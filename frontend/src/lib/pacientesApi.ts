import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 3.3 — la ficha del paciente y su listado.
//
// Distinto de `workspaceApi.listarPacientes`, que sigue existiendo para
// el typeahead del wizard de casos (devuelve TODOS los pacientes, sin
// paginar, y solo para rol médico). Este es el equivalente de
// `propietariosApi`: pantalla de listado paginada + ficha, para médico y
// admin de clínica.
// ---------------------------------------------------------------------

export type SexoPaciente = "macho" | "hembra";
export type EstadoReproductivo = "entero" | "castrado" | "desconocido";

export interface PacienteListado {
  id: string;
  numero_expediente: number;
  nombre: string;
  especie: string;
  raza: string | null;
  sexo: string | null;
  estado: "activo" | "fallecido";
  /** Edad ya resuelta por el backend (nunca se calcula en el cliente). */
  edad_anios: number | null;
  fecha_nacimiento: string | null;
  fecha_nacimiento_estimada: boolean;
  propietario_id: string;
  propietario_nombre: string;
}

export interface PacienteFicha {
  id: string;
  numero_expediente: number;
  nombre: string;
  especie: string;
  raza_id: string | null;
  raza: string | null;
  sexo: string | null;
  estado_reproductivo: EstadoReproductivo;
  fecha_nacimiento: string | null;
  fecha_nacimiento_estimada: boolean;
  edad_anios: number | null;
  microchip: string | null;
  color: string | null;
  alergias: string | null;
  alerta_manejo: string | null;
  estado: "activo" | "fallecido";
  fecha_fallecimiento: string | null;
  creado_en: string;
  propietario_id: string;
  propietario_nombre: string;
  propietario_telefono: string | null;
  propietario_email: string | null;
  propietario_direccion: string | null;
  propietario_numero_identificacion: string | null;
  propietario_tipo_identificacion_etiqueta: string | null;
}

export interface CuidadoPreventivoFicha {
  id: string;
  tipo: "vacunacion" | "desparasitacion";
  fecha_aplicacion: string;
  fecha_proxima_recomendada: string;
  vacuna: string | null;
  lote: string | null;
  subtipo_desparasitacion: string | null;
  producto_desparasitacion: string | null;
  registrado_por_nombre: string;
}

export interface AtencionFicha {
  id: string;
  cita_id: string;
  caso_id: string | null;
  fecha: string;
  hora_inicio: string;
  nota_medica: string | null;
  peso: string | null;
  temperatura: string | null;
  medico_nombre: string;
}

export interface CasoFicha {
  id: string;
  numero_expediente: number;
  motivo: string;
  estado: string;
  severidad: string;
  creado_en: string;
  cerrado_en: string | null;
  diagnostico_final: string | null;
  desenlace: string | null;
  tratamiento_activo: boolean | null;
  agente_nombre: string;
  medico_nombre: string;
}

export interface RecetaFicha {
  id: string;
  emitido_en: string;
  caso_id: string | null;
  con_visita: boolean;
  medico_nombre: string;
  medicamentos: string | null;
}

export interface FichaCompleta {
  paciente: PacienteFicha;
  cuidadosPreventivos: CuidadoPreventivoFicha[];
  atenciones: AtencionFicha[];
  casos: CasoFicha[];
  recetas: RecetaFicha[];
}

export type TipoEventoCronologia =
  | "atencion"
  | "caso_apertura"
  | "caso_cierre"
  | "vacunacion"
  | "desparasitacion"
  | "receta";

export interface EventoCronologiaPaciente {
  tipo: TipoEventoCronologia;
  /** Día calendario ya resuelto en la zona horaria del tenant, por el backend. */
  fecha: string;
  momento: string;
  titulo: string;
  medico_nombre: string | null;
  detalle: string | null;
  referencia_id: string;
  caso_id: string | null;
}

export interface CamposFichaPaciente {
  nombre: string;
  especie: string;
  razaId?: string | null;
  sexo?: SexoPaciente | null;
  estadoReproductivo?: EstadoReproductivo;
  fechaNacimiento?: string | null;
  edadAproximadaAnios?: number | null;
  microchip?: string | null;
  color?: string | null;
  alergias?: string | null;
  alertaManejo?: string | null;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export const pacientesApi = {
  listar: (q: string, pagina: number) => {
    const params = new URLSearchParams({ pagina: String(pagina) });
    if (q) params.set("q", q);
    return authedFetch<{
      pacientes: PacienteListado[];
      total: number;
      pagina: number;
      porPagina: number;
    }>(`/pacientes?${params.toString()}`);
  },

  obtener: (id: string) => authedFetch<FichaCompleta>(`/pacientes/${id}`),

  cronologia: (id: string) =>
    authedFetch<{ eventos: EventoCronologiaPaciente[] }>(`/pacientes/${id}/cronologia`),

  // Reemplazo COMPLETO: un campo que no se manda queda vacío. Mismo
  // criterio que el PATCH de propietarios.
  actualizar: (id: string, data: CamposFichaPaciente) =>
    authedFetch<{ paciente: PacienteFicha }>(`/pacientes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};
