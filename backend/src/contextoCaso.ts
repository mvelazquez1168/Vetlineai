import { Pool, PoolClient } from "pg";
import { calcularEdadEfectiva } from "./edadPaciente";

// ---------------------------------------------------------------------
// Ajustes del área de trabajo, Prioridad 1 — el signalment del paciente
// (especie/raza/sexo/edad) y el motivo de consulta ya se registran al
// crear el caso, pero nunca llegaban al modelo: el agente volvía a
// pedirlos, y Breed Intelligence/análisis de signalment (que deben
// activarse apenas se conoce la raza) nunca se disparaban a tiempo.
//
// Este bloque se arma en cada llamada al modelo (chat, Dashboard e
// Informe — las tres rutas que llaman a Claude) y va como un bloque de
// `system` ADICIONAL, después del bloque cacheado (system_prompt +
// documentos), nunca dentro de él ni como mensaje de usuario simulado:
//
//   - No es texto simulado del médico: es contexto de sistema, invisible
//     en la conversación que ve el médico (no se persiste en `mensajes`).
//   - No toca el bloque cacheado: se cachea (system_prompt + documentos,
//     idéntico byte a byte entre casos) es SIEMPRE el primer elemento del
//     array `system` con su propio cache_control; este bloque va después,
//     sin cache_control, así que no invalida ni reescribe ese cache — solo
//     se reevalúa (barato) en cada llamada, que es lo que hace falta para
//     que un dato corregido a mitad de caso (ej. el médico ajusta el peso)
//     llegue en el siguiente turno.
//
// El texto real de la regla ("no volver a pedir lo que ya está acá") vive
// en agentes.system_prompt (sí forma parte del bloque cacheado, porque es
// idéntica para todos los casos de ese agente) — ver migración/UPDATE que
// la agrega a los 8 agentes con integración real.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export async function construirBloqueContextoCaso(db: EjecutorSql, casoId: string): Promise<string> {
  const result = await db.query(
    `SELECT p.nombre, p.especie, r.nombre AS raza, p.sexo, p.edad_anios, p.fecha_nacimiento, c.motivo
     FROM casos c
     JOIN pacientes p ON p.id = c.paciente_id
     LEFT JOIN razas r ON r.id = p.raza_id
     WHERE c.id = $1`,
    [casoId]
  );
  const fila = result.rows[0];
  if (!fila) return "";

  // Solo se listan los campos que la clínica efectivamente cargó — un
  // campo ausente acá es la señal que el system prompt usa para saber
  // qué SÍ le falta preguntar. peso y estado reproductivo no existen hoy
  // en el modelo de datos de pacientes (no hay dónde cargarlos todavía),
  // así que no pueden inyectarse — quedan pendientes de una fase futura
  // que agregue esas columnas.
  const edadEfectiva = calcularEdadEfectiva(fila.fecha_nacimiento, fila.edad_anios);
  const lineas = [`- Paciente: ${fila.nombre}`, `- Especie: ${fila.especie}`];
  if (fila.raza) lineas.push(`- Raza: ${fila.raza}`);
  if (fila.sexo) lineas.push(`- Sexo: ${fila.sexo}`);
  if (edadEfectiva !== null) lineas.push(`- Edad: ${edadEfectiva} años`);
  if (fila.motivo) lineas.push(`- Motivo de consulta: ${fila.motivo}`);

  return (
    "Contexto del caso — datos que la clínica ya registró. NO se los vuelvas a pedir al médico; " +
    "preguntá únicamente lo que falte de acá:\n" +
    lineas.join("\n")
  );
}
