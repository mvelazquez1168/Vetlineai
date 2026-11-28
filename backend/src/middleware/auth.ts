import { NextFunction, Request, Response } from "express";
import jwt, { JwtHeader, SigningKeyCallback } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { PoolClient } from "pg";
import { config } from "../config";
import { pool, tenantPool } from "../db";
import { enSerie } from "../clienteEnSerie";
import { permisosDePersona } from "../permisos";

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
  /**
   * LOS ROLES Y LOS PERMISOS EFECTIVOS (prompt 04).
   *
   * Resueltos desde la base en cada solicitud, nunca desde el token: si
   * viajaran en el token, quitarle a alguien el permiso de anular no
   * tendría efecto hasta que su token expire.
   *
   * `esMedico` y `esAdminClinica` siguen estando y ahora se DERIVAN de
   * `roles`: son los que usan los 100 chequeos que ya existen.
   */
  roles?: string[];
  permisos?: Set<string>;
  /**
   * La pantalla de entrada que corresponde a su rol (`roles.pantalla_inicio`).
   *
   * No es lo que la persona eligió —eso vive en `personas.pantalla_inicio`
   * y gana—: es la entrada derivada, la que rige mientras no elija nada.
   * Existe porque con ocho roles «el que no es médico aterriza en
   * Médicos» dejó de ser cierto: la recepción aterriza en la agenda.
   */
  pantallaDelRol?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      /** Cliente de Postgres ya posicionado dentro de una transacción con
       *  app.tenant_id seteado (o sin setear, si es staff_plataforma). */
      db?: PoolClient;
      /** Confirma y suelta la transacción de la request ANTES de que
       *  termine la respuesta. Existe para las rutas que hacen una llamada
       *  externa larga (el modelo, Keycloak) en el medio: sin esto, la
       *  transacción queda abierta y quieta durante toda esa espera, que
       *  es la alerta de `idle in transaction`. Después de llamarla,
       *  `req.db` deja de servir a propósito — lo que venga después va en
       *  su propia transacción corta con `conAlcanceTenant`. */
      cerrarTransaccion?: () => Promise<void>;
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
// DEFECTO ABIERTO D-002 — el esquema sale del ISSUER, no del anfitrión.
//
// `issuerUrl.protocol` es el del issuer público, que en producción es
// https. Al combinarlo con un anfitrión interno se arma
// `https://keycloak:8080/...`, pero adentro de la red de Docker Keycloak
// escucha en texto plano (Caddy termina el TLS afuera). La descarga del
// JWKS falla, con ella la verificación de firma, y nadie puede iniciar
// sesión. Pasó en producción: se desbloqueó QUITANDO KEYCLOAK_JWKS_HOST
// del compose, de modo que hoy el JWKS resuelve contra el anfitrión
// público — funciona, pero ata la validación de tokens a que Caddy y el
// DNS público respondan.
//
// Mientras esta línea herede el esquema del issuer, KEYCLOAK_JWKS_HOST no
// se puede volver a usar. El arreglo es componer el esquema según el
// anfitrión (o dejar que la variable lo traiga). Ver DEFECTOS_ABIERTOS.md.
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
      `SELECT p.id, p.tenant_id, p.estado, t.zona_horaria,
              s.estado AS suscripcion_estado
       FROM personas p
       JOIN tenants t ON t.id = p.tenant_id
       LEFT JOIN suscripciones s ON s.id = t.suscripcion_id
       WHERE p.keycloak_user_id = $1`,
      [payload.sub]
    );
    const persona = result.rows[0];
    if (!persona) return null;
    if (persona.tenant_id !== payload.tenant_id) return null;

    // UN DESACTIVADO NO ENTRA — defecto corregido en el prompt 04.
    //
    // Esta consulta no miraba `p.estado`: una persona en `inactivo`
    // resolvía igual y seguía trabajando con su token, y podía
    // renovarlo porque Keycloak no se enteraba de la desactivación.
    // Desactivar era una etiqueta en la base y nada más.
    //
    // Ahora falla acá, con 401, y el frontend lo saca a la pantalla de
    // acceso. La otra mitad del arreglo —deshabilitarlo en Keycloak y
    // revocar sus sesiones— está en la ruta que desactiva.
    if (persona.estado !== "activo") return null;

    if (persona.suscripcion_estado === "bloqueada") throw new ClinicaBloqueadaError();

    // LOS ROLES Y PERMISOS, DESDE LA BASE (prompt 04). `esMedico` y
    // `esAdminClinica` ya no se leen de las columnas: se derivan de los
    // roles, que son la fuente. Las columnas quedan como derivadas y se
    // borran cuando nadie las lea.
    const efectivos = await permisosDePersona(persona.id, persona.tenant_id);

    return {
      userId: persona.id,
      tenantId: persona.tenant_id,
      rol: efectivos.esAdminClinica ? "admin_clinica" : "medico",
      esAdminClinica: efectivos.esAdminClinica,
      esMedico: efectivos.esMedico,
      zonaHoraria: persona.zona_horaria,
      roles: efectivos.roles,
      permisos: efectivos.permisos,
      pantallaDelRol: efectivos.pantallaDelRol,
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
    // El staff de plataforma no tiene roles de clínica: sus permisos son
    // los de las rutas de plataforma, que se gatean por `rol`.
    roles: [],
    permisos: new Set<string>(),
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
      // `client.release()` SIN argumento devuelve la conexión al pool tal
      // como esté: node-postgres no hace rollback por su cuenta. Verificado
      // contra la base — tras un BEGIN y un release() pelado, la sesión
      // queda en `idle in transaction` y el siguiente que toma esa conexión
      // hereda la MISMA transacción abierta. O sea que si el COMMIT falla,
      // la versión anterior de esta función devolvía al pool una conexión
      // sucia, que se quedaba retenida hasta que alguien la reusara.
      //
      // Con el error como argumento, el pool DESTRUYE la conexión en vez de
      // reciclarla (también verificado). Perder una conexión es barato;
      // reciclar una con una transacción abierta es justo lo que dispara la
      // alerta de AWS.
      // Relanza el error después de soltar la conexión, en vez de
      // comérselo: quien cierra la transacción ANTES de responder (ver
      // `interceptarRespuesta` más abajo) necesita saber si el COMMIT
      // falló para mandar un error en lugar de un éxito. Los handlers de
      // `finish`/`close` lo siguen ignorando — ahí ya no hay nada que
      // contarle al cliente.
      const release = async (commit: boolean) => {
        if (released) return;
        released = true;
        try {
          await client.query(commit ? "COMMIT" : "ROLLBACK");
          client.release();
        } catch (err) {
          console.error(
            `withTenantClient: falló el ${commit ? "COMMIT" : "ROLLBACK"} — se descarta la conexión en vez de devolverla al pool`,
            err
          );
          client.release(err instanceof Error ? err : new Error(String(err)));
          throw err;
        }
      };

      // -----------------------------------------------------------------
      // LA RESPUESTA SALE DESPUÉS DEL COMMIT.
      //
      // El defecto que esto cierra: hasta acá la transacción se confirmaba
      // en `res.on("finish")`, o sea DESPUÉS de que la respuesta ya había
      // salido. Un 201 llegaba al cliente antes del COMMIT, así que
      // cualquier operación inmediata sobre la fila recién creada abría su
      // propia transacción, no veía nada y respondía 404. Medido con
      // `verificar_respuesta_despues_del_commit.ts`: 17 de 50 vueltas de
      // "crear paciente y leerlo enseguida" perdían la carrera.
      //
      // No es un caso de laboratorio: es el flujo central de Vetline
      // Clinic ("Guardar y agendar cita" crea el paciente y en el mismo
      // segundo agenda una cita con él).
      //
      // POR QUÉ ACÁ Y NO EN LAS RUTAS: son 29 archivos de rutas y 762
      // respuestas. Cualquier solución que dependa de que cada ruta se
      // acuerde de algo ya nació rota. Este es el único punto por el que
      // pasan todas.
      //
      // POR QUÉ INTERCEPTAR `res.send` Y NADA MÁS: se relevó cómo
      // responde efectivamente este backend y son dos formas, no diez —
      // `res.json(...)` y `res.send(...)` (incluido `res.status(204).send()`
      // y los `res.send(buffer)` de las 7 descargas). NO hay `sendStatus`,
      // `res.end`, `writeHead`, `sendFile`, `download`, `redirect` ni
      // streams a `res` en ninguna parte. Y `res.json` de Express delega
      // en `res.send`, así que envolver `send` cubre las dos.
      //
      // El `finish`/`close` de más abajo queda igual: con la bandera
      // `released` ya en true no hace nada, y sigue siendo la red para un
      // request que se corta sin responder nunca.
      // -----------------------------------------------------------------
      const sendOriginal = res.send.bind(res);
      let yaInterceptado = false;

      res.send = function interceptarRespuesta(this: Response, body?: unknown) {
        // Segunda llamada a send (Express avisa de eso por su cuenta), o
        // una ruta que ya cerró su transacción con `cerrarTransaccion()`:
        // en los dos casos no hay nada que confirmar y se responde
        // directo. Es lo que hace que esto convivise con
        // `cerrarTransaccion()` + `conAlcanceTenant()` sin confirmar dos
        // veces.
        if (yaInterceptado || released) return sendOriginal(body);
        yaInterceptado = true;

        // Mismo criterio que tenía el handler de `finish`: 5xx hace
        // ROLLBACK, cualquier otra cosa confirma. Los 4xx confirman a
        // propósito — hay rutas que escriben (auditoría, un registro de
        // intento) y después responden 400.
        const confirmar = res.statusCode < 500;

        release(confirmar)
          .then(() => sendOriginal(body))
          .catch(() => {
            // El COMMIT falló. El cliente NO puede recibir el éxito que
            // esta respuesta traía: lo que quería guardar no se guardó.
            //
            // Se puede cambiar el estado porque las cabeceras todavía no
            // salieron — justamente porque diferimos el envío. El motivo
            // real ya quedó en el log dentro de `release`; afuera no va,
            // por lo mismo que el resto del backend no expone detalle de
            // errores internos.
            if (res.headersSent) return;
            res.status(500);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            sendOriginal(
              JSON.stringify({
                error: "No se pudo confirmar la operación. No se guardó nada — volvé a intentarlo.",
              })
            );
          });

        // `send` es encadenable y los handlers lo llaman sin esperarlo
        // (`return res.json(...)`), así que se devuelve `res` ya mismo y
        // el envío real ocurre cuando el COMMIT termina.
        return res;
      } as typeof res.send;

      // Los handlers de eventos no pueden devolver una promesa rechazada:
      // nadie la espera, y una rechazada acá termina en unhandledRejection
      // (que en Node moderno tira abajo el proceso). El catch de `release`
      // ya registra el motivo; este `.catch` es el cinturón.
      res.on("finish", () => void release(res.statusCode < 500).catch(() => {}));
      res.on("close", () => void release(false).catch(() => {}));

      try {
        await client.query("BEGIN");

        if (req.auth!.tenantId) {
          // set_config con el 3er argumento en `true` limita el alcance a la
          // transacción actual (equivalente a SET LOCAL, pero parametrizable).
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [
            req.auth!.tenantId,
          ]);
          // QUIÉN ESTÁ HACIENDO ESTO, para los triggers (prompt 11). Un
          // trigger no recibe parámetros y lo único que puede leer es la
          // sesión: el historial de precios lo necesita para poder decir
          // quién cambió un precio. Mismo alcance de transacción.
          if (req.auth!.userId) {
            await client.query("SELECT set_config('app.persona_id', $1, true)", [
              req.auth!.userId,
            ]);
          }
        }

        // EN SERIE (ver clienteEnSerie.ts). Un `Promise.all` de
        // consultas sobre el mismo cliente dispara el aviso de `pg` y
        // en pg@9 va a romperse: la conexión es secuencial y acá se
        // impone, en vez de confiar en que los once lugares que lo
        // hacen se acuerden.
        req.db = enSerie(client);

        // Cierre anticipado, para las rutas que llaman a algo externo en
        // el medio. Reusa el MISMO `release` (y su bandera `released`), así
        // que el handler de `finish`/`close` después no hace nada: no hay
        // doble COMMIT ni doble devolución al pool.
        req.cerrarTransaccion = async () => {
          await release(true);
          // Que `req.db` quede inutilizable es la parte importante. Sin
          // esto, una consulta posterior usaría un cliente ya devuelto al
          // pool — o sea, la conexión de OTRA request, fuera de su
          // transacción y sin su app.tenant_id. Falla ruidosa y explicada
          // en vez de una fuga silenciosa entre tenants.
          req.db = new Proxy({} as PoolClient, {
            get() {
              throw new Error(
                "req.db ya no está disponible: esta request cerró su transacción con cerrarTransaccion(). " +
                  "Para escribir después de la llamada externa, usá conAlcanceTenant()."
              );
            },
          });
        };

        next();
      } catch (err) {
        await release(false);
        next(err);
      }
    })
    .catch(next);
}
