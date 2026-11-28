import type { Express } from "express";

// ---------------------------------------------------------------------
// QUE NINGÚN ROUTER PRIVADO QUEDE SIN `authenticate` — defecto del
// 2026-11-27, punto 7.
//
// El commit 75ca2a9, adelgazando `citas.routes.ts`, borró dos líneas:
// `citasRouter.use(authenticate, withTenantClient)` y
// `citasRouter.use(soloPersonalDeLaClinica())`. Resultado: la agenda
// entera caída —sin `req.db`, toda llamada moría con «Cannot read
// properties of undefined (reading 'query')»— y además abierta, sin
// sesión. Nadie lo vio hasta que apareció el TypeError en un log.
//
// Dos líneas, un módulo completo. Esto lo comprueba al arrancar.
//
// CÓMO: Express guarda los middlewares de cada router en `stack`, y
// cada capa tiene el nombre de la función. No hay forma de preguntarle
// «¿esto autentica?», pero sí «¿pasa por una función llamada
// authenticate?», que es exactamente lo que se olvidó.
//
// EN DESARROLLO CORTA EL ARRANQUE. Un aviso en el log es lo que ya
// teníamos —el TypeError estaba ahí— y nadie lo leyó. En producción
// avisa y sigue: dejar la clínica sin backend por esto sería peor que
// el problema.
// ---------------------------------------------------------------------

/**
 * Routers montados a propósito SIN `authenticate` global.
 *
 * Cada uno autentica por ruta o es público de verdad. La lista se
 * escribe a mano: agregar algo acá tiene que ser una decisión, no un
 * efecto de haber olvidado una línea.
 */
const SIN_AUTENTICACION_GLOBAL = new Set([
  "/api/auth",
  "/api/health",
  "/api/registro-publico",
  "/api/invitaciones",
  "/api/verificar-correo",
  "/api/restablecer-contrasena",
  "/api/legal",
  "/api/paises",
  "/api/planes",
  "/api/firma",
  "/api/webhooks",
  // Autentican por ruta, no por router.
  "/api/citas",
  "/api/farmacos-equivalencias",
  "/api/reportes",
]);

interface CapaExpress {
  name?: string;
  regexp?: RegExp;
  handle?: { stack?: CapaExpress[] };
  route?: { path?: string; methods?: Record<string, boolean>; stack?: CapaExpress[] };
}

export interface RutaRegistrada {
  metodo: string;
  ruta: string;
}

/**
 * TODAS las rutas que Express tiene registradas, con su método.
 *
 * Es la única forma de saber qué superficie existe de verdad: una lista
 * escrita a mano envejece en la primera ruta nueva, y la ruta nueva es
 * justamente la que nadie revisó. Lo usa
 * `verificar_rutas_sin_sesion.ts`, que las llama sin sesión y exige un
 * 401.
 */
export function rutasRegistradas(app: Express): RutaRegistrada[] {
  const raiz = (app as unknown as { _router?: { stack?: CapaExpress[] } })._router;
  const encontradas: RutaRegistrada[] = [];

  const recorrer = (capas: CapaExpress[], prefijo: string) => {
    for (const capa of capas) {
      if (capa.route?.path) {
        for (const [metodo, activo] of Object.entries(capa.route.methods ?? {})) {
          if (!activo) continue;
          encontradas.push({
            metodo: metodo.toUpperCase(),
            ruta: unir(prefijo, capa.route.path),
          });
        }
        continue;
      }
      if (capa.handle?.stack) {
        const propio = capa.regexp ? rutaDeLaCapa(capa.regexp) : null;
        recorrer(capa.handle.stack, propio ? unir(prefijo, propio) : prefijo);
      }
    }
  };

  recorrer(raiz?.stack ?? [], "");
  return encontradas;
}

function unir(a: string, b: string): string {
  const junto = `${a}${b}`.replace(/\/{2,}/g, "/");
  return junto.length > 1 && junto.endsWith("/") ? junto.slice(0, -1) : junto;
}

/** Los nombres que, vistos en el `stack`, significan «acá se autentica». */
const AUTENTICA = new Set(["authenticate", "autenticar", "authenticatePlatform"]);

function autenticaEnAlgunLado(capa: CapaExpress): boolean {
  if (capa.name && AUTENTICA.has(capa.name)) return true;
  for (const hija of capa.handle?.stack ?? []) {
    if (autenticaEnAlgunLado(hija)) return true;
  }
  return false;
}

/**
 * Comprueba los routers montados y devuelve los que quedaron abiertos.
 *
 * Devuelve la lista en vez de tirar el error para que la pueda usar
 * también un verificador, sin levantar el servidor.
 */
export function routersSinAutenticacion(app: Express): string[] {
  // `_router` no está en los tipos de Express 4 pero es donde vive el
  // árbol de capas. Es lectura, y el precio de no tenerlo es este
  // defecto.
  const raiz = (app as unknown as { _router?: { stack?: CapaExpress[] } })._router;
  const abiertos: string[] = [];

  for (const capa of raiz?.stack ?? []) {
    if (!capa.handle?.stack || !capa.regexp) continue;
    const ruta = rutaDeLaCapa(capa.regexp);
    if (!ruta || !ruta.startsWith("/api/")) continue;
    if (SIN_AUTENTICACION_GLOBAL.has(ruta)) continue;
    if (!capa.handle.stack.some(autenticaEnAlgunLado)) abiertos.push(ruta);
  }
  return abiertos;
}

/**
 * De la expresión regular que Express arma para `app.use("/api/x", r)`
 * se recupera el camino. Es feo y es la única vía: Express no guarda el
 * string original.
 */
function rutaDeLaCapa(re: RegExp): string | null {
  const m = /^\^\\\/(.+?)\\\/\?/.exec(re.source);
  if (!m) return null;
  return "/" + m[1].replace(/\\\//g, "/");
}

export function exigirAutenticacionEnRouters(app: Express): void {
  const abiertos = routersSinAutenticacion(app);
  if (abiertos.length === 0) return;

  const mensaje =
    `[guardaDeRutas] Estos routers no pasan por authenticate: ${abiertos.join(", ")}. ` +
    `O les falta el \`use(authenticate, withTenantClient)\`, o son públicos a propósito y ` +
    `van declarados en SIN_AUTENTICACION_GLOBAL (backend/src/guardaDeRutas.ts).`;

  if (process.env.NODE_ENV === "production") {
    console.error(mensaje);
    return;
  }
  throw new Error(mensaje);
}
