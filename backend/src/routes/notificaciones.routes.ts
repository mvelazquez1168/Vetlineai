import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Módulo de Notificaciones — GET de consulta (Fase D), para poder
// revisar que el job diario está disparando correctamente antes de
// integrar el envío real. 100% lectura, RLS vía req.db resuelve el
// aislamiento por tenant.
// ---------------------------------------------------------------------
export const notificacionesRouter = Router();

notificacionesRouter.use(authenticate, withTenantClient);

notificacionesRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

notificacionesRouter.get("/", async (req, res) => {
  try {
    const { tipo, desde, hasta } = req.query as Record<string, string | undefined>;
    const condiciones: string[] = [];
    const valores: any[] = [];

    if (tipo) {
      valores.push(tipo);
      condiciones.push(`n.tipo = $${valores.length}`);
    }
    if (desde) {
      valores.push(desde);
      condiciones.push(`n.creado_en >= $${valores.length}`);
    }
    if (hasta) {
      valores.push(hasta);
      condiciones.push(`n.creado_en <= $${valores.length}`);
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
    const result = await req.db!.query(
      `SELECT n.id, n.tipo, n.destinatario_tipo, n.destinatario_id,
              n.caso_id, n.paciente_id, n.cita_id, n.cuidado_preventivo_id,
              n.asunto, n.contenido, n.estado, n.creado_en,
              p.nombre AS paciente_nombre,
              COALESCE(prop.nombre, med.nombre) AS destinatario_nombre
       FROM notificaciones n
       LEFT JOIN pacientes p ON p.id = n.paciente_id
       LEFT JOIN propietarios prop ON prop.id = n.destinatario_id AND n.destinatario_tipo = 'propietario'
       LEFT JOIN personas med ON med.id = n.destinatario_id AND n.destinatario_tipo = 'medico'
       ${where}
       ORDER BY n.creado_en DESC`,
      valores
    );
    res.json({ notificaciones: result.rows });
  } catch (err) {
    console.error("GET /notificaciones", err);
    res.status(500).json({ error: "Error al listar las notificaciones." });
  }
});

// ---------------------------------------------------------------------
// GET /api/notificaciones/mias
//
// Campanita personal — a diferencia de GET / (todas las de la clínica,
// panel de administración/auditoría), esto solo trae lo dirigido al
// médico autenticado actual (destinatario_tipo='medico' AND
// destinatario_id=userId). Ver prompt_notificaciones_campanita.md: no
// comparte lógica de filtrado con el panel completo a propósito, son dos
// vistas con propósitos distintos.
// ---------------------------------------------------------------------
notificacionesRouter.get("/mias", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT n.id, n.tipo, n.caso_id, n.paciente_id, n.cita_id, n.cuidado_preventivo_id,
              n.asunto, n.contenido, n.estado, n.leida, n.leida_en, n.creado_en,
              p.nombre AS paciente_nombre
       FROM notificaciones n
       LEFT JOIN pacientes p ON p.id = n.paciente_id
       WHERE n.destinatario_tipo = 'medico' AND n.destinatario_id = $1
       ORDER BY n.creado_en DESC`,
      [req.auth!.userId]
    );
    const noLeidas = result.rows.filter((n) => !n.leida).length;
    res.json({ notificaciones: result.rows, no_leidas: noLeidas });
  } catch (err) {
    console.error("GET /notificaciones/mias", err);
    res.status(500).json({ error: "Error al listar tus notificaciones." });
  }
});

// ---------------------------------------------------------------------
// PATCH /api/notificaciones/:id/marcar-leida
//
// Solo el destinatario de esa notificación puede marcarla — 403 si
// destinatario_id no coincide con el usuario autenticado (evita que un
// médico marque como leída una notificación de otro médico solo por
// conocer el id).
// ---------------------------------------------------------------------
notificacionesRouter.patch("/:id/marcar-leida", async (req, res) => {
  try {
    const actualResult = await req.db!.query(
      `SELECT destinatario_tipo, destinatario_id FROM notificaciones WHERE id = $1`,
      [req.params.id]
    );
    if (actualResult.rows.length === 0) {
      return res.status(404).json({ error: "Notificación no encontrada." });
    }
    const notif = actualResult.rows[0];
    if (notif.destinatario_tipo !== "medico" || notif.destinatario_id !== req.auth!.userId) {
      return res.status(403).json({ error: "Solo el destinatario puede marcar esta notificación como leída." });
    }

    const result = await req.db!.query(
      `UPDATE notificaciones SET leida = true, leida_en = now() WHERE id = $1
       RETURNING id, leida, leida_en`,
      [req.params.id]
    );
    res.json({ notificacion: result.rows[0] });
  } catch (err) {
    console.error("PATCH /notificaciones/:id/marcar-leida", err);
    res.status(500).json({ error: "Error al marcar la notificación como leída." });
  }
});
