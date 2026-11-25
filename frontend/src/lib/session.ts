import { keycloakAuth } from "./keycloakAuth";

/**
 * Almacenamiento de la sesión (tokens + snapshot del usuario resuelto) y
 * el interceptor de refresh — todo en un módulo SIN React ni dependencia
 * de `lib/api.ts`, para que `lib/api.ts` pueda importar `obtenerTokenValido`
 * sin generar un ciclo de imports con `hooks/useAuth.tsx` (que sí importa
 * `apiFetch` de `lib/api.ts`).
 */

const ACCESS_TOKEN_KEY = "vetplatform_token";
const REFRESH_TOKEN_KEY = "vetplatform_refresh_token";
const USER_KEY = "vetplatform_user";
// Los módulos de Vetline Clinic habilitados en la clínica de la sesión.
// Clave propia y no un campo dentro de USER_KEY: ahí vive el `req.auth`
// que devuelve el backend tal cual, y agregarle un campo que ese objeto
// no tiene haría que el snapshot diga algo que la respuesta no dice.
const MODULOS_KEY = "vetplatform_modulos";

// Refrescamos un poco antes de que el access_token venza de verdad, para
// no arriesgarnos a que expire en el viaje de ida al backend.
const MARGEN_EXPIRACION_MS = 30_000;

export interface JwtClaims {
  exp?: number;
  sub?: string;
  tenant_id?: string;
  realm_access?: { roles?: string[] };
  [key: string]: unknown;
}

export function decodeJwtPayload(token: string): JwtClaims | null {
  try {
    const [, payloadB64] = token.split(".");
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(normalized)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

function expiraEnMs(token: string): number {
  const claims = decodeJwtPayload(token);
  return claims?.exp ? claims.exp * 1000 : 0;
}

export function guardarTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function guardarUsuario<T>(user: T): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function leerUsuarioGuardado<T>(): T | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function guardarModulos(modulos: string[]): void {
  localStorage.setItem(MODULOS_KEY, JSON.stringify(modulos));
}

/**
 * Devuelve [] cuando no hay nada guardado — nunca null. Un módulo que no
 * está en la lista está apagado, y "todavía no sé" se trata igual que
 * "no": el default seguro para un módulo de gestión es no mostrarlo.
 */
export function leerModulosGuardados(): string[] {
  const raw = localStorage.getItem(MODULOS_KEY);
  if (!raw) return [];
  try {
    const valor = JSON.parse(raw);
    return Array.isArray(valor) ? (valor as string[]) : [];
  } catch {
    return [];
  }
}

export function leerAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function leerRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function limpiarSesion(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(MODULOS_KEY);
}

function redirigirALogin(): void {
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

// Vetline_Ai_Suspension_Bloqueo.md, sección 5.4 y Pantalla 4 — "sin
// sesión iniciada, sin menú, sin datos". Se limpia la sesión local igual
// que en un refresh_token vencido (obtenerTokenValido más abajo): si el
// bloqueo se levanta después, el usuario simplemente vuelve a iniciar
// sesión, no queda un estado a medio camino.
export function redirigirABloqueada(): void {
  limpiarSesion();
  if (window.location.pathname !== "/bloqueada") {
    window.location.assign("/bloqueada");
  }
}

/**
 * Devuelve un access_token vigente, refrescándolo primero si está vencido
 * o a punto de vencer. Si el refresh también falla (refresh_token vencido
 * o inválido), limpia la sesión local y redirige a /login — devuelve null
 * en ese caso (el request que lo llamó va a salir sin Authorization y el
 * backend lo va a rechazar, pero para entonces el usuario ya está siendo
 * llevado al login).
 *
 * Es el interceptor centralizado que pide la Fase B: se llama desde
 * `apiFetch`/`apiFetchBlob` antes de cada request autenticado, en vez de
 * que cada módulo de API tenga que preocuparse por esto.
 */
export async function obtenerTokenValido(): Promise<string | null> {
  const accessToken = leerAccessToken();
  if (!accessToken) return null;

  if (expiraEnMs(accessToken) - Date.now() > MARGEN_EXPIRACION_MS) {
    return accessToken;
  }

  const refreshToken = leerRefreshToken();
  if (!refreshToken) {
    limpiarSesion();
    redirigirALogin();
    return null;
  }

  try {
    const tokens = await keycloakAuth.refresh(refreshToken);
    guardarTokens(tokens.access_token, tokens.refresh_token);
    return tokens.access_token;
  } catch {
    limpiarSesion();
    redirigirALogin();
    return null;
  }
}
