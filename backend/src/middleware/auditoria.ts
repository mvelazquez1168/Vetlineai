import { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { AuthPayload, resolverAuthDesdeHeader } from "./auth";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENTOS_IGNORADOS = new Set(["api", "admin", "platform", "platform-admin", "workspace"]);
const METODOS_ESCRITURA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Heurística simple: el último segmento de la ruta que no sea un prefijo
// de router conocido ni un UUID. No es una tabla de mapeo exacta a
// nombres de tabla (ej. da "accesos" en vez de "medico_agente" para
// PUT /admin/medicos/:id/accesos), pero identifica bien de qué se trata
// para lectura humana en la bitácora, sin tener que anotar cada ruta a mano.
function inferirEntidad(path: string): string {
  const segmentos = path.split("/").filter(Boolean);
  const significativos = segmentos.filter(
    (s) => !SEGMENTOS_IGNORADOS.has(s) && !UUID_REGEX.test(s)
  );
  return significativos[significativos.length - 1] ?? "desconocida";
}

// Busca un `id` dentro del primer valor-objeto del body de respuesta
// (todas las rutas de este backend devuelven `{ nombreRecurso: {...} }`
// con un `id` adentro, ej. `{ caso: { id, ... } }`).
function extraerEntidadId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  for (const value of Object.values(body as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "id" in value) {
      const id = (value as { id: unknown }).id;
      if (typeof id === "string") return id;
    }
  }
  return null;
}

async function insertarFila(
  auth: AuthPayload,
  accion: string,
  entidad: string,
  entidadId: string | null,
  detalle: unknown = null
) {
  try {
    await pool.query(
      `INSERT INTO bitacora_auditoria (tenant_id, persona_id, staff_id, accion, entidad, entidad_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auth.tenantId,
        auth.tenantId ? auth.userId : null,
        auth.tenantId ? null : auth.userId,
        accion,
        entidad,
        entidadId,
        detalle != null ? JSON.stringify(detalle) : null,
      ]
    );
  } catch (err) {
    console.error("Error al registrar auditoría", err);
  }
}

/**
 * Middleware GLOBAL de auditoría — se monta una sola vez en index.ts,
 * antes de los routers de negocio. Resuelve el usuario en paralelo al
 * `authenticate` que corre dentro de cada router (best-effort: si el
 * token falta/es inválido/no corresponde a nadie registrado, simplemente
 * no audita, no corta el request) para no depender de tocar cada router
 * existente. Duplica la verificación contra Keycloak + el lookup en
 * personas/staff_plataforma que hace `authenticate` — no es gratis, pero
 * mantiene este middleware independiente del orden de montaje de cada
 * router.
 *
 * Registra automáticamente cualquier escritura (POST/PUT/PATCH/DELETE)
 * autenticada que responda 2xx. Para las lecturas sensibles puntuales
 * (ver `registrarLecturaSensible`), cada handler la llama explícitamente
 * porque auditar TODAS las lecturas sería demasiado ruido.
 */
export async function auditoria(req: Request, res: Response, next: NextFunction) {
  const auth = await resolverAuthDesdeHeader(req.headers.authorization);

  if (!auth || !METODOS_ESCRITURA.has(req.method)) {
    return next();
  }

  const authConfirmado = auth;
  const originalJson = res.json.bind(res);
  let cuerpoRespuesta: unknown;
  res.json = ((body: unknown) => {
    cuerpoRespuesta = body;
    return originalJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const pathSinQuery = req.originalUrl.split("?")[0];
    insertarFila(
      authConfirmado,
      `${req.method} ${pathSinQuery}`,
      inferirEntidad(pathSinQuery),
      extraerEntidadId(cuerpoRespuesta)
    );
  });

  next();
}

/**
 * Para las lecturas sensibles específicas que sí queremos auditar (ver
 * comentario del middleware `auditoria`). Se llama explícitamente desde
 * el propio handler, con el req.auth ya disponible en ese punto.
 */
export function registrarLecturaSensible(
  auth: AuthPayload,
  accion: string,
  entidad: string,
  entidadId: string | null
) {
  void insertarFila(auth, accion, entidad, entidadId);
}

/**
 * Igual que `registrarLecturaSensible`, pero con un `detalle` JSONB
 * explícito — para acciones donde el "qué cambió" importa tanto como el
 * "qué se tocó" (ej. reasignación de caso: médico anterior, médico nuevo,
 * motivo). El middleware global de arriba nunca setea `detalle`.
 */
export function registrarEventoDetallado(
  auth: AuthPayload,
  accion: string,
  entidad: string,
  entidadId: string | null,
  detalle: unknown
) {
  void insertarFila(auth, accion, entidad, entidadId, detalle);
}
