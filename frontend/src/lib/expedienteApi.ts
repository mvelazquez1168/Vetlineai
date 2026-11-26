import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------
// Cliente de la API del expediente clínico (prompt 07, bloque A).
//
// Mismo criterio que `inventarioApi` y `ventasApi`: tipos y llamadas,
// nada de lógica. La franja de alertas, la completitud, las banderas de
// laboratorio y la ficha racial las calcula el backend — si la pantalla
// las recalculara, el PDF y la pantalla podrían decir distinto.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}
function json<T>(path: string, metodo: string, cuerpo: unknown): Promise<T> {
  return pedir<T>(path, { method: metodo, body: JSON.stringify(cuerpo) });
}

export interface AlertaExpediente {
  tipo: "alergia" | "manejo" | "cronico" | "preventivo" | "saldo" | "hallazgo" | "estudio";
  severidad: "alta" | "media" | "baja";
  texto: string;
  detalle?: string;
}

export interface Problema {
  id: string;
  descripcion: string;
  estado: "activo" | "cronico" | "resuelto";
  fecha_inicio: string;
  fecha_resolucion: string | null;
  nota: string | null;
  atenciones: number;
}

export interface Alergia {
  id: string;
  tipo: string;
  sustancia: string;
  grupo: string | null;
  severidad: string;
  reaccion: string | null;
  nota: string | null;
  medicamento_nombre: string | null;
}

export interface EncabezadoExpediente {
  paciente: Record<string, string | number | boolean | null>;
  cliente: Record<string, string | null> | null;
  alertas: AlertaExpediente[];
  problemas: Problema[];
  alergias: Alergia[];
  medicacionActiva: Array<{
    receta_id: string;
    medicamento: string;
    dosis: string | null;
    frecuencia: string | null;
    duracion: string | null;
    fecha_fin: string | null;
    duracionEstructurada: boolean;
  }>;
  completitud: { porcentaje: number; faltan: string[] };
  pesoActual: number | null;
}

export interface EventoHistoria {
  tipo: string;
  fecha: string;
  titulo: string;
  detalle: string | null;
  medico: string | null;
  referencia_id: string;
}

export interface EstudioLab {
  id: string;
  tipo_estudio: string;
  estado: string;
  es_externo: boolean;
  laboratorio: string | null;
  fecha_solicitud: string;
  fecha_resultado: string | null;
  observaciones: string | null;
  solicitado_por_nombre: string | null;
  visto_en: string | null;
  archivo_id: string | null;
  resultados: Array<{
    analito: string;
    valor: number | string | null;
    valor_texto: string | null;
    unidad: string | null;
    ref_min: number | null;
    ref_max: number | null;
    bandera: "alto" | "bajo" | "normal" | null;
  }>;
}

export interface Tendencia {
  codigo: string;
  nombre: string | null;
  unidad: string | null;
  refMin: number | null;
  refMax: number | null;
  puntos: Array<{ fecha: string; valor: number; bandera: string | null; estudioId: string }>;
}

export interface GroomingRegistro {
  id: string;
  fecha: string;
  groomer_nombre: string | null;
  tipo_corte: string | null;
  comportamiento: string | null;
  observaciones: string | null;
  servicios: string[];
  hallazgos: Array<{ id: string; tipo: string; descripcion: string; atendido_en: string | null }>;
}

export interface FichaRacial {
  raza: string | null;
  especie: string;
  texto: string | null;
  coincidio: boolean;
  seccionAgrupada: boolean;
  motivo: string | null;
}

export const expedienteApi = {
  encabezado: (pacienteId: string) =>
    pedir<EncabezadoExpediente>(`/expediente/pacientes/${pacienteId}`),

  lineaDeTiempo: (pacienteId: string, filtros: Record<string, string> = {}) =>
    pedir<{ eventos: EventoHistoria[] }>(
      `/expediente/pacientes/${pacienteId}/linea-de-tiempo?${new URLSearchParams(filtros)}`
    ),

  buscar: (pacienteId: string, q: string) =>
    pedir<{
      coincidencias: Array<{
        tipo: string;
        fecha: string;
        donde: string;
        fragmento: string;
        referencia_id: string;
      }>;
    }>(`/expediente/pacientes/${pacienteId}/buscar?q=${encodeURIComponent(q)}`),

  evolucion: (pacienteId: string) =>
    pedir<{
      puntos: Array<{ fecha: string; peso: string | null; temperatura: string | null; medico: string | null }>;
    }>(`/expediente/pacientes/${pacienteId}/evolucion`),

  fichaRacial: (pacienteId: string) =>
    pedir<FichaRacial>(`/expediente/pacientes/${pacienteId}/ficha-racial`),

  problemas: (pacienteId: string) =>
    pedir<{ problemas: Problema[] }>(`/expediente/pacientes/${pacienteId}/problemas`),
  agregarProblema: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/pacientes/${pacienteId}/problemas`, "POST", d),
  cambiarProblema: (problemaId: string, d: Record<string, unknown>) =>
    json<{ ok: true }>(`/expediente/problemas/${problemaId}`, "PUT", d),

  alergias: (pacienteId: string) =>
    pedir<{ alergias: Alergia[] }>(`/expediente/pacientes/${pacienteId}/alergias`),
  registrarAlergia: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/pacientes/${pacienteId}/alergias`, "POST", d),
  /** ¿Es alérgico a esto? Se consulta ANTES de confirmar una receta. */
  avisosDeAlergia: (pacienteId: string, farmaco: Record<string, string>) =>
    pedir<{ avisos: Array<{ alergia: Alergia; porque: string }> }>(
      `/expediente/pacientes/${pacienteId}/avisos-alergia?${new URLSearchParams(farmaco)}`
    ),

  adendas: (atencionId: string) =>
    pedir<{
      adendas: Array<{
        id: string;
        motivo: string;
        texto: string;
        autor_nombre: string | null;
        creado_en: string;
      }>;
    }>(`/expediente/atenciones/${atencionId}/adendas`),
  agregarAdenda: (atencionId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/atenciones/${atencionId}/adendas`, "POST", d),
  cerrarAtencion: (atencionId: string) =>
    json<{ ok: true }>(`/expediente/atenciones/${atencionId}/cerrar`, "POST", {}),

  laboratorio: (pacienteId: string) =>
    pedir<{
      estudios: EstudioLab[];
      analitos: Array<{ codigo: string; nombre: string; unidad: string; mediciones: number }>;
    }>(`/expediente/pacientes/${pacienteId}/laboratorio`),
  tendencia: (pacienteId: string, codigo: string) =>
    pedir<Tendencia>(`/expediente/pacientes/${pacienteId}/laboratorio/tendencia/${codigo}`),
  solicitarEstudio: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/pacientes/${pacienteId}/laboratorio`, "POST", d),
  cargarResultados: (estudioId: string, d: Record<string, unknown>) =>
    json<{ cargados: number; conBandera: number }>(
      `/expediente/laboratorio/${estudioId}/resultados`,
      "POST",
      d
    ),
  marcarVisto: (estudioId: string) =>
    json<{ ok: true }>(`/expediente/laboratorio/${estudioId}/visto`, "POST", {}),
  estudiosSinVer: () =>
    pedir<{
      estudios: Array<{
        id: string;
        tipo_estudio: string;
        fecha_resultado: string;
        paciente: string;
        paciente_id: string;
        alterados: number;
      }>;
    }>("/expediente/laboratorio/sin-ver"),

  grooming: (pacienteId: string) =>
    pedir<{ grooming: GroomingRegistro[] }>(`/expediente/pacientes/${pacienteId}/grooming`),
  registrarGrooming: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string; hallazgos: number }>(
      `/expediente/pacientes/${pacienteId}/grooming`,
      "POST",
      d
    ),
  atenderHallazgo: (hallazgoId: string, d: Record<string, unknown> = {}) =>
    json<{ ok: true }>(`/expediente/grooming/hallazgos/${hallazgoId}/atender`, "POST", d),

  plantillasConsentimiento: () =>
    pedir<{
      plantillas: Array<{ id: string; tipo: string; titulo: string; cuerpo: string; activo: boolean }>;
    }>("/expediente/consentimientos/plantillas"),
  sembrarPlantillasBase: () =>
    json<{ creadas: number }>("/expediente/consentimientos/plantillas/base", "POST", {}),
  prepararConsentimiento: (pacienteId: string, plantillaId: string, procedimiento = "") =>
    pedir<{ titulo: string; texto: string; firmanteSugerido: string; identificacion: string | null }>(
      `/expediente/pacientes/${pacienteId}/consentimientos/preparar?plantilla=${plantillaId}&procedimiento=${encodeURIComponent(procedimiento)}`
    ),
  consentimientos: (pacienteId: string) =>
    pedir<{
      consentimientos: Array<{
        id: string;
        titulo: string;
        firmante_nombre: string;
        firmante_identificacion: string | null;
        firmado_en: string;
        testigo: string | null;
      }>;
    }>(`/expediente/pacientes/${pacienteId}/consentimientos`),
  firmarConsentimiento: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/pacientes/${pacienteId}/consentimientos`, "POST", d),
};
