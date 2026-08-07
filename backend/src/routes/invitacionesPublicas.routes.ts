import { Router } from "express";
import { pool } from "../db";
import { obtenerTokenParaUsuario } from "../keycloakAdmin";
import { aceptarInvitacion, obtenerInvitacionPorToken } from "../invitaciones";

// ---------------------------------------------------------------------
// Pantallas faltantes, Prompt A, Paso 3 — pantalla pública (sin sesión) a
// la que se llega por el enlace de invitación. Mismo patrón que
// registro.routes.ts: usa `pool` directo (conecta como el owner de las
// tablas, sin RLS) porque todavía no hay tenant_id de sesión con el que
// posicionar un cliente con RLS forzado.
// ---------------------------------------------------------------------

export const invitacionesPublicasRouter = Router();

invitacionesPublicasRouter.get("/:token", async (req, res) => {
  try {
    const invitacion = await obtenerInvitacionPorToken(pool, req.params.token);
    res.json(invitacion);
  } catch (err) {
    console.error("GET /invitaciones/:token", err);
    res.status(500).json({ error: "No se pudo consultar la invitación." });
  }
});

invitacionesPublicasRouter.post("/:token/aceptar", async (req, res) => {
  const { nombre, colegiatura, password } = req.body as {
    nombre?: string;
    colegiatura?: string;
    password?: string;
  };
  if (!nombre || !colegiatura || !password) {
    return res.status(400).json({ error: "Faltan nombre, colegiatura o contraseña." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await aceptarInvitacion(client, req.params.token, { nombre, colegiatura, password });
    if (!resultado.ok) {
      await client.query("ROLLBACK");
      const mensajes: Record<string, string> = {
        no_encontrada: "El enlace de invitación no es válido.",
        aceptada: "Este enlace ya fue utilizado.",
        cancelada: "Esta invitación fue cancelada por la clínica.",
        vencida: "Esta invitación venció.",
        keycloak_existente: "Ya existe una cuenta con ese correo.",
      };
      const status = resultado.motivo === "keycloak_existente" ? 409 : 400;
      return res.status(status).json({ error: mensajes[resultado.motivo], motivo: resultado.motivo });
    }
    await client.query("COMMIT");

    try {
      const tokens = await obtenerTokenParaUsuario(resultado.email, resultado.password);
      return res.status(201).json({
        autoLogin: true,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      });
    } catch (err) {
      console.error("POST /invitaciones/:token/aceptar: alta ok pero falló el auto-login", err);
      return res.status(201).json({ autoLogin: false });
    }
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe una cuenta con ese correo." });
    }
    console.error("POST /invitaciones/:token/aceptar", err);
    res.status(500).json({ error: "No se pudo completar el alta." });
  } finally {
    client.release();
  }
});
