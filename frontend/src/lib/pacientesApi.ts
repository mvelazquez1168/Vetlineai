import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";
import { ClienteParecido, PosibleDuplicado } from "./propietariosApi";

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

export type EstadoPaciente =
  | "activo"
  | "fallecido"
  | "extraviado"
  | "transferido"
  | "baja_otro";

/** Cómo se dice cada estado en pantalla. Un solo lugar. */
export const ETIQUETA_ESTADO_PACIENTE: Record<EstadoPaciente, string> = {
  activo: "Activo",
  fallecido: "Fallecido",
  extraviado: "Extraviado",
  transferido: "Transferido",
  baja_otro: "De baja",
};

export interface PacienteListado {
  id: string;
  numero_expediente: number;
  nombre: string;
  especie: string;
  raza: string | null;
  sexo: string | null;
  estado: EstadoPaciente;
  /** Qué datos básicos le faltan: lo calcula la base (anexo 07-03, A5). */
  datos_basicos_faltantes: string[];
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
  /* Los cinco estados reales desde la migración 111; hasta el anexo
     07-03 el tipo solo conocía dos. */
  estado: EstadoPaciente;
  fecha_fallecimiento: string | null;
  baja_motivo: string | null;
  baja_en: string | null;
  creado_en: string;
  /* Los opcionales del anexo (A5). */
  pelaje: string | null;
  caracter: string | null;
  habitat: string | null;
  tipo_dieta: string | null;
  alimentacion_detalle: string | null;
  pedigri: boolean;
  pedigri_registro: string | null;
  partos: number | null;
  /* Qué datos básicos le faltan a la ficha. Lo calcula la base, no la
     pantalla: lo leen el fichero, la ficha y el expediente. */
  datos_basicos_faltantes: string[];
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
  /* Los opcionales del anexo (A5). */
  pelaje?: string | null;
  caracter?: string | null;
  habitat?: string | null;
  tipoDieta?: string | null;
  alimentacionDetalle?: string | null;
  pedigri?: boolean;
  pedigriRegistro?: string | null;
  partos?: number | null;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export const pacientesApi = {
  listar: (q: string, pagina: number, soloIncompletas = false) => {
    const params = new URLSearchParams({ pagina: String(pagina) });
    if (q) params.set("q", q);
    if (soloIncompletas) params.set("incompletas", "1");
    return authedFetch<{
      pacientes: PacienteListado[];
      total: number;
      pagina: number;
      porPagina: number;
    }>(`/pacientes?${params.toString()}`);
  },

  obtener: (id: string) => authedFetch<FichaCompleta>(`/pacientes/${id}`),

  /**
   * Alta de paciente (anexo 07-03, A5).
   *
   * `propietarioNuevo` crea al dueño en la misma transacción, para el
   * cliente que llega por primera vez con su mascota. Lanza
   * `PosibleDuplicado` igual que el alta de cliente.
   */
  crear: async (
    datos: CamposFichaPaciente & {
      propietarioId?: string;
      propietarioNuevo?: Record<string, unknown>;
    },
    confirmado = false
  ) => {
    const cuerpo = datos.propietarioNuevo
      ? { ...datos, propietarioNuevo: { ...datos.propietarioNuevo, confirmado } }
      : datos;
    try {
      return await authedFetch<{ paciente: PacienteFicha; propietario: { id: string } | null }>(
        "/pacientes",
        { method: "POST", body: JSON.stringify(cuerpo) }
      );
    } catch (err) {
      const datosError = (err as { data?: { codigo?: string; candidatos?: ClienteParecido[] } })?.data;
      if (datosError?.codigo === "POSIBLE_DUPLICADO") {
        throw new PosibleDuplicado(
          (err as Error).message ?? "Ya existe un cliente parecido.",
          datosError.candidatos ?? []
        );
      }
      throw err;
    }
  },

  /** La baja del paciente, con su motivo (anexo 07-03, A5). */
  darDeBaja: (
    id: string,
    datos: { estado: Exclude<EstadoPaciente, "activo">; motivo: string; fecha?: string; fechaFallecimiento?: string }
  ) =>
    authedFetch<{ paciente: PacienteFicha }>(`/pacientes/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify(datos),
    }),

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
