import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------
// Cliente de la API del CRM (prompt 03). Tipos y llamadas, nada de
// lógica: qué se puede enviar y qué detalle se muestra lo decide el
// backend, porque es una regla y no una preferencia de pantalla.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}
function json<T>(path: string, metodo: string, cuerpo: unknown): Promise<T> {
  return pedir<T>(path, { method: metodo, body: JSON.stringify(cuerpo) });
}

export interface EventoCrm {
  id: string;
  tipo: string;
  etiqueta: string;
  modulo: string;
  clinico: boolean;
  ocurrido_en: string;
  origen_tabla: string;
  origen_id: string | null;
  origen_existe: boolean;
  resumen: string | null;
  canal: string | null;
  finalidad: string | null;
  nota: string | null;
  persona_nombre: string | null;
  paciente_id: string | null;
  paciente_nombre: string | null;
  propietario_id: string | null;
}

export interface TipoEvento {
  codigo: string;
  etiqueta: string;
  modulo: string;
  clinico: boolean;
}

export interface ConsentimientoCrm {
  canal: "correo" | "whatsapp";
  finalidad: "salud" | "promociones";
  otorgado: boolean;
  actualizado_en: string;
}

export interface CambioConsentimiento {
  canal: string;
  finalidad: string;
  otorgado: boolean;
  fuente: string;
  nota: string | null;
  creado_en: string;
  registrado_por_nombre: string | null;
}

export interface PoliticasCrm {
  horaDesde: string;
  horaHasta: string;
  topePromocionesMes: number;
  ventanaDuplicadoHoras: number;
}

export const crmApi = {
  tipos: () => pedir<{ tipos: TipoEvento[] }>("/crm/tipos-evento"),

  lineaDeCliente: (propietarioId: string, filtros: Record<string, string> = {}) => {
    const q = new URLSearchParams(
      Object.entries(filtros).filter(([, v]) => v) as [string, string][]
    );
    return pedir<{ eventos: EventoCrm[] }>(
      `/crm/clientes/${propietarioId}/linea?${q.toString()}`
    );
  },

  lineaDePaciente: (pacienteId: string) =>
    pedir<{ eventos: EventoCrm[] }>(`/crm/pacientes/${pacienteId}/linea`),

  agregarNota: (propietarioId: string, texto: string, pacienteId?: string) =>
    json<{ id: string }>(`/crm/clientes/${propietarioId}/notas`, "POST", { texto, pacienteId }),

  consentimientos: (propietarioId: string) =>
    pedir<{
      consentimientos: ConsentimientoCrm[];
      historial: CambioConsentimiento[];
      preferencias: {
        canalPreferido: "correo" | "whatsapp" | null;
        horaDesde: string | null;
        horaHasta: string | null;
      };
      politicas: PoliticasCrm;
    }>(`/crm/clientes/${propietarioId}/consentimientos`),

  guardarConsentimiento: (
    propietarioId: string,
    d: { canal: string; finalidad: string; otorgado: boolean; nota?: string }
  ) => json<{ cambio: boolean }>(`/crm/clientes/${propietarioId}/consentimientos`, "PUT", d),

  guardarPreferencias: (propietarioId: string, d: Record<string, unknown>) =>
    json<{ guardado: true }>(`/crm/clientes/${propietarioId}/preferencias`, "PUT", d),

  puedeEnviar: (propietarioId: string, q: Record<string, string> = {}) =>
    pedir<{
      puede: boolean;
      motivo?: string;
      explicacion?: string;
      canal: string;
      destino?: string;
      /** El canal usado NO es el que el cliente prefiere (anexo 07-03, B4). */
      canalAlternativo?: boolean;
    }>(`/crm/clientes/${propietarioId}/puede-enviar?${new URLSearchParams(q).toString()}`),

  politicas: () => pedir<PoliticasCrm>("/crm/politicas"),
  guardarPoliticas: (d: Partial<PoliticasCrm>) => json<PoliticasCrm>("/crm/politicas", "PUT", d),

  /** La respuesta de un cliente. Con el proveedor simulado, para probar. */
  simularRespuesta: (d: { canal: string; remitente: string; texto: string }) =>
    json<{ respuestaId: string; accion: string | null; propietarioId: string | null }>(
      "/crm/respuestas",
      "POST",
      d
    ),
};
