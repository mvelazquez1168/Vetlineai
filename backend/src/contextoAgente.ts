import { PoolClient } from "pg";
import { NOMBRE_DOCUMENTO_PREDISPOSICIONES } from "./razaDocumento";

// =====================================================================
// Contexto que se le arma al agente: documentos de la Base de
// Conocimiento y prescripciones ya emitidas del caso.
//
// Vivía dentro de casos.routes.ts y lo importaban el chat, el informe, la
// validación de recetas, la generación de la síntesis y siete scripts.
// Se extrae acá por una razón concreta, no por prolijidad: generarSintesis.ts
// importaba estas funciones DESDE casos.routes.ts, así que en cuanto una
// ruta necesitara llamar a generarSintesis se cerraba un ciclo entre los
// dos módulos.
//
// Ese ciclo habría funcionado —los dos se usan en tiempo de llamada, no de
// carga— hasta que alguien usara una de estas funciones en el nivel
// superior de un módulo y recibiera `undefined`, con el fallo apareciendo
// lejos de la causa. Este archivo no importa ninguna ruta, así que la
// dirección queda en un solo sentido y el ciclo no se puede volver a
// formar por descuido.
//
// casos.routes.ts las re-exporta para que los nueve importadores actuales
// sigan funcionando sin cambios.
// =====================================================================

// ---------------------------------------------------------------------
// Documentos de la Base de Conocimiento relevantes para el contexto de un
// caso: los del agente del caso (o compartidos, agente_id NULL) que
// ADEMÁS apliquen al país del tenant — sin país asignado (NULL, aplica a
// cualquier país) o coincidiendo exactamente con tenants.pais_codigo.
//
// Trae también d.contenido_texto (texto completo, cuando está cargado) —
// se usa tanto para el chat real de GCIS (workspace.routes.ts) como para
// la generación real del Dashboard más abajo en este archivo.
//
// Excluye a propósito el documento de predisposiciones raciales (ver
// razaDocumento.ts) — ese va aparte, seleccionado por la raza del
// paciente, y NUNCA como parte de este bloque cacheado: si viviera acá,
// el prefijo dejaría de ser idéntico byte a byte entre casos del mismo
// agente (la raza varía por caso) y se perdería el caché compartido para
// TODO el bloque, no solo para este documento.
// ---------------------------------------------------------------------
//
// Devuelve los documentos separados por ámbito (migración 073):
// `clinicos` va en el bloque A, que leen los cuatro caminos, y
// `generacion` en el bloque B, que solo mandan dashboard, informe y
// receta. Se hace en UNA consulta y se separa acá para que el orden
// dentro de cada bloque salga del mismo ORDER BY — dos consultas
// distintas podrían ordenar distinto y eso es una reescritura de caché.
export async function obtenerDocumentosParaContexto(
  db: PoolClient,
  agenteId: string,
  tenantId: string
) {
  const result = await db.query(
    `SELECT d.id, d.nombre, d.tipo, d.archivo_ref, d.contenido_texto, d.ambito
     FROM documentos_conocimiento d
     JOIN tenants t ON t.id = $2
     WHERE d.estado = 'activo'
       AND d.incluir_en_contexto = true
       AND d.nombre != $3
       AND (d.agente_id IS NULL OR d.agente_id = $1)
       AND (d.pais_codigo IS NULL OR d.pais_codigo = t.pais_codigo)
     -- El desempate por id NO es cosmético: este orden define el orden de
     -- los documentos dentro del bloque cacheado, y el caché es un match
     -- de prefijo byte a byte. Ordenando solo por fecha_carga hay empates
     -- reales (5 documentos comparten la misma fecha al milisegundo, y hay
     -- otros cuatro grupos iguales) y Postgres no garantiza un orden
     -- estable entre consultas cuando empatan. En la práctica hoy sale
     -- estable, pero un UPDATE a un documento reescribe la fila al final
     -- del heap y le cambia la posición en un scan sin orden garantizado:
     -- editar un documento desde Platform Admin podría reordenar el bloque
     -- y reescribir el caché entero sin que el contenido cambie. id es
     -- inmutable, así que fija el orden para siempre.
     ORDER BY d.fecha_carga DESC, d.id`,
    [agenteId, tenantId, NOMBRE_DOCUMENTO_PREDISPOSICIONES]
  );
  return {
    clinicos: result.rows.filter((d) => d.ambito !== "generacion"),
    generacion: result.rows.filter((d) => d.ambito === "generacion"),
    todos: result.rows,
  };
}

// Mismo mecanismo que workspace.routes.ts (duplicado a propósito, ver
// nota arriba): documentos con contenido_texto cargado se concatenan
// completos; los que no, se mencionan solo por nombre/tipo/archivo_ref.
// El texto resultante tiene que ser BYTE POR BYTE igual al que arma el
// chat para el mismo caso — de eso depende que esta llamada aproveche el
// cache_control ephemeral que ya paga el chat, en vez de escribir un
// cache nuevo.
export function construirBloqueDocumentos(
  documentos: { nombre: string; tipo: string; archivo_ref: string; contenido_texto: string | null }[]
): string {
  if (documentos.length === 0) {
    return "No hay documentos de referencia adicionales cargados para este agente/país.";
  }
  const documentosConTexto = documentos.filter((d) => d.contenido_texto);
  const documentosSinTexto = documentos.filter((d) => !d.contenido_texto);
  return [
    documentosConTexto.length > 0
      ? "Documentos de referencia (contenido completo) para este caso:\n\n" +
        documentosConTexto
          .map((d) => `### ${d.nombre} (${d.tipo})\n${d.contenido_texto}`)
          .join("\n\n---\n\n")
      : null,
    documentosSinTexto.length > 0
      ? "Documentos de referencia mencionados pero sin contenido de texto cargado " +
        "todavía (solo metadata):\n" +
        documentosSinTexto.map((d) => `- ${d.nombre} (${d.tipo}): ${d.archivo_ref}`).join("\n")
      : null,
  ]
    .filter((bloque): bloque is string => bloque !== null)
    .join("\n\n");
}

// ---------------------------------------------------------------------
// Historial de prescripciones YA emitidas de un caso — función
// compartida (ver prompt_receta_contexto_caso.md) reusada tal cual por
// chat, Dashboard, Informe y validación de recetas, mismo criterio que
// obtenerDocumentosParaContexto/construirBloqueDocumentos arriba. Solo
// 'emitida': un borrador de otra sesión/médico no cuenta como "ya
// prescripto" y no debe filtrarse acá.
// ---------------------------------------------------------------------
export async function obtenerRecetasEmitidasParaContexto(db: PoolClient, casoId: string) {
  const result = await db.query(
    `SELECT r.id, r.emitido_en, per.nombre AS medico_nombre,
            med.nombre AS medicamento_nombre, med.concentracion,
            ri.dosis, ri.frecuencia, ri.duracion, ri.via_administracion, ri.orden
     FROM recetas r
     JOIN personas per ON per.id = r.medico_id
     JOIN receta_items ri ON ri.receta_id = r.id
     JOIN medicamentos med ON med.id = ri.medicamento_id
     WHERE r.caso_id = $1 AND r.estado = 'emitida'
     ORDER BY r.emitido_en ASC, ri.orden ASC`,
    [casoId]
  );
  return result.rows;
}

// Devuelve null (nunca un bloque vacío) cuando el caso no tiene ninguna
// receta emitida todavía — mismo criterio de "nunca insertar secciones
// vacías" que ya aplican Dashboard e Informe para sus propias secciones.
export function construirBloquePrescripciones(
  filas: {
    id: string;
    emitido_en: string;
    medico_nombre: string;
    medicamento_nombre: string;
    concentracion: string | null;
    dosis: string;
    frecuencia: string;
    duracion: string;
    via_administracion: string;
  }[]
): string | null {
  if (filas.length === 0) return null;

  const recetasPorId = new Map<string, { emitido_en: string; medico_nombre: string; items: string[] }>();
  const ordenRecetas: string[] = [];
  for (const fila of filas) {
    if (!recetasPorId.has(fila.id)) {
      recetasPorId.set(fila.id, { emitido_en: fila.emitido_en, medico_nombre: fila.medico_nombre, items: [] });
      ordenRecetas.push(fila.id);
    }
    recetasPorId.get(fila.id)!.items.push(
      `- ${fila.medicamento_nombre}${fila.concentracion ? ` (${fila.concentracion})` : ""}: ` +
        `${fila.dosis}, ${fila.frecuencia}, ${fila.duracion}, vía ${fila.via_administracion}`
    );
  }

  const bloques = ordenRecetas.map((id) => {
    const r = recetasPorId.get(id)!;
    const fecha = new Date(r.emitido_en).toISOString().slice(0, 10);
    return `Receta emitida el ${fecha} por ${r.medico_nombre}:\n${r.items.join("\n")}`;
  });

  return (
    "Historial de prescripciones de este caso (recetas YA EMITIDAS — tenelas en cuenta al " +
    "razonar sobre mensajes nuevos, al generar el Dashboard/Informe, y sobre todo al validar " +
    "una receta nueva contra duplicidad terapéutica; nunca las repitas como si fueran una " +
    "prescripción recién indicada):\n\n" +
    bloques.join("\n\n")
  );
}

// Inserta el bloque (si existe) como un par user/assistant sintético
// ANTES del historial real de mensajes — junto a los mensajes, NO en el
// bloque de system prompt cacheado (ver prompt_receta_contexto_caso.md:
// esto es dinámico por caso, igual que los mensajes, nunca debe
// cachearse como si fuera parte de las Project Instructions o la Base
// de Conocimiento). Si no hay recetas emitidas, no toca el array.
export function insertarBloquePrescripciones<T extends { role: "user" | "assistant"; content: unknown }>(
  mensajes: T[],
  bloque: string | null
): T[] {
  if (!bloque) return mensajes;
  return [
    { role: "user", content: bloque } as T,
    { role: "assistant", content: "Entendido — tengo presente el historial de prescripciones de este caso." } as T,
    ...mensajes,
  ];
}
