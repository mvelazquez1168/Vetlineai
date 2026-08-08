import { apiFetch, apiFetchBlob, apiFetchFile } from "./api";
import { getStoredToken } from "../hooks/useAuth";

export interface AgenteResumen {
  id: string;
  nombre: string;
  descripcion: string;
  icono: string;
  estado_catalogo: "disponible" | "proximamente";
  rol: "general" | "especialista";
  casos_activos: number;
}

export interface CasoResumen {
  id: string;
  motivo: string;
  estado: "triage" | "en_curso" | "completado";
  severidad: string;
  confianza_diagnostica: number | null;
  creado_en: string;
  numero_expediente: number;
  paciente_nombre: string;
  especie: string;
  raza: string;
}

// Archivo tal como viaja adjunto a un mensaje ya enviado (join real vía
// archivos.mensaje_id, no algo embebido en `contenido`).
export interface ArchivoDeMensaje {
  id: string;
  nombre_archivo: string;
  tipo: string;
}

// Motor de crédito — motivos estructurados de rechazo que puede traer un
// 402 al enviar un mensaje, actualizar el dashboard o generar un informe.
// Mismo enum que MotivoRechazoGeneracion en backend/src/tarifas.ts.
export type MotivoRechazoGeneracion =
  | "sin_saldo"
  | "colchon_agotado"
  | "agente_no_habilitado"
  | "agente_en_mantenimiento"
  | "suscripcion_finalizada"
  | "fuera_de_ventana";

// Cuerpo de un 402 en cualquiera de los 3 endpoints que invocan al
// modelo — `motivo` está ausente solo en el camino heredado
// (debeBloquearseMensaje, límite de uso viejo, ver memoria del proyecto).
export interface RechazoGeneracion {
  error: string;
  motivo?: MotivoRechazoGeneracion;
  mensaje?: Mensaje;
}

// GET /workspace/consumo — una sola llamada con todo lo que necesita la
// barra de consumo de prueba + los avisos de saldo. `prueba` viene
// poblado solo cuando estadoSuscripcion==='prueba'; `aviso` es el más
// severo entre los vigentes (colchon_agotado > saldo_agotado >
// saldo_bajo), o null si no hay ninguno. Ni el umbral del 80% ni el
// contenido de los avisos se calculan acá — ambos ya vienen resueltos
// del backend (usoIa.ts).
export interface ConsumoWorkspace {
  estadoSuscripcion: string;
  prueba: { creditoRestanteUsd: number; diasRestantes: number; umbralAlcanzado: boolean } | null;
  aviso: { umbral: "saldo_bajo" | "saldo_agotado" | "colchon_agotado"; mensaje: string } | null;
}

// Anotar vs consultar — "informacion" son bloques que el médico registró
// sin invocar al agente (ver "Agregar información" en el área de trabajo);
// "consulta"/"respuesta" son el hilo de diálogo de siempre.
export type TipoMensaje = "consulta" | "informacion" | "respuesta";

export interface Mensaje {
  id: string;
  remitente: "medico" | "ai";
  contenido: string;
  tipo: TipoMensaje;
  creado_en: string;
  archivos: ArchivoDeMensaje[];
}

export interface Archivo {
  id: string;
  nombre_archivo: string;
  tipo: string;
  url: string;
  creado_en: string;
}

export interface CasoDetalle {
  id: string;
  motivo: string;
  estado: string;
  severidad: string;
  confianza_diagnostica: number | null;
  creado_en: string;
  numero_expediente: number;
  paciente_id: string;
  paciente_nombre: string;
  especie: string;
  raza: string;
  sexo: string;
  edad_anios: number | null;
  fecha_nacimiento: string | null;
  paciente_estado: "activo" | "fallecido";
  propietario_id: string;
  propietario_nombre: string;
  // true si el agente del caso tiene system_prompt cargado — mismo
  // criterio de branching que usa el backend en todos lados. Solo esos
  // casos pueblan dashboard_cache (migración 015); se usa para no mostrar
  // el estado "sin_datos" del Dashboard en casos cuyo agente es un stub
  // sin integración real (hoy: Urología), que nunca lo van a tener.
  // Renombrado desde `es_gcis` (prompt_code_informes_anteriores, Paso 4):
  // ese nombre hacía pensar en una condición por agente específico
  // (Gastroenterología) que nunca existió — es solo "¿este agente tiene
  // integración real con Claude?", verdadero para casi todos los agentes.
  agente_operativo: boolean;
}

export interface Derivacion {
  especialidad_sugerida: string;
  prioridad: "baja" | "media" | "alta";
  motivo: string;
}

export interface Paciente {
  id: string;
  nombre: string;
  especie: string;
  raza: string;
  propietario: string;
}

export interface Propietario {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion?: string | null;
  numero_identificacion?: string | null;
  tipo_identificacion_etiqueta?: string | null;
}

export interface TipoIdentificacion {
  id: string;
  codigo: string;
  etiqueta: string;
}

// Mascota tal como la devuelve GET /propietarios/:id/pacientes — sin el
// campo `propietario` (redundante, ya se sabe de quién es en ese contexto).
export interface PacienteDePropietario {
  id: string;
  nombre: string;
  especie: string;
  raza: string | null;
}

// Shape del stub que sigue devolviendo el Dashboard para agentes ICIS
// (sin system_prompt) — sin cambios, ver casos.routes.ts.
export interface DashboardCaso {
  casoId: string;
  pacienteNombre: string;
  severidad: string;
  confianzaDiagnostica: number | null;
  derivacion: Derivacion | null;
  ultimaActualizacion: string;
}

// =====================================================================
// Dashboard real de GCIS (tool use forzado contra generar_dashboard_gcis,
// ver dashboard_schema.json) — shape completamente distinta de
// DashboardCaso. POST /casos/:id/dashboard/actualizar devuelve una u
// otra según si el agente del caso es GCIS o ICIS; se discrimina en
// runtime por la presencia de "meta" (ver actualizarDashboard() en
// CasoWorkspace.tsx).
// =====================================================================

export interface DashboardGcisMeta {
  estado_generacion: "sin_datos" | "generado";
  caso_id: string;
  generado_en: string;
}

export interface DashboardGcisPaciente {
  nombre: string;
  especie: string;
  raza: string;
  edad: string;
  sexo: string;
  peso_actual_kg: number | null;
}

export interface DashboardGcisExecutiveSummary {
  resumen: string;
  paciente: DashboardGcisPaciente;
  contexto_racial: string | null;
}

export interface DashboardGcisClinicalState {
  emoji: string;
  estado:
    | "remision"
    | "estable"
    | "mejorando"
    | "respuesta_parcial"
    | "empeorando"
    | "critico"
    | "informacion_insuficiente";
  justificacion: string;
}

export interface DashboardGcisClinicalConfidence {
  nivel: "alto" | "moderado" | "bajo";
  justificacion: string;
}

export interface DashboardGcisActiveProblem {
  problema: string;
  severidad: "critico" | "relevante" | "seguimiento";
  fuente: string;
}

export interface DashboardGcisAlerta {
  tipo: string;
  descripcion: string;
  nivel: "alta" | "media";
  componente_origen: string;
}

export interface DashboardGcisWeightPoint {
  fecha: string;
  peso_kg: number;
}

export interface DashboardGcisBcsPoint {
  fecha: string;
  bcs: number;
}

export interface DashboardGcisLabValue {
  fecha: string;
  parametro: string;
  valor: number;
  unidad: string;
  rango_ref: string;
}

export interface DashboardGcisImagingPoint {
  fecha: string;
  hallazgo: string;
}

export interface DashboardGcisTimelineEvent {
  fecha: string;
  evento: string;
}

export interface DashboardGcisTreatmentChange {
  fecha: string;
  cambio: string;
}

export interface DashboardGcisTrends {
  weight_trend: DashboardGcisWeightPoint[] | null;
  bcs_trend: DashboardGcisBcsPoint[] | null;
  cbc_trend: DashboardGcisLabValue[] | null;
  clinical_chemistry_trend: DashboardGcisLabValue[] | null;
  imaging_comparison: DashboardGcisImagingPoint[] | null;
  clinical_timeline: DashboardGcisTimelineEvent[] | null;
  treatment_timeline: DashboardGcisTreatmentChange[] | null;
}

export interface DashboardGcisDifferential {
  diagnostico: string;
  evidencia_a_favor: string[];
  evidencia_en_contra: string[];
  confianza: "alta" | "moderada" | "baja";
  informacion_faltante: string[];
}

export interface DashboardGcisKnowledgeMatch {
  referencia: string;
  relevancia: string;
}

export interface DashboardGcisReasoningEntry {
  fecha: string;
  hipotesis: string;
  estado: "activa" | "descartada";
  motivo: string;
}

// Exclusivo de ICIS (Referral Engine Specification ICIS-REF-001) —
// siempre null para GCIS u otros agentes sin motor de derivación.
export interface DashboardGcisReferralRecommendation {
  clasificacion:
    | "manejable_atencion_primaria"
    | "derivacion_no_urgente"
    | "derivacion_urgente"
    | "informacion_insuficiente";
  especialidad_destino: string | null;
  pregunta_clinica: string | null;
  urgencia: "urgente" | "no_urgente" | null;
  justificacion: string;
}

export interface DashboardGcis {
  meta: DashboardGcisMeta;
  executive_summary: DashboardGcisExecutiveSummary | null;
  clinical_state: DashboardGcisClinicalState | null;
  clinical_confidence: DashboardGcisClinicalConfidence | null;
  active_problems: DashboardGcisActiveProblem[] | null;
  alertas: DashboardGcisAlerta[] | null;
  trends: DashboardGcisTrends | null;
  differential_diagnosis: DashboardGcisDifferential[] | null;
  knowledge_match: DashboardGcisKnowledgeMatch[] | null;
  clinical_reasoning_journal: DashboardGcisReasoningEntry[] | null;
  referral_recommendation: DashboardGcisReferralRecommendation | null;
}

export interface GrupoTiposReporte {
  grupo: string;
  tipos: string[];
}

// Fila del historial versionado de informes (sin el binario, ver
// GET /casos/:id/informes) — cada uno es un documento formal fechado,
// nunca se sobreescribe.
export interface InformeGenerado {
  id: string;
  tipo_reporte: string;
  nombre_archivo: string;
  generado_en: string;
  medico_id: string;
  medico_nombre: string;
  es_cortesia: boolean;
}

// =====================================================================
// Módulo de Prescripción Médica — común a cualquier agente clínico
// (GCIS, ICIS, u otros a futuro). El backend ya resuelve el agente
// dinámicamente caso por caso; ningún tipo ni función acá referencia un
// agente en particular.
// =====================================================================

export interface Medicamento {
  id: string;
  nombre: string;
  principio_activo: string | null;
  presentacion: string | null;
  concentracion: string | null;
  via_administracion_default: string | null;
  dosis_min: number | null;
  dosis_max: number | null;
  unidad_dosis: string | null;
  activo: boolean;
}

export interface RecetaItem {
  id: string;
  receta_id: string;
  medicamento_id: string;
  medicamento_nombre: string;
  presentacion: string | null;
  concentracion: string | null;
  dosis: string;
  frecuencia: string;
  duracion: string;
  via_administracion: string;
  observaciones: string | null;
  orden: number;
}

export interface Receta {
  id: string;
  caso_id: string;
  paciente_id: string;
  medico_id: string;
  tenant_id: string;
  estado: "borrador" | "validada" | "emitida";
  instrucciones_generales: string | null;
  instrucciones_propietario: string | null;
  validacion_ia: ValidacionReceta | null;
  validado_en: string | null;
  emitido_en: string | null;
  creado_en: string;
}

export type CategoriaAlertaReceta =
  | "interaccion_medicamentosa"
  | "contraindicacion"
  | "alergia_registrada"
  | "duplicidad_terapeutica"
  | "dosis_fuera_de_rango"
  | "incompatibilidad_enfermedad_existente"
  | "advertencia_edad"
  | "advertencia_peso"
  | "advertencia_especie"
  | "advertencia_raza";

export interface AlertaReceta {
  categoria: CategoriaAlertaReceta;
  medicamento_afectado: string;
  descripcion: string;
  nivel: "alta" | "media";
  fuente: string;
}

export interface ValidacionReceta {
  meta: { estado_validacion: "completada" | "informacion_insuficiente" };
  alertas: AlertaReceta[];
  resumen_validacion: string;
}

export interface ItemRecetaInput {
  medicamentoId: string;
  dosis: string;
  frecuencia: string;
  duracion: string;
  viaAdministracion: string;
  observaciones?: string;
}

export interface RecetaHistorialItem {
  id: string;
  emitido_en: string;
  medico_nombre: string;
  // false si se emitió con "Emitir sin validar" (validación IA opcional
  // — ver prompt_receta_validacion_opcional.md). Deriva de
  // validacion_ia IS NOT NULL, sin columna nueva.
  fue_validada: boolean;
  items: { medicamento_id: string; medicamento_nombre: string; dosis: string; frecuencia: string; duracion: string }[];
}

export interface MedicamentoRepetido {
  medicamentoId: string;
  nombre: string;
  veces: number;
}

// =====================================================================
// Módulo de Notificaciones (mock) — ver prompt_notificaciones_mock.md.
// =====================================================================

export interface CuidadoPreventivo {
  id: string;
  tipo: "desparasitacion" | "vacunacion";
  fecha_aplicacion: string;
  fecha_proxima_recomendada: string;
  creado_en: string;
  registrado_por_nombre: string;
  vacuna: string | null;
  lote: string | null;
  subtipo_desparasitacion: "interna" | "externa" | null;
  producto_desparasitacion: string | null;
}

export type TipoNotificacion =
  | "recordatorio_cita"
  | "desparasitacion_proxima"
  | "seguimiento_faltante"
  | "vacunacion_proxima"
  | "seguimiento_posterior_consulta"
  | "agenda_dia_siguiente"
  | "confirmacion_cita"
  | "cita_cancelada_o_reprogramada"
  | "informe_disponible";

export interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  destinatario_tipo: "propietario" | "medico";
  destinatario_id: string;
  destinatario_nombre: string | null;
  caso_id: string | null;
  paciente_id: string | null;
  paciente_nombre: string | null;
  cita_id: string | null;
  cuidado_preventivo_id: string | null;
  asunto: string;
  contenido: string;
  estado: "simulada" | "enviada" | "fallida";
  creado_en: string;
}

// Campanita personal (médico) — GET /notificaciones/mias, distinto del
// panel completo de arriba (ver notificaciones.routes.ts).
export interface NotificacionMia {
  id: string;
  tipo: TipoNotificacion;
  caso_id: string | null;
  paciente_id: string | null;
  paciente_nombre: string | null;
  cita_id: string | null;
  cuidado_preventivo_id: string | null;
  asunto: string;
  contenido: string;
  estado: "simulada" | "enviada" | "fallida";
  leida: boolean;
  leida_en: string | null;
  creado_en: string;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export const workspaceApi = {
  obtenerMe: () =>
    authedFetch<{
      persona: { persona_nombre: string; tenant_nombre: string; tenant_logo_url: string | null } | null;
    }>("/workspace/me"),

  obtenerConsumo: () => authedFetch<ConsumoWorkspace>("/workspace/consumo"),

  listarAgentes: () => authedFetch<{ agentes: AgenteResumen[] }>("/workspace/agentes"),

  listarPacientes: () => authedFetch<{ pacientes: Paciente[] }>("/workspace/pacientes"),

  listarCasos: (agenteId: string) =>
    authedFetch<{ casos: CasoResumen[] }>(`/workspace/casos?agenteId=${agenteId}`),

  obtenerCaso: (casoId: string) =>
    authedFetch<{ caso: CasoDetalle; mensajes: Mensaje[]; derivacion: Derivacion | null }>(
      `/workspace/casos/${casoId}`
    ),

  // Vive en /api/casos (no /api/workspace/casos como el resto de este
  // archivo) — mismo router que actualizarDashboard más abajo. A
  // diferencia del POST /workspace/casos original (que sigue existiendo
  // sin usarse desde acá), este resuelve y persiste medico_agente_id en
  // el backend.
  // prompt: vincular caso↔cita — citaId opcional (rama "elegir cita de
  // hoy" del wizard). citaVinculada solo viene en la respuesta cuando se
  // mandó citaId: false es la señal de que el vínculo no prendió (p.ej.
  // la cita se vinculó a otra cosa mientras tanto) sin que eso bloquee la
  // creación del caso, que ya sucedió igual.
  crearCaso: (data: { pacienteId: string; agenteId: string; motivoConsulta: string; citaId?: string }) =>
    apiFetch<{ caso: CasoResumen; citaVinculada?: boolean }>("/casos", {
      method: "POST",
      token: getStoredToken(),
      body: JSON.stringify(data),
    }),

  // Citas de hoy de este paciente, agendadas con este médico, que todavía
  // no tienen caso vinculado — para la rama "elegir cita de hoy" del
  // wizard "Nuevo Caso". Filtra client-side por estado (no cancelada/
  // no_show) y caso_id nulo: son pocos registros por día, no vale la pena
  // un endpoint dedicado para esto solo.
  listarCitasDeHoyDelPaciente: async (pacienteId: string, medicoId: string) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const data = await authedFetch<{
      citas: { id: string; hora_inicio: string; hora_fin: string; estado: string; caso_id: string | null }[];
    }>(`/citas?desde=${hoy}&hasta=${hoy}&medico_id=${medicoId}&paciente_id=${pacienteId}`);
    return data.citas.filter(
      (c) => c.caso_id === null && c.estado !== "cancelada" && c.estado !== "no_show"
    );
  },

  buscarPropietarios: (q: string) =>
    authedFetch<{ propietarios: Propietario[] }>(`/propietarios/buscar?q=${encodeURIComponent(q)}`),

  // prompt_code_propietarios, Ajuste 1 — búsqueda exacta por identificación,
  // la llave de entrada del formulario de alta. Devuelve null si no existe.
  buscarPropietarioPorIdentificacion: (tipoIdentificacionId: string, numero: string) =>
    authedFetch<{ propietario: Propietario | null }>(
      `/propietarios/buscar-por-identificacion?tipoIdentificacionId=${encodeURIComponent(tipoIdentificacionId)}&numero=${encodeURIComponent(numero)}`
    ),

  crearPropietario: (data: {
    nombre: string;
    telefono?: string;
    email?: string;
    direccion?: string;
    tipoIdentificacionId?: string;
    numeroIdentificacion?: string;
  }) =>
    authedFetch<{ propietario: Propietario }>("/propietarios", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listarPacientesDePropietario: (propietarioId: string) =>
    authedFetch<{ pacientes: PacienteDePropietario[] }>(`/propietarios/${propietarioId}/pacientes`),

  listarTiposIdentificacion: () =>
    authedFetch<{ tipos: TipoIdentificacion[] }>("/propietarios/tipos-identificacion"),

  crearPaciente: (data: {
    propietarioId: string;
    nombre: string;
    especie: string;
    razaId?: string;
    fechaNacimiento?: string;
  }) =>
    authedFetch<{ paciente: PacienteDePropietario }>("/pacientes", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // prompt_code_paciente_nacimiento_estado.md, Parte B2 — único camino
  // para registrar un fallecimiento. La confirmación vive en el frontend
  // (modal dedicado), no acá.
  marcarPacienteFallecido: (pacienteId: string, fechaFallecimiento: string) =>
    authedFetch<{ paciente: { id: string; nombre: string; estado: string; fecha_fallecimiento: string } }>(
      `/pacientes/${pacienteId}/estado`,
      {
        method: "PATCH",
        body: JSON.stringify({ estado: "fallecido", fechaFallecimiento }),
      }
    ),

  // "Analizar el caso" — contenido puede venir vacío si hay información
  // pendiente sin analizar (el backend arma el disparador él solo); nunca
  // los dos vacíos: el botón se deshabilita en ese caso, ver CasoWorkspace.
  // mensaje viene null cuando se analizó sin escribir nada nuevo — no hay
  // fila de "consulta" que devolver.
  enviarMensaje: (casoId: string, contenido: string, archivoIds: string[] = []) =>
    authedFetch<{ mensaje: Mensaje | null; respuesta: Mensaje }>(`/workspace/casos/${casoId}/mensajes`, {
      method: "POST",
      body: JSON.stringify({ contenido, archivoIds }),
    }),

  // "Agregar información" — se guarda en el caso sin consultar al agente.
  // No hay "respuesta": es solo el bloque que se acaba de registrar.
  agregarInformacion: (casoId: string, contenido: string, archivoIds: string[] = []) =>
    authedFetch<{ mensaje: Mensaje }>(`/workspace/casos/${casoId}/informacion`, {
      method: "POST",
      body: JSON.stringify({ contenido, archivoIds }),
    }),

  subirArchivo: (casoId: string, archivo: File) => {
    const formData = new FormData();
    formData.append("casoId", casoId);
    formData.append("archivo", archivo);
    return apiFetch<{ archivo: Archivo }>("/archivos", {
      method: "POST",
      token: getStoredToken(),
      body: formData,
    });
  },

  // GET /api/archivos/:id ya no es una ruta estática — valida que el
  // archivo pertenezca al tenant de la sesión, así que hay que traerlo
  // como blob autenticado (un <a href> directo no manda el header
  // Authorization) y armar un object URL en el cliente.
  obtenerArchivo: (archivoId: string) =>
    apiFetchBlob(`/archivos/${archivoId}`, { token: getStoredToken() }),

  // Nota: estos dos NO viven bajo /workspace — el backend los monta en
  // /api/casos y /api/reportes respectivamente (routers propios).
  // La respuesta es DashboardCaso (ICIS, stub sin cambios) o DashboardGcis
  // (GCIS, generación real) según el agente del caso — se discrimina en
  // runtime por la presencia de "meta", ver actualizarDashboard() en
  // CasoWorkspace.tsx.
  actualizarDashboard: (casoId: string) =>
    authedFetch<{ dashboard: DashboardCaso | DashboardGcis }>(`/casos/${casoId}/dashboard/actualizar`, {
      method: "POST",
    }),

  // Lectura del cache (migración 015) — solo agentes reales lo pueblan;
  // para el stub sin system_prompt dashboard siempre viene null (columna
  // nunca se toca en ese endpoint). hayInformacionPosterior (Paso 2 de
  // prompt_code_dashboards_informes): true si el caso tiene actividad
  // registrada después de generado_en — indicación, no bloqueo.
  obtenerDashboardCache: (casoId: string) =>
    authedFetch<{
      dashboard: DashboardGcis | null;
      generado_en: string | null;
      hayInformacionPosterior: boolean;
    }>(`/casos/${casoId}/dashboard`),

  // Informe clínico real (CR-001, GCIS) — endpoint completamente distinto
  // de actualizarDashboard, aunque comparta el patrón de tool use del
  // lado del backend. Devuelve el .docx binario directo, no JSON.
  generarInforme: (casoId: string) =>
    apiFetchFile(`/casos/${casoId}/informe/generar`, {
      method: "POST",
      token: getStoredToken(),
    }),

  // Historial versionado (migración 018) — cada informe generado queda
  // guardado para siempre, nunca se sobreescribe. Listado sin binario;
  // la descarga es una lectura directa de Postgres, sin volver a
  // llamar a Claude (responde en ms).
  listarInformes: (casoId: string) =>
    authedFetch<{ informes: InformeGenerado[] }>(`/casos/${casoId}/informes`),

  descargarInforme: (informeId: string) =>
    apiFetchFile(`/informes/${informeId}/descargar`, { token: getStoredToken() }),

  obtenerTiposReporte: () => authedFetch<{ grupos: GrupoTiposReporte[] }>("/reportes/tipos"),

  // Nota: estos NO viven bajo /workspace — el backend los monta en
  // /api/medicamentos, /api/recetas y /api/pacientes respectivamente
  // (routers propios, ver backend/src/index.ts).
  buscarMedicamentos: (q: string) =>
    authedFetch<{ medicamentos: Medicamento[] }>(`/medicamentos?q=${encodeURIComponent(q)}`),

  crearReceta: (
    casoId: string,
    data: { instruccionesGenerales?: string; instruccionesPropietario?: string; items: ItemRecetaInput[] }
  ) =>
    apiFetch<{ receta: Receta; items: RecetaItem[] }>(`/casos/${casoId}/recetas`, {
      method: "POST",
      token: getStoredToken(),
      body: JSON.stringify(data),
    }),

  editarReceta: (
    recetaId: string,
    data: { instruccionesGenerales?: string; instruccionesPropietario?: string; items?: ItemRecetaInput[] }
  ) =>
    apiFetch<{ receta: Receta; items: RecetaItem[] }>(`/recetas/${recetaId}`, {
      method: "PUT",
      token: getStoredToken(),
      body: JSON.stringify(data),
    }),

  validarReceta: (recetaId: string) =>
    apiFetch<ValidacionReceta>(`/recetas/${recetaId}/validar`, {
      method: "POST",
      token: getStoredToken(),
    }),

  // Devuelve el .pdf binario directo, no JSON — mismo mecanismo que
  // generarInforme.
  emitirReceta: (recetaId: string) =>
    apiFetchFile(`/recetas/${recetaId}/emitir`, {
      method: "POST",
      token: getStoredToken(),
    }),

  obtenerHistorialFarmacologico: (pacienteId: string) =>
    authedFetch<{ recetas: RecetaHistorialItem[]; medicamentosRepetidos: MedicamentoRepetido[] }>(
      `/pacientes/${pacienteId}/historial-farmacologico`
    ),

  obtenerCuidadosPreventivos: (pacienteId: string) =>
    authedFetch<{ cuidadosPreventivos: CuidadoPreventivo[] }>(`/pacientes/${pacienteId}/cuidados-preventivos`),

  registrarCuidadoPreventivo: (
    pacienteId: string,
    data: {
      tipo: "desparasitacion" | "vacunacion";
      fechaAplicacion: string;
      fechaProximaRecomendada: string;
      vacuna?: string;
      lote?: string;
      subtipoDesparasitacion?: "interna" | "externa";
      productoDesparasitacion?: string;
    }
  ) =>
    authedFetch<{ cuidadoPreventivo: CuidadoPreventivo }>(`/pacientes/${pacienteId}/cuidados-preventivos`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

export const notificacionesApi = {
  listar: (filtros: { tipo?: TipoNotificacion; desde?: string; hasta?: string } = {}) => {
    const params = new URLSearchParams();
    if (filtros.tipo) params.set("tipo", filtros.tipo);
    if (filtros.desde) params.set("desde", filtros.desde);
    if (filtros.hasta) params.set("hasta", filtros.hasta);
    const qs = params.toString();
    return authedFetch<{ notificaciones: Notificacion[] }>(`/notificaciones${qs ? `?${qs}` : ""}`);
  },

  listarMias: () => authedFetch<{ notificaciones: NotificacionMia[]; no_leidas: number }>("/notificaciones/mias"),

  marcarLeida: (id: string) =>
    authedFetch<{ notificacion: { id: string; leida: boolean; leida_en: string } }>(
      `/notificaciones/${id}/marcar-leida`,
      { method: "PATCH" }
    ),
};
