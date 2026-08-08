import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";
import { Propietario } from "./workspaceApi";

export interface PropietarioListado {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  numero_identificacion: string | null;
  tipo_identificacion_etiqueta: string | null;
  cantidad_pacientes: number;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export const propietariosApi = {
  // Fichero de clientes de la clínica — pantalla de listado, distinta del
  // typeahead de 10 resultados que ya usa el wizard de casos/citas
  // (workspaceApi.buscarPropietarios).
  listar: (q: string, pagina: number) => {
    const params = new URLSearchParams({ pagina: String(pagina) });
    if (q) params.set("q", q);
    return authedFetch<{ propietarios: PropietarioListado[]; total: number; pagina: number; porPagina: number }>(
      `/propietarios?${params.toString()}`
    );
  },

  obtener: (id: string) => authedFetch<{ propietario: Propietario }>(`/propietarios/${id}`),

  // nombre/telefono/email/direccion únicamente — la identificación no se
  // acepta acá a propósito (ver backend/src/routes/propietarios.routes.ts).
  actualizar: (
    id: string,
    data: { nombre: string; telefono?: string; email?: string; direccion?: string }
  ) =>
    authedFetch<{ propietario: Propietario }>(`/propietarios/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};
