import { apiFetch } from "./api";

// RUTAS PÚBLICAS: el backend las sirve sin sesión, y acá se declara con
// `publico: true`. Es la excepción del cliente de API (ver `api.ts`):
// toda llamada va autenticada salvo las que lo digan. En una ruta
// pública el token NO se resuelve a propósito, para no mandar al login a
// alguien que está abriendo un enlace sin sesión.

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
  obtener: (token: string) => apiFetch<InvitacionPublica>(`/invitaciones/${token}`, { publico: true }),

  aceptar: (
    token: string,
    datos: { nombre: string; colegiatura?: string; password: string }
  ) =>
    apiFetch<ResultadoAceptarInvitacion>(`/invitaciones/${token}/aceptar`, {
      publico: true,
      method: "POST",
      body: JSON.stringify(datos),
    }),
};
