import cron from "node-cron";
import { pool } from "../db";
import { emitirNotificacion, enviarNotificacionPorCorreo } from "../notificaciones";

// ---------------------------------------------------------------------
// Módulo de Notificaciones — job diario, común a cualquier agente clínico
// y a cualquier tenant (sin lógica GCIS/ICIS). El envío real va por el
// mismo camino que los correos transaccionales (enviarCorreoTransaccional
// → correos_enviados), consolidado en prompt_code_notificaciones — antes
// este job llamaba a enviarEmail() directo, sin registrar nada en
// correos_enviados ni guardar el motivo de un fallo.
//
// prompt_code_notificaciones_pendientes.md — el par insertar-en-
// notificaciones + enviar-por-correo vive ahora en ../notificaciones
// (emitirNotificacion/enviarNotificacionPorCorreo), no acá: es el mismo
// punto único de emisión que usan citas.routes.ts y casos.routes.ts para
// los avisos disparados por hecho (Parte C).
//
// Corre vía `pool` directo (no `req.db`) porque no hay request/tenant
// activo — mismo patrón que jobs/suscripciones.job.ts. El pool se conecta
// como un rol que bypassea RLS, así que cada query filtra tenant
// explícitamente donde corresponde (join a tenants + estado_suscripcion).
// ---------------------------------------------------------------------

// Bug real encontrado al verificar este prompt, no pedido pero corregido
// porque bloquea en producción el disparador de los 10 avisos: la
// migración 024 renombró 'trial' → 'prueba' en tenants.estado_suscripcion
// (y actualizó el CHECK constraint para no aceptar 'trial' nunca más),
// pero este archivo seguía filtrando por el nombre viejo. Desde esa
// migración, NINGÚN tenant en estado de prueba recibía ningún aviso de
// este job — la condición `t.estado_suscripcion = ANY($1)` nunca hacía
// match. usoIa.ts y platform-admin.routes.ts tienen el mismo literal
// stale 'trial' en otro contexto (cálculo de ciclo de uso, conteo para
// platform-admin) — señalado, no corregido acá: es un cambio de
// comportamiento distinto al de este prompt y no está verificado.
const TENANTS_ACTIVOS = ["prueba", "activa"];

// prompt_code_paciente_nacimiento_estado.md, Parte B2 — las 6 consultas de
// este archivo (los 6 avisos que dependen de un job periódico, de los 9
// existentes al momento de este prompt) exigen `p.estado = 'activo'`. Un
// paciente fallecido no puede recibir NINGÚN aviso, no solo el de
// cumpleaños — confirmado explícitamente, incluye los 2 dirigidos al
// médico (seguimiento_faltante, agenda_dia_siguiente). Los otros 3 avisos
// (disparados por hecho, no por este job) llevan el mismo filtro en su
// punto de emisión — ver citas.routes.ts y casos.routes.ts.

function formatoFechaCorta(fecha: Date | string): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Intl.DateTimeFormat("es", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

// ---------------------------------------------------------------------
// 1. Recordatorio de cita: citas dentro de las próximas
// horas_aviso_recordatorio_cita horas (por tenant, default 26) en estado
// programada/confirmada. La comparación usa la zona horaria del tenant
// (fecha+hora_inicio son wall-clock local, sin tz) para que la ventana
// sea correcta sin importar dónde esté la clínica. Dedupe real a nivel de
// base vía el índice único parcial sobre (cita_id) — ON CONFLICT DO
// NOTHING, así nunca hay doble recordatorio para la misma cita aunque el
// job corra dos veces.
// ---------------------------------------------------------------------
async function procesarRecordatoriosCita() {
  const candidatos = await pool.query(
    `SELECT c.id AS cita_id, c.tenant_id, c.fecha, c.hora_inicio, c.paciente_id,
            p.nombre AS paciente_nombre, p.propietario_id,
            m.nombre AS medico_nombre
     FROM citas c
     JOIN pacientes p ON p.id = c.paciente_id
     JOIN personas m ON m.id = c.medico_id
     JOIN tenants t ON t.id = c.tenant_id
     LEFT JOIN configuracion_notificaciones cn ON cn.tenant_id = c.tenant_id
     WHERE c.estado IN ('programada', 'confirmada')
       AND p.estado = 'activo'
       AND t.estado_suscripcion = ANY($1)
       AND COALESCE(cn.recordatorio_cita_activo, true) = true
       AND (c.fecha + c.hora_inicio) AT TIME ZONE t.zona_horaria
           BETWEEN now() AND now() + (COALESCE(cn.horas_aviso_recordatorio_cita, 26) || ' hours')::interval`,
    [TENANTS_ACTIVOS]
  );

  let creadas = 0;
  for (const c of candidatos.rows) {
    const asunto = `Recordatorio de cita — ${c.paciente_nombre}`;
    const contenido =
      `Le recordamos la cita de ${c.paciente_nombre} el ${formatoFechaCorta(c.fecha)} ` +
      `a las ${String(c.hora_inicio).slice(0, 5)} con ${c.medico_nombre}.`;
    const result = await pool.query(
      `INSERT INTO notificaciones
         (tenant_id, tipo, destinatario_tipo, destinatario_id, paciente_id, cita_id, asunto, contenido)
       VALUES ($1, 'recordatorio_cita', 'propietario', $2, $3, $4, $5, $6)
       ON CONFLICT (cita_id) WHERE tipo = 'recordatorio_cita' AND cita_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [c.tenant_id, c.propietario_id, c.paciente_id, c.cita_id, asunto, contenido]
    );
    if (result.rows.length > 0) {
      creadas++;
      await enviarNotificacionPorCorreo(pool, c.tenant_id, result.rows[0].id, "propietario", c.propietario_id, "recordatorio_cita", {
        nombrePaciente: c.paciente_nombre,
        fecha: formatoFechaCorta(c.fecha),
        hora: String(c.hora_inicio).slice(0, 5),
        medicoNombre: c.medico_nombre,
      });
    }
  }
  if (creadas > 0) console.log(`[jobs:notificaciones] ${creadas} recordatorio(s) de cita creado(s).`);
}

// ---------------------------------------------------------------------
// 2. Desparasitación próxima a vencer: cuidados_preventivos cuya
// fecha_proxima_recomendada esté a <= dias_aviso_desparasitacion (por
// tenant, default 7) días de hoy. Sin cota inferior a propósito: un
// aviso vencido sigue siendo relevante para el propietario. Dedupe por
// ventana de tiempo (no constraint única, porque SÍ conviene reavisar
// pasados esos días si la condición sigue vigente).
// ---------------------------------------------------------------------
async function procesarDesparasitacionesProximas() {
  const candidatos = await pool.query(
    `SELECT cp.id AS cuidado_id, cp.tenant_id, cp.paciente_id, cp.fecha_proxima_recomendada,
            p.nombre AS paciente_nombre, p.propietario_id,
            COALESCE(cn.dias_aviso_desparasitacion, 7) AS dias_aviso
     FROM cuidados_preventivos cp
     JOIN pacientes p ON p.id = cp.paciente_id
     JOIN tenants t ON t.id = cp.tenant_id
     LEFT JOIN configuracion_notificaciones cn ON cn.tenant_id = cp.tenant_id
     WHERE cp.tipo = 'desparasitacion'
       AND p.estado = 'activo'
       AND t.estado_suscripcion = ANY($1)
       AND COALESCE(cn.desparasitacion_activo, true) = true
       AND cp.fecha_proxima_recomendada <= CURRENT_DATE + COALESCE(cn.dias_aviso_desparasitacion, 7)`,
    [TENANTS_ACTIVOS]
  );

  let creadas = 0;
  for (const c of candidatos.rows) {
    const yaAvisado = await pool.query(
      `SELECT 1 FROM notificaciones
       WHERE cuidado_preventivo_id = $1 AND tipo = 'desparasitacion_proxima'
         AND creado_en >= now() - ($2 || ' days')::interval
       LIMIT 1`,
      [c.cuidado_id, c.dias_aviso]
    );
    if (yaAvisado.rows.length > 0) continue;

    const fechaProxima = formatoFechaCorta(c.fecha_proxima_recomendada);
    await emitirNotificacion(pool, {
      tenantId: c.tenant_id,
      tipo: "desparasitacion_proxima",
      destinatarioTipo: "propietario",
      destinatarioId: c.propietario_id,
      pacienteId: c.paciente_id,
      cuidadoPreventivoId: c.cuidado_id,
      asunto: `Desparasitación próxima — ${c.paciente_nombre}`,
      contenido: `La próxima desparasitación de ${c.paciente_nombre} está recomendada para el ${fechaProxima}.`,
      datosCorreo: { nombrePaciente: c.paciente_nombre, fechaProxima },
    });
    creadas++;
  }
  if (creadas > 0) console.log(`[jobs:notificaciones] ${creadas} aviso(s) de desparasitación creado(s).`);
}

// ---------------------------------------------------------------------
// B1 — Vacunación próxima a vencer. Mismo mecanismo que la
// desparasitación (mismo job, mismo dedupe por ventana), pero filtrado a
// cuidados_preventivos.tipo = 'vacunacion' y con su propio umbral
// configurable — es el aviso de mayor valor clínico de los nueve.
// ---------------------------------------------------------------------
async function procesarVacunacionesProximas() {
  const candidatos = await pool.query(
    `SELECT cp.id AS cuidado_id, cp.tenant_id, cp.paciente_id, cp.fecha_proxima_recomendada, cp.vacuna,
            p.nombre AS paciente_nombre, p.propietario_id,
            COALESCE(cn.dias_aviso_vacunacion, 7) AS dias_aviso
     FROM cuidados_preventivos cp
     JOIN pacientes p ON p.id = cp.paciente_id
     JOIN tenants t ON t.id = cp.tenant_id
     LEFT JOIN configuracion_notificaciones cn ON cn.tenant_id = cp.tenant_id
     WHERE cp.tipo = 'vacunacion'
       AND p.estado = 'activo'
       AND t.estado_suscripcion = ANY($1)
       AND COALESCE(cn.vacunacion_activo, true) = true
       AND cp.fecha_proxima_recomendada <= CURRENT_DATE + COALESCE(cn.dias_aviso_vacunacion, 7)`,
    [TENANTS_ACTIVOS]
  );

  let creadas = 0;
  for (const c of candidatos.rows) {
    const yaAvisado = await pool.query(
      `SELECT 1 FROM notificaciones
       WHERE cuidado_preventivo_id = $1 AND tipo = 'vacunacion_proxima'
         AND creado_en >= now() - ($2 || ' days')::interval
       LIMIT 1`,
      [c.cuidado_id, c.dias_aviso]
    );
    if (yaAvisado.rows.length > 0) continue;

    const fechaProxima = formatoFechaCorta(c.fecha_proxima_recomendada);
    await emitirNotificacion(pool, {
      tenantId: c.tenant_id,
      tipo: "vacunacion_proxima",
      destinatarioTipo: "propietario",
      destinatarioId: c.propietario_id,
      pacienteId: c.paciente_id,
      cuidadoPreventivoId: c.cuidado_id,
      asunto: `Vacunación próxima — ${c.paciente_nombre}`,
      contenido: `La próxima vacuna de ${c.paciente_nombre} (${c.vacuna}) está recomendada para el ${fechaProxima}.`,
      datosCorreo: { nombrePaciente: c.paciente_nombre, vacuna: c.vacuna, fechaProxima },
    });
    creadas++;
  }
  if (creadas > 0) console.log(`[jobs:notificaciones] ${creadas} aviso(s) de vacunación creado(s).`);
}

// ---------------------------------------------------------------------
// 3. Seguimiento faltante: casos cuyo dashboard_cache más reciente diga
// clinical_state.estado en (empeorando, critico) y sin ninguna cita
// futura programada/confirmada. Dedupe: no repetir antes de
// dias_aviso_seguimiento_faltante días (por tenant, default 3) para el
// mismo caso si la condición sigue vigente — es la única noción de
// "días" que existe hoy en este disparador (el trigger en sí es por
// severidad clínica, no por tiempo de inactividad medido).
// ---------------------------------------------------------------------
async function procesarSeguimientosFaltantes() {
  const candidatos = await pool.query(
    `SELECT c.id AS caso_id, c.tenant_id, c.medico_id, c.paciente_id,
            p.nombre AS paciente_nombre,
            c.dashboard_cache->'clinical_state'->>'estado' AS estado_clinico,
            COALESCE(cn.dias_aviso_seguimiento_faltante, 3) AS dias_dedupe
     FROM casos c
     JOIN pacientes p ON p.id = c.paciente_id
     JOIN tenants t ON t.id = c.tenant_id
     LEFT JOIN configuracion_notificaciones cn ON cn.tenant_id = c.tenant_id
     WHERE t.estado_suscripcion = ANY($1)
       AND p.estado = 'activo'
       -- prompt_code_cierre_caso.md, Paso 5 — un caso que el médico ya dio
       -- por cerrado no debe seguir generando avisos de seguimiento.
       AND c.estado <> 'completado'
       AND COALESCE(cn.seguimiento_faltante_activo, true) = true
       AND c.dashboard_cache->'clinical_state'->>'estado' IN ('empeorando', 'critico')
       AND NOT EXISTS (
         SELECT 1 FROM citas ci
         WHERE ci.caso_id = c.id AND ci.fecha >= CURRENT_DATE AND ci.estado IN ('programada', 'confirmada')
       )`,
    [TENANTS_ACTIVOS]
  );

  let creadas = 0;
  for (const c of candidatos.rows) {
    const yaAvisado = await pool.query(
      `SELECT 1 FROM notificaciones
       WHERE caso_id = $1 AND tipo = 'seguimiento_faltante'
         AND creado_en >= now() - ($2 || ' days')::interval
       LIMIT 1`,
      [c.caso_id, c.dias_dedupe]
    );
    if (yaAvisado.rows.length > 0) continue;

    await emitirNotificacion(pool, {
      tenantId: c.tenant_id,
      tipo: "seguimiento_faltante",
      destinatarioTipo: "medico",
      destinatarioId: c.medico_id,
      casoId: c.caso_id,
      pacienteId: c.paciente_id,
      asunto: `Seguimiento pendiente — ${c.paciente_nombre}`,
      contenido:
        `El caso de ${c.paciente_nombre} está en estado clínico "${c.estado_clinico}" y no tiene ` +
        `ninguna cita futura agendada — considerá programar un seguimiento.`,
      datosCorreo: { nombrePaciente: c.paciente_nombre, estadoClinico: c.estado_clinico },
    });
    creadas++;
  }
  if (creadas > 0) console.log(`[jobs:notificaciones] ${creadas} alerta(s) de seguimiento faltante creada(s).`);
}

// ---------------------------------------------------------------------
// B2 — Seguimiento posterior a la consulta. Al propietario, de cortesía,
// a partir de dias_seguimiento_posterior días desde la última actividad
// del caso (casos.actualizado_en — se toca en cada mensaje nuevo, ver
// workspace.routes.ts). Distinto de seguimiento_faltante en todo: acá va
// al tutor, no lleva ningún dato clínico, y no depende de severidad.
// Dedupe simple — una sola vez por caso, no se repite (no tiene sentido
// seguir preguntando "¿cómo sigue?" indefinidamente sobre el mismo caso).
// ---------------------------------------------------------------------
async function procesarSeguimientosPosteriores() {
  const candidatos = await pool.query(
    `SELECT c.id AS caso_id, c.tenant_id, c.paciente_id, p.nombre AS paciente_nombre, p.propietario_id
     FROM casos c
     JOIN pacientes p ON p.id = c.paciente_id
     JOIN tenants t ON t.id = c.tenant_id
     LEFT JOIN configuracion_notificaciones cn ON cn.tenant_id = c.tenant_id
     WHERE t.estado_suscripcion = ANY($1)
       AND p.estado = 'activo'
       -- prompt_code_cierre_caso.md, Paso 5 (revisado) — a diferencia de
       -- seguimiento_faltante, este aviso NO excluye los casos cerrados:
       -- se dispara días después de la última actividad, así que excluir
       -- los cerrados dejaría afuera justo a los casos bien llevados
       -- (cerrados a tiempo) y solo llegaría a los que nadie cerró.
       -- Sí se excluye explícitamente el desenlace fallecido — no alcanza
       -- con el filtro p.estado = 'activo' de arriba porque ese es un paso
       -- manual aparte que el médico puede no haber confirmado todavía.
       AND (c.desenlace IS DISTINCT FROM 'fallecido')
       AND COALESCE(cn.seguimiento_posterior_activo, true) = true
       AND c.actualizado_en <= now() - (COALESCE(cn.dias_seguimiento_posterior, 3) || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM notificaciones n WHERE n.caso_id = c.id AND n.tipo = 'seguimiento_posterior_consulta'
       )`,
    [TENANTS_ACTIVOS]
  );

  let creadas = 0;
  for (const c of candidatos.rows) {
    await emitirNotificacion(pool, {
      tenantId: c.tenant_id,
      tipo: "seguimiento_posterior_consulta",
      destinatarioTipo: "propietario",
      destinatarioId: c.propietario_id,
      casoId: c.caso_id,
      pacienteId: c.paciente_id,
      asunto: `¿Cómo sigue ${c.paciente_nombre}?`,
      contenido: `Esperamos que ${c.paciente_nombre} esté evolucionando bien. Si notás algo que te preocupe, no dudes en contactarnos.`,
      datosCorreo: { nombrePaciente: c.paciente_nombre },
    });
    creadas++;
  }
  if (creadas > 0) console.log(`[jobs:notificaciones] ${creadas} seguimiento(s) posterior(es) a la consulta creado(s).`);
}

// ---------------------------------------------------------------------
// B3 — Agenda del día siguiente. Al médico, un resumen de sus citas de
// mañana — SOLO si tiene, para no convertirse en ruido (pedido explícito
// del prompt). Se agrupa por médico en JS, no en SQL, porque el contenido
// del correo necesita la lista completa de citas, no una fila por cita.
// ---------------------------------------------------------------------
async function procesarAgendaDiaSiguiente() {
  const candidatos = await pool.query(
    `SELECT c.medico_id, c.tenant_id, c.hora_inicio, c.motivo_consulta, p.nombre AS paciente_nombre
     FROM citas c
     JOIN pacientes p ON p.id = c.paciente_id
     JOIN tenants t ON t.id = c.tenant_id
     LEFT JOIN configuracion_notificaciones cn ON cn.tenant_id = c.tenant_id
     WHERE c.fecha = CURRENT_DATE + 1
       AND c.estado IN ('programada', 'confirmada')
       AND p.estado = 'activo'
       AND t.estado_suscripcion = ANY($1)
       AND COALESCE(cn.agenda_dia_siguiente_activo, true) = true
     ORDER BY c.medico_id, c.hora_inicio`,
    [TENANTS_ACTIVOS]
  );

  const porMedico = new Map<string, { tenantId: string; citas: { hora: string; pacienteNombre: string; motivoConsulta: string | null }[] }>();
  for (const c of candidatos.rows) {
    if (!porMedico.has(c.medico_id)) porMedico.set(c.medico_id, { tenantId: c.tenant_id, citas: [] });
    porMedico.get(c.medico_id)!.citas.push({
      hora: String(c.hora_inicio).slice(0, 5),
      pacienteNombre: c.paciente_nombre,
      motivoConsulta: c.motivo_consulta,
    });
  }

  let creadas = 0;
  const mañana = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const fecha = formatoFechaCorta(mañana);
  for (const [medicoId, datos] of porMedico) {
    const yaAvisado = await pool.query(
      `SELECT 1 FROM notificaciones
       WHERE destinatario_id = $1 AND tipo = 'agenda_dia_siguiente' AND creado_en >= CURRENT_DATE
       LIMIT 1`,
      [medicoId]
    );
    if (yaAvisado.rows.length > 0) continue;

    const textoLista = datos.citas.map((c) => `${c.hora} — ${c.pacienteNombre}`).join(", ");
    await emitirNotificacion(pool, {
      tenantId: datos.tenantId,
      tipo: "agenda_dia_siguiente",
      destinatarioTipo: "medico",
      destinatarioId: medicoId,
      asunto: `Tu agenda de mañana — ${fecha}`,
      contenido: `Tus citas para el ${fecha}: ${textoLista}.`,
      datosCorreo: { fecha, citas: datos.citas },
    });
    creadas++;
  }
  if (creadas > 0) console.log(`[jobs:notificaciones] ${creadas} agenda(s) del día siguiente creada(s).`);
}

// ---------------------------------------------------------------------
// B3 — Cumpleaños del paciente. Al propietario, único aviso puramente
// comercial de los diez (ver correos.ts). Requiere fecha_nacimiento
// (muchos pacientes no la tienen — no hay nada que festejar sin ella) y
// estado='activo' (no felicitar el cumpleaños de un animal fallecido, el
// motivo por el que existe el estado del paciente). Coincidencia de
// mes/día en SQL directo, sin restar años — la edad no importa acá.
// Dedupe: una sola vez por año calendario, comparando contra el mismo
// mes/día del envío anterior (no "hace 365 días", para tolerar que el job
// se salte un día por algún motivo sin perder el aviso del año).
// ---------------------------------------------------------------------
async function procesarAvisoCumpleanos() {
  const candidatos = await pool.query(
    `SELECT p.id AS paciente_id, p.tenant_id, p.nombre AS paciente_nombre, p.propietario_id
     FROM pacientes p
     JOIN tenants t ON t.id = p.tenant_id
     LEFT JOIN configuracion_notificaciones cn ON cn.tenant_id = p.tenant_id
     WHERE p.estado = 'activo'
       AND p.fecha_nacimiento IS NOT NULL
       AND EXTRACT(MONTH FROM p.fecha_nacimiento) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(DAY FROM p.fecha_nacimiento) = EXTRACT(DAY FROM CURRENT_DATE)
       AND t.estado_suscripcion = ANY($1)
       AND COALESCE(cn.cumpleanos_activo, true) = true`,
    [TENANTS_ACTIVOS]
  );

  let creadas = 0;
  for (const c of candidatos.rows) {
    const yaAvisado = await pool.query(
      `SELECT 1 FROM notificaciones
       WHERE paciente_id = $1 AND tipo = 'cumpleanos'
         AND EXTRACT(YEAR FROM creado_en) = EXTRACT(YEAR FROM CURRENT_DATE)
       LIMIT 1`,
      [c.paciente_id]
    );
    if (yaAvisado.rows.length > 0) continue;

    await emitirNotificacion(pool, {
      tenantId: c.tenant_id,
      tipo: "cumpleanos",
      destinatarioTipo: "propietario",
      destinatarioId: c.propietario_id,
      pacienteId: c.paciente_id,
      asunto: `¡Feliz cumpleaños, ${c.paciente_nombre}!`,
      contenido: `¡Feliz cumpleaños, ${c.paciente_nombre}! Todo el equipo te manda un saludo muy cariñoso.`,
      datosCorreo: { nombrePaciente: c.paciente_nombre },
    });
    creadas++;
  }
  if (creadas > 0) console.log(`[jobs:notificaciones] ${creadas} saludo(s) de cumpleaños creado(s).`);
}

export async function ejecutarJobNotificaciones() {
  try {
    await procesarRecordatoriosCita();
    await procesarDesparasitacionesProximas();
    await procesarVacunacionesProximas();
    await procesarSeguimientosFaltantes();
    await procesarSeguimientosPosteriores();
    await procesarAgendaDiaSiguiente();
    await procesarAvisoCumpleanos();
  } catch (err) {
    console.error("[jobs:notificaciones] Error al ejecutar el job de notificaciones", err);
  }
}

// Horario fijo razonable — 6:00 AM, una vez al día. No corre al arrancar
// (a diferencia de los jobs de suscripciones.job.ts) porque estos
// disparadores son idempotentes por diseño (dedupe en base), así que no
// hay urgencia de "no esperar el primer intervalo"; correrlo manualmente
// para verificar está disponible vía ejecutarJobNotificaciones().
export function iniciarJobNotificaciones() {
  cron.schedule("0 6 * * *", () => {
    ejecutarJobNotificaciones();
  });
}
