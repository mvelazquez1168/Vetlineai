import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Descarga de informes ya generados (historial versionado, ver
// migración 018) — lectura directa de bytea desde Postgres, sin llamar
// a Claude en absoluto.
// ---------------------------------------------------------------------
export const informesRouter = Router();

informesRouter.use(authenticate, withTenantClient);

informesRouter.use((req, res, next) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }
  next();
});

// GET /api/informes/:id/descargar
// El control de permisos es por tenant (RLS vía withTenantClient) y por
// pertenecer a un caso real, no por "dueño" del caso — mismo criterio que
// GET /casos/:id/informes (ver prompt_code_informes_anteriores, Paso 3):
// cualquier médico de la clínica puede descargar cualquier informe de
// cualquier caso, lo haya generado él mismo, un colega, o el médico
// original de un caso ya reasignado.
informesRouter.get("/:id/descargar", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT contenido_docx, nombre_archivo FROM informes_generados WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Informe no encontrado." });
    }
    const fila = result.rows[0];

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fila.nombre_archivo}"`);
    res.send(fila.contenido_docx);
  } catch (err) {
    console.error("GET /informes/:id/descargar", err);
    res.status(500).json({ error: "Error al descargar el informe." });
  }
});
