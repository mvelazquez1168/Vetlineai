import { getStoredToken } from "../hooks/useAuth";
import { Modulo } from "../hooks/useAuth";
import { apiFetch } from "./api";

export interface EstadoModulo {
  modulo: Modulo;
  etiqueta: string;
  habilitado: boolean;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export const clinicApi = {
  // Gateado por el módulo `expediente` en el backend
  // (requiereModulo) — una clínica sin ese módulo recibe 403 con
  // code: "MODULO_NO_HABILITADO".
  estado: () => authedFetch<{ modulos: EstadoModulo[] }>("/clinic/estado"),
};
