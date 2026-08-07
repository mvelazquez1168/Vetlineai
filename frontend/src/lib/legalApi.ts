import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

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
    apiFetch<{ documento: DocumentoLegal }>(`/legal/${tipo}`),

  // Solo super_admin — nunca actualiza la fila vigente, siempre publica una nueva.
  publicar: (tipo: TipoDocumentoLegal, data: { contenido: string; version: string }) =>
    apiFetch<{ documento: DocumentoLegal }>(`/platform-admin/legal/${tipo}`, {
      method: "PATCH",
      token: getStoredToken(),
      body: JSON.stringify(data),
    }),
};
