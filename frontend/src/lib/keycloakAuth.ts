import { ApiError } from "./apiError";

// Seguimos con Direct Access Grant (usuario/contraseña directo contra
// Keycloak desde nuestro propio formulario) — sin redirect a la pantalla
// de Keycloak, decisión ya tomada. El backend valida cada request de
// forma independiente contra el JWKS del realm (ver backend/src/middleware/auth.ts);
// acá solo hablamos con el endpoint de token para obtener/renovar la sesión.
const KEYCLOAK_ISSUER =
  import.meta.env.VITE_KEYCLOAK_ISSUER ?? "http://localhost:8080/realms/Vetplatform";
const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? "vetplatform-web";

const TOKEN_ENDPOINT = `${KEYCLOAK_ISSUER}/protocol/openid-connect/token`;
const LOGOUT_ENDPOINT = `${KEYCLOAK_ISSUER}/protocol/openid-connect/logout`;

export interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function pedirToken(params: Record<string, string>): Promise<KeycloakTokenResponse> {
  const body = new URLSearchParams({ client_id: KEYCLOAK_CLIENT_ID, ...params });

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new ApiError("No pudimos conectar con el servidor de autenticación.", 0);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // Keycloak devuelve { error: "invalid_grant", error_description: "..." }
    // — "invalid_grant" cubre tanto credenciales incorrectas como cuenta
    // deshabilitada/refresh token vencido, así que el mensaje genérico de
    // credenciales es el más útil para el formulario de login; para el
    // refresh (donde este mismo código también puede disparar) el llamador
    // no muestra este mensaje al usuario, solo lo usa para decidir cerrar
    // la sesión.
    const mensaje =
      data?.error === "invalid_grant"
        ? "Correo o contraseña incorrectos."
        : (data?.error_description as string | undefined) ?? "No pudimos iniciar sesión. Intentá de nuevo.";
    throw new ApiError(mensaje, response.status);
  }

  return data as KeycloakTokenResponse;
}

export const keycloakAuth = {
  login: (username: string, password: string) =>
    pedirToken({ grant_type: "password", username, password }),

  refresh: (refreshToken: string) =>
    pedirToken({ grant_type: "refresh_token", refresh_token: refreshToken }),

  // Best-effort: invalida la sesión del lado de Keycloak. Si falla (red,
  // token ya vencido, etc.) no bloquea el logout local — la limpieza de
  // localStorage es lo que realmente cierra la sesión en este navegador.
  logout: async (refreshToken: string): Promise<void> => {
    try {
      await fetch(LOGOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: KEYCLOAK_CLIENT_ID, refresh_token: refreshToken }),
      });
    } catch {
      // silencioso a propósito, ver comentario arriba.
    }
  },
};
