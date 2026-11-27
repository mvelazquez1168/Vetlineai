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


/** Un cliente que ya existe y se parece al que se está por crear (A5). */
export interface ClienteParecido {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  numeroIdentificacion: string | null;
  criterios: Array<"identificacion" | "telefono" | "correo" | "nombre">;
  puntaje: number;
  pacientes: number;
}

/**
 * El 409 del alta cuando hay un cliente parecido.
 *
 * No es un error de validación: es una pregunta. La pantalla muestra los
 * candidatos y deja elegir entre usar el que existe o crear igual con
 * `confirmado: true`.
 */
export class PosibleDuplicado extends Error {
  constructor(
    mensaje: string,
    public readonly candidatos: ClienteParecido[]
  ) {
    super(mensaje);
    this.name = "PosibleDuplicado";
  }
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

  /**
   * Alta de cliente desde el fichero (anexo 07-03, A5).
   *
   * Lanza `PosibleDuplicado` cuando ya hay alguien con la misma
   * identificación o el mismo teléfono, para que la pantalla ofrezca
   * usar el que existe en vez de crear el duplicado que después habría
   * que unificar.
   */
  crear: async (datos: Record<string, unknown>, confirmado = false) => {
    try {
      return await authedFetch<{ propietario: Propietario }>("/propietarios", {
        method: "POST",
        body: JSON.stringify({ ...datos, confirmado }),
      });
    } catch (err) {
      // `ApiError.data` es el cuerpo completo de la respuesta: ahí
      // viajan el código y los candidatos.
      const cuerpo = (err as { data?: { codigo?: string; candidatos?: ClienteParecido[] } })?.data;
      if (cuerpo?.codigo === "POSIBLE_DUPLICADO") {
        throw new PosibleDuplicado(
          (err as Error).message ?? "Ya existe un cliente parecido.",
          cuerpo.candidatos ?? []
        );
      }
      throw err;
    }
  },

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
