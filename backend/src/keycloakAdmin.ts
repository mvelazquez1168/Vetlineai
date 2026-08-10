import crypto from "crypto";
import { config } from "./config";

// ---------------------------------------------------------------------
// Creación automática de usuarios en Keycloak vía su Admin REST API,
// autenticado como el client de servicio (confidencial, service account
// con el rol manage-users de realm-management — se crea a mano en la
// consola de Keycloak, no por código, ver instrucciones de la fase
// anterior). Reemplaza tener que crear cada usuario manualmente en
// Keycloak → Users cada vez que se da de alta una clínica o un médico.
// ---------------------------------------------------------------------

// KEYCLOAK_ADMIN_URL = ".../admin/realms/Vetplatform" — el endpoint de
// token (client_credentials) vive en el mismo host, sacando el prefijo
// "/admin".
const REALM_URL = config.keycloakAdminUrl.replace("/admin/realms/", "/realms/");
const TOKEN_ENDPOINT = `${REALM_URL}/protocol/openid-connect/token`;

interface TokenServicio {
  accessToken: string;
  expiraEn: number; // epoch ms
}

let tokenCacheado: TokenServicio | null = null;

// Cachea el token de servicio en memoria hasta que esté por vencer — no
// pide uno nuevo en cada llamada a la Admin API.
async function obtenerTokenServicio(): Promise<string> {
  if (tokenCacheado && tokenCacheado.expiraEn - Date.now() > 5_000) {
    return tokenCacheado.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.keycloakServiceClientId,
    client_secret: config.keycloakServiceClientSecret,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    throw new Error(
      `No se pudo obtener el token de servicio de Keycloak (HTTP ${response.status}): ${detalle}`
    );
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCacheado = {
    accessToken: data.access_token,
    expiraEn: Date.now() + data.expires_in * 1000,
  };
  return tokenCacheado.accessToken;
}

async function adminFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await obtenerTokenServicio();
  return fetch(`${config.keycloakAdminUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// Distinguible de un fallo genérico — el llamador la usa para devolver un
// 409 claro ("ya existe") en vez de un 500 ("algo se rompió").
export class KeycloakUsuarioExistenteError extends Error {
  constructor(email: string) {
    super(`Ya existe un usuario de Keycloak con el email ${email}.`);
    this.name = "KeycloakUsuarioExistenteError";
  }
}

export type RolKeycloak = "VETERINARIO" | "ADMIN" | "SUPER_ADMIN";

export interface DatosNuevoUsuarioKeycloak {
  email: string;
  nombreCompleto: string;
  password: string;
  /** Ausente para staff de plataforma (sin tenant). */
  tenantId?: string | null;
  rol: RolKeycloak;
  /**
   * Default true (comportamiento histórico) — el único caso que lo pasa en
   * false es el administrador que se autorregistra (ver registro.routes.ts),
   * porque desde el prompt de verificación de correo su emailVerified real
   * depende de que confirme el enlace que le mandamos por Resend, no de
   * que Keycloak lo dé por sentado al crearlo. El médico invitado sigue
   * naciendo verificado: su enlace de invitación ya prueba que lo recibió.
   */
  emailVerificado?: boolean;
}

function separarNombre(nombreCompleto: string): { firstName: string; lastName: string } {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
  const firstName = partes[0] ?? nombreCompleto;
  const lastName = partes.slice(1).join(" ") || firstName;
  return { firstName, lastName };
}

// Password inicial generada al azar — el admin que crea la cuenta se la
// comunica al usuario nuevo por el canal que prefiera (no hay invitación
// por email todavía, ver QUÉ NO HACER de esta fase). No es temporal en
// Keycloak (no fuerza cambio en el primer login) — es una decisión de MVP,
// no un descuido: forzar cambio de password requeriría un flujo de
// "primer login" que el frontend todavía no tiene.
export function generarPasswordAleatoria(): string {
  const aleatorio = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "");
  return `Vp${aleatorio}!1`;
}

/**
 * Crea un usuario nuevo en Keycloak: alta + password fija (no temporal) +
 * atributo tenant_id (si corresponde) + rol de realm. Si cualquier paso
 * posterior a la creación falla (password o rol), borra el usuario recién
 * creado antes de propagar el error — nunca deja un usuario "a medias"
 * (creado pero sin password utilizable o sin el rol correcto) en Keycloak.
 *
 * Devuelve el ID de Keycloak del usuario (para guardar en
 * personas.keycloak_user_id / staff_plataforma.keycloak_user_id).
 */
export async function crearUsuarioKeycloak(datos: DatosNuevoUsuarioKeycloak): Promise<string> {
  const { firstName, lastName } = separarNombre(datos.nombreCompleto);

  const crearResponse = await adminFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      username: datos.email,
      email: datos.email,
      firstName,
      lastName,
      enabled: true,
      // true por defecto — no queremos que quede pendiente de verificación
      // nativa de Keycloak (no la usamos, ver verificacionCorreo.ts). El
      // único caso que lo pasa en false es el admin autorregistrado.
      emailVerified: datos.emailVerificado ?? true,
      requiredActions: [],
      ...(datos.tenantId ? { attributes: { tenant_id: [datos.tenantId] } } : {}),
    }),
  });

  if (crearResponse.status === 409) {
    throw new KeycloakUsuarioExistenteError(datos.email);
  }
  if (!crearResponse.ok) {
    const detalle = await crearResponse.text().catch(() => "");
    throw new Error(
      `No se pudo crear el usuario en Keycloak (HTTP ${crearResponse.status}): ${detalle}`
    );
  }

  // POST /users no devuelve el usuario en el body — el id nuevo viaja en
  // el header Location (".../admin/realms/Vetplatform/users/<id>").
  const location = crearResponse.headers.get("Location");
  const keycloakUserId = location?.split("/").pop();
  if (!keycloakUserId) {
    throw new Error("Keycloak no devolvió el ID del usuario recién creado.");
  }

  try {
    const passwordResponse = await adminFetch(`/users/${keycloakUserId}/reset-password`, {
      method: "PUT",
      body: JSON.stringify({ type: "password", value: datos.password, temporary: false }),
    });
    if (!passwordResponse.ok) {
      const detalle = await passwordResponse.text().catch(() => "");
      throw new Error(`No se pudo setear la contraseña (HTTP ${passwordResponse.status}): ${detalle}`);
    }

    // El endpoint de role-mappings pide {id, name} del rol, no solo el
    // nombre — hay que resolver el rol de realm primero.
    const rolResponse = await adminFetch(`/roles/${datos.rol}`);
    if (!rolResponse.ok) {
      throw new Error(
        `No se encontró el rol de realm '${datos.rol}' en Keycloak (HTTP ${rolResponse.status}).`
      );
    }
    const rol = (await rolResponse.json()) as { id: string; name: string };

    const asignarRolResponse = await adminFetch(`/users/${keycloakUserId}/role-mappings/realm`, {
      method: "POST",
      body: JSON.stringify([{ id: rol.id, name: rol.name }]),
    });
    if (!asignarRolResponse.ok) {
      const detalle = await asignarRolResponse.text().catch(() => "");
      throw new Error(
        `No se pudo asignar el rol '${datos.rol}' (HTTP ${asignarRolResponse.status}): ${detalle}`
      );
    }
  } catch (err) {
    await eliminarUsuarioKeycloak(keycloakUserId);
    throw err;
  }

  return keycloakUserId;
}

/**
 * Borra un usuario de Keycloak — usado tanto internamente (limpieza si
 * password/rol fallan durante la creación) como por los llamadores que
 * necesiten deshacer un alta ya confirmada (ver admin.routes.ts).
 * No lanza si el usuario ya no existe (404): borrar algo que ya no está
 * no es un error para quien llama esto como parte de un rollback.
 */
export async function eliminarUsuarioKeycloak(keycloakUserId: string): Promise<void> {
  const response = await adminFetch(`/users/${keycloakUserId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    console.error(
      `No se pudo eliminar el usuario de Keycloak ${keycloakUserId} (HTTP ${response.status}) — requiere limpieza manual.`
    );
  }
}

/**
 * Cambia username+email de un usuario ya creado — requiere
 * editUsernameAllowed=true en el reino (ver backend/keycloak/CONFIGURACION_MANUAL.md).
 * Usado únicamente por verificacionCorreo.ts cuando el administrador de
 * clínica corrige su propio correo (Capa 3): username=email siempre en
 * este reino, así que corregir el correo implica corregir el username.
 */
export async function cambiarEmailUsuarioKeycloak(keycloakUserId: string, nuevoEmail: string): Promise<void> {
  const response = await adminFetch(`/users/${keycloakUserId}`, {
    method: "PUT",
    body: JSON.stringify({ username: nuevoEmail, email: nuevoEmail }),
  });
  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    throw new Error(`No se pudo cambiar el correo en Keycloak (HTTP ${response.status}): ${detalle}`);
  }
}

/**
 * Sincroniza el flag emailVerified de Keycloak con nuestra propia
 * verificación (verificacionCorreo.ts es la fuente de verdad — esto solo
 * evita que Keycloak quede diciendo algo distinto, ver caveat del usuario
 * sobre no dejar dos fuentes con estados contradictorios).
 */
export async function marcarEmailVerificadoKeycloak(keycloakUserId: string, verificado: boolean): Promise<void> {
  const response = await adminFetch(`/users/${keycloakUserId}`, {
    method: "PUT",
    body: JSON.stringify({ emailVerified: verificado }),
  });
  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    throw new Error(`No se pudo sincronizar emailVerified en Keycloak (HTTP ${response.status}): ${detalle}`);
  }
}

/**
 * Cambia la contraseña de un usuario YA existente — a diferencia del
 * reset-password inline dentro de crearUsuarioKeycloak (que solo corre
 * una vez, al alta), este es el que usa restablecerContrasena.ts para un
 * usuario real pidiendo "olvidé mi contraseña". temporary:false, mismo
 * criterio que el alta: no forzamos un cambio en el próximo login porque
 * el usuario ya la acaba de elegir a propósito.
 */
export async function restablecerContrasenaUsuarioKeycloak(keycloakUserId: string, nuevaContrasena: string): Promise<void> {
  const response = await adminFetch(`/users/${keycloakUserId}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ type: "password", value: nuevaContrasena, temporary: false }),
  });
  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    throw new Error(`No se pudo restablecer la contraseña en Keycloak (HTTP ${response.status}): ${detalle}`);
  }
}

/**
 * Invalida todas las sesiones activas del usuario — decisión de
 * seguridad del prompt de restablecimiento: si alguien restablece la
 * contraseña porque sospecha que le entraron a la cuenta, dejar viva la
 * sesión del intruso vacía el sentido del cambio. Se llama siempre
 * después de restablecerContrasenaUsuarioKeycloak, nunca antes (no tiene
 * sentido cerrar sesiones de una contraseña que todavía no cambió).
 */
export async function cerrarSesionesUsuarioKeycloak(keycloakUserId: string): Promise<void> {
  const response = await adminFetch(`/users/${keycloakUserId}/logout`, { method: "POST" });
  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    throw new Error(`No se pudieron cerrar las sesiones en Keycloak (HTTP ${response.status}): ${detalle}`);
  }
}

export interface TokenUsuarioKeycloak {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Intercambia usuario+contraseña por un access_token/refresh_token reales
 * de Keycloak — Direct Access Grant, el mismo mecanismo que usa el login
 * normal del frontend (ver frontend/src/lib/keycloakAuth.ts), pero
 * ejecutado del lado del backend para el auto-login inmediatamente
 * después de /api/registro-publico: el usuario ya escribió su contraseña
 * en el formulario de registro, no tiene sentido pedírsela de nuevo.
 * Usa el client PÚBLICO (vetplatform-web), no el de servicio — está
 * actuando en nombre de un usuario real, no como el backend en sí mismo.
 */
export async function obtenerTokenParaUsuario(
  username: string,
  password: string
): Promise<TokenUsuarioKeycloak> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: config.keycloakClientId,
    username,
    password,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    throw new Error(
      `No se pudo obtener el token del usuario recién creado (HTTP ${response.status}): ${detalle}`
    );
  }

  return (await response.json()) as TokenUsuarioKeycloak;
}
