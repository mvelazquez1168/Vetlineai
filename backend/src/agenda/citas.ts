import { PoolClient } from "pg";
import { registrarInteraccion } from "../crm/interacciones";
import { avisoActivo, emitirNotificacion } from "../notificaciones";
import { Veredicto, aHora, aMinutos, sePuedeCitar } from "./disponibilidad";

// ---------------------------------------------------------------------
// EL ÚNICO PUNTO QUE ESCRIBE EN `citas` — prompt 05, §0.
//
// EL PROBLEMA QUE CIERRA, encontrado en el relevamiento: había **seis
// archivos** escribiendo en `citas`, y cada uno hacía una parte distinta
// de lo que hay que hacer:
//
//   | Quién                        | Qué escribía                  | Qué le faltaba |
//   |------------------------------|-------------------------------|----------------|
//   | `citas.routes.ts`            | crear, mover, estado, borrar  | rechazar los choques: solo avisaba |
//   | `atencion.ts`                | `estado = 'completada'`       | el evento de CRM del cambio |
//   | `expediente/atencion.ts` (×2)| `'en_consulta'` y `'completada'` | ídem, y la validación de transición |
//   | `casos.routes.ts`            | `caso_id`                     | la regla de no pisar un vínculo |
//   | `workspace.routes.ts`        | `caso_id`                     | ídem |
//
// Ninguno estaba «mal»: cada uno hacía lo suyo. El problema es que la
// regla de transiciones válidas vivía en uno solo, así que una atención
// podía completar una cita cancelada sin que nada lo frenara, y el CRM
// se quedaba sin el evento.
//
// Ahora todos pasan por acá. Lo que esto garantiza, y antes no:
//
//   * **la transición es válida** —y es la misma tabla para los seis—;
//   * **la disponibilidad se respeta**: crear o mover una cita que choca
//     se RECHAZA, no se avisa (§1);
//   * **el CRM recibe su evento** en la misma transacción;
//   * **el cliente recibe su aviso** cuando la cita se cancela o se
//     mueve, venga el cambio de la pantalla, de la atención o del
//     calendario del médico;
//   * **el calendario externo se sincroniza**, por una cola que corre
//     después y fuera de la transacción.
// ---------------------------------------------------------------------

/** Las transiciones que la agenda admite. Una sola tabla para todos. */
export const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  programada: ["confirmada", "registrada", "en_consulta", "cancelada", "no_show"],
  confirmada: ["registrada", "en_consulta", "cancelada", "no_show"],
  registrada: ["en_consulta", "cancelada", "no_show"],
  en_consulta: ["completada", "cancelada"],
  completada: [],
  cancelada: [],
  no_show: [],
};

/** El evento de CRM de cada estado. El nombre del evento es del CRM. */
const EVENTO_POR_ESTADO: Record<string, string> = {
  confirmada: "cita_confirmada",
  registrada: "llegada",
  cancelada: "cita_cancelada",
  no_show: "cita_no_presentada",
  completada: "cita_completada",
};

export function sumarMinutos(horaHHMM: string, minutos: number): string {
  return aHora(aMinutos(horaHHMM) + minutos);
}

export function formatoFechaCorta(fecha: Date | string): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

// ---------------------------------------------------------------------
// LOS ERRORES, que la ruta traduce a HTTP
// ---------------------------------------------------------------------

/** La cita no se puede agendar ahí, y nadie lo autorizó. */
export class CitaNoDisponible extends Error {
  constructor(
    mensaje: string,
    public readonly veredicto: Veredicto
  ) {
    super(mensaje);
    this.name = "CitaNoDisponible";
  }
}

/** La transición de estado no existe. */
export class TransicionInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "TransicionInvalida";
  }
}

export class CitaNoEncontrada extends Error {
  constructor() {
    super("Cita no encontrada.");
    this.name = "CitaNoEncontrada";
  }
}

// ---------------------------------------------------------------------
// LA COLA DEL CALENDARIO EXTERNO
// ---------------------------------------------------------------------

/**
 * Deja encolado el cambio para los calendarios conectados del médico.
 *
 * SE ENCOLA DENTRO DE LA TRANSACCIÓN y SE ENVÍA FUERA. Es lo que el §4
 * pide: si Google no responde, la cita en Vetline queda igual y el envío
 * se reintenta. Llamar a Google acá dejaría la transacción abierta
 * durante una llamada de red —la alerta de `idle in transaction` que ya
 * costó una migración— y, peor, una cita que no se guarda porque Google
 * estaba caído.
 */
export async function encolarCalendario(
  db: PoolClient,
  tenantId: string,
  datos: {
    citaId: string | null;
    medicoId: string;
    accion: "crear" | "actualizar" | "borrar";
    /** Para `borrar`: el evento, porque la cita puede ya no existir. */
    eventoId?: string | null;
  }
): Promise<void> {
  const conexiones = await db.query<{ id: string }>(
    `SELECT id FROM cal_conexiones
      WHERE tenant_id = $1 AND persona_id = $2 AND estado <> 'desconectado'`,
    [tenantId, datos.medicoId]
  );
  for (const c of conexiones.rows) {
    await db.query(
      `INSERT INTO cal_cola (tenant_id, conexion_id, cita_id, accion, evento_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, c.id, datos.citaId, datos.accion, datos.eventoId ?? null]
    );
  }
}

// ---------------------------------------------------------------------
// CREAR
// ---------------------------------------------------------------------

export interface CrearCitaInput {
  pacienteId: string;
  medicoId: string;
  salaId?: string | null;
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  prioridad?: "baja" | "normal" | "alta" | "emergencia";
  motivoConsulta?: string;
  casoId?: string | null;
  tipoCitaId?: string | null;
  /** Los equipos que la cita ocupa (§1). */
  equipoIds?: string[];
  /**
   * LA SOBRECARGA EXPLÍCITA (§1). Sin esto, una cita que choca se
   * rechaza. Con esto —y solo con el permiso `agenda.sobrecarga`— se
   * agenda y **queda registrado quién la autorizó y por qué**.
   *
   * El nombre del campo sigue siendo `fueraDeHorario` en la API para no
   * romper el cliente del 04; la columna y el permiso ya se llaman
   * sobrecarga.
   */
  fueraDeHorario?: { autorizadoPor: string; motivo: string };
}

export interface OpcionesDeCita {
  /** Para los caminos que ya validaron (la lista de espera, el agente). */
  omitirDisponibilidad?: boolean;
}

export async function crearCita(
  db: PoolClient,
  tenantId: string,
  body: CrearCitaInput,
  opciones: OpcionesDeCita = {}
) {
  const horaFin = sumarMinutos(body.horaInicio, body.duracionMinutos);

  // LOS EQUIPOS DEL TIPO DE CITA, si no vinieron explícitos: el tipo
  // «cirugía con anestesia» ya sabe qué ocupa, y pedirlo de nuevo en
  // cada agendada es cómo se agenda una cirugía sin anestesia.
  let equipoIds = body.equipoIds;
  if (!equipoIds && body.tipoCitaId) {
    const r = await db.query<{ equipo_id: string }>(
      `SELECT equipo_id FROM tipo_cita_equipos WHERE tipo_cita_id = $1`,
      [body.tipoCitaId]
    );
    equipoIds = r.rows.map((f) => f.equipo_id);
  }

  // LA DISPONIBILIDAD, QUE AHORA RECHAZA.
  if (!opciones.omitirDisponibilidad && !body.fueraDeHorario) {
    const veredicto = await sePuedeCitar(db, tenantId, {
      fecha: body.fecha,
      horaInicio: body.horaInicio,
      duracionMinutos: body.duracionMinutos,
      medicoId: body.medicoId,
      salaId: body.salaId ?? null,
      equipoIds,
      tipoCitaId: body.tipoCitaId,
    });
    if (!veredicto.permitido) {
      throw new CitaNoDisponible(veredicto.motivo ?? "No se puede agendar ahí.", veredicto);
    }
  }

  const result = await db.query(
    `INSERT INTO citas
       (tenant_id, paciente_id, medico_id, sala_id, fecha, hora_inicio, hora_fin,
        duracion_minutos, prioridad, motivo_consulta, caso_id,
        tipo_cita_id, fuera_de_horario_por, fuera_de_horario_motivo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      tenantId,
      body.pacienteId,
      body.medicoId,
      body.salaId ?? null,
      body.fecha,
      body.horaInicio,
      horaFin,
      body.duracionMinutos,
      body.prioridad ?? "normal",
      body.motivoConsulta ?? null,
      body.casoId ?? null,
      body.tipoCitaId ?? null,
      body.fueraDeHorario?.autorizadoPor ?? null,
      body.fueraDeHorario?.motivo ?? null,
    ]
  );
  const cita = result.rows[0];

  for (const equipoId of equipoIds ?? []) {
    await db.query(
      `INSERT INTO cita_equipos (cita_id, equipo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [cita.id, equipoId]
    );
  }

  // CRM: el evento va en la MISMA transacción que la cita. Si la cita se
  // va atrás, su evento tampoco queda.
  await registrarInteraccion(db, {
    tenantId,
    tipo: "cita_agendada",
    pacienteId: cita.paciente_id,
    ocurridoEn: cita.creado_en,
    origenTabla: "citas",
    origenId: cita.id,
    personaId: body.medicoId,
    resumen: `${String(cita.fecha).slice(0, 10)} ${String(cita.hora_inicio).slice(0, 5)}${
      cita.motivo_consulta ? ` - ${cita.motivo_consulta}` : ""
    }`,
  });

  await avisarConfirmacion(db, tenantId, cita);
  await encolarCalendario(db, tenantId, {
    citaId: cita.id,
    medicoId: cita.medico_id,
    accion: "crear",
  });

  // `conflictos` se mantiene en la respuesta por compatibilidad con el
  // cliente del 04, y ahora va SIEMPRE vacío: lo que antes era un aviso
  // ahora es un rechazo.
  return { cita, conflictos: [] as unknown[] };
}

/** La confirmación al cliente, en el momento de agendar. */
async function avisarConfirmacion(
  db: PoolClient,
  tenantId: string,
  cita: Record<string, unknown>
): Promise<void> {
  if (!(await avisoActivo(db, tenantId, "confirmacion_cita_activo"))) return;
  const datos = await db.query(
    `SELECT p.nombre AS paciente_nombre, p.propietario_id, p.estado AS paciente_estado,
            m.nombre AS medico_nombre
       FROM pacientes p, personas m
      WHERE p.id = $1 AND m.id = $2`,
    [cita.paciente_id, cita.medico_id]
  );
  const info = datos.rows[0];
  // Un paciente fallecido no recibe ningún aviso.
  if (!info || info.paciente_estado !== "activo") return;

  const fecha = formatoFechaCorta(cita.fecha as string);
  const hora = String(cita.hora_inicio).slice(0, 5);
  await emitirNotificacion(db, {
    tenantId,
    tipo: "confirmacion_cita",
    destinatarioTipo: "propietario",
    destinatarioId: info.propietario_id,
    pacienteId: cita.paciente_id as string,
    citaId: cita.id as string,
    asunto: `Cita confirmada — ${info.paciente_nombre}`,
    contenido: `Se registró la cita de ${info.paciente_nombre} para el ${fecha} a las ${hora} con ${info.medico_nombre}.`,
    datosCorreo: {
      nombrePaciente: info.paciente_nombre,
      fecha,
      hora,
      medicoNombre: info.medico_nombre,
    },
  });
}

/**
 * El aviso de cancelación o reprogramación.
 *
 * Un solo aviso para las dos cosas (mismo tipo, contenido distinto),
 * llamado desde los cuatro puntos donde una cita deja de estar en pie:
 * cancelar, mover, borrar y el cambio que llega del calendario del
 * médico.
 */
export async function avisarCanceladaOReprogramada(
  db: PoolClient,
  tenantId: string,
  cita: { id: string; paciente_id: string; fecha: string; hora_inicio: string },
  reprogramada: boolean,
  fechaNueva?: string,
  horaNueva?: string
): Promise<void> {
  if (!(await avisoActivo(db, tenantId, "cancelacion_cita_activo"))) return;

  const info = await db.query(
    `SELECT nombre AS paciente_nombre, propietario_id, estado FROM pacientes WHERE id = $1`,
    [cita.paciente_id]
  );
  const row = info.rows[0];
  if (!row || row.estado !== "activo") return;

  const fechaOriginal = formatoFechaCorta(cita.fecha);
  const horaOriginal = String(cita.hora_inicio).slice(0, 5);
  const contenido = reprogramada
    ? `La cita de ${row.paciente_nombre} del ${fechaOriginal} a las ${horaOriginal} se reprogramó para el ${fechaNueva} a las ${horaNueva}.`
    : `La cita de ${row.paciente_nombre} del ${fechaOriginal} a las ${horaOriginal} fue cancelada.`;

  await emitirNotificacion(db, {
    tenantId,
    tipo: "cita_cancelada_o_reprogramada",
    destinatarioTipo: "propietario",
    destinatarioId: row.propietario_id,
    pacienteId: cita.paciente_id,
    citaId: cita.id,
    asunto: reprogramada
      ? `Cita reprogramada — ${row.paciente_nombre}`
      : `Cita cancelada — ${row.paciente_nombre}`,
    contenido,
    datosCorreo: {
      nombrePaciente: row.paciente_nombre,
      fechaOriginal,
      horaOriginal,
      reprogramada,
      fechaNueva,
      horaNueva,
    },
  });
}

// ---------------------------------------------------------------------
// MOVER / EDITAR
// ---------------------------------------------------------------------

export async function moverCita(
  db: PoolClient,
  tenantId: string,
  citaId: string,
  body: CrearCitaInput,
  quien: string,
  opciones: OpcionesDeCita = {}
) {
  const existente = await db.query(
    `SELECT id, paciente_id, fecha, hora_inicio, medico_id FROM citas WHERE id = $1`,
    [citaId]
  );
  if (existente.rows.length === 0) throw new CitaNoEncontrada();
  const anterior = existente.rows[0];

  const horaFin = sumarMinutos(body.horaInicio, body.duracionMinutos);

  let equipoIds = body.equipoIds;
  if (!equipoIds) {
    const r = await db.query<{ equipo_id: string }>(
      `SELECT equipo_id FROM cita_equipos WHERE cita_id = $1`,
      [citaId]
    );
    equipoIds = r.rows.map((f) => f.equipo_id);
  }

  // MOVER UNA CITA A UN FERIADO ES EL MISMO PROBLEMA QUE CREARLA AHÍ, y
  // mover una cita sobre una sala ocupada también: la misma función.
  if (!opciones.omitirDisponibilidad && !body.fueraDeHorario) {
    const veredicto = await sePuedeCitar(db, tenantId, {
      fecha: body.fecha,
      horaInicio: body.horaInicio,
      duracionMinutos: body.duracionMinutos,
      medicoId: body.medicoId,
      salaId: body.salaId ?? null,
      equipoIds,
      tipoCitaId: body.tipoCitaId,
      excluirCitaId: citaId,
    });
    if (!veredicto.permitido) {
      throw new CitaNoDisponible(veredicto.motivo ?? "No se puede mover ahí.", veredicto);
    }
  }

  const result = await db.query(
    `UPDATE citas
        SET paciente_id = $1, medico_id = $2, sala_id = $3, fecha = $4, hora_inicio = $5,
            hora_fin = $6, duracion_minutos = $7, prioridad = $8, motivo_consulta = $9,
            tipo_cita_id = COALESCE($11::uuid, tipo_cita_id),
            fuera_de_horario_por = $12::uuid,
            fuera_de_horario_motivo = $13,
            actualizado_en = now()
      WHERE id = $10
      RETURNING *`,
    [
      body.pacienteId,
      body.medicoId,
      body.salaId ?? null,
      body.fecha,
      body.horaInicio,
      horaFin,
      body.duracionMinutos,
      body.prioridad ?? "normal",
      body.motivoConsulta ?? null,
      citaId,
      body.tipoCitaId ?? null,
      body.fueraDeHorario?.autorizadoPor ?? null,
      body.fueraDeHorario?.motivo ?? null,
    ]
  );
  const cita = result.rows[0];

  if (body.equipoIds) {
    await db.query(`DELETE FROM cita_equipos WHERE cita_id = $1`, [citaId]);
    for (const equipoId of body.equipoIds) {
      await db.query(
        `INSERT INTO cita_equipos (cita_id, equipo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [citaId, equipoId]
      );
    }
  }

  // Solo cuenta como reprogramación si la fecha o la hora cambiaron de
  // verdad: editar la prioridad o el motivo no es una reprogramación y
  // no tiene por qué avisarle al cliente.
  //
  // `anterior.fecha` es un DATE que pg devuelve como `Date`, y
  // `String(date)` da el formato local («Wed Aug 12 2026…»), nunca ISO:
  // comparar sus diez primeros caracteres daba SIEMPRE distinto y
  // cualquier edición se reportaba como reprogramación.
  const fechaAnteriorISO = new Date(anterior.fecha).toISOString().slice(0, 10);
  const huboReprogramacion =
    fechaAnteriorISO !== body.fecha ||
    String(anterior.hora_inicio).slice(0, 5) !== body.horaInicio;

  if (huboReprogramacion) {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "cita_reprogramada",
      pacienteId: cita.paciente_id,
      origenTabla: "citas",
      origenId: cita.id,
      personaId: quien,
      resumen: `De ${fechaAnteriorISO} ${String(anterior.hora_inicio).slice(0, 5)} a ${body.fecha} ${body.horaInicio}`,
    });
    await avisarCanceladaOReprogramada(
      db,
      tenantId,
      {
        id: cita.id,
        paciente_id: anterior.paciente_id,
        fecha: anterior.fecha,
        hora_inicio: anterior.hora_inicio,
      },
      true,
      formatoFechaCorta(body.fecha),
      body.horaInicio
    );
  }

  await encolarCalendario(db, tenantId, {
    citaId: cita.id,
    medicoId: cita.medico_id,
    accion: "actualizar",
  });
  // Si cambió de médico, el calendario del anterior tiene que perder el
  // evento: si no, la cita le queda para siempre en su agenda personal.
  if (anterior.medico_id !== cita.medico_id) {
    await encolarCalendario(db, tenantId, {
      citaId: cita.id,
      medicoId: anterior.medico_id,
      accion: "borrar",
    });
  }

  return { cita, conflictos: [] as unknown[], huboReprogramacion };
}

// ---------------------------------------------------------------------
// CAMBIAR DE ESTADO
// ---------------------------------------------------------------------

export async function cambiarEstadoDeCita(
  db: PoolClient,
  tenantId: string,
  citaId: string,
  nuevoEstado: string,
  datos: { quien?: string | null; motivoCancelacion?: string | null; casoId?: string | null } = {}
) {
  const actual = await db.query(
    `SELECT id, estado, paciente_id, fecha, hora_inicio, medico_id FROM citas WHERE id = $1`,
    [citaId]
  );
  if (actual.rows.length === 0) throw new CitaNoEncontrada();
  const citaAnterior = actual.rows[0];
  const estadoActual = citaAnterior.estado as string;

  // LA MISMA TABLA DE TRANSICIONES PARA TODOS. Antes vivía solo en la
  // ruta, así que la atención podía completar una cita cancelada.
  const permitidos = TRANSICIONES_VALIDAS[estadoActual] ?? [];
  if (estadoActual !== nuevoEstado && !permitidos.includes(nuevoEstado)) {
    throw new TransicionInvalida(
      `No se puede pasar de '${estadoActual}' a '${nuevoEstado}'. Transiciones válidas desde '${estadoActual}': ${
        permitidos.length > 0 ? permitidos.join(", ") : "ninguna (estado final)"
      }.`
    );
  }

  const result = await db.query(
    `UPDATE citas
        SET estado = $1,
            motivo_cancelacion = CASE WHEN $1::varchar = 'cancelada' THEN $2 ELSE motivo_cancelacion END,
            caso_id = COALESCE($3, caso_id),
            -- LA HORA DE LLEGADA SE SELLA UNA VEZ (anexo del 07, A2).
            check_in_en = CASE
              WHEN $1::varchar IN ('registrada', 'en_consulta') THEN COALESCE(check_in_en, now())
              ELSE check_in_en
            END,
            actualizado_en = now()
      WHERE id = $4
      RETURNING *`,
    [nuevoEstado, datos.motivoCancelacion ?? null, datos.casoId ?? null, citaId]
  );
  const cita = result.rows[0];

  const tipoEvento = EVENTO_POR_ESTADO[nuevoEstado];
  if (tipoEvento && estadoActual !== nuevoEstado) {
    await registrarInteraccion(db, {
      tenantId,
      tipo: tipoEvento as never,
      pacienteId: cita.paciente_id,
      origenTabla: "citas",
      origenId: cita.id,
      personaId: datos.quien ?? null,
      resumen:
        nuevoEstado === "cancelada" && datos.motivoCancelacion
          ? datos.motivoCancelacion.slice(0, 120)
          : `${String(cita.fecha).slice(0, 10)} ${String(cita.hora_inicio).slice(0, 5)}`,
    });
  }

  if (nuevoEstado === "cancelada" && estadoActual !== "cancelada") {
    await avisarCanceladaOReprogramada(db, tenantId, citaAnterior, false);
    await encolarCalendario(db, tenantId, {
      citaId: cita.id,
      medicoId: cita.medico_id,
      accion: "borrar",
    });
  } else if (estadoActual !== nuevoEstado) {
    // El estado se ve en el evento del calendario («en la clínica»),
    // así que también se sincroniza.
    await encolarCalendario(db, tenantId, {
      citaId: cita.id,
      medicoId: cita.medico_id,
      accion: "actualizar",
    });
  }

  return { cita };
}

// ---------------------------------------------------------------------
// VINCULAR A UN CASO
// ---------------------------------------------------------------------

/**
 * Vincula una cita a un caso, sin pisar un vínculo que ya existe.
 *
 * Lo hacían `casos.routes.ts` y `workspace.routes.ts` cada uno con su
 * `UPDATE`, y solo la ruta de citas tenía la regla de no reemplazar en
 * silencio. Ahora los tres pasan por acá.
 */
export async function vincularCasoACita(
  db: PoolClient,
  citaId: string,
  casoId: string
): Promise<{ vinculada: boolean; yaTeniaOtro: boolean }> {
  const r = await db.query<{ id: string; caso_id: string }>(
    `UPDATE citas SET caso_id = $1, actualizado_en = now()
      WHERE id = $2 AND caso_id IS NULL
      RETURNING id, caso_id`,
    [casoId, citaId]
  );
  if (r.rows.length > 0) return { vinculada: true, yaTeniaOtro: false };

  const existe = await db.query<{ caso_id: string | null }>(
    `SELECT caso_id FROM citas WHERE id = $1`,
    [citaId]
  );
  if (existe.rows.length === 0) throw new CitaNoEncontrada();
  // Vincular al mismo caso otra vez no es un error.
  if (existe.rows[0].caso_id === casoId) return { vinculada: false, yaTeniaOtro: false };
  return { vinculada: false, yaTeniaOtro: true };
}

// ---------------------------------------------------------------------
// BORRAR
// ---------------------------------------------------------------------

export async function borrarCita(
  db: PoolClient,
  tenantId: string,
  citaId: string
): Promise<void> {
  const actual = await db.query(
    `SELECT id, estado, paciente_id, fecha, hora_inicio, medico_id FROM citas WHERE id = $1`,
    [citaId]
  );
  if (actual.rows.length === 0) throw new CitaNoEncontrada();
  const cita = actual.rows[0];
  if (cita.estado !== "programada" && cita.estado !== "confirmada") {
    throw new TransicionInvalida(
      "Solo se pueden borrar citas en estado 'programada' o 'confirmada'. Usá cancelar o no-show para las demás."
    );
  }

  // El aviso va ANTES de borrar: después, los datos del paciente ya no
  // se pueden leer desde la cita.
  await avisarCanceladaOReprogramada(db, tenantId, cita, false);

  // El evento del calendario externo se encola con su id, porque la
  // cita —y con ella `cal_eventos`— va a dejar de existir.
  const eventos = await db.query<{ conexion_id: string; evento_id: string }>(
    `SELECT conexion_id, evento_id FROM cal_eventos WHERE cita_id = $1`,
    [citaId]
  );
  for (const e of eventos.rows) {
    await db.query(
      `INSERT INTO cal_cola (tenant_id, conexion_id, cita_id, accion, evento_id)
       VALUES ($1, $2, NULL, 'borrar', $3)`,
      [tenantId, e.conexion_id, e.evento_id]
    );
  }

  // `notificaciones.cita_id` no tiene CASCADE a propósito —una
  // notificación enviada es historia— pero bloquea el borrado: se
  // desvincula, no se elimina.
  await db.query(`UPDATE notificaciones SET cita_id = NULL WHERE cita_id = $1`, [citaId]);
  await db.query(`DELETE FROM citas WHERE id = $1`, [citaId]);
}
