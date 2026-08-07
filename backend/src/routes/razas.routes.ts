import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

export const razasRouter = Router();

// A diferencia de paisesRouter (público, sin sesión, porque país se elige
// desde formularios pre-login), razas solo se usa dentro del wizard de
// "Nuevo caso" del workspace clínico — mismo gate que pacientes/propietarios.
razasRouter.use(authenticate, withTenantClient);

razasRouter.use((req, res, next) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }
  next();
});

// ---------------------------------------------------------------------
// GET /api/razas?especie=canina|felina
// ---------------------------------------------------------------------
razasRouter.get("/", async (req, res) => {
  const { especie } = req.query;
  if (especie !== "canina" && especie !== "felina") {
    return res.status(400).json({ error: "El parámetro especie debe ser 'canina' o 'felina'." });
  }

  try {
    const result = await req.db!.query(
      `SELECT id, nombre FROM razas WHERE especie = $1 ORDER BY nombre`,
      [especie]
    );
    res.json({ razas: result.rows });
  } catch (err) {
    console.error("GET /razas", err);
    res.status(500).json({ error: "Error al listar razas." });
  }
});
