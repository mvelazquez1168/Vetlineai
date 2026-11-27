import { apiFetch } from "./api";

// RUTAS PÚBLICAS: el backend las sirve sin sesión, y acá se declara con
// `publico: true`. Es la excepción del cliente de API (ver `api.ts`):
// toda llamada va autenticada salvo las que lo digan. En una ruta
// pública el token NO se resuelve a propósito, para no mandar al login a
// alguien que está abriendo un enlace sin sesión.

// Cliente público (sin sesión) — mismo criterio que verificacionCorreoApi.ts.

export type MotivoTokenInvalido = "token_invalido" | "token_vencido" | "token_usado";

export const restablecerContrasenaApi = {
  solicitar: (email: string) =>
    apiFetch<{ ok: true; mensaje: string }>("/restablecer-contrasena", {
      publico: true,
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  validarToken: (token: string) => apiFetch<{ ok: true }>(`/restablecer-contrasena/${token}`, { publico: true }),
  confirmar: (token: string, password: string) =>
    apiFetch<{ ok: true }>(`/restablecer-contrasena/${token}/confirmar`, {
      publico: true,
      method: "POST",
      body: JSON.stringify({ password }),
    }),
};
