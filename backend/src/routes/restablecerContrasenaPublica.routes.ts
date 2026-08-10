import { Router } from "express";
import { pool } from "../db";
import { solicitarRestablecimiento, validarTokenRestablecimiento, confirmarRestablecimiento } from "../restablecerContrasena";

// ---------------------------------------------------------------------
// prompt_code_restablecer_contrasena — pantallas públicas (sin sesión),
// mismo patrón que verificacionCorreoPublica.routes.ts: `pool` directo,
// sin RLS todavía.
// ---------------------------------------------------------------------

export const restablecerContrasenaPublicaRouter = Router();

// SIEMPRE 200 con el mismo mensaje, exista o no la cuenta, esté o no
// limitada — ver restablecerContrasena.ts. El body nunca debe usarse
// para distinguir casos.
restablecerContrasenaPublicaRouter.post("/", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Falta el correo electrónico." });
  }
  try {
    await solicitarRestablecimiento(pool, email.trim().toLowerCase());
  } catch (err) {
    // Ni siquiera un error interno debe cambiar la respuesta pública —
    // se registra para diagnóstico, pero el usuario ve el mismo mensaje.
    console.error("POST /restablecer-contrasena", err);
  }
  res.json({ ok: true, mensaje: "Si esa dirección está registrada, te enviamos las instrucciones." });
});

restablecerContrasenaPublicaRouter.get("/:token", async (req, res) => {
  try {
    const resultado = await validarTokenRestablecimiento(pool, req.params.token);
    if (!resultado.ok) {
      return res.status(400).json({ error: "Enlace no válido.", motivo: resultado.motivo });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("GET /restablecer-contrasena/:token", err);
    res.status(500).json({ error: "No se pudo validar el enlace." });
  }
});

restablecerContrasenaPublicaRouter.post("/:token/confirmar", async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await confirmarRestablecimiento(client, req.params.token, password);
    if (!resultado.ok) {
      await client.query("ROLLBACK");
      const mensajes: Record<string, string> = {
        token_invalido: "El enlace de restablecimiento no es válido.",
        token_vencido: "El enlace de restablecimiento venció. Pedí uno nuevo.",
        token_usado: "Este enlace ya fue usado. Pedí uno nuevo si necesitás restablecer tu contraseña de nuevo.",
      };
      return res.status(400).json({ error: mensajes[resultado.motivo], motivo: resultado.motivo });
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /restablecer-contrasena/:token/confirmar", err);
    res.status(500).json({ error: "No se pudo restablecer la contraseña." });
  } finally {
    client.release();
  }
});
