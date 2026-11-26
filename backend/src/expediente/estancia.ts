import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// QUIÉN ESTÁ EN LA CLÍNICA — anexo del 07, parte A2.
//
// La atención registra cuándo entró el paciente y, si corresponde,
// cuándo salió. Con eso —y con nada más— se contesta la pregunta que la
// recepción hace veinte veces por día: «¿quién está adentro y desde
// cuándo?».
//
// LO QUE ESTO NO ES, Y EL ANEXO LO DICE EXPLÍCITO: no es
// hospitalización. No hay hoja de tratamiento, ni jaulas, ni rondas, ni
// turnos de enfermería. Son dos marcas de tiempo y una bandera. La
// propuesta de modelo para el módulo de hospitalización que podría
// colgarse de acá está en el informe del anexo, escrita y no
// construida.
//
// LA HORA DE INGRESO NO SE INVENTA. Sale del check-in de la cita
// (`citas.check_in_en`, migración 120) cuando el paciente pasó por
// recepción; si no pasó —la consulta sin turno que se abre en el
// momento—, es la hora en que se abrió la atención. Las dos son ciertas;
// lo que no sería cierto es usar `now()` al cerrar y llamarlo «hora de
// ingreso».
// ---------------------------------------------------------------------

export interface EnLaClinica {
  atencionId: string;
  pacienteId: string;
  paciente: string;
  especie: string | null;
  propietario: string;
  medico: string | null;
  ingresoEn: string;
  /** Minutos desde que entró. Lo calcula la base, no el navegador. */
  minutosAdentro: number;
  esEstancia: boolean;
  estanciaMotivo: string | null;
  estadoAtencion: string;
}

/**
 * Sella la hora de ingreso de la atención.
 *
 * Idempotente a propósito: si ya hay hora, no se pisa. Abrir dos veces
 * la misma atención no puede hacer que el paciente «entre» de nuevo.
 */
export async function sellarIngreso(
  db: PoolClient,
  atencionId: string,
  citaId: string | null
): Promise<void> {
  await db.query(
    `UPDATE atenciones a
        SET ingreso_en = COALESCE(
              a.ingreso_en,
              (SELECT c.check_in_en FROM citas c WHERE c.id = $2),
              now()
            )
      WHERE a.id = $1 AND a.ingreso_en IS NULL`,
    [atencionId, citaId]
  );
}

/** La salida la marca quien la ve irse, y se puede corregir. */
export async function registrarSalida(
  db: PoolClient,
  atencionId: string,
  cuando?: string | null
): Promise<{ salidaEn: string }> {
  const r = await db.query<{ salida_en: Date; ingreso_en: Date | null }>(
    `UPDATE atenciones SET salida_en = COALESCE($2::timestamptz, now()), actualizado_en = now()
      WHERE id = $1
      RETURNING salida_en, ingreso_en`,
    [atencionId, cuando ?? null]
  );
  if (r.rows.length === 0) throw new Error("Esa atención no existe.");
  return { salidaEn: r.rows[0].salida_en.toISOString() };
}

export async function deshacerSalida(db: PoolClient, atencionId: string): Promise<void> {
  await db.query(`UPDATE atenciones SET salida_en = NULL, actualizado_en = now() WHERE id = $1`, [
    atencionId,
  ]);
}

/**
 * Marca (o desmarca) la atención como estancia.
 *
 * El motivo es obligatorio al marcarla: «estancia» sin motivo no le
 * dice nada a quien entra a las seis de la tarde y ve un perro que no
 * esperaba.
 */
export async function marcarEstancia(
  db: PoolClient,
  atencionId: string,
  esEstancia: boolean,
  motivo?: string | null
): Promise<void> {
  if (esEstancia && !motivo?.trim()) {
    throw new Error("Una estancia lleva el motivo por el que el paciente se queda.");
  }
  await db.query(
    `UPDATE atenciones
        SET es_estancia = $2,
            estancia_motivo = CASE WHEN $2 THEN $3 ELSE NULL END,
            actualizado_en = now()
      WHERE id = $1`,
    [atencionId, esEstancia, motivo?.trim() ?? null]
  );
}

/**
 * Quién está adentro ahora mismo.
 *
 * El criterio es «entró y no salió», no «la atención está en
 * borrador»: un paciente puede quedarse después de que el médico firmó
 * —esperando que lo retiren, o en observación— y seguir estando en la
 * clínica. Ligar las dos cosas haría que firmar la atención sacara al
 * animal de la lista sin que nadie lo haya retirado.
 */
export async function enLaClinicaAhora(db: PoolClient): Promise<EnLaClinica[]> {
  const r = await db.query(
    `SELECT a.id, a.paciente_id, p.nombre AS paciente, p.especie,
            pr.nombre AS propietario, m.nombre AS medico,
            a.ingreso_en, a.es_estancia, a.estancia_motivo, a.estado,
            EXTRACT(EPOCH FROM (now() - a.ingreso_en))::int / 60 AS minutos
       FROM atenciones a
       JOIN pacientes p   ON p.id = a.paciente_id
       JOIN propietarios pr ON pr.id = p.propietario_id
       LEFT JOIN personas m ON m.id = a.medico_id
      WHERE a.ingreso_en IS NOT NULL
        AND a.salida_en IS NULL
      ORDER BY a.es_estancia DESC, a.ingreso_en`,
    []
  );
  return (r.rows as Record<string, unknown>[]).map((f) => ({
    atencionId: f.id as string,
    pacienteId: f.paciente_id as string,
    paciente: f.paciente as string,
    especie: (f.especie as string) ?? null,
    propietario: f.propietario as string,
    medico: (f.medico as string) ?? null,
    ingresoEn: (f.ingreso_en as Date).toISOString(),
    minutosAdentro: Number(f.minutos),
    esEstancia: Boolean(f.es_estancia),
    estanciaMotivo: (f.estancia_motivo as string) ?? null,
    estadoAtencion: f.estado as string,
  }));
}
