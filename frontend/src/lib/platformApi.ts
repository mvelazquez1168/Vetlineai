import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

export interface Overview {
  clinicasActivas: number;
  agentesHabilitados: number;
}

export interface ClinicaResumen {
  id: string;
  nombre: string;
  pais_codigo: string | null;
  ciudad: string | null;
  plan: string;
  agentes_habilitados: number;
  medicos_activos: number;
}

export interface AgenteCatalogo {
  id: string;
  nombre: string;
  descripcion: string;
  estado_catalogo: "disponible" | "proximamente";
  clinicas_habilitadas: number;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export const platformApi = {
  obtenerOverview: () => authedFetch<Overview>("/platform/overview"),

  listarClinicas: (filtros?: { q?: string; pais?: string; plan?: string }) => {
    const params = new URLSearchParams();
    if (filtros?.q) params.set("q", filtros.q);
    if (filtros?.pais) params.set("pais", filtros.pais);
    if (filtros?.plan) params.set("plan", filtros.plan);
    const qs = params.toString();
    return authedFetch<{ clinicas: ClinicaResumen[] }>(`/platform/clinicas${qs ? `?${qs}` : ""}`);
  },

  crearClinica: (data: {
    nombre: string;
    pais_codigo: string;
    ciudad?: string;
    idioma?: string;
    plan?: string;
    adminNombre: string;
    adminEmail: string;
  }) =>
    authedFetch<{ clinica: ClinicaResumen }>("/platform/clinicas", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listarAgentes: () => authedFetch<{ agentes: AgenteCatalogo[] }>("/platform/agentes"),

  crearAgente: (data: {
    nombre: string;
    descripcion?: string;
    estadoCatalogo?: "disponible" | "proximamente";
  }) =>
    authedFetch<{ agente: AgenteCatalogo }>("/platform/agentes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
