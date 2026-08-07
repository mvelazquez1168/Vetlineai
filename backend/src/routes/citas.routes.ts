import { Router } from "express";
import { PoolClient } from "pg";
import { authenticate, withTenantClient } from "../middleware/auth";
import { avisoActivo, emitirNotificacion } from "../notificaciones";

// ---------------------------------------------------------------------
// Citas — 100% CRUD/SQL, sin IA en ninguna parte. tenant_id directo, sin
// clinica_id (ver nota de diseño en la migración 017).
// ---------------------------------------------------------------------
export const citasRouter = Router();

function formatoFechaCorta(fecha: Date | string): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Intl.DateTimeFormat("es", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

citasRouter.use(authenticate, withTenantClient);

citasRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

// Transiciones de estado válidas — explícitas, sin saltos ilógicos.
// Estados terminales (completada/cancelada/no_show) no salen a ningún
// otro estado.
const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  programada: ["confirmada", "cancelada", "no_show"],
  confirmada: ["registrada", "cancelada", "no_show"],
  registrada: ["en_consulta", "cancelada"],
  en_consulta: ["completada", "cancelada"],
  completada: [],
  cancelada: [],
  no_show: [],
};

function sumarMinutos(horaHHMM: string, minutos: number): string {
  const [h, m] = horaHHMM.split(":").map(Number);
  const total = h * 60 + m + minutos;
  const hh = Math.floor(((total % 1440) + 1440) / 60) % 24;
  const mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// No es IA — una consulta de solapamiento simple: mismo médico O misma
// sala, mismo día, rangos de hora que se cruzan. Nunca bloquea: el
// llamador decide qué hacer con el resultado.
async function buscarConflictos(
  db: PoolClient,
  params: {
    fecha: string;
    horaInicio: string;
    horaFin: string;
    medicoId: string;
    salaId: string | null;
    excluirCitaId?: string;
  }
) {
  const condicionesRecurso = params.salaId
    ? `(c.medico_id = $2 OR c.sala_id = $3)`
    : `c.medico_id = $2`;
  const valores: any[] = [params.fecha, params.medicoId];
  if (params.salaId) valores.push(params.salaId);
  valores.push(params.horaFin, params.horaInicio);
  const idxHoraFin = valores.length - 1;
  const idxHoraInicio = valores.length;

  let query = `
    SELECT c.id, c.fecha, c.hora_inicio, c.hora_fin, c.medico_id, c.sala_id, c.estado,
           p.nombre AS paciente_nombre, m.nombre AS medico_nombre, s.nombre AS sala_nombre
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    JOIN personas m ON m.id = c.medico_id
    LEFT JOIN salas s ON s.id = c.sala_id
    WHERE c.fecha = $1
      AND c.estado NOT IN ('cancelada', 'no_show')
      AND ${condicionesRecurso}
      AND c.hora_inicio < $${idxHoraFin}
      AND c.hora_fin > $${idxHoraInicio}
  `;
  if (params.excluirCitaId) {
    valores.push(params.excluirCitaId);
    query += ` AND c.id != $${valores.length}`;
  }

  const result = await db.query(query, valores);
  return result.rows;
}

export interface CrearCitaInput {
  pacienteId: string;
  medicoId: string;
  salaId?: string | null;
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  prioridad?: "baja" | "normal" | "alta" | "emergencia";
  motivoConsulta?: string;
}

// Núcleo de creación de citas (conflictos + insert) — exportada para que
// POST /lista-espera/:id/agendar la reuse tal cual, sin duplicarla (así
// lo pide el prompt explícitamente: "reusando la misma lógica de POST
// /api/citas, incluyendo detección de conflictos").
export async function crearCita(db: PoolClient, tenantId: string, body: CrearCitaInput) {
  const horaFin = sumarMinutos(body.horaInicio, body.duracionMinutos);
  const conflictos = await buscarConflictos(db, {
    fecha: body.fecha,
    horaInicio: body.horaInicio,
    horaFin,
    medicoId: body.medicoId,
    salaId: body.salaId ?? null,
  });

  const result = await db.query(
    `INSERT INTO citas
       (tenant_id, paciente_id, medico_id, sala_id, fecha, hora_inicio, hora_fin,
        duracion_minutos, prioridad, motivo_consulta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    ]
  );
  const cita = result.rows[0];

  // prompt_code_notificaciones_pendientes.md, C1 — confirmación al
  // propietario en el momento de agendar, sea desde POST /citas o desde
  // POST /lista-espera/:id/agendar (esta función es el único punto de
  // creación de citas, ver comentario de arriba).
  if (await avisoActivo(db, tenantId, "confirmacion_cita_activo")) {
    const datosNotificacion = await db.query(
      `SELECT p.nombre AS paciente_nombre, p.propietario_id, m.nombre AS medico_nombre
       FROM pacientes p, personas m
       WHERE p.id = $1 AND m.id = $2`,
      [cita.paciente_id, cita.medico_id]
    );
    const info = datosNotificacion.rows[0];
    if (info) {
      const fecha = formatoFechaCorta(cita.fecha);
      const hora = String(cita.hora_inicio).slice(0, 5);
      await emitirNotificacion(db, {
        tenantId,
        tipo: "confirmacion_cita",
        destinatarioTipo: "propietario",
        destinatarioId: info.propietario_id,
        pacienteId: cita.paciente_id,
        citaId: cita.id,
        asunto: `Cita confirmada — ${info.paciente_nombre}`,
        contenido: `Se registró la cita de ${info.paciente_nombre} para el ${fecha} a las ${hora} con ${info.medico_nombre}.`,
        datosCorreo: { nombrePaciente: info.paciente_nombre, fecha, hora, medicoNombre: info.medico_nombre },
      });
    }
  }

  return { cita, conflictos };
}

// prompt_code_notificaciones_pendientes.md, C2 — un solo aviso para
// cancelación y reprogramación (mismo tipo, contenido distinto según
// `reprogramada`), llamado desde los 3 puntos donde una cita deja de
// estar en pie: PATCH estado->cancelada, PUT con fecha/hora distinta, y
// DELETE (ver nota de diseño en el handler DELETE más abajo).
async function notificarCitaCanceladaOReprogramada(
  db: PoolClient,
  tenantId: string,
  cita: { id: string; paciente_id: string; fecha: string; hora_inicio: string },
  reprogramada: boolean,
  fechaNueva?: string,
  horaNueva?: string
): Promise<void> {
  if (!(await avisoActivo(db, tenantId, "cancelacion_cita_activo"))) return;

  const info = await db.query(`SELECT nombre AS paciente_nombre, propietario_id FROM pacientes WHERE id = $1`, [
    cita.paciente_id,
  ]);
  const row = info.rows[0];
  if (!row) return;

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
    asunto: reprogramada ? `Cita reprogramada — ${row.paciente_nombre}` : `Cita cancelada — ${row.paciente_nombre}`,
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
// GET /api/citas?desde=&hasta=&medico_id=&estado=
// ---------------------------------------------------------------------
citasRouter.get("/", async (req, res) => {
  try {
    const { desde, hasta, medico_id, estado } = req.query as Record<string, string | undefined>;
    const condiciones: string[] = [];
    const valores: any[] = [];

    if (desde) {
      valores.push(desde);
      condiciones.push(`c.fecha >= $${valores.length}`);
    }
    if (hasta) {
      valores.push(hasta);
      condiciones.push(`c.fecha <= $${valores.length}`);
    }
    if (medico_id) {
      valores.push(medico_id);
      condiciones.push(`c.medico_id = $${valores.length}`);
    }
    if (estado) {
      valores.push(estado);
      condiciones.push(`c.estado = $${valores.length}`);
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
    const result = await req.db!.query(
      `SELECT c.*, p.nombre AS paciente_nombre, p.especie,
              prop.nombre AS propietario_nombre,
              m.nombre AS medico_nombre, s.nombre AS sala_nombre
       FROM citas c
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN propietarios prop ON prop.id = p.propietario_id
       JOIN personas m ON m.id = c.medico_id
       LEFT JOIN salas s ON s.id = c.sala_id
       ${where}
       ORDER BY c.fecha ASC, c.hora_inicio ASC`,
      valores
    );
    res.json({ citas: result.rows });
  } catch (err) {
    console.error("GET /citas", err);
    res.status(500).json({ error: "Error al listar las citas." });
  }
});

// ---------------------------------------------------------------------
// POST /api/citas — nunca bloquea por conflicto, solo informa.
// ---------------------------------------------------------------------
citasRouter.post("/", async (req, res) => {
  const body = req.body as CrearCitaInput;
  if (!body.pacienteId || !body.medicoId || !body.fecha || !body.horaInicio || !body.duracionMinutos) {
    return res.status(400).json({ error: "Faltan pacienteId, medicoId, fecha, horaInicio o duracionMinutos." });
  }

  try {
    const { cita, conflictos } = await crearCita(req.db!, req.auth!.tenantId!, body);
    res.status(201).json({ cita, conflictos });
  } catch (err) {
    console.error("POST /citas", err);
    res.status(500).json({ error: "Error al crear la cita." });
  }
});

// ---------------------------------------------------------------------
// PUT /api/citas/:id — reprogramar/editar, misma detección de conflictos.
// ---------------------------------------------------------------------
citasRouter.put("/:id", async (req, res) => {
  const body = req.body as CrearCitaInput;
  if (!body.pacienteId || !body.medicoId || !body.fecha || !body.horaInicio || !body.duracionMinutos) {
    return res.status(400).json({ error: "Faltan pacienteId, medicoId, fecha, horaInicio o duracionMinutos." });
  }

  try {
    const existente = await req.db!.query(`SELECT id, paciente_id, fecha, hora_inicio FROM citas WHERE id = $1`, [
      req.params.id,
    ]);
    if (existente.rows.length === 0) {
      return res.status(404).json({ error: "Cita no encontrada." });
    }
    const anterior = existente.rows[0];

    const horaFin = sumarMinutos(body.horaInicio, body.duracionMinutos);
    const conflictos = await buscarConflictos(req.db!, {
      fecha: body.fecha,
      horaInicio: body.horaInicio,
      horaFin,
      medicoId: body.medicoId,
      salaId: body.salaId ?? null,
      excluirCitaId: req.params.id,
    });

    const result = await req.db!.query(
      `UPDATE citas
       SET paciente_id = $1, medico_id = $2, sala_id = $3, fecha = $4, hora_inicio = $5,
           hora_fin = $6, duracion_minutos = $7, prioridad = $8, motivo_consulta = $9,
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
        req.params.id,
      ]
    );
    const cita = result.rows[0];

    // C2 — solo cuenta como "reprogramada" si la fecha o la hora
    // realmente cambiaron; editar prioridad o motivo no es una
    // reprogramación y no debería avisar al tutor.
    //
    // anterior.fecha es un DATE que pg parsea como Date (medianoche UTC) —
    // String(date) usa el formato local del motor de JS ("Wed Aug 12
    // 2026..."), nunca ISO, así que comparar sus primeros 10 caracteres
    // contra body.fecha ("2026-08-12") daba SIEMPRE distinto — cualquier
    // edición (aunque fuera solo el motivo) se reportaba como
    // reprogramación. toISOString() sí reconstruye el YYYY-MM-DD real
    // porque el Date ya está anclado a medianoche UTC.
    const fechaAnteriorISO = new Date(anterior.fecha).toISOString().slice(0, 10);
    const huboReprogramacion =
      fechaAnteriorISO !== body.fecha || String(anterior.hora_inicio).slice(0, 5) !== body.horaInicio;
    if (huboReprogramacion) {
      await notificarCitaCanceladaOReprogramada(
        req.db!,
        req.auth!.tenantId!,
        { id: cita.id, paciente_id: anterior.paciente_id, fecha: anterior.fecha, hora_inicio: anterior.hora_inicio },
        true,
        formatoFechaCorta(body.fecha),
        body.horaInicio
      );
    }

    res.json({ cita, conflictos });
  } catch (err) {
    console.error("PUT /citas/:id", err);
    res.status(500).json({ error: "Error al editar la cita." });
  }
});

// ---------------------------------------------------------------------
// PATCH /api/citas/:id/estado
// ---------------------------------------------------------------------
citasRouter.patch("/:id/estado", async (req, res) => {
  const { estado: nuevoEstado, motivoCancelacion, casoId } = req.body as {
    estado?: string;
    motivoCancelacion?: string;
    casoId?: string;
  };
  if (!nuevoEstado) {
    return res.status(400).json({ error: "Falta el nuevo estado." });
  }

  try {
    const actual = await req.db!.query(`SELECT id, estado, paciente_id, fecha, hora_inicio FROM citas WHERE id = $1`, [
      req.params.id,
    ]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: "Cita no encontrada." });
    }
    const citaAnterior = actual.rows[0];
    const estadoActual = citaAnterior.estado as string;
    const permitidos = TRANSICIONES_VALIDAS[estadoActual] ?? [];
    if (!permitidos.includes(nuevoEstado)) {
      return res.status(400).json({
        error: `No se puede pasar de '${estadoActual}' a '${nuevoEstado}'. Transiciones válidas desde '${estadoActual}': ${
          permitidos.length > 0 ? permitidos.join(", ") : "ninguna (estado final)"
        }.`,
      });
    }

    const result = await req.db!.query(
      `UPDATE citas
       SET estado = $1,
           motivo_cancelacion = CASE WHEN $1::varchar = 'cancelada' THEN $2 ELSE motivo_cancelacion END,
           caso_id = COALESCE($3, caso_id),
           actualizado_en = now()
       WHERE id = $4
       RETURNING *`,
      [nuevoEstado, motivoCancelacion ?? null, casoId ?? null, req.params.id]
    );
    const cita = result.rows[0];

    // C2 — cancelación explícita (no reprogramación: acá no hay fecha
    // nueva que ofrecer).
    if (nuevoEstado === "cancelada") {
      await notificarCitaCanceladaOReprogramada(req.db!, req.auth!.tenantId!, citaAnterior, false);
    }

    res.json({ cita });
  } catch (err) {
    console.error("PATCH /citas/:id/estado", err);
    res.status(500).json({ error: "Error al cambiar el estado de la cita." });
  }
});

// ---------------------------------------------------------------------
// DELETE /api/citas/:id — solo citas que todavía no arrancaron.
//
// prompt_code_notificaciones_pendientes.md, C2 — el borrado en duro deja
// al tutor esperando un turno que ya no existe si no se avisa acá
// también. Se manda el mismo aviso de cancelación ANTES de borrar (los
// datos del paciente/propietario todavía tienen que estar disponibles).
//
// notificaciones.cita_id no tiene ON DELETE CASCADE (a propósito: una
// notificación ya enviada es historia, no debería desaparecer porque la
// cita se borró) — pero SÍ bloqueaba el DELETE con una violación de FK
// en cuanto la cita tenía alguna notificación previa (la confirmación de
// C1, como mínimo, existe siempre desde que se agenda). Se desvincula
// (cita_id = NULL) antes de borrar, no se elimina la notificación.
//
// Nota aparte, señalada al usuario y NO resuelta en este prompt: borrar
// en duro una cita destruye el historial de quién la canceló y por qué
// (motivo_cancelacion no se completa acá). Convertir este DELETE en una
// cancelación sería una decisión de diseño aparte.
// ---------------------------------------------------------------------
citasRouter.delete("/:id", async (req, res) => {
  try {
    const actual = await req.db!.query(`SELECT id, estado, paciente_id, fecha, hora_inicio FROM citas WHERE id = $1`, [
      req.params.id,
    ]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: "Cita no encontrada." });
    }
    const citaAnterior = actual.rows[0];
    const estadoActual = citaAnterior.estado as string;
    if (estadoActual !== "programada" && estadoActual !== "confirmada") {
      return res.status(400).json({
        error: "Solo se pueden borrar citas en estado 'programada' o 'confirmada'. Usá cancelar o no-show para las demás.",
      });
    }
    await notificarCitaCanceladaOReprogramada(req.db!, req.auth!.tenantId!, citaAnterior, false);
    await req.db!.query(`UPDATE notificaciones SET cita_id = NULL WHERE cita_id = $1`, [req.params.id]);
    await req.db!.query(`DELETE FROM citas WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /citas/:id", err);
    res.status(500).json({ error: "Error al borrar la cita." });
  }
});
