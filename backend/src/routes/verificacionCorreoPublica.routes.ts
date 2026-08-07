import { Router } from "express";
import { pool } from "../db";
import { confirmarVerificacionPorToken } from "../verificacionCorreo";

// ---------------------------------------------------------------------
// Prompt de verificación de correo — pantalla pública (sin sesión) a la
// que se llega por el enlace del correo. Mismo patrón que
// invitacionesPublicas.routes.ts: `pool` directo, sin RLS, porque
// todavía no hay sesión con la que posicionar un cliente con tenant_id.
// ---------------------------------------------------------------------

export const verificacionCorreoPublicaRouter = Router();

verificacionCorreoPublicaRouter.post("/:token/confirmar", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await confirmarVerificacionPorToken(client, req.params.token);
    if (!resultado.ok) {
      await client.query("ROLLBACK");
      const mensajes: Record<string, string> = {
        token_invalido: "El enlace de verificación no es válido.",
        token_vencido: "El enlace de verificación venció. Pedí que te lo reenvíen desde el producto.",
      };
      return res.status(400).json({ error: mensajes[resultado.motivo], motivo: resultado.motivo });
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /verificar-correo/:token/confirmar", err);
    res.status(500).json({ error: "No se pudo confirmar la verificación." });
  } finally {
    client.release();
  }
});
