import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

export interface Raza {
  id: string;
  nombre: string;
}

// A diferencia de paisesApi (catálogo público), razas solo se usa desde
// el workspace clínico autenticado — mismo gate que /api/pacientes.
export const razasApi = {
  listar: (especie: "canina" | "felina") =>
    apiFetch<{ razas: Raza[] }>(`/razas?especie=${especie}`, { token: getStoredToken() }),
};
