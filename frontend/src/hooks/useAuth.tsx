import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch } from "../lib/api";
import { keycloakAuth, KeycloakTokenResponse } from "../lib/keycloakAuth";
import {
  decodeJwtPayload,
  guardarModulos,
  guardarPantallaInicio,
  leerPantallaInicioGuardada,
  guardarTokens,
  guardarUsuario,
  leerAccessToken,
  leerModulosGuardados,
  leerRefreshToken,
  leerUsuarioGuardado,
  limpiarSesion,
} from "../lib/session";

/**
 * Este hook es la ÚNICA puerta de entrada a la sesión en todo el frontend.
 * Ningún otro archivo debe saber CÓMO se obtiene o se guarda la sesión —
 * ahora es un access_token de Keycloak (antes era un JWT propio); el resto
 * de la app sigue consumiendo `useAuth()` exactamente igual que antes.
 */

export type Rol = "medico" | "admin_clinica" | "super_admin" | "soporte_senior" | "soporte";

export interface AuthUser {
  userId: string;
  tenantId: string | null;
  rol: Rol;
  esAdminClinica: boolean;
  /** Independiente de `rol`: una persona puede ser admin_clinica Y médico a
   *  la vez (clínica chica, caso normal). `rol` solo decide a dónde
   *  aterriza (admin_clinica tiene prioridad ahí) — cualquier gating de
   *  rutas debe usar `misRoles()` de este mismo archivo, no `rol` solo. */
  esMedico: boolean;
  /** Zona horaria IANA del tenant activo. null para staff_plataforma. */
  zonaHoraria: string | null;
  /** Roles de la clínica (`persona_roles`), prompt 04. */
  roles?: string[];
  /** Permisos efectivos, resueltos por el backend. Llegan como lista. */
  permisos?: string[];
  /** La entrada que corresponde a su rol (`roles.pantalla_inicio`). */
  pantallaDelRol?: string | null;
}

/**
 * Todos los roles que efectivamente tiene la sesión — a diferencia de
 * `user.rol` (que es un único valor, la pantalla de aterrizaje), esto
 * puede traer más de uno para una persona admin_clinica + médico. Staff de
 * plataforma (tenantId null) sigue siendo mutuamente excluyente por
 * diseño, así que ahí devuelve un solo elemento.
 */
export function misRoles(user: Pick<AuthUser, "tenantId" | "rol" | "esAdminClinica" | "esMedico">): Rol[] {
  if (user.tenantId === null) return [user.rol];
  const roles: Rol[] = [];
  if (user.esMedico) roles.push("medico");
  if (user.esAdminClinica) roles.push("admin_clinica");
  return roles;
}

/**
 * Los módulos de Vetline Clinic. Espejo del CHECK de
 * `tenant_modulos.modulo` y de `MODULOS` en backend/src/tenantModulos.ts.
 *
 * `crm` cubre campañas, recordatorios comerciales y oportunidades: son
 * piezas del CRM, no módulos aparte (guía rectora §7).
 */
export type Modulo = "expediente" | "inventario" | "ventas" | "facturacion" | "crm";

interface AuthContextValue {
  user: AuthUser | null;
  tenantId: string | null;
  rol: Rol | null;
  esAdminClinica: boolean;
  esMedico: boolean;
  /**
   * Los roles de la persona en SU clínica (prompt 04): `recepcion`,
   * `caja`, `farmacia`… Son los de `persona_roles` y no los de Keycloak,
   * que solo distingue ADMIN de VETERINARIO.
   */
  rolesClinica: string[];
  /**
   * LO QUE ESTA PERSONA PUEDE HACER, resuelto por el backend contra la
   * base. Se usa para decidir qué menú y qué botones se dibujan.
   *
   * NO ES LA AUTORIZACIÓN: el backend vuelve a resolverlo en cada
   * request con `exigirPermiso`. Esto es nada más para no ofrecerle a
   * alguien un botón que le va a contestar 403.
   */
  puede: (codigo: string) => boolean;
  zonaHoraria: string | null;
  /** Módulos de Vetline Clinic habilitados en la clínica de la sesión. [] para staff de plataforma. */
  modulos: Modulo[];
  /**
   * La pantalla de entrada que ESTE usuario eligió, o null para «la que
   * corresponda». Vive en la base (`personas.pantalla_inicio`) y no en
   * el navegador: es del usuario, no del equipo desde el que entra.
   */
  pantallaInicio: string | null;
  /** Guarda la elección. `null` vuelve a la derivada del rol y los módulos. */
  elegirPantallaInicio: (ruta: string | null) => Promise<void>;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  /**
   * Para flujos que ya obtuvieron un access_token/refresh_token reales de
   * Keycloak sin pasar por `login()` (ej. /registro-publico, que hace el
   * intercambio password grant del lado del backend inmediatamente
   * después de crear la clínica y devuelve esos tokens ya listos — acá
   * solo falta guardarlos y resolver la sesión, no volver a pedirle la
   * contraseña al usuario).
   */
  iniciarSesionConTokensKeycloak: (tokens: KeycloakTokenResponse) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Roles de negocio que trae realm_access.roles del token de Keycloak — el
// resto (offline_access, uma_authorization, default-roles-*, etc.) son
// roles internos de Keycloak sin significado para esta app.
//
// Un ADMIN de clínica que además es médico (VETERINARIO) sigue aterrizando
// en /admin, mismo criterio que ya usaba el backend con es_admin_clinica —
// VETERINARIO solo decide el `rol` cuando no hay ADMIN ni SUPER_ADMIN.
// esAdminClinica en cambio es independiente del `rol` final: es true cada
// vez que el token trae ADMIN, ambos pueden convivir.
function mapearRol(roles: string[]): { rol: Rol; esAdminClinica: boolean } | null {
  const esAdminClinica = roles.includes("ADMIN");
  if (roles.includes("SUPER_ADMIN")) return { rol: "super_admin", esAdminClinica };
  if (esAdminClinica) return { rol: "admin_clinica", esAdminClinica: true };
  if (roles.includes("VETERINARIO")) return { rol: "medico", esAdminClinica };
  return null;
}

function isExpired(claims: { exp?: number } | null): boolean {
  if (!claims?.exp) return false;
  return Date.now() >= claims.exp * 1000;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [pantallaInicio, setPantallaInicio] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Al montar, restauramos el snapshot ya resuelto (evita esperar un
  // viaje de red solo para pintar la UI) mientras el access_token siga
  // vigente. Si venció, no lo refrescamos acá — el interceptor central en
  // apiFetch (ver session.ts) se encarga apenas haya un request real, y si
  // el refresh falla ahí, limpia la sesión y redirige a /login.
  useEffect(() => {
    const accessToken = leerAccessToken();
    const claims = accessToken ? decodeJwtPayload(accessToken) : null;
    const snapshot = leerUsuarioGuardado<AuthUser>();

    if (accessToken && snapshot && claims && !isExpired(claims)) {
      setUser(snapshot);
      // UN SNAPSHOT DE ANTES DEL 04 no tiene permisos, y el menú ahora se
      // dibuja con ellos: sin esto, quien tenga la sesión abierta vería
      // una barra vacía hasta volver a entrar. Se completan de la base en
      // vez de dejar un camino de respaldo que lea los booleanos viejos,
      // que serían dos fuentes para lo mismo.
      if (snapshot.permisos === undefined) {
        apiFetch<{ roles: string[]; permisos: string[] }>("/clinica/mis-permisos", {
          token: accessToken,
        })
          .then((r) => {
            const completo = { ...snapshot, roles: r.roles, permisos: r.permisos };
            guardarUsuario(completo);
            setUser(completo);
          })
          .catch(() => {
            // Si falla, la sesión sigue andando: el backend es el que
            // autoriza, y el próximo login trae los permisos.
          });
      }
      // Mismo criterio que el snapshot del usuario: se restaura lo ya
      // resuelto para no esperar un viaje de red solo para decidir qué
      // secciones pintar. La lista se refresca en el próximo login o
      // refresco de sesión; habilitar un módulo se ve al recargar.
      setModulos(leerModulosGuardados() as Modulo[]);
      setPantallaInicio(leerPantallaInicioGuardada());
    } else {
      limpiarSesion();
    }
    setIsLoading(false);
  }, []);

  // Único lugar que efectivamente guarda tokens de Keycloak y resuelve la
  // sesión — tanto login() (que primero PIDE los tokens con email+password)
  // como iniciarSesionConTokensKeycloak() (que ya los recibe listos, ver
  // /registro-publico) terminan acá.
  const establecerSesionKeycloak = async (tokens: KeycloakTokenResponse): Promise<AuthUser> => {
    const claims = decodeJwtPayload(tokens.access_token);
    const roles = (claims?.realm_access?.roles as string[] | undefined) ?? [];
    const mapeo = claims ? mapearRol(roles) : null;
    if (!claims || !mapeo) {
      throw new ApiError(
        "Tu usuario no tiene un rol reconocido en Vetline Ai. Contactá a soporte.",
        403
      );
    }

    // Guardamos los tokens ANTES de llamar a /auth/me: apiFetch resuelve el
    // token vigente leyéndolo de acá (ver session.ts obtenerTokenValido),
    // no del valor que se le pasa literalmente.
    guardarTokens(tokens.access_token, tokens.refresh_token);

    // zonaHoraria no viaja en el token de Keycloak — se completa con lo que
    // el backend ya resuelve en GET /auth/me a partir de la persona y su
    // tenant reales. De paso, esta llamada confirma que el backend
    // efectivamente reconoce a este usuario de Keycloak (keycloak_user_id
    // vinculado) antes de dar la sesión por establecida: mejor fallar acá
    // con un mensaje claro que dejar entrar a alguien cuyo primer request
    // real le va a devolver 401 en todos lados.
    let me: {
      auth: AuthUser;
      modulos?: Modulo[];
      persona?: { pantalla_inicio?: string | null } | null;
    };
    try {
      me = await apiFetch<{
        auth: AuthUser;
        modulos?: Modulo[];
        persona?: { pantalla_inicio?: string | null } | null;
      }>("/auth/me", {
        token: tokens.access_token,
      });
    } catch (err) {
      limpiarSesion();
      throw err;
    }

    guardarUsuario(me.auth);
    // `?? []` y no un error: una sesión contra un backend que todavía no
    // devuelve `modulos` es una sesión sin módulos de Vetline Clinic, no
    // una sesión inválida.
    const modulosDeLaSesion = me.modulos ?? [];
    guardarModulos(modulosDeLaSesion);
    setUser(me.auth);
    setModulos(modulosDeLaSesion);
    guardarPantallaInicio(me.persona?.pantalla_inicio ?? null);
    setPantallaInicio(me.persona?.pantalla_inicio ?? null);
    return me.auth;
  };

  const login = async (email: string, password: string): Promise<AuthUser> => {
    const tokens: KeycloakTokenResponse = await keycloakAuth.login(email, password);
    return establecerSesionKeycloak(tokens);
  };

  const iniciarSesionConTokensKeycloak = (tokens: KeycloakTokenResponse): Promise<AuthUser> =>
    establecerSesionKeycloak(tokens);

  const logout = () => {
    const refreshToken = leerRefreshToken();
    limpiarSesion();
    setUser(null);
    setModulos([]);
    setPantallaInicio(null);
    if (refreshToken) {
      // Best-effort: invalida la sesión del lado de Keycloak, sin bloquear
      // el logout local si falla (ver keycloakAuth.ts).
      keycloakAuth.logout(refreshToken).catch(() => {});
    }
  };

  const elegirPantallaInicio = async (ruta: string | null) => {
    // Optimista: el menu se cierra con la eleccion ya puesta. Si el
    // guardado falla, se vuelve atras — la alternativa, esperar la
    // respuesta, hace que el clic parezca no haber pasado (es el mismo
    // problema que tenian las casillas de consentimientos del CRM).
    const previo = pantallaInicio;
    setPantallaInicio(ruta);
    guardarPantallaInicio(ruta);
    try {
      await apiFetch("/auth/mi-pantalla-inicio", {
        method: "PUT",
        token: getStoredToken(),
        body: JSON.stringify({ pantalla: ruta }),
      });
    } catch (err) {
      setPantallaInicio(previo);
      guardarPantallaInicio(previo);
      console.error("No se pudo guardar la pantalla de entrada:", err);
    }
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      tenantId: user?.tenantId ?? null,
      rol: user?.rol ?? null,
      esAdminClinica: user?.esAdminClinica ?? false,
      esMedico: user?.esMedico ?? false,
      rolesClinica: user?.roles ?? [],
      // Si la sesión es de antes del 04 y no trae permisos, `puede()`
      // dice que no a todo: la pantalla se ve sin botones y el siguiente
      // login los trae. Lo contrario —asumir que puede— ofrecería
      // acciones que el backend va a rechazar.
      puede: (codigo: string) => (user?.permisos ?? []).includes(codigo),
      zonaHoraria: user?.zonaHoraria ?? null,
      modulos,
      pantallaInicio,
      elegirPantallaInicio,
      isLoading,
      login,
      iniciarSesionConTokensKeycloak,
      logout,
    }),
    [user, modulos, pantallaInicio, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  }
  return ctx;
}

/** Devuelve el token crudo guardado, para pasarlo a apiFetch en llamadas autenticadas. */
export function getStoredToken(): string | null {
  return leerAccessToken();
}
