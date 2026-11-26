import { getStoredToken } from "../hooks/useAuth";
import { apiFetch, apiFetchFile } from "./api";
import { CasoSinActividad, CerrarCasoInput, Derivacion, Desenlace, Mensaje } from "./workspaceApi";

// prompt: vincular caso↔cita — 5 columnas exactas (fecha de atención,
// hora de inicio, hora de fin, número de expediente, número de
// colegiado). Sin médico_nombre ni paciente_nombre en la fila.
export interface AtencionReporte {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  numero_expediente: number | null;
  colegiatura: string | null;
}

// Ya no es una fila de tabla — solo el expediente de referencia para la
// nota de "no omitidos" en la pantalla.
export interface CasoSinCitaReporte {
  id: string;
  numero_expediente: number | null;
}

export interface ReporteAtenciones {
  atenciones: AtencionReporte[];
  casosSinCita: CasoSinCitaReporte[];
  totalAtenciones: number;
  totalesPorMedico: { medicoNombre: string; total: number }[];
}

export interface Especialidad {
  agente: string;
  rol: "general" | "especialista";
  habilitado: boolean;
}

export interface AccesoAgente {
  agenteId: string;
  agenteNombre: string;
  habilitado: boolean;
  rol: "general" | "especialista" | null;
}

export interface Medico {
  id: string;
  nombre: string;
  email: string;
  colegiatura: string | null;
  estado: "activo" | "inactivo";
  especialidades: Especialidad[];
}

export interface ConteoCuposMedicos {
  medicosContratados: number;
  medicosActivos: number;
  invitacionesPendientes: number;
  disponibles: number;
}

export interface InvitacionMedico {
  id: string;
  tenantId: string;
  email: string;
  nombre: string | null;
  token: string;
  estado: "pendiente" | "aceptada" | "cancelada" | "vencida";
  creadaEn: string;
  venceEn: string;
  aceptadaEn: string | null;
}

export interface AgenteAdmin {
  id: string;
  nombre: string;
  descripcion: string;
  icono: string;
  estado_catalogo: "disponible" | "proximamente";
  estado: "activo" | "discontinuado" | "mantenimiento";
  motivo_mantenimiento: string | null;
  retorno_estimado: string | null;
  estado_tenant: "habilitado" | "deshabilitado" | null;
  habilitado_en: string | null;
  deshabilitado_en: string | null;
  periodo_ultimo_cambio: string | null;
  medicos_asignados: number;
  casos_count: number;
}

export interface TenantInfo {
  id: string;
  nombre: string;
  pais_codigo: string | null;
  ciudad: string | null;
  idioma: string;
  zona_horaria: string;
  plan: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  logo_url: string | null;
  expediente_proximo_numero: number;
}

export interface PlanInfo {
  agentesHabilitados: number;
  agentesTotal: number;
  medicosActivos: number;
  medicosTotal: number;
}

// prompt_code_notificaciones, PARTE C — un interruptor + un parámetro por
// cada una de las 3 notificaciones del módulo.
export interface ConfiguracionNotificaciones {
  recordatorioCitaActivo: boolean;
  horasAvisoRecordatorioCita: number;
  desparasitacionActivo: boolean;
  diasAvisoDesparasitacion: number;
  seguimientoFaltanteActivo: boolean;
  diasAvisoSeguimientoFaltante: number;
  vacunacionActivo: boolean;
  diasAvisoVacunacion: number;
  seguimientoPosteriorActivo: boolean;
  diasSeguimientoPosterior: number;
  agendaDiaSiguienteActivo: boolean;
  confirmacionCitaActivo: boolean;
  cancelacionCitaActivo: boolean;
  informeDisponibleActivo: boolean;
  cumpleanosActivo: boolean;
  /** Dictado de la consulta con IA (prompt 07d fase 2). */
  dictadoIaActivo: boolean;
  /** Horas que se guarda el audio tras transcribirlo. 0 = no se guarda. */
  dictadoRetencionAudioHoras: number;
}

export type EstadoSuscripcion = "trial" | "activa" | "trial_expirado" | "suspendida" | "cancelada";

export interface PlanSuscripcion {
  id: string;
  nombre: string;
  cuposAgenteMedico: number;
  presupuestoUsdIncluido: number;
  precioMensualUsd: number;
  precioCupoExtraUsd: number;
  esPlanPrueba: boolean;
}

export interface SuscripcionInfo {
  estado: EstadoSuscripcion;
  cancelacionSolicitada: boolean;
  cancelacionEfectivaEn: string | null;
  trialTerminaEn: string | null;
  plan: PlanSuscripcion;
}

export interface Factura {
  fecha: string;
  concepto: string;
  monto: number;
  estado: "pagada" | "pendiente";
}

export interface UsoFacturacion {
  suscripcion: SuscripcionInfo;
  cupos: { usados: number; incluidos: number };
  consumoIA: { montoUsado: number; montoIncluido: number; cicloInicio: string; cicloFin: string };
  facturas: Factura[];
  limiteUso: LimiteUso;
}

export interface PlanCatalogo {
  id: string;
  nombre: string;
  codigo: string | null;
  orden: number;
  agentesIncluidos: number | null; // null = plan Full, todos los del catálogo
  medicosIncluidos: number;
  creditoIaUsd: number;
  precioMensualUsd: number;
  precioAnualUsd: number | null;
}

// ---------------------------------------------------------------------
// Implementación de pantallas, prompt 2 — Plan y consumo. Tipos y
// funciones nuevas; también cubre los endpoints de los flujos de
// suscripción A/B/C (cupos, downgrade/cancelación, exportación) que
// hasta ahora no tenían ningún consumidor en el frontend.
// ---------------------------------------------------------------------

export type MotivoRechazoCupo =
  | "sin_cupo_agentes"
  | "sin_cupo_medicos"
  | "freno_anti_rotacion"
  | "agente_con_casos"
  | "agente_no_encontrado"
  | "agente_discontinuado"
  | "agente_en_mantenimiento";

export interface ConteoCupos {
  agentesContratados: number | null;
  agentesEnUso: number;
  agentesDisponibles: number | null;
  agentesExceso: number;
  medicosContratados: number;
  medicosActivos: number;
  medicosDisponibles: number;
  medicosExceso: number;
}

export interface AvisoConsumo {
  umbral: "saldo_bajo" | "saldo_agotado" | "colchon_agotado" | "trial_agotado" | "trial_80";
  mensaje: string;
}

export interface CambioPendiente {
  id: string;
  tipo: "downgrade" | "cancelacion";
  plan_destino_id: string | null;
  plan_destino_nombre: string | null;
  periodicidad_destino: string | null;
  agentes_destino: number | null;
  medicos_destino: number | null;
  efectivo_en: string;
  plan_actual_id: string;
  plan_actual_nombre: string;
  credito_actual: string;
  credito_destino: string | null;
  precio_actual: string;
  precio_destino: string | null;
}

export interface ConsumoPeriodoItem {
  tipo: string;
  cantidad: number;
  montoUsd: number;
}

export interface PlanConsumo {
  plan: { id: string; codigo: string | null; orden: number; nombre: string; precioUsd: number; periodicidad: string; renovacion: string };
  cupos: ConteoCupos;
  credito: { pactadoUsd: number };
  saldo: { planUsd: number; compradoUsd: number; totalUsd: number };
  aviso: AvisoConsumo | null;
  cambioPendiente: CambioPendiente | null;
  consumoPeriodo: ConsumoPeriodoItem[];
}

export interface Cobro {
  id: string;
  fecha: string;
  concepto: string;
  montoUsd: number;
  moneda: string;
  estado: "pendiente" | "exitoso" | "fallido";
  comprobante: { numero: string; estado: string } | null;
}

export interface DatosFiscales {
  pais_codigo: string | null;
  tipo_persona: "fisica" | "juridica" | null;
  tipo_identificacion_id: string | null;
  numero_identificacion: string | null;
  nombre_fiscal: string | null;
}

export interface TipoIdentificacion {
  id: string;
  codigo: string;
  etiqueta: string;
}

export interface Exportacion {
  id: string;
  estado: "pendiente" | "generando" | "lista" | "descargada" | "fallida";
  casos_incluidos: number | null;
  creada_en: string;
  lista_en: string | null;
  expira_en: string | null;
}

// Pantallas faltantes, Prompt B — barra de estado de la ventana de purga,
// persistente en toda la app. `estado` es el de `suscripciones.estado`
// (prueba/activa/morosa/suspendida/ventana_purga/cancelada/finalizada);
// solo interesa distinguir 'ventana_purga' del resto para mostrar la
// barra, así que se tipa como string y no como el enum completo.
export interface EstadoMiCorreo {
  email: string;
  verificado: boolean;
  rebotado: boolean;
}

export interface EstadoSuscripcionResumen {
  estado: string | null;
  purgaProgramadaPara: string | null;
  diasRestantes: number | null;
  ventanaPurgaOrigen: "prueba_no_convertida" | "cuenta_no_operativa" | "impago" | null;
}

export type LimiteAccion = "solo_notificar" | "bloquear";

export interface LimiteUso {
  limiteUsdConfigurado: number | null;
  limiteAccion: LimiteAccion;
}

export type UmbralNotificacion = "80_plan" | "100_plan" | "limite_propio";

/** Lo que devuelven las tres rutas de apariencia. */
export interface AparienciaApi {
  primario: string;
  tema: "marca" | "sereno" | "vibrante";
  logoUrl: string | null;
  nombreClinica: string;
  calculado: {
    primarioElegido: string;
    primario: string;
    ajustado: boolean;
    contrasteConBlanco: number;
    contrasteDelTextoEncima: number;
    sobrePrimario: string;
    primarioTexto: string;
    contrasteComoTexto: number;
    primarioHover: string;
    primarioSuave: string;
    primarioOscuro: string;
    primarioBorde: string;
  };
}

export interface NotificacionUso {
  id: string;
  umbral: UmbralNotificacion;
  mensaje: string;
  fecha: string;
  leida: boolean;
}

export interface CasoAdmin {
  id: string;
  motivo: string;
  estado: "triage" | "en_curso" | "completado";
  severidad: string;
  confianza_diagnostica: number | null;
  creado_en: string;
  numero_expediente: number;
  paciente_nombre: string;
  especie: string;
  raza: string | null;
  agente_id: string;
  agente_nombre: string;
  medico_id: string;
  medico_nombre: string;
}

export interface CasoAdminDetalle {
  id: string;
  motivo: string;
  estado: string;
  severidad: string;
  confianza_diagnostica: number | null;
  creado_en: string;
  numero_expediente: number;
  medico_id: string;
  agente_id: string;
  paciente_id: string;
  paciente_nombre: string;
  especie: string;
  raza: string | null;
  sexo: string;
  edad_anios: number | null;
  paciente_estado: "activo" | "fallecido";
  medico_nombre: string;
  agente_nombre: string;
  // prompt_code_cierre_caso.md, Paso 2 — presentes solo si estado==='completado'.
  diagnostico_final: string | null;
  tratamiento_activo: boolean | null;
  tratamiento_activo_detalle: string | null;
  desenlace: Desenlace | null;
  cerrado_en: string | null;
  cerrado_por_nombre: string | null;
  // Paso 3 — ver la misma nota en workspaceApi.CasoDetalle.
  motivo_reapertura: string | null;
  reabierto_en: string | null;
  reabierto_por_nombre: string | null;
}

export interface MedicoDisponible {
  medico_agente_id: string;
  persona_id: string;
  nombre: string;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export const adminApi = {
  listarMedicos: () => authedFetch<{ medicos: Medico[] }>("/admin/medicos"),

  obtenerCuposMedicos: () => authedFetch<{ cupos: ConteoCuposMedicos }>("/admin/medicos/cupos"),

  listarInvitacionesMedicos: () =>
    authedFetch<{ invitaciones: InvitacionMedico[] }>("/admin/medicos/invitaciones"),

  invitarMedico: (email: string, nombre?: string) =>
    authedFetch<{ invitacion: InvitacionMedico }>("/admin/medicos/invitar", {
      method: "POST",
      body: JSON.stringify({ email, nombre: nombre?.trim() || undefined }),
    }),

  reenviarInvitacionMedico: (id: string) =>
    authedFetch<{ invitacion: InvitacionMedico }>(`/admin/medicos/invitaciones/${id}/reenviar`, {
      method: "POST",
    }),

  cancelarInvitacionMedico: (id: string) =>
    authedFetch<{ invitacion: InvitacionMedico }>(`/admin/medicos/invitaciones/${id}/cancelar`, {
      method: "POST",
    }),

  cambiarEstadoMedico: (id: string, estado: "activo" | "inactivo") =>
    authedFetch<{ medico: Medico }>(`/admin/medicos/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ estado }),
    }),

  obtenerAccesos: (personaId: string) =>
    authedFetch<{ accesos: AccesoAgente[] }>(`/admin/medicos/${personaId}/accesos`),

  actualizarAccesos: (personaId: string, accesos: { agenteId: string; habilitado: boolean }[]) =>
    authedFetch<{ accesos: AccesoAgente[]; cuposConsumidos: number }>(
      `/admin/medicos/${personaId}/accesos`,
      { method: "PUT", body: JSON.stringify({ accesos }) }
    ),

  listarAgentes: () => authedFetch<{ agentes: AgenteAdmin[] }>("/admin/agentes"),

  // Flujo de suscripción A — gestión de cupos. Los 3 mutadores lanzan
  // ApiError en el rechazo (402/404/409) — `err.data` trae
  // `{error, motivo, disponibleDesde?}`, igual que RechazoGeneracion del
  // lado del médico (ver ConsumoBanner.tsx).
  obtenerCupos: () => authedFetch<{ cupos: ConteoCupos }>("/admin/cupos"),

  habilitarAgente: (agenteId: string) =>
    authedFetch<{ ok: true }>(`/admin/agentes/${agenteId}/habilitar`, { method: "PATCH" }),

  deshabilitarAgente: (agenteId: string) =>
    authedFetch<{ ok: true }>(`/admin/agentes/${agenteId}/deshabilitar`, { method: "PATCH" }),

  eliminarAgente: (agenteId: string) =>
    authedFetch<{ ok: true }>(`/admin/agentes/${agenteId}`, { method: "DELETE" }),

  obtenerClinica: () =>
    authedFetch<{ tenant: TenantInfo; plan: PlanInfo }>("/admin/clinica"),

  // Prompt de verificación de correo, Capas 2/3.
  obtenerEstadoMiCorreo: () =>
    authedFetch<EstadoMiCorreo>("/admin/mi-correo"),

  cambiarMiCorreo: (email: string) =>
    authedFetch<{ ok: true; nuevoEmail: string }>("/admin/mi-correo", {
      method: "PUT",
      body: JSON.stringify({ email }),
    }),

  // prompt_code_reenvio_verificacion — reenvía sin tocar la dirección. En
  // el límite (429), el backend manda `disponibleEn` en err.data (ver
  // ApiError) — el llamador lo formatea con formatearHora, nunca a mano.
  reenviarVerificacionCorreo: () =>
    authedFetch<{ ok: true }>("/admin/mi-correo/reenviar-verificacion", { method: "POST" }),

  actualizarClinica: (data: Partial<TenantInfo>) =>
    authedFetch<{ tenant: TenantInfo }>("/admin/clinica", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // prompt_code_expediente_y_propietario, Parte A3 — devuelve el error
  // del backend tal cual (409 con proximoNumeroActual) para que la
  // pantalla muestre el mensaje real, no uno genérico.
  configurarNumeracionExpedientes: (numeroInicio: number) =>
    authedFetch<{ expedienteProximoNumero: number }>("/admin/clinica/numeracion-expedientes", {
      method: "PATCH",
      body: JSON.stringify({ numeroInicio }),
    }),

  subirLogo: (archivo: File) => {
    const formData = new FormData();
    formData.append("logo", archivo);
    return apiFetch<{ logoUrl: string }>("/admin/clinica/logo", {
      method: "POST",
      token: getStoredToken(),
      body: formData,
    });
  },

  // --- Apariencia de la clinica (prompt 01c) ---------------------------
  // El tema CALCULADO viene del servidor: el navegador no deriva tonos
  // (ver useApariencia.tsx). `previsualizar` pide el calculo de un color
  // sin guardarlo, que es lo que hace la vista previa fiel.
  obtenerApariencia: () => authedFetch<AparienciaApi>("/admin/apariencia"),

  previsualizarApariencia: (primario: string) =>
    authedFetch<AparienciaApi["calculado"]>(
      `/admin/apariencia/previsualizar?primario=${encodeURIComponent(primario)}`
    ),

  guardarApariencia: (datos: { primario?: string; tema?: string }) =>
    apiFetch<AparienciaApi>("/admin/apariencia", {
      method: "PUT",
      token: getStoredToken(),
      body: JSON.stringify(datos),
    }),

  restablecerApariencia: () =>
    apiFetch<AparienciaApi>("/admin/apariencia/restablecer", {
      method: "POST",
      token: getStoredToken(),
    }),

  obtenerConfiguracionNotificaciones: () =>
    authedFetch<ConfiguracionNotificaciones>("/admin/clinica/configuracion-notificaciones"),

  actualizarConfiguracionNotificaciones: (config: ConfiguracionNotificaciones) =>
    authedFetch<ConfiguracionNotificaciones>("/admin/clinica/configuracion-notificaciones", {
      method: "PATCH",
      body: JSON.stringify(config),
    }),

  obtenerUsoFacturacion: () => authedFetch<UsoFacturacion>("/admin/uso-facturacion"),

  listarPlanes: () => authedFetch<{ planes: PlanCatalogo[] }>("/admin/planes"),

  // Implementación de pantallas, prompt 2 — Plan y consumo.
  obtenerPlanConsumo: () => authedFetch<PlanConsumo>("/admin/plan-consumo"),

  listarCobros: () => authedFetch<{ cobros: Cobro[] }>("/admin/cobros"),

  obtenerDatosFiscales: () =>
    authedFetch<{ datosFiscales: DatosFiscales | null }>("/admin/clinica/datos-fiscales"),

  // País y tipo de persona quedan fijos desde el registro (Prompt B) —
  // este endpoint ya no los acepta, solo los datos de identificación.
  actualizarDatosFiscales: (data: Partial<{
    tipoIdentificacionId: string;
    numeroIdentificacion: string;
    nombreFiscal: string;
  }>) =>
    authedFetch<{ datosFiscales: DatosFiscales }>("/admin/clinica/datos-fiscales", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  listarTiposIdentificacion: (paisCodigo: string, tipoPersona?: "fisica" | "juridica") => {
    const params = new URLSearchParams({ paisCodigo });
    if (tipoPersona) params.set("tipoPersona", tipoPersona);
    return authedFetch<{ tipos: TipoIdentificacion[] }>(`/admin/tipos-identificacion?${params.toString()}`);
  },

  // Flujo de suscripción B — downgrade y cancelación programados.
  obtenerCambioPendiente: () => authedFetch<{ cambio: CambioPendiente | null }>("/admin/cambio-pendiente"),

  solicitarDowngrade: (data: {
    planDestinoId: string;
    periodicidadDestino?: string;
    agentesConservados: string[];
    medicosConservados: string[];
  }) =>
    authedFetch<{ cambioId: string }>("/admin/downgrade", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  cancelarCambioPendiente: (cambioId: string) =>
    authedFetch<{ ok: true }>(`/admin/cambio-pendiente/${cambioId}`, { method: "DELETE" }),

  // Flujo de suscripción C — exportación.
  listarExportaciones: () => authedFetch<{ exportaciones: Exportacion[] }>("/admin/exportaciones"),

  generarExportacion: () =>
    authedFetch<{ exportacionId: string }>("/admin/exportaciones", { method: "POST" }),

  descargarExportacion: (id: string) =>
    apiFetchFile(`/admin/exportaciones/${id}/descargar`, { token: getStoredToken() }),

  // Pantallas faltantes, Prompt B — barra global de la ventana de purga.
  obtenerEstadoSuscripcion: () => authedFetch<EstadoSuscripcionResumen>("/admin/estado-suscripcion"),

  cambiarPlan: (planId: string) =>
    authedFetch<{ tenant: { id: string; plan_id: string } }>("/admin/plan", {
      method: "PUT",
      body: JSON.stringify({ planId }),
    }),

  cancelarSuscripcion: () =>
    authedFetch<{
      suscripcion: { estado: "cancelada"; efectivo_en: string | null };
      cambio: CambioPendiente | null;
    }>("/admin/cancelar-suscripcion", { method: "PUT" }),

  revertirCancelacion: () =>
    authedFetch<{ suscripcion: { estado: "activa" } }>("/admin/revertir-cancelacion", { method: "PUT" }),

  actualizarLimiteUso: (data: { limiteUsdConfigurado: number | null; limiteAccion: LimiteAccion }) =>
    authedFetch<LimiteUso>("/admin/limite-uso", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  listarNotificaciones: () =>
    authedFetch<{ notificaciones: NotificacionUso[] }>("/admin/notificaciones"),

  marcarNotificacionLeida: (id: string) =>
    authedFetch<{ notificacion: NotificacionUso }>(`/admin/notificaciones/${id}/leida`, {
      method: "PATCH",
    }),

  marcarTodasLeidas: () =>
    authedFetch<{ ok: true }>("/admin/notificaciones/marcar-todas-leidas", { method: "PATCH" }),

  obtenerReporteAtenciones: (desde: string, hasta: string, medicoId?: string) => {
    const params = new URLSearchParams({ desde, hasta });
    if (medicoId) params.set("medicoId", medicoId);
    return authedFetch<ReporteAtenciones>(`/admin/reporte-atenciones?${params.toString()}`);
  },

  descargarReporteAtencionesPdf: (desde: string, hasta: string, medicoId?: string) => {
    const params = new URLSearchParams({ desde, hasta });
    if (medicoId) params.set("medicoId", medicoId);
    return apiFetchFile(`/admin/reporte-atenciones/pdf?${params.toString()}`, { token: getStoredToken() });
  },

  listarCasos: (filtros: {
    medicoId?: string;
    estado?: string;
    agenteId?: string;
    buscarPaciente?: string;
    numeroExpediente?: string;
    pagina?: number;
  }) => {
    const params = new URLSearchParams();
    if (filtros.medicoId) params.set("medicoId", filtros.medicoId);
    if (filtros.estado) params.set("estado", filtros.estado);
    if (filtros.agenteId) params.set("agenteId", filtros.agenteId);
    if (filtros.buscarPaciente) params.set("buscarPaciente", filtros.buscarPaciente);
    if (filtros.numeroExpediente) params.set("numeroExpediente", filtros.numeroExpediente);
    params.set("pagina", String(filtros.pagina ?? 1));
    return authedFetch<{ casos: CasoAdmin[]; total: number; totalPaginas: number }>(
      `/admin/casos?${params.toString()}`
    );
  },

  obtenerCaso: (casoId: string) =>
    authedFetch<{ caso: CasoAdminDetalle; mensajes: Mensaje[]; derivacion: Derivacion | null }>(
      `/admin/casos/${casoId}`
    ),

  obtenerMedicosDisponibles: (casoId: string) =>
    authedFetch<{ medicos: MedicoDisponible[] }>(`/admin/casos/${casoId}/medicos-disponibles`),

  reasignarCaso: (casoId: string, data: { nuevoMedicoAgenteId: string; motivo?: string }) =>
    authedFetch<{ ok: true }>(`/admin/casos/${casoId}/reasignar`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // prompt_code_cierre_caso.md, Paso 2 — endpoint gemelo del médico
  // (workspaceApi.cerrarCaso), mismo body, WHERE de pertenencia distinto
  // del lado del backend (ver admin.routes.ts).
  cerrarCaso: (casoId: string, data: CerrarCasoInput) =>
    authedFetch<{ caso: CasoAdminDetalle; pacienteMarcadoFallecido: boolean }>(`/admin/casos/${casoId}/cerrar`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  reabrirCaso: (casoId: string, motivo: string) =>
    authedFetch<{ caso: CasoAdminDetalle }>(`/admin/casos/${casoId}/reabrir`, {
      method: "POST",
      body: JSON.stringify({ motivo }),
    }),

  casosSinActividad: (params: { meses?: number; fechaCorte?: string }) => {
    const query = new URLSearchParams();
    if (params.meses != null) query.set("meses", String(params.meses));
    if (params.fechaCorte) query.set("fechaCorte", params.fechaCorte);
    return authedFetch<{ casos: CasoSinActividad[] }>(`/admin/casos/sin-actividad?${query.toString()}`);
  },
};
