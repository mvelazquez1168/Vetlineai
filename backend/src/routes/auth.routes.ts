import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

export const authRouter = Router();

// ---------------------------------------------------------------------
// GET /api/auth/me — el login ya no lo resuelve este backend (el
// frontend habla directo con Keycloak para obtener el token). Esta ruta
// es lo que el frontend llama después de loguearse contra Keycloak, para
// confirmar la sesión y traer los datos básicos de la persona/staff que
// `authenticate` ya resolvió a partir del token.
// ---------------------------------------------------------------------
authRouter.get("/me", authenticate, withTenantClient, async (req, res) => {
  try {
    if (!req.auth!.tenantId) {
      // Staff de plataforma: no hay tenant, respondemos directo.
      return res.json({ auth: req.auth, persona: null });
    }

    const result = await req.db!.query(
      `SELECT id, nombre, email, es_admin_clinica FROM personas WHERE id = $1`,
      [req.auth!.userId]
    );

    res.json({ auth: req.auth, persona: result.rows[0] ?? null });
  } catch (err) {
    console.error("GET /api/auth/me", err);
    res.status(500).json({ error: "Error interno." });
  }
});
