import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Endpoints de agregación de la Agenda — Centro de Comando, Conflictos
// standalone y Analíticas. Todo por SQL directo, CERO llamadas a la API
// de Anthropic. tenant_id directo (sin clinica_id, ver migración 017).
// ---------------------------------------------------------------------
export const agendaRouter = Router();

agendaRouter.use(authenticate, withTenantClient);

agendaRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

// No existe una columna de "capacidad máxima por defecto de la clínica"
// en tenants (el prompt original asumía que ya existía uno) — se usa
// esta constante como placeholder ajustable cuando un médico no tiene
// max_citas_dia propio configurado para ese día. Ver aviso al usuario.
const CAPACIDAD_MAXIMA_DEFAULT = 20;

async function obtenerZonaHoraria(db: any, tenantId: string): Promise<string> {
  const result = await db.query(`SELECT zona_horaria FROM tenants WHERE id = $1`, [tenantId]);
  return result.rows[0]?.zona_horaria ?? "America/Costa_Rica";
}

function fechaHoyEnZona(zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date());
}

// ---------------------------------------------------------------------
// GET /api/centro-comando?fecha=
// ---------------------------------------------------------------------
agendaRouter.get("/centro-comando", async (req, res) => {
  try {
    const zona = await obtenerZonaHoraria(req.db!, req.auth!.tenantId!);
    const fecha = (req.query.fecha as string | undefined) ?? fechaHoyEnZona(zona);

    const citasResult = await req.db!.query(
      `SELECT c.id, c.hora_inicio, c.hora_fin, c.estado, c.motivo_consulta,
              p.nombre AS paciente_nombre, p.especie,
              prop.nombre AS propietario_nombre,
              m.nombre AS medico_nombre
       FROM citas c
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN propietarios prop ON prop.id = p.propietario_id
       JOIN personas m ON m.id = c.medico_id
       WHERE c.fecha = $1
       ORDER BY c.hora_inicio ASC`,
      [fecha]
    );
    const citas = citasResult.rows;

    const conteos = {
      total: citas.length,
      enSalaEspera: citas.filter((c: any) => c.estado === "registrada").length,
      enProgreso: citas.filter((c: any) => c.estado === "en_consulta").length,
      completadas: citas.filter((c: any) => c.estado === "completada").length,
      noShowsCanceladas: citas.filter((c: any) => c.estado === "no_show" || c.estado === "cancelada").length,
    };

    const duracionResult = await req.db!.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (hora_fin - hora_inicio)) / 60) AS promedio
       FROM citas WHERE fecha = $1 AND estado = 'completada'`,
      [fecha]
    );
    const duracionPromedioMinutos = duracionResult.rows[0].promedio
      ? Math.round(Number(duracionResult.rows[0].promedio))
      : null;

    const colaProximos = citas
      .filter((c: any) => !["completada", "cancelada", "no_show"].includes(c.estado))
      .slice(0, 5);

    // No-show: hora_inicio + 15 min ya pasó y sigue sin check-in.
    const noShowResult = await req.db!.query(
      `SELECT c.id, c.hora_inicio, p.nombre AS paciente_nombre, m.nombre AS medico_nombre
       FROM citas c
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN personas m ON m.id = c.medico_id
       WHERE c.fecha = $1
         AND c.estado IN ('programada', 'confirmada')
         AND ((c.fecha + c.hora_inicio) AT TIME ZONE $2 + interval '15 minutes') < now()
       ORDER BY c.hora_inicio ASC`,
      [fecha, zona]
    );

    const cargaTrabajo = await calcularCargaTrabajo(req.db!, req.auth!.tenantId!, fecha);

    res.json({
      fecha,
      conteos,
      duracionPromedioMinutos,
      flujoClinico: citas,
      colaProximos,
      alertasNoShow: noShowResult.rows,
      cargaTrabajo,
    });
  } catch (err) {
    console.error("GET /centro-comando", err);
    res.status(500).json({ error: "Error al obtener el centro de comando." });
  }
});

// Fase F — aritmética factual pura, sin componente predictivo: citas
// agendadas hoy / capacidad máxima configurada, redondeado.
async function calcularCargaTrabajo(db: any, tenantId: string, fecha: string) {
  // dia_semana: misma convención que Postgres EXTRACT(DOW) y JS
  // Date.getDay() — 0=domingo, 6=sábado (el prompt no lo especificaba).
  const diaSemana = new Date(`${fecha}T00:00:00Z`).getUTCDay();

  const medicosResult = await db.query(
    `SELECT id, nombre FROM personas WHERE tenant_id = $1 AND es_admin_clinica = false AND estado = 'activo'`,
    [tenantId]
  );

  const carga = [];
  for (const medico of medicosResult.rows) {
    const citasHoyResult = await db.query(
      `SELECT COUNT(*) FROM citas WHERE medico_id = $1 AND fecha = $2 AND estado != 'cancelada'`,
      [medico.id, fecha]
    );
    const citasHoy = Number(citasHoyResult.rows[0].count);

    const horarioResult = await db.query(
      `SELECT max_citas_dia FROM horarios_configuracion WHERE medico_id = $1 AND dia_semana = $2`,
      [medico.id, diaSemana]
    );
    const capacidadMaxima = horarioResult.rows[0]?.max_citas_dia ?? CAPACIDAD_MAXIMA_DEFAULT;

    carga.push({
      medicoId: medico.id,
      medicoNombre: medico.nombre,
      citasHoy,
      capacidadMaxima,
      porcentaje: capacidadMaxima > 0 ? Math.round((citasHoy / capacidadMaxima) * 100) : 0,
    });
  }
  return carga;
}

// ---------------------------------------------------------------------
// GET /api/conflictos?fecha= — pares de citas solapadas (médico o sala)
// standalone, sin necesidad de editar una cita para descubrirlos.
// ---------------------------------------------------------------------
agendaRouter.get("/conflictos", async (req, res) => {
  try {
    const zona = await obtenerZonaHoraria(req.db!, req.auth!.tenantId!);
    const fecha = (req.query.fecha as string | undefined) ?? fechaHoyEnZona(zona);

    const result = await req.db!.query(
      `SELECT
         a.id AS cita_a_id, a.hora_inicio AS a_hora_inicio, a.hora_fin AS a_hora_fin,
         pa.nombre AS a_paciente_nombre, ma.nombre AS a_medico_nombre, sa.nombre AS a_sala_nombre,
         b.id AS cita_b_id, b.hora_inicio AS b_hora_inicio, b.hora_fin AS b_hora_fin,
         pb.nombre AS b_paciente_nombre, mb.nombre AS b_medico_nombre, sb.nombre AS b_sala_nombre,
         CASE WHEN a.medico_id = b.medico_id THEN 'medico' ELSE 'sala' END AS tipo
       FROM citas a
       JOIN citas b ON a.id < b.id AND a.fecha = b.fecha
       JOIN pacientes pa ON pa.id = a.paciente_id
       JOIN pacientes pb ON pb.id = b.paciente_id
       JOIN personas ma ON ma.id = a.medico_id
       JOIN personas mb ON mb.id = b.medico_id
       LEFT JOIN salas sa ON sa.id = a.sala_id
       LEFT JOIN salas sb ON sb.id = b.sala_id
       WHERE a.fecha = $1
         AND a.estado NOT IN ('cancelada', 'no_show')
         AND b.estado NOT IN ('cancelada', 'no_show')
         AND a.hora_inicio < b.hora_fin AND a.hora_fin > b.hora_inicio
         AND (a.medico_id = b.medico_id OR (a.sala_id IS NOT NULL AND a.sala_id = b.sala_id))
       ORDER BY a.hora_inicio ASC`,
      [fecha]
    );
    res.json({ fecha, conflictos: result.rows });
  } catch (err) {
    console.error("GET /conflictos", err);
    res.status(500).json({ error: "Error al obtener los conflictos." });
  }
});

// ---------------------------------------------------------------------
// GET /api/analiticas?desde=&hasta= — sin "Revenue/Appt" ni nada de
// facturación, explícitamente fuera de este módulo.
// ---------------------------------------------------------------------
agendaRouter.get("/analiticas", async (req, res) => {
  const desde = req.query.desde as string | undefined;
  const hasta = req.query.hasta as string | undefined;
  if (!desde || !hasta) {
    return res.status(400).json({ error: "Faltan los parámetros desde y hasta." });
  }

  try {
    const totalResult = await req.db!.query(
      `SELECT COUNT(*) FROM citas WHERE fecha BETWEEN $1 AND $2`,
      [desde, hasta]
    );
    const totalActual = Number(totalResult.rows[0].count);

    const dias = Math.round(
      (new Date(hasta).getTime() - new Date(desde).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;
    const hastaAnterior = new Date(desde);
    hastaAnterior.setUTCDate(hastaAnterior.getUTCDate() - 1);
    const desdeAnterior = new Date(desde);
    desdeAnterior.setUTCDate(desdeAnterior.getUTCDate() - dias);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const totalAnteriorResult = await req.db!.query(
      `SELECT COUNT(*) FROM citas WHERE fecha BETWEEN $1 AND $2`,
      [fmt(desdeAnterior), fmt(hastaAnterior)]
    );
    const totalAnterior = Number(totalAnteriorResult.rows[0].count);
    const variacionPorcentaje =
      totalAnterior > 0 ? Math.round(((totalActual - totalAnterior) / totalAnterior) * 1000) / 10 : null;

    const noShowResult = await req.db!.query(
      `SELECT COUNT(*) FILTER (WHERE estado = 'no_show') AS no_shows, COUNT(*) AS total
       FROM citas WHERE fecha BETWEEN $1 AND $2`,
      [desde, hasta]
    );
    const totalParaTasa = Number(noShowResult.rows[0].total);
    const tasaNoShow =
      totalParaTasa > 0
        ? Math.round((Number(noShowResult.rows[0].no_shows) / totalParaTasa) * 1000) / 10
        : 0;

    const duracionResult = await req.db!.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (hora_fin - hora_inicio)) / 60) AS promedio
       FROM citas WHERE fecha BETWEEN $1 AND $2 AND estado = 'completada'`,
      [desde, hasta]
    );
    const duracionPromedioMinutos = duracionResult.rows[0].promedio
      ? Math.round(Number(duracionResult.rows[0].promedio))
      : null;

    const motivosResult = await req.db!.query(
      `SELECT COALESCE(motivo_cancelacion, 'Sin motivo especificado') AS motivo, COUNT(*) AS cantidad
       FROM citas
       WHERE fecha BETWEEN $1 AND $2 AND estado = 'cancelada'
       GROUP BY motivo_cancelacion
       ORDER BY cantidad DESC`,
      [desde, hasta]
    );

    res.json({
      totalCitas: totalActual,
      totalCitasRangoAnterior: totalAnterior,
      variacionPorcentaje,
      tasaNoShowPorcentaje: tasaNoShow,
      duracionPromedioMinutos,
      motivosCancelacion: motivosResult.rows.map((r: any) => ({ motivo: r.motivo, cantidad: Number(r.cantidad) })),
    });
  } catch (err) {
    console.error("GET /analiticas", err);
    res.status(500).json({ error: "Error al obtener las analíticas." });
  }
});
