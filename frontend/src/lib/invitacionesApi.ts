import { apiFetch } from "./api";

// Cliente público (sin sesión) para la pantalla de alta del médico
// invitado — Pantallas faltantes, Prompt A, Paso 3.

export interface InvitacionPublica {
  estado: "pendiente" | "aceptada" | "cancelada" | "vencida" | "no_encontrada";
  email?: string;
  nombre?: string | null;
  nombreClinica?: string;
  /** Los roles con los que va a nacer (prompt 04). */
  roles?: string[];
  /** Sus nombres, para decirle a qué la invitan. */
  rolesNombres?: string[];
  /** Si hay que pedirle la colegiatura: solo los médicos la tienen. */
  esMedico?: boolean;
}

export type ResultadoAceptarInvitacion =
  | { autoLogin: true; access_token: string; refresh_token: string; expires_in: number }
  | { autoLogin: false };

export const invitacionesApi = {
  obtener: (token: string) => apiFetch<InvitacionPublica>(`/invitaciones/${token}`),

  aceptar: (
    token: string,
    datos: { nombre: string; colegiatura?: string; password: string }
  ) =>
    apiFetch<ResultadoAceptarInvitacion>(`/invitaciones/${token}/aceptar`, {
      method: "POST",
      body: JSON.stringify(datos),
    }),
};
