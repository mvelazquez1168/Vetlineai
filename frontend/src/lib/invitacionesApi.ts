import { apiFetch } from "./api";

// Cliente público (sin sesión) para la pantalla de alta del médico
// invitado — Pantallas faltantes, Prompt A, Paso 3.

export interface InvitacionPublica {
  estado: "pendiente" | "aceptada" | "cancelada" | "vencida" | "no_encontrada";
  email?: string;
  nombre?: string | null;
  nombreClinica?: string;
}

export type ResultadoAceptarInvitacion =
  | { autoLogin: true; access_token: string; refresh_token: string; expires_in: number }
  | { autoLogin: false };

export const invitacionesApi = {
  obtener: (token: string) => apiFetch<InvitacionPublica>(`/invitaciones/${token}`),

  aceptar: (token: string, datos: { nombre: string; colegiatura: string; password: string }) =>
    apiFetch<ResultadoAceptarInvitacion>(`/invitaciones/${token}/aceptar`, {
      method: "POST",
      body: JSON.stringify(datos),
    }),
};
