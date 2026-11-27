import { Request, Response, NextFunction } from "express";
import { pool } from "./db";

// ---------------------------------------------------------------------
// EL TIPO DE `req.auth` SE DECLARA ACÁ Y NO SE IMPORTA DE `auth.ts`.
//
// La ampliación global de Express vive en `middleware/auth.ts`, que
// importa este archivo: importarlo de vuelta sería un ciclo, y
// `ts-node` compilando un script suelto no carga la ampliación global
// —`tsc --noEmit` sí, porque ve el programa entero, y por eso el error
// solo aparecía al correr un verificador—.
//
// Lo que se declara es lo MÍNIMO que estas funciones usan. Si algún día
// divergiera de `AuthPayload`, el compilador lo diría en `auth.ts`, que
// es donde se arma el objeto.
// ---------------------------------------------------------------------
type AuthMinimo = { permisos?: Set<string> } | undefined;

function authDe(req: Request): AuthMinimo {
  return (req as Request & { auth?: { permisos?: Set<string> } }).auth;
}

// ---------------------------------------------------------------------
// LOS PERMISOS, RESUELTOS SIEMPRE DESDE LA BASE — prompt 04, sección 1.
//
// El token identifica a la persona y nada más. Eso ya era así —los roles
// del token se leían y se descartaban a propósito— y acá se mantiene: lo
// que decide qué puede hacer alguien sale de `persona_roles`,
// `rol_permisos` y lo que la clínica configuró en `tenant_rol_permiso`.
//
// POR QUÉ NO VA EN EL TOKEN, aunque sería más rápido: un token vive
// minutos. Si los permisos viajaran dentro, quitarle a alguien el
// permiso de anular no tendría efecto hasta que su token expire, y el
// prompt pide lo contrario: «cambiar los roles de una persona actualiza
// sus permisos en su próxima solicitud, sin cerrar sesión».
//
// LA CACHÉ ES CORTA Y POR PERSONA. Treinta segundos: suficiente para que
// una pantalla que hace diez llamadas no haga diez consultas, y lo
// bastante corto para que «en su próxima solicitud» siga siendo verdad
// en cualquier uso real. Se invalida explícitamente al cambiar roles o
// permisos, así que los treinta segundos son el peor caso de una
// invalidación que se perdió, no el comportamiento normal.
// ---------------------------------------------------------------------

export interface PermisosDePersona {
  roles: string[];
  permisos: Set<string>;
  /** Derivados de los roles, para los 100 chequeos que ya existen. */
  esMedico: boolean;
  esAdminClinica: boolean;
}

const VIDA_CACHE_MS = 30_000;
const cache = new Map<string, { en: number; valor: PermisosDePersona }>();

/** Se llama al cambiar los roles de alguien o los permisos de un rol. */
export function olvidarPermisos(personaId?: string): void {
  if (personaId) cache.delete(personaId);
  else cache.clear();
}

/**
 * Los roles y permisos efectivos de una persona.
 *
 * Va contra el pool admin y no contra `req.db`: esto corre en
 * `authenticate`, ANTES de que exista la transacción con alcance de
 * tenant —justamente porque todavía no se sabe de qué tenant es quien
 * pregunta—. El aislamiento lo da el `WHERE persona_id`, que es el id
 * que acabamos de resolver desde el token.
 */
export async function permisosDePersona(
  personaId: string,
  tenantId: string | null,
  /**
   * El cliente con el que leer, cuando quien llama ya tiene una
   * transacción abierta.
   *
   * `authenticate` no lo pasa —todavía no hay transacción— y entonces
   * se usa el pool admin. Un verificador o una ruta que acaba de
   * escribir roles SÍ lo pasa: con el pool admin leería desde otra
   * conexión y no vería lo que su propia transacción escribió, que es
   * el commit diferido de este backend. Con `db`, además, **no se usa
   * la caché**: quien pregunta dentro de su transacción quiere el
   * estado de su transacción.
   */
  db?: { query: typeof pool.query }
): Promise<PermisosDePersona> {
  const lector = db ?? pool;
  if (!db) {
    const guardado = cache.get(personaId);
    if (guardado && Date.now() - guardado.en < VIDA_CACHE_MS) return guardado.valor;
  }

  const r = await lector.query<{ rol: string }>(
    `SELECT rol FROM persona_roles WHERE persona_id = $1`,
    [personaId]
  );
  const roles = r.rows.map((f) => f.rol);

  const permisos = new Set<string>();
  if (roles.length > 0) {
    // LA MATRIZ DEL NÚCLEO Y LO QUE LA CLÍNICA CAMBIÓ, EN UNA CONSULTA.
    //
    // `concedido = false` de la clínica QUITA un permiso que la matriz
    // daba, y `true` AGREGA uno que no daba. Se resuelve con un
    // FULL OUTER JOIN conceptual —acá, una unión y un filtro— para que
    // las dos direcciones funcionen: si solo mirara la matriz y después
    // restara, no se podría agregar nada.
    const p = await lector.query<{ permiso: string }>(
      `WITH del_nucleo AS (
         SELECT rp.permiso FROM rol_permisos rp WHERE rp.rol = ANY($1::varchar[])
       ),
       de_la_clinica AS (
         SELECT trp.permiso, bool_or(trp.concedido) AS concedido
           FROM tenant_rol_permiso trp
          WHERE trp.rol = ANY($1::varchar[])
            AND ($2::uuid IS NULL OR trp.tenant_id = $2::uuid)
          GROUP BY trp.permiso
       )
       SELECT p.codigo AS permiso
         FROM permisos p
        WHERE (
          -- Lo que da el núcleo y la clínica no quitó…
          (p.codigo IN (SELECT permiso FROM del_nucleo)
             AND COALESCE((SELECT concedido FROM de_la_clinica c WHERE c.permiso = p.codigo), true))
          -- …más lo que la clínica agregó.
          OR COALESCE((SELECT concedido FROM de_la_clinica c WHERE c.permiso = p.codigo), false)
        )`,
      [roles, tenantId]
    );
    for (const f of p.rows) permisos.add(f.permiso);
  }

  const valor: PermisosDePersona = {
    roles,
    permisos,
    esMedico: roles.includes("medico"),
    esAdminClinica: roles.includes("admin_clinica"),
  };
  // Solo se cachea lo leído con el pool: lo leído dentro de una
  // transacción ajena puede deshacerse con un ROLLBACK.
  if (!db) cache.set(personaId, { en: Date.now(), valor });
  return valor;
}

/** El nombre legible de un permiso, para el mensaje de error. */
const nombres = new Map<string, string>();
let nombresCargados = false;

async function nombreDelPermiso(codigo: string): Promise<string> {
  if (!nombresCargados) {
    const r = await pool.query<{ codigo: string; nombre: string }>(
      `SELECT codigo, nombre FROM permisos`
    );
    for (const f of r.rows) nombres.set(f.codigo, f.nombre);
    nombresCargados = true;
  }
  return nombres.get(codigo) ?? codigo;
}

/**
 * La guarda única: `exigirPermiso("caja.anular")`.
 *
 * Reemplaza a `soloAdmin`, `soloMedico` y `permisoAprobar`, que hacían
 * lo mismo con cuatro nombres distintos y ninguna consultaba una tabla
 * de permisos porque no existía.
 *
 * EL MENSAJE DICE QUÉ FALTA, no «no autorizado»: quien lo lee tiene que
 * poder pedirle a su administrador exactamente eso.
 */
export function exigirPermiso(codigo: string) {
  return async function guarda(req: Request, res: Response, next: NextFunction) {
    const auth = authDe(req);
    if (!auth) return res.status(401).json({ error: "No autenticado." });
    if (auth.permisos?.has(codigo)) return next();
    const nombre = await nombreDelPermiso(codigo);
    return res.status(403).json({
      error: `No tenés permiso para esto: «${nombre}». Pedíselo a un administrador de la clínica.`,
      permisoFaltante: codigo,
    });
  };
}

/** Para chequear dentro de una ruta, cuando depende de los datos. */
export function tienePermiso(req: Request, codigo: string): boolean {
  return authDe(req)?.permisos?.has(codigo) === true;
}
