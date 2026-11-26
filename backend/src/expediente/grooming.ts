import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// GROOMING — sección 6 del prompt 07.
//
// Lo que hace que esto valga la pena no es el registro del baño: es el
// CANAL DE HALLAZGOS. El groomer es quien toca al animal entero todos
// los meses, y es el primero que encuentra el bulto, la otitis o las
// pulgas. En un sistema donde el grooming vive aparte, ese hallazgo se
// queda en la peluquería.
//
// Un hallazgo sin atender aparece en la franja de alertas del paciente y
// en los avisos del médico, y se apaga cuando un médico lo marca
// atendido —opcionalmente ligándolo a la atención donde lo revisó—.
// No se apaga solo con el tiempo: un bulto no desaparece porque pasen
// tres semanas.
//
// EL GROOMER NO ESCRIBE CONTENIDO CLÍNICO (sección 1: "lo clínico es del
// médico"). Escribe lo que vio, con su tipo y su descripción, y eso es
// un hallazgo, no un diagnóstico. La ruta lo gatea por rol.
// ---------------------------------------------------------------------

export interface Grooming {
  id: string;
  fecha: string;
  groomer_nombre: string | null;
  tipo_corte: string | null;
  comportamiento: string | null;
  observaciones: string | null;
  foto_antes_id: string | null;
  foto_despues_id: string | null;
  servicios: string[];
  hallazgos: Array<{
    id: string;
    tipo: string;
    descripcion: string;
    atendido_en: string | null;
  }>;
}

export async function registrarGrooming(
  db: PoolClient,
  tenantId: string,
  datos: {
    pacienteId: string;
    citaId?: string;
    groomerId?: string;
    fecha?: string;
    tipoCorte?: string;
    comportamiento?: "tranquilo" | "nervioso" | "agresivo" | "no_coopera";
    observaciones?: string;
    fotoAntesId?: string;
    fotoDespuesId?: string;
    /** Servicios del catálogo. El bloque B les pone precio. */
    servicios?: Array<{ servicioId?: string; descripcion: string }>;
    hallazgos?: Array<{ tipo: string; descripcion: string }>;
  }
): Promise<{ id: string; hallazgos: number }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_grooming (tenant_id, paciente_id, cita_id, fecha, groomer_id, tipo_corte,
                               comportamiento, observaciones, foto_antes_id, foto_despues_id)
     VALUES ($1,$2,$3,COALESCE($4::timestamptz, now()),$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      tenantId,
      datos.pacienteId,
      datos.citaId ?? null,
      datos.fecha ?? null,
      datos.groomerId ?? null,
      datos.tipoCorte?.trim() || null,
      datos.comportamiento ?? null,
      datos.observaciones?.trim() || null,
      datos.fotoAntesId ?? null,
      datos.fotoDespuesId ?? null,
    ]
  );
  const groomingId = r.rows[0].id;

  for (const s of datos.servicios ?? []) {
    if (!s.descripcion?.trim()) continue;
    await db.query(
      `INSERT INTO exp_grooming_servicios (tenant_id, grooming_id, servicio_id, descripcion)
       VALUES ($1,$2,$3,$4) ON CONFLICT (grooming_id, servicio_id) DO NOTHING`,
      [tenantId, groomingId, s.servicioId ?? null, s.descripcion.trim()]
    );
  }

  let hallazgos = 0;
  for (const h of datos.hallazgos ?? []) {
    if (!h.descripcion?.trim()) continue;
    await db.query(
      `INSERT INTO exp_grooming_hallazgos (tenant_id, grooming_id, paciente_id, tipo, descripcion)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, groomingId, datos.pacienteId, h.tipo, h.descripcion.trim()]
    );
    hallazgos++;
  }

  return { id: groomingId, hallazgos };
}

export async function groomingDePaciente(
  db: PoolClient,
  pacienteId: string
): Promise<Grooming[]> {
  const r = await db.query<Grooming>(
    `SELECT g.id, g.fecha, g.tipo_corte, g.comportamiento, g.observaciones,
            g.foto_antes_id, g.foto_despues_id, per.nombre AS groomer_nombre,
            COALESCE((SELECT json_agg(s.descripcion) FROM exp_grooming_servicios s
                       WHERE s.grooming_id = g.id), '[]'::json) AS servicios,
            COALESCE((SELECT json_agg(json_build_object('id', h.id, 'tipo', h.tipo,
                       'descripcion', h.descripcion, 'atendido_en', h.atendido_en))
                        FROM exp_grooming_hallazgos h WHERE h.grooming_id = g.id),
                     '[]'::json) AS hallazgos
       FROM exp_grooming g
       LEFT JOIN personas per ON per.id = g.groomer_id
      WHERE g.paciente_id = $1
      ORDER BY g.fecha DESC`,
    [pacienteId]
  );
  return r.rows;
}

/** Los hallazgos que todavía nadie revisó. Van a la franja de alertas. */
export async function hallazgosPendientes(db: PoolClient, pacienteId?: string) {
  const r = await db.query(
    `SELECT h.id, h.tipo, h.descripcion, h.creado_en, h.paciente_id, p.nombre AS paciente,
            g.fecha AS fecha_grooming, per.nombre AS groomer
       FROM exp_grooming_hallazgos h
       JOIN pacientes p ON p.id = h.paciente_id
       JOIN exp_grooming g ON g.id = h.grooming_id
       LEFT JOIN personas per ON per.id = g.groomer_id
      WHERE h.atendido_en IS NULL AND ($1::uuid IS NULL OR h.paciente_id = $1::uuid)
      ORDER BY h.creado_en DESC
      LIMIT 200`,
    [pacienteId ?? null]
  );
  return r.rows;
}

/**
 * Un médico marca el hallazgo como revisado.
 *
 * Lo tiene que hacer una persona: nada lo apaga por tiempo. Si se
 * apagara solo, el aviso dejaría de servir para lo único que sirve —que
 * alguien lo mire—.
 */
export async function atenderHallazgo(
  db: PoolClient,
  hallazgoId: string,
  personaId: string,
  atencionId?: string
): Promise<void> {
  const r = await db.query(
    `UPDATE exp_grooming_hallazgos
        SET atendido_en = now(), atendido_por = $2, atencion_id = COALESCE($3, atencion_id)
      WHERE id = $1 AND atendido_en IS NULL`,
    [hallazgoId, personaId, atencionId ?? null]
  );
  if (r.rowCount === 0) {
    throw new Error("Ese hallazgo no existe o ya fue atendido.");
  }
}
