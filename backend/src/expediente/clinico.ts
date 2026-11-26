import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// LO CLÍNICO DEL EXPEDIENTE que no estaba: la lista de problemas, las
// alergias estructuradas y las adendas.
//
// Las tres responden a la sección 1 del prompt 07 —"una sola fuente por
// dato" e "integridad del registro médico"— y las tres tienen una regla
// que vale la pena decir en voz alta:
//
//   * un PROBLEMA es longitudinal: nace en una visita, se trata en
//     varias y se resuelve en otra. No es el diagnóstico de una visita;
//     el diagnóstico de la visita vive en la atención.
//   * una ALERGIA estructurada existe porque `pacientes.alergias` es
//     texto libre y con texto libre no se puede avisar al recetar.
//   * una ADENDA es la única forma de agregarle algo a una atención
//     cerrada. La base lo impone con un trigger; acá solo se escribe.
// ---------------------------------------------------------------------

export interface Problema {
  id: string;
  descripcion: string;
  estado: "activo" | "cronico" | "resuelto";
  fecha_inicio: string;
  fecha_resolucion: string | null;
  nota: string | null;
  atencion_origen_id: string | null;
  caso_id: string | null;
  atenciones: number;
}

export async function problemasDePaciente(
  db: PoolClient,
  pacienteId: string
): Promise<Problema[]> {
  const r = await db.query<Problema>(
    `SELECT p.id, p.descripcion, p.estado, p.fecha_inicio, p.fecha_resolucion, p.nota,
            p.atencion_origen_id, p.caso_id,
            (SELECT count(*) FROM exp_problema_atenciones pa WHERE pa.problema_id = p.id)::int
              AS atenciones
       FROM exp_problemas p
      WHERE p.paciente_id = $1
      ORDER BY CASE p.estado WHEN 'activo' THEN 0 WHEN 'cronico' THEN 1 ELSE 2 END,
               p.fecha_inicio DESC`,
    [pacienteId]
  );
  return r.rows;
}

export async function agregarProblema(
  db: PoolClient,
  tenantId: string,
  datos: {
    pacienteId: string;
    descripcion: string;
    estado?: "activo" | "cronico";
    fechaInicio?: string;
    nota?: string;
    atencionOrigenId?: string;
    casoId?: string;
    personaId?: string;
  }
): Promise<{ id: string }> {
  if (!datos.descripcion?.trim()) {
    throw new Error("Un problema necesita su descripción: es lo que se va a seguir en el tiempo.");
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_problemas (tenant_id, paciente_id, descripcion, estado, fecha_inicio, nota,
                                atencion_origen_id, caso_id, creado_por)
     VALUES ($1,$2,$3,COALESCE($4,'activo'),COALESCE($5::date, CURRENT_DATE),$6,$7,$8,$9)
     RETURNING id`,
    [
      tenantId,
      datos.pacienteId,
      datos.descripcion.trim(),
      datos.estado ?? null,
      datos.fechaInicio ?? null,
      datos.nota?.trim() || null,
      datos.atencionOrigenId ?? null,
      datos.casoId ?? null,
      datos.personaId ?? null,
    ]
  );
  if (datos.atencionOrigenId) {
    await ligarProblemaAAtencion(db, tenantId, r.rows[0].id, datos.atencionOrigenId);
  }
  return { id: r.rows[0].id };
}

/**
 * Cambia el estado de un problema.
 *
 * Resolver EXIGE la fecha —la base lo impone— porque "resuelto sin
 * fecha" no se puede leer después: no se sabe si fue hace una semana o
 * hace tres años.
 */
export async function cambiarEstadoProblema(
  db: PoolClient,
  tenantId: string,
  problemaId: string,
  datos: {
    estado: "activo" | "cronico" | "resuelto";
    fechaResolucion?: string;
    nota?: string;
  }
): Promise<void> {
  const fecha =
    datos.estado === "resuelto" ? (datos.fechaResolucion ?? new Date().toISOString().slice(0, 10)) : null;
  const r = await db.query(
    `UPDATE exp_problemas
        SET estado = $3, fecha_resolucion = $4::date,
            nota = COALESCE($5, nota), actualizado_en = now()
      WHERE id = $1 AND tenant_id = $2`,
    [problemaId, tenantId, datos.estado, fecha, datos.nota?.trim() || null]
  );
  if (r.rowCount === 0) throw new Error("Ese problema no existe.");
}

export async function ligarProblemaAAtencion(
  db: PoolClient,
  tenantId: string,
  problemaId: string,
  atencionId: string
): Promise<void> {
  await db.query(
    `INSERT INTO exp_problema_atenciones (tenant_id, problema_id, atencion_id)
     VALUES ($1,$2,$3) ON CONFLICT (problema_id, atencion_id) DO NOTHING`,
    [tenantId, problemaId, atencionId]
  );
}

// ---------------------------------------------------------------------
// ALERGIAS
// ---------------------------------------------------------------------

export interface Alergia {
  id: string;
  tipo: string;
  sustancia: string;
  grupo: string | null;
  severidad: string;
  reaccion: string | null;
  nota: string | null;
  medicamento_id: string | null;
  medicamento_nombre: string | null;
}

/** Normaliza para comparar: minúsculas, sin acentos, sin espacios extra. */
export function normalizarSustancia(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export async function alergiasDePaciente(
  db: PoolClient,
  pacienteId: string
): Promise<Alergia[]> {
  const r = await db.query<Alergia>(
    `SELECT a.id, a.tipo, a.sustancia, a.grupo, a.severidad, a.reaccion, a.nota,
            a.medicamento_id, m.nombre AS medicamento_nombre
       FROM exp_alergias a
       LEFT JOIN medicamentos m ON m.id = a.medicamento_id
      WHERE a.paciente_id = $1
      ORDER BY CASE a.severidad WHEN 'grave' THEN 0 WHEN 'moderada' THEN 1 ELSE 2 END,
               a.sustancia`,
    [pacienteId]
  );
  return r.rows;
}

export async function registrarAlergia(
  db: PoolClient,
  tenantId: string,
  datos: {
    pacienteId: string;
    sustancia: string;
    tipo?: "alergia" | "reaccion_adversa" | "intolerancia";
    medicamentoId?: string;
    grupo?: string;
    severidad?: "leve" | "moderada" | "grave";
    reaccion?: string;
    nota?: string;
    personaId?: string;
  }
): Promise<{ id: string }> {
  if (!datos.sustancia?.trim()) {
    throw new Error("Una alergia necesita decir A QUÉ: sin la sustancia no se puede avisar al recetar.");
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_alergias (tenant_id, paciente_id, tipo, medicamento_id, sustancia, grupo,
                               severidad, reaccion, nota, registrado_por)
     VALUES ($1,$2,COALESCE($3,'alergia'),$4,$5,$6,COALESCE($7,'moderada'),$8,$9,$10)
     RETURNING id`,
    [
      tenantId,
      datos.pacienteId,
      datos.tipo ?? null,
      datos.medicamentoId ?? null,
      normalizarSustancia(datos.sustancia),
      datos.grupo ? normalizarSustancia(datos.grupo) : null,
      datos.severidad ?? null,
      datos.reaccion?.trim() || null,
      datos.nota?.trim() || null,
      datos.personaId ?? null,
    ]
  );
  return { id: r.rows[0].id };
}

export interface AvisoAlergia {
  alergia: Alergia;
  /** Por qué coincidió: el fármaco mismo, su nombre o su grupo. */
  porque: "medicamento" | "sustancia" | "grupo";
}

/**
 * ¿ESTE PACIENTE ES ALÉRGICO A ESTO?
 *
 * Se consulta antes de confirmar una receta (bloque B) y devuelve los
 * avisos, no un booleano: la pantalla tiene que poder decir a qué es
 * alérgico y con qué gravedad, porque la decisión es del médico.
 *
 * Tres formas de coincidir, de la más fuerte a la más débil:
 *
 *   1. el `medicamento_id` es el mismo;
 *   2. el nombre o el principio activo contiene la sustancia
 *      registrada (o al revés): "amoxicilina" coincide con
 *      "amoxicilina con clavulánico";
 *   3. el GRUPO coincide: una alergia a "penicilinas" alcanza a la
 *      amoxicilina aunque nadie haya cargado ese fármaco.
 *
 * La comparación es por contención y no exacta a propósito: el nombre
 * comercial casi nunca es igual al principio activo, y un aviso de más
 * lo descarta el médico en un segundo, mientras que uno de menos es una
 * reacción.
 */
export async function avisosDeAlergia(
  db: PoolClient,
  pacienteId: string,
  farmaco: { medicamentoId?: string; nombre?: string; principioActivo?: string; grupo?: string }
): Promise<AvisoAlergia[]> {
  const alergias = await alergiasDePaciente(db, pacienteId);
  if (alergias.length === 0) return [];

  const textos = [farmaco.nombre, farmaco.principioActivo]
    .filter(Boolean)
    .map((t) => normalizarSustancia(String(t)));
  const grupo = farmaco.grupo ? normalizarSustancia(farmaco.grupo) : null;

  const avisos: AvisoAlergia[] = [];
  for (const a of alergias) {
    if (farmaco.medicamentoId && a.medicamento_id === farmaco.medicamentoId) {
      avisos.push({ alergia: a, porque: "medicamento" });
      continue;
    }
    if (textos.some((t) => t.includes(a.sustancia) || a.sustancia.includes(t))) {
      avisos.push({ alergia: a, porque: "sustancia" });
      continue;
    }
    if (a.grupo && grupo && (a.grupo === grupo || grupo.includes(a.grupo))) {
      avisos.push({ alergia: a, porque: "grupo" });
    }
  }
  return avisos;
}

// ---------------------------------------------------------------------
// ADENDAS
// ---------------------------------------------------------------------

export async function agregarAdenda(
  db: PoolClient,
  tenantId: string,
  datos: { atencionId: string; motivo: string; texto: string; personaId?: string }
): Promise<{ id: string }> {
  if (!datos.motivo?.trim()) {
    throw new Error(
      "Una adenda lleva su MOTIVO: es lo que explica por qué se agregó algo después de cerrar."
    );
  }
  if (!datos.texto?.trim()) throw new Error("Una adenda sin texto no agrega nada.");

  const a = await db.query<{ estado: string }>(`SELECT estado FROM atenciones WHERE id = $1`, [
    datos.atencionId,
  ]);
  if (a.rows.length === 0) throw new Error("Esa atención no existe.");
  if (a.rows[0].estado === "borrador") {
    throw new Error(
      "Esa atención todavía está abierta: lo que haya que agregar se escribe en ella. Una adenda es para una atención ya cerrada."
    );
  }

  // El nombre del autor se COPIA, por el mismo motivo que el del médico
  // que firma: el registro tiene que leerse dentro de diez años.
  const persona = datos.personaId
    ? await db.query<{ nombre: string }>(`SELECT nombre FROM personas WHERE id = $1`, [
        datos.personaId,
      ])
    : null;

  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_adendas (tenant_id, atencion_id, motivo, texto, autor_id, autor_nombre)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      tenantId,
      datos.atencionId,
      datos.motivo.trim(),
      datos.texto.trim(),
      datos.personaId ?? null,
      persona?.rows[0]?.nombre ?? null,
    ]
  );
  return { id: r.rows[0].id };
}

export async function adendasDeAtencion(db: PoolClient, atencionId: string) {
  const r = await db.query(
    `SELECT id, motivo, texto, autor_nombre, creado_en FROM exp_adendas
      WHERE atencion_id = $1 ORDER BY creado_en`,
    [atencionId]
  );
  return r.rows;
}

/**
 * Cierra y FIRMA una atención.
 *
 * La firma es el nombre de quien cierra, copiado. A partir de acá la
 * base no deja editar lo clínico: solo adendas.
 *
 * El bloque B llama a esto como último paso de su cierre coherente; acá
 * existe por separado porque una atención vieja sin cargos también se
 * cierra.
 */
export async function cerrarYFirmarAtencion(
  db: PoolClient,
  atencionId: string,
  personaId: string
): Promise<void> {
  const persona = await db.query<{ nombre: string; es_medico: boolean }>(
    `SELECT nombre, es_medico FROM personas WHERE id = $1`,
    [personaId]
  );
  if (persona.rows.length === 0) throw new Error("Esa persona no existe.");
  if (!persona.rows[0].es_medico) {
    throw new Error(
      "Una atención la firma un médico: es contenido clínico, y la firma dice quién responde por él."
    );
  }

  const r = await db.query(
    `UPDATE atenciones
        SET estado = 'cerrada', cerrada_en = now(), firmada_por = $2, firmada_nombre = $3
      WHERE id = $1 AND estado = 'borrador'`,
    [atencionId, personaId, persona.rows[0].nombre]
  );
  if (r.rowCount === 0) {
    throw new Error("Esa atención no existe o ya estaba cerrada.");
  }
}
