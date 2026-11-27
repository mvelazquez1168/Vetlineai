import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import {
  autorizarFueraDeHorario,
  crearCita,
  CrearCitaInput,
  FueraDeHorario,
  responderFueraDeHorario,
} from "./citas.routes";

// ---------------------------------------------------------------------
// Lista de espera — tenant_id directo. POST /:id/agendar reusa
// crearCita() de citas.routes.ts tal cual (misma detección de
// conflictos), no la duplica.
// ---------------------------------------------------------------------
export const listaEsperaRouter = Router();

listaEsperaRouter.use(authenticate, withTenantClient);

listaEsperaRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

// GET /api/lista-espera?prioridad=&especie=
listaEsperaRouter.get("/", async (req, res) => {
  try {
    const { prioridad, especie } = req.query as Record<string, string | undefined>;
    const condiciones: string[] = [];
    const valores: any[] = [];

    if (prioridad) {
      valores.push(prioridad);
      condiciones.push(`le.prioridad = $${valores.length}`);
    }
    if (especie) {
      valores.push(especie);
      condiciones.push(`p.especie = $${valores.length}`);
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
    const result = await req.db!.query(
      `SELECT le.*, p.nombre AS paciente_nombre, p.especie,
              prop.nombre AS propietario_nombre,
              mp.nombre AS medico_preferido_nombre
       FROM lista_espera le
       JOIN pacientes p ON p.id = le.paciente_id
       JOIN propietarios prop ON prop.id = p.propietario_id
       LEFT JOIN personas mp ON mp.id = le.medico_preferido_id
       ${where}
       ORDER BY
         CASE le.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
         le.fecha_solicitud ASC`,
      valores
    );
    res.json({ listaEspera: result.rows });
  } catch (err) {
    console.error("GET /lista-espera", err);
    res.status(500).json({ error: "Error al listar la lista de espera." });
  }
});

listaEsperaRouter.post("/", async (req, res) => {
  const { pacienteId, medicoPreferidoId, motivo, prioridad, fechaSolicitud } = req.body as {
    pacienteId?: string;
    medicoPreferidoId?: string;
    motivo?: string;
    prioridad?: string;
    fechaSolicitud?: string;
  };
  if (!pacienteId || !motivo || !motivo.trim()) {
    return res.status(400).json({ error: "Faltan pacienteId o motivo." });
  }
  try {
    const result = await req.db!.query(
      `INSERT INTO lista_espera (tenant_id, paciente_id, medico_preferido_id, motivo, prioridad, fecha_solicitud)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE))
       RETURNING *`,
      [req.auth!.tenantId, pacienteId, medicoPreferidoId ?? null, motivo.trim(), prioridad ?? "media", fechaSolicitud ?? null]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    console.error("POST /lista-espera", err);
    res.status(500).json({ error: "Error al agregar a la lista de espera." });
  }
});

listaEsperaRouter.put("/:id", async (req, res) => {
  const { medicoPreferidoId, motivo, prioridad, fechaSolicitud } = req.body as {
    medicoPreferidoId?: string;
    motivo?: string;
    prioridad?: string;
    fechaSolicitud?: string;
  };
  if (!motivo || !motivo.trim()) {
    return res.status(400).json({ error: "Falta el motivo." });
  }
  try {
    const result = await req.db!.query(
      `UPDATE lista_espera
       SET medico_preferido_id = $1, motivo = $2, prioridad = $3, fecha_solicitud = COALESCE($4, fecha_solicitud)
       WHERE id = $5
       RETURNING *`,
      [medicoPreferidoId ?? null, motivo.trim(), prioridad ?? "media", fechaSolicitud ?? null, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Ítem de lista de espera no encontrado." });
    }
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error("PUT /lista-espera/:id", err);
    res.status(500).json({ error: "Error al editar el ítem de lista de espera." });
  }
});

listaEsperaRouter.patch("/:id/estado", async (req, res) => {
  const { estado } = req.body as { estado?: string };
  if (!estado || !["pendiente", "agendada", "cancelada"].includes(estado)) {
    return res.status(400).json({ error: "Estado inválido." });
  }
  try {
    const result = await req.db!.query(
      `UPDATE lista_espera SET estado = $1 WHERE id = $2 RETURNING *`,
      [estado, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Ítem de lista de espera no encontrado." });
    }
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error("PATCH /lista-espera/:id/estado", err);
    res.status(500).json({ error: "Error al cambiar el estado." });
  }
});

// POST /api/lista-espera/:id/agendar — crea la cita real (misma lógica
// que POST /api/citas) y marca este ítem como 'agendada', vinculado.
listaEsperaRouter.post("/:id/agendar", async (req, res) => {
  const body = req.body as CrearCitaInput;
  if (!body.pacienteId || !body.medicoId || !body.fecha || !body.horaInicio || !body.duracionMinutos) {
    return res.status(400).json({ error: "Faltan pacienteId, medicoId, fecha, horaInicio o duracionMinutos." });
  }

  try {
    const itemResult = await req.db!.query(`SELECT id, estado FROM lista_espera WHERE id = $1`, [req.params.id]);
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: "Ítem de lista de espera no encontrado." });
    }
    if (itemResult.rows[0].estado !== "pendiente") {
      return res.status(400).json({ error: "Este ítem ya fue agendado o cancelado." });
    }

    // AGENDAR DESDE LA LISTA DE ESPERA ES AGENDAR: el horario de la
    // clínica vale igual que en el alta, y la excepción lleva el mismo
    // permiso. Sin esto, la lista de espera sería la puerta de atrás de
    // una política de la clínica.
    const rechazo = autorizarFueraDeHorario(req, body);
    if (rechazo) return res.status(rechazo.estado).json(rechazo.cuerpo);

    const { cita, conflictos } = await crearCita(req.db!, req.auth!.tenantId!, body);

    const updateResult = await req.db!.query(
      `UPDATE lista_espera SET estado = 'agendada', cita_id = $1 WHERE id = $2 RETURNING *`,
      [cita.id, req.params.id]
    );

    res.status(201).json({ cita, conflictos, item: updateResult.rows[0] });
  } catch (err) {
    if (err instanceof FueraDeHorario) return responderFueraDeHorario(req, res, err);
    console.error("POST /lista-espera/:id/agendar", err);
    res.status(500).json({ error: "Error al agendar el ítem de lista de espera." });
  }
});
