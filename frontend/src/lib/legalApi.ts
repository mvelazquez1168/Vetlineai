import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// RUTAS PÚBLICAS: el backend las sirve sin sesión, y acá se declara con
// `publico: true`. Es la excepción del cliente de API (ver `api.ts`):
// toda llamada va autenticada salvo las que lo digan. En una ruta
// pública el token NO se resuelve a propósito, para no mandar al login a
// alguien que está abriendo un enlace sin sesión.

export type TipoDocumentoLegal = "terminos_condiciones" | "politica_privacidad";

export interface DocumentoLegal {
  id: string;
  tipo: TipoDocumentoLegal;
  contenido: string;
  version: string;
  fecha_publicacion: string;
}

export const legalApi = {
  // Público — sin token, consultable incluso desde /registro o /login.
  obtener: (tipo: TipoDocumentoLegal) =>
    apiFetch<{ documento: DocumentoLegal }>(`/legal/${tipo}`, { publico: true }),

  // Solo super_admin — nunca actualiza la fila vigente, siempre publica una nueva.
  publicar: (tipo: TipoDocumentoLegal, data: { contenido: string; version: string }) =>
    apiFetch<{ documento: DocumentoLegal }>(`/platform-admin/legal/${tipo}`, {
      method: "PATCH",
      token: getStoredToken(),
      body: JSON.stringify(data),
    }),
};
