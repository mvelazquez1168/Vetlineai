import { apiFetch } from "./api";

// RUTAS PÚBLICAS: el backend las sirve sin sesión, y acá se declara con
// `publico: true`. Es la excepción del cliente de API (ver `api.ts`):
// toda llamada va autenticada salvo las que lo digan. En una ruta
// pública el token NO se resuelve a propósito, para no mandar al login a
// alguien que está abriendo un enlace sin sesión.

export type RegistroResponse =
  | {
      autoLogin: true;
      access_token: string;
      refresh_token: string;
      expires_in: number;
      nombreClinica: string;
    }
  | { autoLogin: false }
  | { listaEspera: true };

export interface PaisRegistro {
  codigo_iso: string;
  nombre: string;
  estado: "no_disponible" | "lista_espera" | "habilitado";
}

export interface TipoIdentificacionRegistro {
  id: string;
  codigo: string;
  etiqueta: string;
}

export interface AgentePrueba {
  id: string;
  nombre: string;
  descripcion: string;
  icono: string | null;
}

export interface DatosRegistro {
  paisCodigo: string;
  nombreComercial: string;
  tipoPersona: "fisica" | "juridica";
  tipoIdentificacionId?: string;
  numeroIdentificacion?: string;
  nombreFiscal?: string;
  nombreTitular: string;
  email: string;
  telefono?: string;
  password: string;
  esMedico: boolean;
  colegiatura?: string;
  universidadEgreso?: string;
  anioGraduacion?: number;
  correoMedicoInvitado?: string;
  agenteId: string;
}

export const registroApi = {
  listarPaises: () => apiFetch<{ paises: PaisRegistro[] }>("/paises", { publico: true }),

  listarTiposIdentificacion: (paisCodigo: string, tipoPersona: "fisica" | "juridica") =>
    apiFetch<{ tipos: TipoIdentificacionRegistro[] }>(
      `/paises/${paisCodigo}/tipos-identificacion?tipoPersona=${tipoPersona}`,
      { publico: true }
    ),

  listarAgentesPrueba: () => apiFetch<{ agentes: AgentePrueba[] }>("/registro-publico/agentes", { publico: true }),

  registrarListaEspera: (data: { email: string; paisCodigo: string; nombre?: string }) =>
    apiFetch<{ ok: true }>("/registro-publico/lista-espera", {
      publico: true,
      method: "POST",
      body: JSON.stringify(data),
    }),

  registrarClinica: (data: DatosRegistro) =>
    apiFetch<RegistroResponse>("/registro-publico", {
      publico: true,
      method: "POST",
      body: JSON.stringify(data),
    }),
};
