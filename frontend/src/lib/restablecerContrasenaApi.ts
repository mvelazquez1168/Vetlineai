import { apiFetch } from "./api";

// Cliente público (sin sesión) — mismo criterio que verificacionCorreoApi.ts.

export type MotivoTokenInvalido = "token_invalido" | "token_vencido" | "token_usado";

export const restablecerContrasenaApi = {
  solicitar: (email: string) =>
    apiFetch<{ ok: true; mensaje: string }>("/restablecer-contrasena", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  validarToken: (token: string) => apiFetch<{ ok: true }>(`/restablecer-contrasena/${token}`),
  confirmar: (token: string, password: string) =>
    apiFetch<{ ok: true }>(`/restablecer-contrasena/${token}/confirmar`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
};
