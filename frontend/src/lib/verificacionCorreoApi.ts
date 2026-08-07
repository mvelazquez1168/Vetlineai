import { apiFetch } from "./api";

// Cliente público (sin sesión) — pantalla a la que se llega por el
// enlace del correo de verificación.

export type MotivoConfirmacionFallida = "token_invalido" | "token_vencido";

export const verificacionCorreoApi = {
  confirmar: (token: string) =>
    apiFetch<{ ok: true }>(`/verificar-correo/${token}/confirmar`, { method: "POST" }),
};
