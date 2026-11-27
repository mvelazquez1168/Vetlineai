import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// TURNOS, AUSENCIAS Y CREDENCIALES — prompt 11, §2.
//
// EL TURNO NO ES EL HORARIO. El horario del médico dice cuándo **puede**
// atender; el turno, cuándo **le toca**. Una clínica con tres médicos y
// un consultorio necesita los dos: todos pueden los lunes, y el lunes
// atiende uno.
//
// LAS AUSENCIAS SON `clinica_excepciones`, la tabla del 04 que la agenda
// ya consulta. Acá se agregan la solicitud y la aprobación, que es lo
// que le faltaba. Una segunda tabla de ausencias obligaría a la agenda a
// mirar dos lugares.
// ---------------------------------------------------------------------

export class PersonalInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PersonalInvalido";
  }
}

export interface Turno {
  id: string;
  persona_id: string;
  persona_nombre: string;
  fecha: string;
  hora_desde: string;
  hora_hasta: string;
  tipo: string;
  nota: string | null;
}

export async function turnos(
  db: PoolClient,
  tenantId: string,
  desde: string,
  hasta: string,
  personaId?: string
): Promise<Turno[]> {
  const r = await db.query<Turno>(
    `SELECT t.id, t.persona_id, p.nombre AS persona_nombre, t.fecha::text,
            t.hora_desde::text, t.hora_hasta::text, t.tipo, t.nota
       FROM personal_turnos t
       JOIN personas p ON p.id = t.persona_id
      WHERE t.tenant_id = $1 AND t.fecha BETWEEN $2::date AND $3::date
        AND ($4::uuid IS NULL OR t.persona_id = $4::uuid)
      ORDER BY t.fecha, t.hora_desde, p.nombre`,
    [tenantId, desde, hasta, personaId ?? null]
  );
  return r.rows;
}

export async function guardarTurno(
  db: PoolClient,
  tenantId: string,
  datos: {
    personaId: string;
    fecha: string;
    horaDesde: string;
    horaHasta: string;
    tipo?: string;
    nota?: string | null;
    personaQueRegistra: string;
  }
): Promise<{ id: string }> {
  if (datos.horaHasta <= datos.horaDesde) {
    throw new PersonalInvalido(`El turno de ${datos.horaDesde} a ${datos.horaHasta} termina antes de empezar.`);
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO personal_turnos
       (tenant_id, persona_id, fecha, hora_desde, hora_hasta, tipo, nota, creado_por)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'turno'),$7,$8)
     ON CONFLICT (persona_id, fecha, hora_desde, tipo)
       DO UPDATE SET hora_hasta = EXCLUDED.hora_hasta, nota = EXCLUDED.nota
     RETURNING id`,
    [
      tenantId,
      datos.personaId,
      datos.fecha,
      datos.horaDesde,
      datos.horaHasta,
      datos.tipo ?? null,
      datos.nota ?? null,
      datos.personaQueRegistra,
    ]
  );
  return r.rows[0];
}

export async function borrarTurno(db: PoolClient, tenantId: string, id: string): Promise<void> {
  await db.query(`DELETE FROM personal_turnos WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
}

/**
 * Copia los turnos de una semana a otra.
 *
 * Es lo que hace que armar la semana no sea escribir veinte turnos: una
 * clínica repite su semana con pocos cambios.
 *
 * NO PISA lo que ya haya en la semana destino: el `ON CONFLICT` de
 * `guardarTurno` actualiza la hora de fin, así que copiar dos veces no
 * duplica.
 */
export async function copiarSemana(
  db: PoolClient,
  tenantId: string,
  datos: { desdeLunes: string; haciaLunes: string; personaQueRegistra: string }
): Promise<{ copiados: number }> {
  const origen = await db.query<{
    persona_id: string;
    fecha: string;
    hora_desde: string;
    hora_hasta: string;
    tipo: string;
    nota: string | null;
    dia: number;
  }>(
    `SELECT persona_id, fecha::text, hora_desde::text, hora_hasta::text, tipo, nota,
            (fecha - $2::date)::int AS dia
       FROM personal_turnos
      WHERE tenant_id = $1 AND fecha >= $2::date AND fecha < $2::date + 7`,
    [tenantId, datos.desdeLunes]
  );

  let copiados = 0;
  for (const t of origen.rows) {
    const fecha = await db.query<{ f: string }>(
      `SELECT ($1::date + $2::int)::text AS f`,
      [datos.haciaLunes, t.dia]
    );
    await guardarTurno(db, tenantId, {
      personaId: t.persona_id,
      fecha: fecha.rows[0].f,
      horaDesde: t.hora_desde,
      horaHasta: t.hora_hasta,
      tipo: t.tipo,
      nota: t.nota,
      personaQueRegistra: datos.personaQueRegistra,
    });
    copiados += 1;
  }
  return { copiados };
}

/**
 * ¿Esta persona tiene turno a esta hora?
 *
 * La agenda la usa para avisar —no para prohibir— cuando se cita a
 * alguien fuera de su turno: el turno es organización de la clínica, no
 * una regla sanitaria, y el prompt pide que se pueda citar igual con el
 * permiso de excepción.
 *
 * SIN NINGÚN TURNO CARGADO ESE DÍA, no dice nada: una clínica que no usa
 * turnos no tiene por qué ver avisos.
 */
export async function tieneTurno(
  db: PoolClient,
  tenantId: string,
  datos: { personaId: string; fecha: string; horaInicio: string; horaFin: string }
): Promise<{ hayTurnos: boolean; dentro: boolean; turnos: Array<{ desde: string; hasta: string }> }> {
  const r = await db.query<{ hora_desde: string; hora_hasta: string }>(
    `SELECT hora_desde::text, hora_hasta::text FROM personal_turnos
      WHERE tenant_id = $1 AND persona_id = $2 AND fecha = $3::date AND tipo = 'turno'
      ORDER BY hora_desde`,
    [tenantId, datos.personaId, datos.fecha]
  );
  if (r.rows.length === 0) return { hayTurnos: false, dentro: true, turnos: [] };
  const dentro = r.rows.some(
    (t) => datos.horaInicio >= t.hora_desde.slice(0, 5) && datos.horaFin <= t.hora_hasta.slice(0, 5)
  );
  return {
    hayTurnos: true,
    dentro,
    turnos: r.rows.map((t) => ({ desde: t.hora_desde.slice(0, 5), hasta: t.hora_hasta.slice(0, 5) })),
  };
}

// ---------------------------------------------------------------------
// LAS AUSENCIAS, sobre `clinica_excepciones`.
// ---------------------------------------------------------------------

export interface Ausencia {
  id: string;
  tipo: string;
  nombre: string;
  desde: string;
  hasta: string;
  medico_id: string | null;
  medico_nombre: string | null;
  estado: string;
  bloquea: boolean;
  citas_afectadas: number;
}

export async function ausencias(
  db: PoolClient,
  tenantId: string,
  desde?: string
): Promise<Ausencia[]> {
  const r = await db.query<Ausencia>(
    `SELECT e.id, e.tipo, e.nombre, e.desde::text, e.hasta::text, e.medico_id,
            p.nombre AS medico_nombre, e.estado, e.bloquea,
            -- LAS CITAS QUE QUEDAN EN EL AIRE. El prompt pide que se
            -- señalen para reasignar: no se cancelan solas.
            (SELECT count(*) FROM citas c
              WHERE c.medico_id = e.medico_id
                AND c.fecha BETWEEN e.desde AND e.hasta
                AND c.estado IN ('programada', 'confirmada'))::int AS citas_afectadas
       FROM clinica_excepciones e
       LEFT JOIN personas p ON p.id = e.medico_id
      WHERE e.tenant_id = $1
        AND e.medico_id IS NOT NULL
        AND e.hasta >= COALESCE($2::date, CURRENT_DATE - 30)
      ORDER BY e.desde DESC`,
    [tenantId, desde ?? null]
  );
  return r.rows;
}

/**
 * Pedir una ausencia.
 *
 * NACE SIN BLOQUEAR LA AGENDA. Pedir vacaciones no puede cerrarle la
 * agenda a nadie antes de que se las aprueben: la recepción seguiría sin
 * poder citar a un médico que al final no se va.
 *
 * NO SE GUARDA EL DIAGNÓSTICO de una incapacidad: solo el tipo y las
 * fechas. Es dato de salud de un empleado y la clínica no lo necesita
 * para organizar la agenda.
 */
export async function pedirAusencia(
  db: PoolClient,
  tenantId: string,
  datos: {
    personaId: string;
    tipo: "vacaciones" | "incapacidad" | "permiso";
    desde: string;
    hasta: string;
    nota?: string | null;
    solicitadaPor: string;
    /** Quien tiene el permiso la aprueba en el mismo acto. */
    aprobarYa?: boolean;
    aprobadaPor?: string;
  }
): Promise<{ id: string; citasAfectadas: number }> {
  if (datos.hasta < datos.desde) {
    throw new PersonalInvalido("La ausencia termina antes de empezar.");
  }
  const nombre = await db.query<{ nombre: string }>(
    `SELECT nombre FROM personas WHERE id = $1 AND tenant_id = $2`,
    [datos.personaId, tenantId]
  );
  if (nombre.rows.length === 0) throw new PersonalInvalido("Esa persona no trabaja en la clínica.");

  const etiqueta =
    datos.tipo === "vacaciones"
      ? `Vacaciones de ${nombre.rows[0].nombre}`
      : datos.tipo === "incapacidad"
        ? `Incapacidad de ${nombre.rows[0].nombre}`
        : `Permiso de ${nombre.rows[0].nombre}`;

  const aprobada = datos.aprobarYa === true;
  const r = await db.query<{ id: string }>(
    `INSERT INTO clinica_excepciones
       (tenant_id, tipo, nombre, desde, hasta, medico_id, bloquea,
        estado, solicitado_por, aprobado_por, aprobado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      tenantId,
      // `incapacidad` y `permiso` no están en el CHECK del 04, que
      // conoce feriado, vacaciones y bloqueo. Se guardan como
      // `vacaciones` cuando lo son y como `bloqueo` en los demás casos:
      // para la AGENDA son lo mismo —ese día no atiende— y el tipo real
      // va en el nombre, que es lo que la gente lee.
      datos.tipo === "vacaciones" ? "vacaciones" : "bloqueo",
      etiqueta + (datos.nota ? ` — ${datos.nota}` : ""),
      datos.desde,
      datos.hasta,
      datos.personaId,
      aprobada,
      aprobada ? "aprobada" : "pendiente",
      datos.solicitadaPor,
      aprobada ? (datos.aprobadaPor ?? datos.solicitadaPor) : null,
      aprobada ? new Date() : null,
    ]
  );

  const citas = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM citas
      WHERE medico_id = $1 AND fecha BETWEEN $2::date AND $3::date
        AND estado IN ('programada', 'confirmada')`,
    [datos.personaId, datos.desde, datos.hasta]
  );

  return { id: r.rows[0].id, citasAfectadas: citas.rows[0].n };
}

export async function resolverAusencia(
  db: PoolClient,
  tenantId: string,
  datos: { id: string; aprobar: boolean; personaId: string }
): Promise<void> {
  const r = await db.query(
    `UPDATE clinica_excepciones
        SET estado = $3, bloquea = $4, aprobado_por = $5, aprobado_en = now()
      WHERE id = $1 AND tenant_id = $2 AND estado = 'pendiente'`,
    [datos.id, tenantId, datos.aprobar ? "aprobada" : "rechazada", datos.aprobar, datos.personaId]
  );
  if (r.rowCount === 0) {
    throw new PersonalInvalido("Esa ausencia no existe o ya estaba resuelta.");
  }
}

// ---------------------------------------------------------------------
// LAS CREDENCIALES Y SUS VENCIMIENTOS.
// ---------------------------------------------------------------------

export async function credenciales(
  db: PoolClient,
  tenantId: string,
  personaId?: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT c.id, c.persona_id, p.nombre AS persona_nombre, c.tipo, c.numero,
            c.emitida_el::text, c.vence_el::text, c.archivo_clave, c.activo,
            (c.vence_el - CURRENT_DATE)::int AS dias_para_vencer
       FROM personal_credenciales c
       JOIN personas p ON p.id = c.persona_id
      WHERE c.tenant_id = $1 AND ($2::uuid IS NULL OR c.persona_id = $2::uuid)
      ORDER BY c.vence_el NULLS LAST, p.nombre`,
    [tenantId, personaId ?? null]
  );
  return r.rows;
}

export async function guardarCredencial(
  db: PoolClient,
  tenantId: string,
  datos: {
    id?: string;
    personaId: string;
    tipo: string;
    numero?: string | null;
    emitidaEl?: string | null;
    venceEl?: string | null;
    archivoClave?: string | null;
    activo?: boolean;
  }
): Promise<{ id: string }> {
  if (!datos.tipo?.trim()) throw new PersonalInvalido("La credencial necesita un tipo.");
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE personal_credenciales
          SET tipo = $3, numero = $4, emitida_el = $5, vence_el = $6,
              archivo_clave = COALESCE($7, archivo_clave), activo = COALESCE($8, activo),
              -- Al cambiarle la fecha de vencimiento se olvida el aviso:
              -- una credencial renovada tiene que poder volver a avisar.
              avisado_en = CASE WHEN $6::date IS DISTINCT FROM vence_el THEN NULL ELSE avisado_en END
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [
        datos.id,
        tenantId,
        datos.tipo.trim(),
        datos.numero ?? null,
        datos.emitidaEl ?? null,
        datos.venceEl ?? null,
        datos.archivoClave ?? null,
        datos.activo ?? null,
      ]
    );
    if (r.rows.length === 0) throw new PersonalInvalido("Esa credencial no existe.");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO personal_credenciales
       (tenant_id, persona_id, tipo, numero, emitida_el, vence_el, archivo_clave)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      tenantId,
      datos.personaId,
      datos.tipo.trim(),
      datos.numero ?? null,
      datos.emitidaEl ?? null,
      datos.venceEl ?? null,
      datos.archivoClave ?? null,
    ]
  );
  return r.rows[0];
}

/**
 * Las credenciales y los permisos de la clínica que vencen pronto.
 *
 * Una sola función para las dos cosas porque el aviso es el mismo y la
 * pantalla las muestra juntas: a quien administra no le importa si lo
 * que vence es la regencia de una persona o la patente del local.
 */
export async function porVencer(
  db: PoolClient,
  tenantId: string,
  dias = 30
): Promise<
  Array<{
    clase: "credencial" | "permiso";
    id: string;
    titulo: string;
    de_quien: string | null;
    vence_el: string;
    dias_para_vencer: number;
  }>
> {
  const r = await db.query<{
    clase: "credencial" | "permiso";
    id: string;
    titulo: string;
    de_quien: string | null;
    vence_el: string;
    dias_para_vencer: number;
  }>(
    `SELECT 'credencial'::text AS clase, c.id, c.tipo AS titulo, p.nombre AS de_quien,
            c.vence_el::text, (c.vence_el - CURRENT_DATE)::int AS dias_para_vencer
       FROM personal_credenciales c
       JOIN personas p ON p.id = c.persona_id
      WHERE c.tenant_id = $1 AND c.activo AND c.vence_el IS NOT NULL
        AND c.vence_el <= CURRENT_DATE + $2::int
     UNION ALL
     SELECT 'permiso'::text AS clase, cp.id, cp.nombre AS titulo, per.nombre AS de_quien,
            cp.vence_el::text, (cp.vence_el - CURRENT_DATE)::int AS dias_para_vencer
       FROM cmp_permisos cp
       LEFT JOIN personas per ON per.id = cp.responsable_id
      WHERE cp.tenant_id = $1 AND cp.activo AND cp.vence_el IS NOT NULL
        AND cp.vence_el <= CURRENT_DATE + GREATEST($2::int, cp.dias_aviso)
      ORDER BY 5`,
    [tenantId, dias]
  );
  return r.rows;
}

/**
 * Las horas del período por persona, para la planilla.
 *
 * ES LO QUE EL CONTADOR NECESITA Y NADA MÁS: horas de turno, horas de
 * guardia y cuántos días. La planilla y las cargas sociales las calcula
 * él —lo dice el prompt— y este sistema no las toca.
 */
export async function horasParaPlanilla(
  db: PoolClient,
  tenantId: string,
  desde: string,
  hasta: string
): Promise<
  Array<{
    persona: string;
    dias: number;
    horas_turno: string;
    horas_guardia: string;
    ausencias: number;
  }>
> {
  const r = await db.query<{
    persona: string;
    dias: number;
    horas_turno: string;
    horas_guardia: string;
    ausencias: number;
  }>(
    `SELECT p.nombre AS persona,
            count(DISTINCT t.fecha)::int AS dias,
            COALESCE(sum(CASE WHEN t.tipo = 'turno'
                   THEN EXTRACT(EPOCH FROM (t.hora_hasta - t.hora_desde)) / 3600 END), 0)::numeric(10,2)::text
              AS horas_turno,
            COALESCE(sum(CASE WHEN t.tipo = 'guardia'
                   THEN EXTRACT(EPOCH FROM (t.hora_hasta - t.hora_desde)) / 3600 END), 0)::numeric(10,2)::text
              AS horas_guardia,
            (SELECT count(*) FROM clinica_excepciones e
              WHERE e.medico_id = p.id AND e.estado = 'aprobada'
                AND e.desde <= $3::date AND e.hasta >= $2::date)::int AS ausencias
       FROM personas p
       LEFT JOIN personal_turnos t
         ON t.persona_id = p.id AND t.fecha BETWEEN $2::date AND $3::date
      WHERE p.tenant_id = $1 AND p.estado = 'activo'
      GROUP BY p.id, p.nombre
      ORDER BY p.nombre`,
    [tenantId, desde, hasta]
  );
  return r.rows;
}
