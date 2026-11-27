import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------
// ADMINISTRACIÓN DE LA CLÍNICA — prompt 04.
//
// Archivo propio y no dentro de `adminApi.ts`, que habla de agentes,
// plan y consumo: eso es la administración de la cuenta de Vetline Ai y
// esto es la administración de la clínica. Son dos cosas distintas y la
// pantalla que las junte va a tener que elegir una de las dos palabras.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

function enviar<T>(path: string, metodo: string, cuerpo?: unknown): Promise<T> {
  return pedir<T>(path, {
    method: metodo,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

export interface PersonaDeLaClinica {
  id: string;
  nombre: string;
  email: string;
  estado: string;
  colegiatura: string | null;
  universidad_egreso: string | null;
  anio_graduacion: number | null;
  roles: string[];
  creado_en: string;
  /** El backend lo devuelve null a propósito: `personas` no lo registra. */
  ultimo_acceso: null;
  /** Para avisar al desactivar: hay citas que alguien tiene que reasignar. */
  citas_futuras: number;
}

export interface RolDeLaClinica {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  pantallaInicio: string | null;
  esClinico: boolean;
  personas: number;
}

export interface PermisoDelCatalogo {
  codigo: string;
  nombre: string;
  modulo: string;
  configurable: boolean;
}

export interface MatrizDeRoles {
  roles: RolDeLaClinica[];
  permisos: PermisoDelCatalogo[];
  /** `rol|permiso` de todo lo concedido, ya resuelto con lo de la clínica. */
  concedidos: string[];
  cambiados: Array<{ rol: string; permiso: string; concedido: boolean }>;
}

export interface PoliticaDeLaClinica {
  clave: string;
  nombre: string;
  descripcion: string;
  tipo: string;
  modulo: string;
  minimo: string | null;
  maximo: string | null;
  valor: string;
  origen: string;
  porRol: Array<{ rol: string; valor: string }>;
  ultimoCambio: { valor_anterior: string | null; cuando: string; quien: string | null } | null;
}

export interface BloqueHorario {
  desde: string;
  hasta: string;
}

export interface DiaDelHorario {
  dia_semana: number;
  bloques: BloqueHorario[];
  abierto: boolean;
}

export interface ExcepcionDelHorario {
  id: string;
  tipo: string;
  nombre: string;
  desde: string;
  hasta: string;
  hora_desde: string | null;
  hora_hasta: string | null;
  bloquea: boolean;
  medico_id: string | null;
  medico_nombre: string | null;
}

export interface TipoDeCita {
  id: string;
  nombre: string;
  duracion_minutos: number;
  color: string | null;
  sala_id: string | null;
  sala_nombre: string | null;
  linea_negocio: string | null;
  servicio_id: string | null;
  servicio_nombre: string | null;
  activo: boolean;
  orden: number;
}

export interface Numeracion {
  documento: string;
  prefijo: string | null;
  siguiente: number;
  digitos: number;
  actualizado_en: string;
}

export interface CambioDePolitica {
  valor_anterior: string | null;
  valor_nuevo: string;
  rol: string | null;
  cambiado_en: string;
  cambiado_por_nombre: string | null;
}

export const clinicaApi = {
  // --- Personas -------------------------------------------------------
  personas: () => pedir<{ personas: PersonaDeLaClinica[] }>("/clinica/personas"),
  guardarRoles: (personaId: string, roles: string[]) =>
    enviar<{ roles: string[] }>(`/clinica/personas/${personaId}/roles`, "PUT", { roles }),
  desactivar: (personaId: string) =>
    enviar<{ estado: string; keycloak: string }>(
      `/clinica/personas/${personaId}/desactivar`,
      "POST"
    ),
  reactivar: (personaId: string, roles: string[]) =>
    enviar<{ estado: string }>(`/clinica/personas/${personaId}/reactivar`, "POST", { roles }),

  // --- Roles y permisos ----------------------------------------------
  roles: () => pedir<MatrizDeRoles>("/clinica/roles"),
  guardarPermisoDeRol: (rol: string, permiso: string, concedido: boolean) =>
    enviar<{ rol: string; permiso: string; concedido: boolean }>(
      "/clinica/roles/permiso",
      "PUT",
      { rol, permiso, concedido }
    ),
  misPermisos: () => pedir<{ roles: string[]; permisos: string[] }>("/clinica/mis-permisos"),

  // --- Políticas ------------------------------------------------------
  politicas: () => pedir<{ politicas: PoliticaDeLaClinica[] }>("/clinica/politicas"),
  guardarPolitica: (clave: string, valor: string, rol?: string | null) =>
    enviar<{ clave: string; valor: string }>("/clinica/politicas", "PUT", { clave, valor, rol }),
  historialDePolitica: (clave: string) =>
    pedir<{ historial: CambioDePolitica[] }>(
      `/clinica/politicas/${encodeURIComponent(clave)}/historial`
    ),

  // --- Horario y excepciones -----------------------------------------
  horario: () =>
    pedir<{ horario: DiaDelHorario[]; excepciones: ExcepcionDelHorario[] }>("/clinica/horario"),
  guardarDia: (dia: number, bloques: BloqueHorario[], abierto: boolean) =>
    enviar<{ horario: DiaDelHorario[] }>(`/clinica/horario/${dia}`, "PUT", { bloques, abierto }),
  guardarExcepcion: (datos: {
    id?: string;
    tipo: string;
    nombre: string;
    desde: string;
    hasta?: string;
    horaDesde?: string | null;
    horaHasta?: string | null;
    medicoId?: string | null;
    bloquea?: boolean;
  }) => enviar<{ id: string }>("/clinica/excepciones", "POST", datos),
  borrarExcepcion: (id: string) => enviar<{ borrada: boolean }>(`/clinica/excepciones/${id}`, "DELETE"),

  // --- Tipos de cita --------------------------------------------------
  tiposDeCita: (todos = false) =>
    pedir<{ tipos: TipoDeCita[] }>(`/clinica/tipos-cita${todos ? "?todos=1" : ""}`),
  guardarTipoDeCita: (datos: {
    id?: string;
    nombre: string;
    duracionMinutos: number;
    color?: string | null;
    salaId?: string | null;
    lineaNegocio?: string | null;
    servicioId?: string | null;
    activo?: boolean;
    orden?: number;
  }) => enviar<{ id: string }>("/clinica/tipos-cita", "POST", datos),
  desactivarTipoDeCita: (id: string) =>
    enviar<{ desactivado: boolean }>(`/clinica/tipos-cita/${id}`, "DELETE"),

  // --- Numeraciones ---------------------------------------------------
  numeraciones: () => pedir<{ numeraciones: Numeracion[] }>("/clinica/numeraciones"),
  guardarNumeracion: (documento: string, prefijo: string | null, digitos: number) =>
    enviar<{ numeraciones: Numeracion[] }>(`/clinica/numeraciones/${documento}`, "PUT", {
      prefijo,
      digitos,
    }),
};
