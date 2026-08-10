import { getStoredToken } from "../hooks/useAuth";
import { apiFetch, apiFetchBlob } from "./api";

export type TipoDocumento =
  | "banderas_rojas"
  | "breed_intelligence"
  | "farmacoterapia"
  | "nutricion"
  | "otro";

export interface DocumentoConocimiento {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo: TipoDocumento;
  agente_id: string | null;
  agente_nombre: string | null;
  pais_codigo: string | null;
  archivo_ref: string;
  version: string;
  estado: "activo" | "archivado";
  fecha_carga: string;
  cargado_por_nombre: string | null;
  tiene_texto: boolean;
  caracteres_texto: number | null;
  incluir_en_contexto: boolean;
}

export type EstadoAgente = "activo" | "discontinuado" | "mantenimiento";

export interface AgenteCatalogoCompleto {
  id: string;
  nombre: string;
  especialidad: string | null;
  descripcion: string | null;
  icono: string | null;
  estado_catalogo: "disponible" | "proximamente";
  estado: EstadoAgente;
  motivo_mantenimiento: string | null;
  retorno_estimado: string | null;
  estado_actualizado_en: string | null;
  clinicas_activas: string;
  casos_totales: string;
}

export interface RegistroAuditoria {
  id: string;
  creado_en: string;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  tenant_nombre: string | null;
  usuario_nombre: string | null;
  usuario_tipo: "medico" | "admin_clinica" | "staff_plataforma" | "desconocido";
}

export interface AuditoriaRespuesta {
  registros: RegistroAuditoria[];
  total: number;
  pagina: number;
  totalPaginas: number;
  tiposAccion: string[];
}

export interface UsoIaClinica {
  tenantId: string;
  tenantNombre: string;
  planNombre: string | null;
  montoUsado: number;
  presupuestoUsdIncluido: number | null;
  porcentajePresupuesto: number | null;
  limiteUsdConfigurado: number | null;
  limiteAccion: "solo_notificar" | "bloquear";
  cicloInicio: string;
  cicloFin: string;
}

export interface ResumenFacturas {
  ingresosEsteMes: number;
  facturasEmitidas30d: number;
  facturasPendientes: number;
}

export interface FacturaFila {
  id: string;
  clinica: string;
  concepto: string | null;
  monto: number;
  fecha: string;
  estado: "pagada" | "pendiente";
  origen: "manual" | "automatica";
}

export interface FacturasRespuesta {
  facturas: FacturaFila[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

export interface ResumenPagos {
  pagosExitosos30d: number;
  montoTotalCobrado30d: number;
  pagosFallidos30d: number;
}

export interface PagoFila {
  id: string;
  clinica: string;
  monto: number;
  fecha: string;
  plan: string | null;
}

export interface PagosRespuesta {
  pagos: PagoFila[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

export interface ResumenCancelaciones {
  cancelacionesPendientes: number;
  cancelacionesCompletadas30d: number;
  tasaCancelacionMes: number;
}

export interface CancelacionFila {
  id: string;
  clinica: string;
  fechaSolicitud: string | null;
  fechaEfectiva: string | null;
  estado: "pendiente" | "completada";
}

export interface CancelacionesRespuesta {
  cancelaciones: CancelacionFila[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

export interface ResumenNuevasClinicas {
  clinicasNuevas30d: number;
  enPeriodoDePrueba: number;
  convertidasAPago30d: number;
}

export interface NuevaClinicaFila {
  id: string;
  nombre: string;
  pais: string | null;
  fechaRegistro: string;
  estado: string;
  plan: string | null;
}

export interface NuevasClinicasRespuesta {
  clinicas: NuevaClinicaFila[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

// ---------------------------------------------------------------------
// Prompt A (platform_admin_registro) — tarifas, parámetros, directorio de
// países y consumo por clínica. Hasta ahora estas 4 áreas de
// administración se cambiaban editando la base a mano.
// ---------------------------------------------------------------------

export type TipoToken = "entrada" | "salida" | "cache_escritura" | "cache_lectura";

export interface TarifaFila {
  id: string;
  tipoToken: TipoToken;
  precioUsdPorMillon: number;
  facturable: boolean;
  vigenteDesde: string;
  vigenteHasta: string | null;
  vigente: boolean;
}

export interface TarifaModelo {
  modelo: string;
  facturable: boolean;
  tarifas: TarifaFila[];
}

export type AlertaTarifa =
  | { modelo: string; motivo: "sin_tarifa_vigente" | "tarifa_en_cero" }
  | { modelo: null; motivo: "credito_agotado"; detectadoEn: string | null };

export interface ParametroPlataforma {
  clave: string;
  valor: string;
  tipo: "numero" | "texto" | "booleano" | "json";
  descripcion: string | null;
  actualizadoEn: string;
  actualizadoPorNombre: string | null;
}

export interface RecargaProveedorIa {
  id: string;
  fecha: string;
  montoUsd: number;
  nota: string | null;
  creadoEn: string;
  cargadoPorNombre?: string;
}

export interface ConsumoPruebas {
  consumoUsd: number;
  topeUsd: number;
}

// ---------------------------------------------------------------------
// prompt_code_panel_consumo_sin_api — el saldo del proveedor de IA es
// una ESTIMACIÓN derivada (recargas menos consumo ya calculado en
// uso_api), nunca el número real del proveedor. Todo lo que viene de
// /saldo-proveedor-ia debe presentarse como tal.
// ---------------------------------------------------------------------
export interface ConsumoDiario {
  fecha: string;
  costoUsd: number;
}

export interface DesgloseBolsas {
  plan: number;
  comprado: number;
  prueba: number;
  colchon: number;
  otro: number;
}

export interface UltimaRecargaProveedor {
  fecha: string;
  montoUsd: number;
}

export interface UltimoControlSaldo {
  id: string;
  fecha: string;
  saldoObservadoUsd: number;
  diferenciaUsd: number;
  nota: string | null;
  registradoPorNombre: string | null;
  creadoEn: string;
}

export interface SaldoProveedorIa {
  saldoDerivadoUsd: number;
  origenDerivacion: "control" | "primera_recarga" | "sin_datos";
  desdeFecha: string | null;
  ritmoDiarioUsd: number;
  diasProyeccion: number | null;
  consumoDiario: ConsumoDiario[];
  desgloseBolsas: DesgloseBolsas;
  ultimaRecarga: UltimaRecargaProveedor | null;
  ultimoControl: UltimoControlSaldo | null;
}

export interface ControlSaldoProveedor {
  id: string;
  fecha: string;
  saldoObservadoUsd: number;
  diferenciaUsd: number;
  nota: string | null;
  registradoPorNombre: string | null;
  creadoEn: string;
}

export interface RentabilidadClinica {
  tenantId: string;
  nombre: string;
  estado: string;
  ingresoUsd: number;
  costoIaUsd: number;
  bonificacionUsd: number;
  comisionUsd: number;
  comisionConocida: boolean;
  margenUsd: number;
  margenSinComision: boolean;
  proporcionIaSobreIngreso: number | null;
  senalConsumoCercaDeIngreso: boolean;
  senalBajoConsumoRelativo: boolean;
}

export interface ImpuestoPais {
  nombre: string;
  tasa: number;
}

export interface PaisDirectorio {
  codigoIso: string;
  nombre: string;
  idiomaDefault: string;
  estado: "no_disponible" | "lista_espera" | "habilitado";
  monedaCotizacion: string;
  monedaLiquidacion: string | null;
  pasarelaCodigo: string | null;
  proveedorFacturacion: string | null;
  motivoInactivacion?: string | null;
  impuesto: ImpuestoPais | null;
}

export interface ClinicasPais {
  total: number;
  enPrueba: number;
}

export interface ChecklistPais {
  pasarela: boolean;
  impuestoVigente: boolean;
  proveedorFacturacion: boolean;
  idioma: boolean;
}

export interface TipoIdentificacionAdmin {
  id: string;
  codigo: string;
  etiqueta: string;
  aplicaPersonaFisica: boolean;
  aplicaPersonaJuridica: boolean;
  activo: boolean;
  orden: number;
}

export interface DetallePais {
  pais: PaisDirectorio;
  clinicas: ClinicasPais;
  checklist: ChecklistPais;
  tiposIdentificacion: TipoIdentificacionAdmin[];
}

export interface ListaEsperaPaisItem {
  paisCodigo: string;
  paisNombre: string | null;
  cantidad: number;
}

export interface InteresadoListaEspera {
  id: string;
  correo: string;
  paisCodigo: string | null;
  paisNombre: string | null;
  creadoEn: string;
}

export interface ListaEsperaPaises {
  totalInteresados: number;
  porPais: ListaEsperaPaisItem[];
  interesados: InteresadoListaEspera[];
}

export interface ClinicaConsumo {
  tenantId: string;
  nombre: string;
  plan: { id: string; nombre: string; codigo: string | null };
  estado: string;
  saldoUsd: number;
  consumoPeriodoUsd: number;
  proximoCobro: string | null;
}

export interface ResumenClinicas {
  clinicasActivas: number;
  clinicasPrueba: number;
  consumoAgregadoMesUsd: number;
  ingresosRecurrentesUsd: number;
}

export interface DesgloseConsumoItem {
  tipo: string;
  etiqueta: string;
  cantidad: number;
  montoUsd: number;
}

export interface MovimientoCreditoAdmin {
  id: string;
  tipo: string;
  bolsa: string;
  montoUsd: number;
  saldoPlanPost: number;
  saldoCompradoPost: number;
  descripcion: string | null;
  operador: string;
  creadoEn: string;
}

// Vetline_Ai_Suspension_Bloqueo.md — las 4 acciones manuales de ciclo de
// vida y el historial que las auditoría.
export type TipoEventoCicloVida =
  | "suspension_manual"
  | "reactivacion"
  | "bloqueo"
  | "desbloqueo"
  | "entrada_ventana_cierre"
  | "cancelacion_ventana_cierre"
  | "cierre_efectivo";

export interface EventoCicloVida {
  id: string;
  tipoEvento: TipoEventoCicloVida;
  motivo: string | null;
  estadoAnterior: string | null;
  estadoNuevo: string | null;
  ejecutadoPorNombre: string | null;
  ejecutadoEn: string;
}

export interface DetalleClinicaConsumo {
  nombre: string;
  plan: string;
  estado: string;
  saldoUsd: number;
  usuariosActivos: number;
  desgloseConsumo: DesgloseConsumoItem[];
  movimientos: MovimientoCreditoAdmin[];
  historialCicloVida: EventoCicloVida[];
}

// La vista previa inline solo existe para PDF (los navegadores lo
// renderizan nativamente en un <iframe>); todo lo demás va directo a
// descarga. Se detecta por extensión de archivo_ref, no por `tipo`
// (que es la categoría del documento, no su formato).
export function esArchivoPdf(archivoRef: string): boolean {
  return archivoRef.toLowerCase().endsWith(".pdf");
}

export const platformAdminApi = {
  // agente: undefined = sin filtro, null = solo compartidos, string = ese agente.
  listarDocumentos: (agente?: string | null) => {
    const query = agente === null ? "?agente=null" : agente ? `?agente=${agente}` : "";
    return authedFetch<{ documentos: DocumentoConocimiento[] }>(
      `/platform-admin/documentos${query}`
    );
  },

  subirDocumento: (data: {
    nombre: string;
    descripcion?: string;
    tipo: TipoDocumento;
    agenteId?: string | null;
    archivo: File;
  }) => {
    const formData = new FormData();
    formData.append("nombre", data.nombre);
    if (data.descripcion) formData.append("descripcion", data.descripcion);
    formData.append("tipo", data.tipo);
    if (data.agenteId) formData.append("agenteId", data.agenteId);
    formData.append("archivo", data.archivo);

    return apiFetch<{ documento: DocumentoConocimiento }>("/platform-admin/documentos", {
      method: "POST",
      token: getStoredToken(),
      body: formData,
    });
  },

  archivarDocumento: (id: string) =>
    authedFetch<{ documento: DocumentoConocimiento }>(
      `/platform-admin/documentos/${id}/archivar`,
      { method: "PATCH" }
    ),

  editarDocumento: (
    id: string,
    data: {
      nombre: string;
      descripcion?: string;
      tipo: TipoDocumento;
      agenteId?: string | null;
      paisCodigo?: string | null;
      version: string;
      archivo?: File;
    }
  ) => {
    const formData = new FormData();
    formData.append("nombre", data.nombre);
    if (data.descripcion) formData.append("descripcion", data.descripcion);
    formData.append("tipo", data.tipo);
    if (data.agenteId) formData.append("agenteId", data.agenteId);
    if (data.paisCodigo) formData.append("paisCodigo", data.paisCodigo);
    formData.append("version", data.version);
    if (data.archivo) formData.append("archivo", data.archivo);

    return apiFetch<{ documento: DocumentoConocimiento }>(`/platform-admin/documentos/${id}`, {
      method: "PATCH",
      token: getStoredToken(),
      body: formData,
    });
  },

  eliminarDocumento: (id: string) =>
    authedFetch<null>(`/platform-admin/documentos/${id}`, { method: "DELETE" }),

  // descargar=true fuerza attachment aun para PDF (el botón "Descargar");
  // sin eso, un PDF vuelve con Content-Disposition inline para el iframe
  // de vista previa.
  obtenerArchivo: (id: string, descargar = false) =>
    apiFetchBlob(`/platform-admin/documentos/${id}/archivo${descargar ? "?descargar=1" : ""}`, {
      token: getStoredToken(),
    }),

  listarAgentesCatalogo: () =>
    authedFetch<{ agentes: AgenteCatalogoCompleto[] }>("/platform-admin/agentes"),

  editarAgenteCatalogo: (
    id: string,
    data: {
      nombre: string;
      especialidad?: string;
      descripcion?: string;
      icono?: string;
      estado: "disponible" | "proximamente";
    }
  ) =>
    authedFetch<{ agente: AgenteCatalogoCompleto }>(`/platform-admin/agentes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Estado OPERATIVO del agente (activo/discontinuado/mantenimiento) —
  // distinto de estado_catalogo (disponible/proximamente) que edita
  // editarAgenteCatalogo de arriba.
  cambiarEstadoAgente: (
    id: string,
    data: { estado: EstadoAgente; motivoMantenimiento?: string; retornoEstimado?: string }
  ) =>
    authedFetch<{ agente: AgenteCatalogoCompleto }>(`/platform-admin/agentes/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  listarAuditoria: (filtros: {
    tenantId?: string;
    tipoAccion?: string;
    desde?: string;
    hasta?: string;
    pagina?: number;
  }) => {
    const params = new URLSearchParams();
    if (filtros.tenantId) params.set("tenantId", filtros.tenantId);
    if (filtros.tipoAccion) params.set("tipoAccion", filtros.tipoAccion);
    if (filtros.desde) params.set("desde", filtros.desde);
    if (filtros.hasta) params.set("hasta", filtros.hasta);
    if (filtros.pagina) params.set("pagina", String(filtros.pagina));
    return authedFetch<AuditoriaRespuesta>(`/platform-admin/auditoria?${params.toString()}`);
  },

  listarUsoIa: () => authedFetch<{ clinicas: UsoIaClinica[] }>("/platform-admin/facturacion/uso-ia"),

  facturarManualmente: (data: { tenantId: string; concepto: string; montoUsd: number }) =>
    authedFetch<{ factura: { clinica: string; concepto: string; monto: number; stripeInvoiceId: string } }>(
      "/platform-admin/facturas/manual",
      { method: "POST", body: JSON.stringify(data) }
    ),

  obtenerResumenFacturas: () => authedFetch<ResumenFacturas>("/platform-admin/facturacion/resumen-facturas"),

  listarFacturas: (filtros: {
    desde?: string;
    hasta?: string;
    q?: string;
    estado?: string;
    origen?: string;
    pagina?: number;
  }) => {
    const params = new URLSearchParams();
    if (filtros.desde) params.set("desde", filtros.desde);
    if (filtros.hasta) params.set("hasta", filtros.hasta);
    if (filtros.q) params.set("q", filtros.q);
    if (filtros.estado) params.set("estado", filtros.estado);
    if (filtros.origen) params.set("origen", filtros.origen);
    if (filtros.pagina) params.set("pagina", String(filtros.pagina));
    return authedFetch<FacturasRespuesta>(`/platform-admin/facturacion/facturas?${params.toString()}`);
  },

  obtenerResumenPagos: () => authedFetch<ResumenPagos>("/platform-admin/facturacion/resumen-pagos"),

  listarPagos: (filtros: { desde?: string; hasta?: string; q?: string; pagina?: number }) => {
    const params = new URLSearchParams();
    if (filtros.desde) params.set("desde", filtros.desde);
    if (filtros.hasta) params.set("hasta", filtros.hasta);
    if (filtros.q) params.set("q", filtros.q);
    if (filtros.pagina) params.set("pagina", String(filtros.pagina));
    return authedFetch<PagosRespuesta>(`/platform-admin/facturacion/pagos?${params.toString()}`);
  },

  obtenerResumenCancelaciones: () =>
    authedFetch<ResumenCancelaciones>("/platform-admin/facturacion/resumen-cancelaciones"),

  listarCancelaciones: (filtros: { q?: string; estado?: string; pagina?: number }) => {
    const params = new URLSearchParams();
    if (filtros.q) params.set("q", filtros.q);
    if (filtros.estado) params.set("estado", filtros.estado);
    if (filtros.pagina) params.set("pagina", String(filtros.pagina));
    return authedFetch<CancelacionesRespuesta>(`/platform-admin/facturacion/cancelaciones?${params.toString()}`);
  },

  obtenerResumenNuevasClinicas: () =>
    authedFetch<ResumenNuevasClinicas>("/platform-admin/facturacion/resumen-nuevas-clinicas"),

  listarNuevasClinicas: (filtros: { q?: string; pagina?: number }) => {
    const params = new URLSearchParams();
    if (filtros.q) params.set("q", filtros.q);
    if (filtros.pagina) params.set("pagina", String(filtros.pagina));
    return authedFetch<NuevasClinicasRespuesta>(`/platform-admin/facturacion/nuevas-clinicas?${params.toString()}`);
  },

  // -------------------------------------------------------------------
  // Tarifas
  // -------------------------------------------------------------------
  listarTarifas: () => authedFetch<{ modelos: TarifaModelo[] }>("/platform-admin/tarifas"),

  listarAlertasTarifas: () => authedFetch<{ alertas: AlertaTarifa[] }>("/platform-admin/tarifas/alertas"),

  crearTarifa: (data: { modelo: string; tipoToken: TipoToken; precioUsdPorMillon: number }) =>
    authedFetch<{ id: string }>("/platform-admin/tarifas", { method: "POST", body: JSON.stringify(data) }),

  cambiarFacturableModelo: (modelo: string, facturable: boolean) =>
    authedFetch<{ ok: true }>(`/platform-admin/tarifas/${encodeURIComponent(modelo)}/facturable`, {
      method: "PATCH",
      body: JSON.stringify({ facturable }),
    }),

  // -------------------------------------------------------------------
  // Parámetros
  // -------------------------------------------------------------------
  listarParametros: () => authedFetch<{ parametros: ParametroPlataforma[] }>("/platform-admin/parametros"),

  actualizarParametro: (clave: string, valor: string | number) =>
    authedFetch<ParametroPlataforma>(`/platform-admin/parametros/${encodeURIComponent(clave)}`, {
      method: "PUT",
      body: JSON.stringify({ valor }),
    }),

  obtenerConsumoPruebas: () => authedFetch<ConsumoPruebas>("/platform-admin/parametros/consumo-pruebas"),

  // -------------------------------------------------------------------
  // prompt_code_panel_consumo_plataforma, Paso 1 — recargas de la cuenta
  // de Anthropic (entrada manual, el saldo no se puede consultar por API).
  // -------------------------------------------------------------------
  listarRecargasProveedorIa: () =>
    authedFetch<{ recargas: RecargaProveedorIa[] }>("/platform-admin/recargas-proveedor-ia"),

  registrarRecargaProveedorIa: (data: { fecha: string; montoUsd: number; nota?: string }) =>
    authedFetch<RecargaProveedorIa>("/platform-admin/recargas-proveedor-ia", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // -------------------------------------------------------------------
  // prompt_code_panel_consumo_sin_api — saldo derivado, control manual y
  // rentabilidad por clínica (sin API de administración de Anthropic).
  // -------------------------------------------------------------------
  obtenerSaldoProveedorIa: () => authedFetch<SaldoProveedorIa>("/platform-admin/saldo-proveedor-ia"),

  listarControlesSaldoProveedorIa: () =>
    authedFetch<{ controles: ControlSaldoProveedor[] }>("/platform-admin/saldo-proveedor-ia/controles"),

  registrarControlSaldoProveedorIa: (data: { fecha: string; saldoObservadoUsd: number; nota?: string }) =>
    authedFetch<ControlSaldoProveedor>("/platform-admin/saldo-proveedor-ia/controles", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  obtenerRentabilidadClinicas: () =>
    authedFetch<{ periodoDias: number; clinicas: RentabilidadClinica[] }>("/platform-admin/clinicas/rentabilidad"),

  // -------------------------------------------------------------------
  // Directorio de países
  // -------------------------------------------------------------------
  listarPaisesAdmin: () => authedFetch<{ paises: PaisDirectorio[] }>("/platform-admin/paises"),

  obtenerDetallePais: (codigo: string) =>
    authedFetch<DetallePais>(`/platform-admin/paises/${encodeURIComponent(codigo)}`),

  actualizarPais: (
    codigo: string,
    data: Partial<{ monedaLiquidacion: string; pasarelaCodigo: string; proveedorFacturacion: string }>
  ) =>
    authedFetch<{ ok: true }>(`/platform-admin/paises/${encodeURIComponent(codigo)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  crearImpuestoPais: (codigo: string, data: { nombre: string; tasa: number }) =>
    authedFetch<{ id: string }>(`/platform-admin/paises/${encodeURIComponent(codigo)}/impuesto`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  crearTipoIdentificacion: (
    codigo: string,
    data: { codigo: string; etiqueta: string; aplicaPersonaFisica: boolean; aplicaPersonaJuridica: boolean }
  ) =>
    authedFetch<{ id: string }>(`/platform-admin/paises/${encodeURIComponent(codigo)}/tipos-identificacion`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  actualizarTipoIdentificacion: (id: string, data: { activo?: boolean; etiqueta?: string }) =>
    authedFetch<{ ok: true }>(`/platform-admin/tipos-identificacion/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  cambiarEstadoPais: (
    codigo: string,
    estado: "no_disponible" | "lista_espera" | "habilitado",
    motivo?: string
  ) =>
    authedFetch<{ codigoIso: string; estado: string }>(
      `/platform-admin/paises/${encodeURIComponent(codigo)}/estado`,
      { method: "PATCH", body: JSON.stringify({ estado, motivo }) }
    ),

  listarListaEsperaPaises: () => authedFetch<ListaEsperaPaises>("/platform-admin/lista-espera"),

  // -------------------------------------------------------------------
  // Consumo por clínica
  // -------------------------------------------------------------------
  listarClinicasConsumo: (filtros: { q?: string; estado?: string; planId?: string }) => {
    const params = new URLSearchParams();
    if (filtros.q) params.set("q", filtros.q);
    if (filtros.estado) params.set("estado", filtros.estado);
    if (filtros.planId) params.set("planId", filtros.planId);
    const qs = params.toString();
    return authedFetch<{ clinicas: ClinicaConsumo[] }>(`/platform-admin/clinicas${qs ? `?${qs}` : ""}`);
  },

  obtenerResumenClinicas: () => authedFetch<ResumenClinicas>("/platform-admin/clinicas/resumen"),

  obtenerDetalleClinicaConsumo: (tenantId: string) =>
    authedFetch<DetalleClinicaConsumo>(`/platform-admin/clinicas/${tenantId}`),

  ajustarSaldoClinica: (tenantId: string, data: { montoUsd: number; motivo: string }) =>
    authedFetch<{ saldoUsd: number }>(`/platform-admin/clinicas/${tenantId}/ajuste-saldo`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  suspenderClinica: (tenantId: string, motivo: string) =>
    authedFetch<{ ok: true }>(`/platform-admin/clinicas/${tenantId}/suspender`, {
      method: "POST",
      body: JSON.stringify({ motivo }),
    }),

  reactivarClinica: (tenantId: string, motivo: string) =>
    authedFetch<{ ok: true }>(`/platform-admin/clinicas/${tenantId}/reactivar`, {
      method: "POST",
      body: JSON.stringify({ motivo }),
    }),

  bloquearClinica: (tenantId: string, motivo: string) =>
    authedFetch<{ ok: true }>(`/platform-admin/clinicas/${tenantId}/bloquear`, {
      method: "POST",
      body: JSON.stringify({ motivo }),
    }),

  desbloquearClinica: (tenantId: string, motivo: string) =>
    authedFetch<{ ok: true }>(`/platform-admin/clinicas/${tenantId}/desbloquear`, {
      method: "POST",
      body: JSON.stringify({ motivo }),
    }),
};
