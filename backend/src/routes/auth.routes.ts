import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { modulosHabilitados } from "../tenantModulos";

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
      // Staff de plataforma: no hay tenant, respondemos directo. `modulos`
      // va vacío y no ausente para que el frontend no tenga que
      // distinguir dos formas de respuesta — los módulos son de una
      // clínica, y staff no pertenece a ninguna.
      return res.json({ auth: req.auth, persona: null, modulos: [] });
    }

    const result = await req.db!.query(
      `SELECT id, nombre, email, es_admin_clinica FROM personas WHERE id = $1`,
      [req.auth!.userId]
    );

    // vetline-clinic-01, punto 2 — qué módulos de Vetline Clinic tiene
    // habilitada esta clínica. Viaja acá y no en el token de Keycloak a
    // propósito: habilitar un módulo tiene que surtir efecto sin esperar
    // a que todas las sesiones abiertas refresquen su token.
    const modulos = await modulosHabilitados(req.db!, req.auth!.tenantId);

    res.json({ auth: req.auth, persona: result.rows[0] ?? null, modulos });
  } catch (err) {
    console.error("GET /api/auth/me", err);
    res.status(500).json({ error: "Error interno." });
  }
});
