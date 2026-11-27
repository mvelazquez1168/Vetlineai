import { getStoredToken } from "../hooks/useAuth";
import { adminApi } from "./adminApi";
import { apiFetch } from "./api";

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

// =====================================================================
// Salas
// =====================================================================

export interface Sala {
  id: string;
  tenant_id: string;
  nombre: string;
  tipo: string | null;
  activa: boolean;
  creado_en: string;
}

// =====================================================================
// Horarios (configuración semanal por médico)
// =====================================================================

export type TipoBloqueHorario = "disponible" | "almuerzo" | "bloqueado";

export interface BloqueHorario {
  hora_inicio: string;
  hora_fin: string;
  tipo: TipoBloqueHorario;
  etiqueta?: string | null;
}

export interface HorarioConfiguracion {
  id: string;
  tenant_id: string;
  medico_id: string;
  medico_nombre: string;
  dia_semana: number; // 0=domingo … 6=sábado, igual que Postgres EXTRACT(DOW) y JS Date.getDay()
  bloques: BloqueHorario[];
  activo: boolean;
  max_citas_dia: number | null;
  duracion_default_minutos: number;
  buffer_minutos: number;
  acepta_emergencias: boolean;
}

export interface DiaConfigInput {
  diaSemana: number;
  bloques: BloqueHorario[];
  activo?: boolean;
  maxCitasDia?: number | null;
  duracionDefaultMinutos?: number;
  bufferMinutos?: number;
  aceptaEmergencias?: boolean;
}

// =====================================================================
// Citas
// =====================================================================

export type EstadoCita =
  | "programada"
  | "confirmada"
  | "registrada"
  | "en_consulta"
  | "completada"
  | "cancelada"
  | "no_show";

export type PrioridadCita = "baja" | "normal" | "alta" | "emergencia";

export interface Cita {
  id: string;
  tenant_id: string;
  sala_id: string | null;
  paciente_id: string;
  medico_id: string;
  fecha: string; // YYYY-MM-DD
  hora_inicio: string; // HH:MM:SS
  hora_fin: string; // HH:MM:SS
  duracion_minutos: number;
  prioridad: PrioridadCita;
  motivo_consulta: string | null;
  estado: EstadoCita;
  motivo_cancelacion: string | null;
  caso_id: string | null;
  creado_en: string;
  actualizado_en: string;
  // Solo presentes en GET /citas (joins)
  paciente_nombre?: string;
  especie?: string;
  propietario_id?: string;
  propietario_nombre?: string;
  medico_nombre?: string;
  sala_nombre?: string | null;
}

export interface ConflictoCita {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  medico_id: string;
  sala_id: string | null;
  estado: EstadoCita;
  paciente_nombre: string;
  medico_nombre: string;
  sala_nombre: string | null;
}

export interface CrearCitaInput {
  pacienteId: string;
  medicoId: string;
  salaId?: string | null;
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  prioridad?: PrioridadCita;
  motivoConsulta?: string;
  // prompt: vincular caso↔cita — rama "crear cita ahora" del wizard "Nuevo
  // Caso": la cita nace ya vinculada al caso recién creado.
  casoId?: string | null;
  /** De qué tipo es: trae su duración y su color (prompt 04, §3). */
  tipoCitaId?: string | null;
  /**
   * CITAR FUERA DEL HORARIO, con su motivo (prompt 04, §3).
   *
   * Solo se manda después de que el backend contestó 409: es la
   * respuesta a «esa hora está fuera del horario, ¿la agendás igual?».
   * Quien no tenga el permiso `agenda.fuera_de_horario` recibe 403 aunque
   * lo mande.
   */
  forzarFueraDeHorario?: { motivo: string };
}

/**
 * El 409 de la agenda: la hora está fuera del horario o sobre un
 * bloqueo. No es un error: es una pregunta con los datos para
 * contestarla.
 */
export interface FueraDeHorario {
  error: string;
  fueraDeHorario: true;
  nivel?: "clinica" | "excepcion" | "medico";
  bloquesDelDia?: Array<{ desde: string; hasta: string }>;
  puedeForzar?: boolean;
}

/** Si una respuesta de error es el 409 del horario. */
export function esFueraDeHorario(data: unknown): data is FueraDeHorario {
  return typeof data === "object" && data !== null && "fueraDeHorario" in data;
}

const ESTADO_LABEL: Record<EstadoCita, string> = {
  programada: "Programada",
  confirmada: "Confirmada",
  registrada: "En sala de espera",
  en_consulta: "En consulta",
  completada: "Completada",
  cancelada: "Cancelada",
  no_show: "No-show",
};

export function etiquetaEstadoCita(estado: EstadoCita): string {
  return ESTADO_LABEL[estado] ?? estado;
}

// Transiciones válidas — reflejo exacto de TRANSICIONES_VALIDAS en
// citas.routes.ts, para no ofrecer en la UI un cambio que el backend va
// a rechazar igual. Los tres "completada" agregados en programada/
// confirmada/registrada existen para que "Registrar atención" pueda
// completar la cita de un walk-in sin pasar por cada estado intermedio.
const TRANSICIONES_VALIDAS: Record<EstadoCita, EstadoCita[]> = {
  programada: ["confirmada", "cancelada", "no_show", "completada"],
  confirmada: ["registrada", "cancelada", "no_show", "completada"],
  registrada: ["en_consulta", "cancelada", "completada"],
  en_consulta: ["completada", "cancelada"],
  completada: [],
  cancelada: [],
  no_show: [],
};

export function transicionesValidas(estado: EstadoCita): EstadoCita[] {
  return TRANSICIONES_VALIDAS[estado] ?? [];
}

// =====================================================================
// Lista de espera
// =====================================================================

export type PrioridadListaEspera = "baja" | "media" | "alta";
export type EstadoListaEspera = "pendiente" | "agendada" | "cancelada";

export interface ItemListaEspera {
  id: string;
  tenant_id: string;
  paciente_id: string;
  paciente_nombre: string;
  especie: string;
  propietario_nombre: string;
  medico_preferido_id: string | null;
  medico_preferido_nombre: string | null;
  motivo: string;
  prioridad: PrioridadListaEspera;
  fecha_solicitud: string; // YYYY-MM-DD
  estado: EstadoListaEspera;
  cita_id: string | null;
  creado_en: string;
}

// =====================================================================
// Agregados de Agenda (Centro de Comando, Conflictos, Analíticas)
// =====================================================================

export interface CargaTrabajoMedico {
  medicoId: string;
  medicoNombre: string;
  citasHoy: number;
  capacidadMaxima: number;
  porcentaje: number;
}

export interface CentroComando {
  fecha: string;
  conteos: {
    total: number;
    enSalaEspera: number;
    enProgreso: number;
    completadas: number;
    noShowsCanceladas: number;
  };
  duracionPromedioMinutos: number | null;
  flujoClinico: Cita[];
  colaProximos: Cita[];
  alertasNoShow: { id: string; hora_inicio: string; paciente_nombre: string; medico_nombre: string }[];
  cargaTrabajo: CargaTrabajoMedico[];
}

export interface ParConflicto {
  cita_a_id: string;
  a_hora_inicio: string;
  a_hora_fin: string;
  a_paciente_nombre: string;
  a_medico_nombre: string;
  a_sala_nombre: string | null;
  cita_b_id: string;
  b_hora_inicio: string;
  b_hora_fin: string;
  b_paciente_nombre: string;
  b_medico_nombre: string;
  b_sala_nombre: string | null;
  tipo: "medico" | "sala";
}

export interface AnaliticasAgenda {
  totalCitas: number;
  totalCitasRangoAnterior: number;
  variacionPorcentaje: number | null;
  tasaNoShowPorcentaje: number;
  duracionPromedioMinutos: number | null;
  motivosCancelacion: { motivo: string; cantidad: number }[];
}

// =====================================================================
// Médico ligero — id + nombre, para selectores/filtros/leyenda de color.
// No existe un endpoint de "listar médicos" accesible a rol medico (solo
// GET /admin/medicos, que es admin_clinica-only), así que se deriva de
// GET /horarios (accesible a ambos roles) más el usuario actual, en vez
// de tocar permisos de backend fuera del alcance de este prompt.
// =====================================================================

export interface MedicoLigero {
  id: string;
  nombre: string;
}

export async function listarMedicosLigero(
  esAdminClinica: boolean,
  usuarioActual: { id: string; nombre: string } | null
): Promise<MedicoLigero[]> {
  const mapa = new Map<string, string>();

  if (esAdminClinica) {
    const { medicos } = await adminApi.listarMedicos();
    for (const m of medicos) {
      if (m.estado === "activo") mapa.set(m.id, m.nombre);
    }
  } else {
    const { horarios } = await horariosApi.listar();
    for (const h of horarios) {
      mapa.set(h.medico_id, h.medico_nombre);
    }
  }

  if (usuarioActual && !mapa.has(usuarioActual.id)) {
    mapa.set(usuarioActual.id, usuarioActual.nombre);
  }

  return Array.from(mapa.entries())
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// =====================================================================
// Cliente API
// =====================================================================

export const salasApi = {
  listar: () => authedFetch<{ salas: Sala[] }>("/salas"),
  crear: (data: { nombre: string; tipo?: string }) =>
    authedFetch<{ sala: Sala }>("/salas", { method: "POST", body: JSON.stringify(data) }),
  editar: (id: string, data: { nombre: string; tipo?: string }) =>
    authedFetch<{ sala: Sala }>(`/salas/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  desactivar: (id: string) =>
    authedFetch<{ sala: Sala }>(`/salas/${id}/desactivar`, { method: "PATCH" }),
};

export const horariosApi = {
  listar: (medicoId?: string) =>
    authedFetch<{ horarios: HorarioConfiguracion[] }>(
      medicoId ? `/horarios?medicoId=${encodeURIComponent(medicoId)}` : "/horarios"
    ),
  guardar: (medicoId: string, dias: DiaConfigInput[]) =>
    authedFetch<{ horarios: HorarioConfiguracion[] }>("/horarios", {
      method: "PUT",
      body: JSON.stringify({ medicoId, dias }),
    }),
};

// pg-node serializa las columnas DATE como timestamp ISO completo
// ("2026-08-05T00:00:00.000Z"), no como "2026-08-05" — cualquier
// comparación de string contra una fecha construida a mano (ej. en la
// grilla del Calendario) fallaba silenciosamente por esto. Se normaliza
// acá, en el único punto de entrada de estos datos al frontend, para que
// el resto de la app pueda tratar `fecha`/`fecha_solicitud` siempre como
// "YYYY-MM-DD" puro.
function soloFecha(valor: string): string {
  return valor.slice(0, 10);
}
function normalizarCita(c: Cita): Cita {
  // Las filas de /centro-comando (flujoClinico/colaProximos) no
  // seleccionan c.fecha en el SELECT del backend — solo trae fecha real
  // GET /citas y las respuestas de crear/editar/agendar. Sin este chequeo,
  // esas filas rompían con "Cannot read properties of undefined".
  return typeof c.fecha === "string" ? { ...c, fecha: soloFecha(c.fecha) } : c;
}
function normalizarItem(i: ItemListaEspera): ItemListaEspera {
  return { ...i, fecha_solicitud: soloFecha(i.fecha_solicitud) };
}

export const citasApi = {
  listar: async (filtros: { desde?: string; hasta?: string; medicoId?: string; estado?: EstadoCita }) => {
    const params = new URLSearchParams();
    if (filtros.desde) params.set("desde", filtros.desde);
    if (filtros.hasta) params.set("hasta", filtros.hasta);
    if (filtros.medicoId) params.set("medico_id", filtros.medicoId);
    if (filtros.estado) params.set("estado", filtros.estado);
    const qs = params.toString();
    const data = await authedFetch<{ citas: Cita[] }>(`/citas${qs ? `?${qs}` : ""}`);
    return { citas: data.citas.map(normalizarCita) };
  },
  crear: async (data: CrearCitaInput) => {
    const r = await authedFetch<{ cita: Cita; conflictos: ConflictoCita[] }>("/citas", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { ...r, cita: normalizarCita(r.cita) };
  },
  editar: async (id: string, data: CrearCitaInput) => {
    const r = await authedFetch<{ cita: Cita; conflictos: ConflictoCita[] }>(`/citas/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return { ...r, cita: normalizarCita(r.cita) };
  },
  cambiarEstado: async (id: string, estado: EstadoCita, motivoCancelacion?: string) => {
    const r = await authedFetch<{ cita: Cita }>(`/citas/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ estado, motivoCancelacion }),
    });
    return { cita: normalizarCita(r.cita) };
  },
  borrar: (id: string) => authedFetch<void>(`/citas/${id}`, { method: "DELETE" }),
  // prompt_code_registro_atencion.md, Paso 6 — ligar una cita de hoy ya
  // agendada (sin caso) al caso desde el que se abrió el Registro de
  // Atención. Nunca pisa un vínculo existente (ver PATCH /citas/:id/caso).
  vincularCaso: (id: string, casoId: string) =>
    authedFetch<{ cita: { id: string; caso_id: string | null } }>(`/citas/${id}/caso`, {
      method: "PATCH",
      body: JSON.stringify({ casoId }),
    }),
};

export const listaEsperaApi = {
  listar: async (filtros: { prioridad?: PrioridadListaEspera; especie?: string }) => {
    const params = new URLSearchParams();
    if (filtros.prioridad) params.set("prioridad", filtros.prioridad);
    if (filtros.especie) params.set("especie", filtros.especie);
    const qs = params.toString();
    const data = await authedFetch<{ listaEspera: ItemListaEspera[] }>(`/lista-espera${qs ? `?${qs}` : ""}`);
    return { listaEspera: data.listaEspera.map(normalizarItem) };
  },
  crear: async (data: {
    pacienteId: string;
    medicoPreferidoId?: string;
    motivo: string;
    prioridad?: PrioridadListaEspera;
    fechaSolicitud?: string;
  }) => {
    const r = await authedFetch<{ item: ItemListaEspera }>("/lista-espera", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { item: normalizarItem(r.item) };
  },
  editar: async (
    id: string,
    data: { medicoPreferidoId?: string; motivo: string; prioridad?: PrioridadListaEspera; fechaSolicitud?: string }
  ) => {
    const r = await authedFetch<{ item: ItemListaEspera }>(`/lista-espera/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return { item: normalizarItem(r.item) };
  },
  cambiarEstado: async (id: string, estado: EstadoListaEspera) => {
    const r = await authedFetch<{ item: ItemListaEspera }>(`/lista-espera/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ estado }),
    });
    return { item: normalizarItem(r.item) };
  },
  agendar: async (id: string, data: CrearCitaInput) => {
    const r = await authedFetch<{ cita: Cita; conflictos: ConflictoCita[]; item: ItemListaEspera }>(
      `/lista-espera/${id}/agendar`,
      { method: "POST", body: JSON.stringify(data) }
    );
    return { ...r, cita: normalizarCita(r.cita), item: normalizarItem(r.item) };
  },
};

export const agendaApi = {
  centroComando: async (fecha?: string) => {
    const data = await authedFetch<CentroComando>(`/centro-comando${fecha ? `?fecha=${fecha}` : ""}`);
    return {
      ...data,
      flujoClinico: data.flujoClinico.map(normalizarCita),
      colaProximos: data.colaProximos.map(normalizarCita),
    };
  },
  conflictos: (fecha?: string) =>
    authedFetch<{ fecha: string; conflictos: ParConflicto[] }>(`/conflictos${fecha ? `?fecha=${fecha}` : ""}`),
  analiticas: (desde: string, hasta: string) =>
    authedFetch<AnaliticasAgenda>(`/analiticas?desde=${desde}&hasta=${hasta}`),
};
