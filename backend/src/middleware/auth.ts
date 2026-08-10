import { NextFunction, Request, Response } from "express";
import jwt, { JwtHeader, SigningKeyCallback } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { PoolClient } from "pg";
import { config } from "../config";
import { pool, tenantPool } from "../db";

/**
 * Payload que este backend arma a partir del token de Keycloak ya
 * verificado + resuelto contra nuestra base (ver `resolverPrincipal` más
 * abajo). tenantId es null para staff_plataforma (no pertenece a ningún
 * tenant).
 */
export interface AuthPayload {
  userId: string;
  tenantId: string | null;
  rol: "medico" | "admin_clinica" | "super_admin" | "soporte_senior" | "soporte";
  esAdminClinica: boolean;
  /** Independiente de `rol`: una persona puede ser admin_clinica Y médico a
   *  la vez (caso normal en una clínica chica). `rol` solo decide la
   *  pantalla de aterrizaje (admin_clinica tiene prioridad ahí); toda
   *  autorización que dependa específicamente de "es médico" debe usar
   *  este campo, no `rol === "medico"` — ver auditoría de 2026-08-06. */
  esMedico: boolean;
  /** Zona horaria IANA del tenant activo. null para staff_plataforma (sin tenant). */
  zonaHoraria: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      /** Cliente de Postgres ya posicionado dentro de una transacción con
       *  app.tenant_id seteado (o sin setear, si es staff_plataforma). */
      db?: PoolClient;
    }
  }
}

// ---------------------------------------------------------------------
// Validación de firma contra el JWKS de Keycloak — la librería cachea las
// claves públicas automáticamente (no hace falta implementarlo a mano) y
// limita cuántas veces por minuto puede pedir una clave nueva.
// ---------------------------------------------------------------------
const issuerUrl = new URL(config.keycloakIssuer);
const jwksHost = config.keycloakJwksHost ?? issuerUrl.host;
const jwks = jwksClient({
  jwksUri: `${issuerUrl.protocol}//${jwksHost}${issuerUrl.pathname}/protocol/openid-connect/certs`,
  cache: true,
  cacheMaxAge: 10 * 60 * 1000,
  rateLimit: true,
});

// Keycloak no tiene un hostname fijo configurado (KC_HOSTNAME) en este
// entorno, así que estampa el claim "iss" según el host por el que
// efectivamente le llegó la request — no un valor fijo. El navegador le
// pega por "localhost:8080" (issuer = config.keycloakIssuer), pero este
// backend, cuando é ES QUIEN pide un token directamente (registro-publico:
// password grant para el auto-login), le pega por el alias de red interno
// de Docker ("keycloak:8080", ver KEYCLOAK_JWKS_HOST) — y ese token sale
// con un "iss" distinto, aunque sea exactamente el mismo realm. Sin
// aceptar ambos acá, ese token se rechazaba siempre con "Token inválido"
// pese a ser 100% legítimo — detectado recién al probar el registro
// público de punta a punta, nunca antes con tokens obtenidos por el
// navegador (que siempre entran por "localhost").
const issuerInternoDocker = `${issuerUrl.protocol}//${jwksHost}${issuerUrl.pathname}`;
// jwt.verify espera `issuer` como string | [string, ...string[]] (tupla no
// vacía), no un string[] genérico — Array.from pierde esa forma. Siempre
// tiene al menos 1 elemento (config.keycloakIssuer es obligatorio), así que
// el cast es seguro, no un silenciamiento del chequeo de tipos.
const ISSUERS_ACEPTADOS = Array.from(new Set([config.keycloakIssuer, issuerInternoDocker])) as [
  string,
  ...string[],
];

function resolverClaveFirma(header: JwtHeader, callback: SigningKeyCallback) {
  if (!header.kid) {
    callback(new Error("El token no tiene 'kid' en el header."));
    return;
  }
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err ?? new Error("No se pudo resolver la clave pública de Keycloak."));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

interface TokenKeycloak {
  sub: string;
  tenant_id?: string;
  realm_access?: { roles?: string[] };
}

// Roles de negocio reconocidos — el resto (offline_access, uma_authorization,
// default-roles-*, etc.) son roles internos de Keycloak sin significado acá.
const ROLES_RECONOCIDOS = new Set(["VETERINARIO", "ADMIN", "SUPER_ADMIN"]);

// Solo valida firma + issuer — todavía no sabemos si ese `sub` corresponde
// a alguien registrado en Vetline Ai.
function verificarFirma(token: string): Promise<TokenKeycloak> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      resolverClaveFirma,
      { issuer: ISSUERS_ACEPTADOS, algorithms: ["RS256"] },
      (err, decoded) => {
        if (err || !decoded || typeof decoded === "string") {
          reject(err ?? new Error("Token inválido."));
          return;
        }
        resolve(decoded as TokenKeycloak);
      }
    );
  });
}

/**
 * A partir de un token YA verificado (firma + issuer OK), resuelve la
 * persona o el staff de plataforma correspondiente en nuestra base.
 *
 * roles (VETERINARIO/ADMIN/SUPER_ADMIN) se extraen del token per lo
 * pedido, pero el `rol`/`esAdminClinica`/`esMedico` que efectivamente gatean
 * cada ruta se toman de la base (personas.es_admin_clinica / .es_medico /
 * staff_plataforma.rol)
 * — son el dato de negocio real, y ya podían existir sub-roles
 * (soporte/soporte_senior) que Keycloak no modela todavía como roles de
 * realm separados. tenant_id del token tampoco se usa para autorizar
 * directamente: se cruza contra personas.tenant_id (ver más abajo) — la
 * firma ya garantiza que no fue manipulado, pero esta doble verificación
 * es barata y evita inconsistencias si el atributo de Keycloak y la base
 * alguna vez divergen (ej. a un médico se le reasigna de clínica en la
 * base pero su token todavía no se refrescó).
 */
// Vetline_Ai_Suspension_Bloqueo.md, sección 5.1 — "se impide el acceso a
// la plataforma: ningún usuario de esa clínica puede ingresar". Es la
// única de las transiciones de estado que efectivamente corta acceso
// (suspendida/ventana_purga solo restringen la generación con IA, ver
// purga.ts::suscripcionBloqueaGeneracionIa) — por eso el chequeo vive acá,
// en la autenticación misma, y no en un gate puntual de cada ruta. Una
// excepción propia (no simplemente `return null`) para que `authenticate`
// pueda distinguir "no registrado" de "bloqueado" y responder distinto —
// el motivo del bloqueo nunca viaja en esta respuesta (spec: no se expone
// en una pantalla que cualquier usuario de la clínica puede ver).
export class ClinicaBloqueadaError extends Error {
  constructor() {
    super("La clínica está bloqueada.");
    this.name = "ClinicaBloqueadaError";
  }
}

async function resolverPrincipal(payload: TokenKeycloak): Promise<AuthPayload | null> {
  const rolesToken = (payload.realm_access?.roles ?? []).filter((r) => ROLES_RECONOCIDOS.has(r));
  void rolesToken; // extraídos según lo pedido; sin gating adicional en esta fase.

  if (payload.tenant_id) {
    const result = await pool.query(
      `SELECT p.id, p.tenant_id, p.es_admin_clinica, p.es_medico, t.zona_horaria, s.estado AS suscripcion_estado
       FROM personas p
       JOIN tenants t ON t.id = p.tenant_id
       LEFT JOIN suscripciones s ON s.id = t.suscripcion_id
       WHERE p.keycloak_user_id = $1`,
      [payload.sub]
    );
    const persona = result.rows[0];
    if (!persona) return null;
    if (persona.tenant_id !== payload.tenant_id) return null;
    if (persona.suscripcion_estado === "bloqueada") throw new ClinicaBloqueadaError();

    return {
      userId: persona.id,
      tenantId: persona.tenant_id,
      rol: persona.es_admin_clinica ? "admin_clinica" : "medico",
      esAdminClinica: persona.es_admin_clinica,
      esMedico: persona.es_medico,
      zonaHoraria: persona.zona_horaria,
    };
  }

  const staffResult = await pool.query(
    `SELECT id, rol FROM staff_plataforma WHERE keycloak_user_id = $1`,
    [payload.sub]
  );
  const staff = staffResult.rows[0];
  if (!staff) return null;

  return {
    userId: staff.id,
    tenantId: null,
    rol: staff.rol,
    esAdminClinica: false,
    esMedico: false,
    zonaHoraria: null,
  };
}

/**
 * Verifica el Bearer token del header Authorization contra Keycloak
 * (firma RS256 vía JWKS + issuer) y resuelve el usuario en nuestra base.
 * No toca la base de datos con `req.db` — eso lo hace `withTenantClient`.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No autenticado. Falta el token." });
  }

  let payload: TokenKeycloak;
  try {
    payload = await verificarFirma(header.slice("Bearer ".length));
  } catch (err) {
    // Antes se descartaba el motivo real acá — un 401 sin rastro en el log
    // obliga a diagnosticar a ciegas desde afuera (firma inválida, issuer
    // que no matchea, token vencido, kid no resuelto en el JWKS, o un
    // fallo de red al pedir las claves, son todos "Token inválido o
    // expirado" para el cliente, pero errores completamente distintos acá
    // adentro). El mensaje al cliente no cambia — sigue sin exponer detalle.
    console.error(
      `[auth] Token rechazado: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)} ` +
        `(issuers aceptados: ${ISSUERS_ACEPTADOS.join(", ")})`
    );
    return res.status(401).json({ error: "Token inválido o expirado." });
  }

  try {
    const auth = await resolverPrincipal(payload);
    if (!auth) {
      return res.status(401).json({
        error:
          "Usuario autenticado en Keycloak pero no registrado en Vetline Ai — contactá a soporte.",
      });
    }
    req.auth = auth;
    next();
  } catch (err) {
    if (err instanceof ClinicaBloqueadaError) {
      return res.status(403).json({
        error: "El acceso a esta clínica está suspendido.",
        code: "CLINICA_BLOQUEADA",
      });
    }
    console.error("Error al resolver el usuario autenticado", err);
    res.status(500).json({ error: "Error interno de autenticación." });
  }
}

/**
 * Misma verificación que `authenticate`, pero "best effort": nunca
 * rechaza el request, solo devuelve null si el token falta/es inválido/no
 * corresponde a nadie registrado. Usado por el middleware GLOBAL de
 * auditoría (ver middleware/auditoria.ts), que corre ANTES de que cada
 * router llegue a su propio `authenticate` y no debe bloquear nada por sí
 * mismo — solo quiere saber quién hizo la escritura, si es que hay alguien.
 */
export async function resolverAuthDesdeHeader(header: string | undefined): Promise<AuthPayload | null> {
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    const payload = await verificarFirma(header.slice("Bearer ".length));
    return await resolverPrincipal(payload);
  } catch {
    return null;
  }
}

/**
 * Debe correr DESPUÉS de `authenticate`.
 *
 * Para un usuario de CLÍNICA (médico/admin_clinica, `tenantId` presente):
 * abre la transacción sobre `tenantPool` (rol `vetplatform_app`, SIN
 * privilegios de superusuario/dueño — a diferencia de `pool`, para este
 * rol las políticas RLS `*_isolation` SÍ se aplican) y ejecuta
 * `SET LOCAL app.tenant_id = '<uuid>'` para que esas políticas tengan con
 * qué comparar. RLS queda así como red de seguridad real además del
 * filtro explícito que cada endpoint debería tener.
 *
 * Para STAFF de plataforma (`tenantId` null: super_admin/soporte/etc.) se
 * usa el `pool` admin de siempre, sin SET — estas rutas (platform.routes.ts,
 * platform-admin.routes.ts) consultan across-tenant a propósito, y con RLS
 * forzado + sin `app.tenant_id` seteado no verían ninguna fila tenant-scoped
 * si pasaran por `tenantPool`. Dependen 100% de sus propios WHERE, nunca de
 * RLS — ya era así antes de este cambio, esto solo lo hace explícito.
 *
 * El client se libera automáticamente cuando la respuesta termina
 * (o si el request se corta), haciendo COMMIT o ROLLBACK según corresponda.
 */
export function withTenantClient(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ error: "No autenticado." });
  }

  const poolParaEsteRequest = req.auth.tenantId ? tenantPool : pool;

  poolParaEsteRequest
    .connect()
    .then(async (client) => {
      let released = false;
      const release = async (commit: boolean) => {
        if (released) return;
        released = true;
        try {
          await client.query(commit ? "COMMIT" : "ROLLBACK");
        } finally {
          client.release();
        }
      };

      res.on("finish", () => release(res.statusCode < 500));
      res.on("close", () => release(false));

      try {
        await client.query("BEGIN");

        if (req.auth!.tenantId) {
          // set_config con el 3er argumento en `true` limita el alcance a la
          // transacción actual (equivalente a SET LOCAL, pero parametrizable).
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [
            req.auth!.tenantId,
          ]);
        }

        req.db = client;
        next();
      } catch (err) {
        await release(false);
        next(err);
      }
    })
    .catch(next);
}
