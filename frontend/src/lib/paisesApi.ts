import { apiFetch } from "./api";

export interface Pais {
  codigo_iso: string;
  nombre: string;
  idioma_default: string;
  zona_horaria_default: string | null;
  zonas_horarias: string[];
}

// Catálogo público — no requiere token, igual que en el backend.
export const paisesApi = {
  listar: () => apiFetch<{ paises: Pais[] }>("/paises"),
};
