import { Request, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { modulosHabilitados } from "../tenantModulos";

export const authRouter = Router();

/**
 * `req.auth` tal cual NO se puede serializar: `permisos` es un `Set`, y
 * `JSON.stringify(new Set(["a"]))` es `{}`.
 *
 * Es el tipo de defecto que no rompe nada visible: la respuesta sale con
 * 200, el campo está, y lo que llega es un objeto vacío. El frontend
 * dibujaría un menú sin ninguna entrada y nadie sabría por qué.
 */
function paraElNavegador(auth: NonNullable<Request["auth"]>) {
  return { ...auth, permisos: [...(auth.permisos ?? [])] };
}

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
      return res.json({ auth: paraElNavegador(req.auth!), persona: null, modulos: [] });
    }

    const result = await req.db!.query(
      `SELECT id, nombre, email, es_admin_clinica, pantalla_inicio
         FROM personas WHERE id = $1`,
      [req.auth!.userId]
    );

    // vetline-clinic-01, punto 2 — qué módulos de Vetline Clinic tiene
    // habilitada esta clínica. Viaja acá y no en el token de Keycloak a
    // propósito: habilitar un módulo tiene que surtir efecto sin esperar
    // a que todas las sesiones abiertas refresquen su token.
    const modulos = await modulosHabilitados(req.db!, req.auth!.tenantId);

    res.json({ auth: paraElNavegador(req.auth!), persona: result.rows[0] ?? null, modulos });
  } catch (err) {
    console.error("GET /api/auth/me", err);
    res.status(500).json({ error: "Error interno." });
  }
});

// ---------------------------------------------------------------------
// PUT /api/auth/mi-pantalla-inicio — donde aterriza ESTE usuario al
// entrar (prompt 01c).
//
// Es del usuario y no del navegador: la misma persona entra desde la
// computadora del mostrador y desde la de la sala, y tiene que caer en
// el mismo lugar en las dos.
//
// `null` no es "ninguna": es "la que corresponda", derivada del rol y
// de los modulos habilitados. Es importante que se pueda volver a eso,
// porque la derivacion cambia sola el dia que la clinica habilita caja.
//
// La ruta se valida contra una lista corta: sin eso, un valor viejo o
// escrito a mano manda al usuario a un 404 cada vez que entra, que es
// el peor lugar donde dejar un dato invalido.
// ---------------------------------------------------------------------

const PANTALLAS_DE_ENTRADA = [
  "/inicio",
  "/workspace",
  "/agenda/calendario",
  "/pacientes",
  "/ventas",
  "/inventario",
  "/admin/casos",
  "/admin/medicos",
];

authRouter.get("/pantallas-de-entrada", authenticate, (_req, res) => {
  res.json({ pantallas: PANTALLAS_DE_ENTRADA });
});

authRouter.put("/mi-pantalla-inicio", authenticate, withTenantClient, async (req, res) => {
  const pedida = req.body?.pantalla ?? null;
  if (pedida !== null && !PANTALLAS_DE_ENTRADA.includes(pedida)) {
    return res.status(400).json({ error: `"${pedida}" no es una pantalla de entrada válida.` });
  }
  if (!req.auth!.userId) {
    return res.status(403).json({ error: "Solo una persona de una clínica tiene pantalla de entrada." });
  }
  try {
    await req.db!.query(`UPDATE personas SET pantalla_inicio = $2 WHERE id = $1`, [
      req.auth!.userId,
      pedida,
    ]);
    res.json({ pantalla: pedida });
  } catch (err) {
    console.error("PUT /api/auth/mi-pantalla-inicio", err);
    res.status(500).json({ error: "No se pudo guardar la pantalla de entrada." });
  }
});
