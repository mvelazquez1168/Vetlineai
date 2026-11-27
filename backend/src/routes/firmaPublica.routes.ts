import { Router } from "express";
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { createHash } from "crypto";
import { ConsentimientoInvalido } from "../expediente/consentimientos";
import {
  abrirFirmaRemota,
  firmarADistancia,
  verificarCodigo,
} from "../expediente/firmaRemota";

// ---------------------------------------------------------------------
// LA FIRMA A DISTANCIA, SIN SESIÓN — corrección de firmas, 2026-11-27.
//
// Este router es el único del sistema que se abre sin autenticar, y por
// eso lleva su propio razonamiento escrito:
//
//   * **el token ES la autorización**, y por eso no se guarda en claro,
//     vence, sirve una vez y pide un código que llegó por otro mensaje;
//   * **no hay tenant en la sesión**, así que tampoco se puede usar la
//     RLS por `app.tenant_id` como en el resto. La fila del enlace trae
//     su propio `tenant_id` y todo lo que se hace después usa ESE. El
//     token no se puede usar para leer datos de otra clínica porque
//     nunca se pregunta por una clínica: se pregunta por el token;
//   * **lo que se devuelve es lo mínimo**: el título, el paciente y la
//     clínica. El texto del consentimiento recién después del código,
//     porque nombra al paciente y el procedimiento;
//   * **no se puede listar nada**: no hay endpoint que devuelva enlaces,
//     ni pacientes, ni consentimientos. Solo el token que se tiene.
//
// La página que lo consume es `/firmar/:token` del frontend, que
// tampoco pide sesión.
// ---------------------------------------------------------------------

export const firmaPublicaRouter = Router();

/**
 * EL ALCANCE DE CLÍNICA SALE DEL TOKEN, no de la sesión —que no hay—.
 *
 * Se resuelve en dos pasos a propósito: primero se busca a qué clínica
 * pertenece el enlace, con una consulta que solo puede encontrar UNA
 * fila (el hash del token es único), y recién después se abre la
 * transacción CON esa clínica puesta. Así todo lo que viene después
 * corre con RLS, igual que cualquier otra escritura del sistema.
 *
 * Lo que esto NO permite: usar un token para leer datos de otra
 * clínica. El tenant no se recibe, se deduce del token.
 */
async function conAlcanceDelToken<T>(
  token: string,
  fn: (db: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const hashToken = createHash("sha256").update(token, "utf8").digest("hex");
  const r = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM exp_firmas_remotas WHERE token_hash = $1`,
    [hashToken]
  );
  if (r.rows.length === 0) {
    throw new ConsentimientoInvalido("Este enlace no es válido.");
  }
  return conAlcanceTenant(r.rows[0].tenant_id, fn);
}

function fallo(res: import("express").Response, err: unknown, donde: string) {
  if (err instanceof ConsentimientoInvalido) {
    return res.status(400).json({ error: err.message });
  }
  console.error(`[firma-publica] ${donde}:`, err);
  res.status(500).json({ error: "No se pudo completar la firma. Volvé a intentarlo." });
}

/** Abre el enlace. Devuelve lo mínimo, sin el texto. */
firmaPublicaRouter.get("/:token", async (req, res) => {
  try {
    const datos = await conAlcanceDelToken(req.params.token, (db) => abrirFirmaRemota(db, req.params.token));
    res.json(datos);
  } catch (err) {
    fallo(res, err, "GET /firma/:token");
  }
});

/** El código correcto devuelve el texto a firmar. */
firmaPublicaRouter.post("/:token/verificar", async (req, res) => {
  const { codigo } = req.body as { codigo?: string };
  if (!codigo?.trim()) {
    return res.status(400).json({ error: "Falta el código que te llegó en el mensaje." });
  }
  try {
    const datos = await conAlcanceDelToken(req.params.token, (db) =>
      verificarCodigo(db, req.params.token, codigo)
    );
    res.json(datos);
  } catch (err) {
    fallo(res, err, "POST /firma/:token/verificar");
  }
});

/** Firma. El código se vuelve a pedir porque no hay sesión que lo recuerde. */
firmaPublicaRouter.post("/:token/firmar", async (req, res) => {
  const { codigo, firmaPng, firmanteNombre, firmanteIdentificacion, relacion, autorizadoPor } =
    req.body as Record<string, string | undefined>;
  if (!codigo?.trim()) {
    return res.status(400).json({ error: "Falta el código." });
  }
  if (!firmanteNombre?.trim()) {
    return res.status(400).json({ error: "Falta tu nombre." });
  }
  try {
    const r = await conAlcanceDelToken(req.params.token, (db) =>
      firmarADistancia(db, {
        token: req.params.token,
        codigo,
        firmaPng: firmaPng ?? "",
        firmanteNombre,
        firmanteIdentificacion,
        relacion: relacion === "autorizado" ? "autorizado" : "propietario",
        autorizadoPor,
        // La evidencia la pone el servidor, igual que en la firma
        // presencial.
        dispositivo: req.get("user-agent") ?? null,
        ip: req.ip ?? null,
      })
    );
    res.status(201).json({ ok: true, consentimientoId: r.consentimientoId });
  } catch (err) {
    fallo(res, err, "POST /firma/:token/firmar");
  }
});
