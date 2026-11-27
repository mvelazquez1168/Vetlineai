import { getStoredToken } from "../hooks/useAuth";
import { apiFetch, apiFetchFile } from "./api";

// ---------------------------------------------------------------------
// Cliente de la API del facturador electrónico de Costa Rica.
//
// El contrato completo —y, sobre todo, qué significa cada estado y qué
// tiene que hacer quien factura con cada uno— está en
// `docs/facturacion/contrato-api.md`. Acá solo están los tipos y las
// llamadas.
// ---------------------------------------------------------------------

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export type EstadoComprobante =
  | "borrador"
  | "firmado"
  | "en_cola"
  | "enviado"
  | "aceptado"
  | "aceptado_parcial"
  | "rechazado"
  | "error";

export interface OpcionCatalogo {
  codigo: string;
  nombre: string;
  exigeDetalle?: boolean;
}

export interface Catalogos {
  tiposComprobante: OpcionCatalogo[];
  tiposIdentificacion: OpcionCatalogo[];
  condicionesVenta: OpcionCatalogo[];
  mediosPago: OpcionCatalogo[];
  tarifasIva: Array<OpcionCatalogo & { tarifa: number }>;
  unidadesMedida: Array<{ codigo: string; descripcion: string }>;
  codigosDescuento: OpcionCatalogo[];
  codigosReferencia: OpcionCatalogo[];
}

export interface ResultadoCabys {
  resultados: Array<{ codigo: string; descripcion: string; codigoTarifaIvaSugerido: string | null }>;
  catalogoVacio: boolean;
  aviso?: string;
}

export interface Emisor {
  id: string;
  tipoIdentificacion: string;
  numeroIdentificacion: string;
  nombre: string;
  nombreComercial?: string | null;
  codigoActividadEconomica: string;
  registroFiscal8707?: string | null;
  ubicacionProvincia: string;
  ubicacionCanton: string;
  ubicacionDistrito: string;
  ubicacionBarrio?: string | null;
  ubicacionOtrasSenas: string;
  telefonoCodigoPais?: string | null;
  telefonoNumero?: string | null;
  correo: string;
  proveedorSistemas: string;
  sucursal: string;
  terminal: string;
  ambienteActivo: "pruebas" | "produccion";
}

/**
 * Lo único que la API devuelve de una credencial. No hay campo con la
 * contraseña, la llave ni el PIN: no es que la pantalla los oculte, es
 * que el backend no los manda.
 */
export interface CredencialPublica {
  ambiente: "pruebas" | "produccion";
  usuarioApi: string;
  llaveNombreArchivo: string | null;
  llaveVenceEn: string | null;
  diasParaVencer: number | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface ComprobanteListado {
  id: string;
  tipoComprobante: string;
  tipoComprobanteNombre: string;
  /** `null` mientras es borrador: la identidad se asigna al emitir. */
  clave: string | null;
  consecutivo: string | null;
  fechaEmision: string;
  estado: EstadoComprobante;
  estadoLegible: string;
  receptorNombre: string | null;
  receptorIdentificacion: string | null;
  moneda: string;
  totalComprobante: string;
  indEstado: string | null;
  detalle: string | null;
}

export interface LineaDetalleApi {
  numero_linea: number;
  codigo_cabys: string | null;
  cantidad: string;
  unidad_medida: string;
  detalle: string;
  precio_unitario: string;
  subtotal: string;
  base_imponible: string;
  impuesto_neto: string;
  monto_total_linea: string;
  impuestos: Array<{
    codigoImpuesto: string;
    codigoTarifaIva: string | null;
    tarifa: string | null;
    monto: string;
    montoExonerado: string | null;
  }>;
  descuentos: Array<{ monto: string; codigo: string; naturaleza: string | null }>;
}

export interface EventoComprobante {
  tipo_evento: string;
  detalle: Record<string, unknown> | null;
  creado_en: string;
}

export interface DetalleComprobante {
  comprobante: Record<string, unknown> & {
    id: string;
    /** `null` mientras es borrador: la identidad se asigna al emitir. */
    clave: string | null;
    consecutivo: string | null;
    tipo_comprobante: string;
    estado: EstadoComprobante;
    estadoLegible: string;
    fecha_emision: string;
    moneda: string;
    total_comprobante: string;
    total_gravado: string;
    total_exento: string;
    total_descuentos: string;
    total_venta_neta: string;
    total_impuesto: string;
    total_otros_cargos: string;
    receptor_nombre: string | null;
    receptor_numero_identificacion: string | null;
    receptor_correo: string | null;
    respuesta_ind_estado: string | null;
    respuesta_detalle: string | null;
    xmlFirmado: string | null;
    respuestaXml: string | null;
  };
  lineas: LineaDetalleApi[];
  eventos: EventoComprobante[];
  referencias: Array<{
    tipo_documento: string;
    numero: string | null;
    fecha_emision: string;
    codigo: string | null;
    razon: string | null;
  }>;
  mediosPago: Array<{ codigo_medio_pago: string; medio_pago_otro: string | null; monto: string | null }>;
  notas: Array<{
    id: string;
    tipo_comprobante: string;
    consecutivo: string;
    clave: string;
    estado: string;
    total_comprobante: string;
  }>;
}

export interface Recibido {
  id: string;
  clave: string;
  tipoComprobante: string | null;
  tipoComprobanteNombre: string | null;
  consecutivo: string | null;
  emisorNombre: string | null;
  emisorIdentificacion: string | null;
  fechaEmision: string | null;
  totalComprobante: string | null;
  totalImpuesto: string | null;
  moneda: string | null;
  validacionOk: boolean | null;
  validacionDetalle: string | null;
  /** Si el receptor del XML es esta clínica. `null` = no se pudo leer. */
  receptorEsLaClinica: boolean | null;
  /** Si la firma digital verifica. `null` = no se pudo comprobar. */
  firmaValida: boolean | null;
  firmaDetalle: string | null;
  responderHasta: string | null;
  plazoVencido: boolean | null;
  plazoPorVencer: boolean | null;
  compraId: string | null;
  registradoEnInventario: string | null;
  mensajeTipo: string | null;
  mensajeConsecutivo: string | null;
  mensajeCondicionImpuesto: string | null;
  mensajeIndEstado: string | null;
  mensajeEnviadoEn: string | null;
  creadoEn: string;
}

/** El documento de venta, igual que lo documenta el contrato. */
export interface LineaDocumento {
  codigoCabys?: string;
  cantidad: string | number;
  unidadMedida: string;
  detalle: string;
  precioUnitario: string | number;
  descuentos?: Array<{ monto: string | number; codigoDescuento: string; naturaleza?: string }>;
  impuestos: Array<{ codigo: string; codigoTarifaIva?: string }>;
}

export interface DocumentoVenta {
  tipoComprobante: string;
  condicionVenta: string;
  condicionVentaDetalle?: string;
  plazoCreditoDias?: number;
  moneda?: string;
  tipoCambio?: string | number;
  receptor?: {
    nombre: string;
    identificacion?: { tipo: string; numero: string };
    correo?: string;
    telefono?: { codigoPais: string; numero: string };
    ubicacion?: {
      provincia: string;
      canton: string;
      distrito: string;
      barrio?: string;
      otrasSenas: string;
    };
  };
  lineas: LineaDocumento[];
  mediosPago?: Array<{ codigo: string; otro?: string; monto?: string | number }>;
  /** Sale en el XML como Otros/OtroTexto. Máximo 500 caracteres. */
  observaciones?: string;
  /** De qué ficha de cliente salieron los datos del receptor. */
  receptorPropietarioId?: string;
  /** De qué perfil de facturación salió el receptor (trazabilidad). */
  receptorPerfilId?: string;
  claveIdempotencia?: string;
}

/** Un cliente de la clínica, como lo devuelve la búsqueda de receptores. */
/**
 * A nombre de quién se puede facturar: un cliente o un perfil de
 * facturación. La búsqueda devuelve las dos cosas en una lista, con
 * `tipo` para saber qué es cada una.
 */
export interface ReceptorPosible {
  tipo: "cliente" | "perfil";
  id: string;
  nombre: string;
  tipoIdentificacion: string | null;
  numeroIdentificacion: string | null;
  correo: string | null;
  /** La segunda línea de la opción: qué es y a quién sirve. */
  detalle: string;
  puntaje: number;
}

export interface PerfilFacturacion {
  id: string;
  nombre: string;
  nombre_comercial: string | null;
  tipo_identificacion: string;
  numero_identificacion: string;
  ubicacion_provincia: string | null;
  ubicacion_canton: string | null;
  ubicacion_distrito: string | null;
  ubicacion_barrio: string | null;
  ubicacion_otras_senas: string | null;
  correo: string | null;
  telefono_codigo_pais: string | null;
  telefono_numero: string | null;
  codigo_actividad: string | null;
  activo: boolean;
}

export interface ReceptorEncontrado {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  numero_identificacion: string | null;
  tipo_identificacion_etiqueta: string | null;
  tipo_identificacion_codigo: string | null;
  cantidad_pacientes: number;
}

/**
 * Los totales calculados por el MISMO motor que emite. Los montos
 * vienen como cadenas con los decimales que usa el Anexo.
 */
export interface VistaPrevia {
  resumen: Record<string, string | number>;
  lineas: Array<{
    numeroLinea: number;
    subtotal: string | number;
    baseImponible: string | number;
    impuestoNeto: string | number;
    montoTotalLinea: string | number;
  }>;
}

export interface ResultadoEmision {
  comprobanteId: string;
  clave: string;
  consecutivo: string;
  estado: EstadoComprobante;
  yaExistia: boolean;
  indEstado?: string;
  detalle?: string;
  entrega?: { enviado: boolean; motivo?: string };
}

export interface FiltrosComprobantes {
  tipo?: string;
  estado?: string;
  desde?: string;
  hasta?: string;
  receptor?: string;
  pagina?: number;
  porPagina?: number;
}

function queryDe(filtros: FiltrosComprobantes): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) {
    if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Un nivel de la codificación de ubicación de Hacienda. */
export interface NivelUbicacion {
  nivel: "provincia" | "canton" | "distrito" | "barrio";
  resultados: Array<{ codigo: string; nombre: string }>;
  /** `true` si la codificación no está cargada en este servidor. */
  catalogoVacio: boolean;
}

export const facturacionCrApi = {
  catalogos: () => authedFetch<Catalogos>("/facturacion/catalogos"),

  buscarCabys: (q: string) =>
    authedFetch<ResultadoCabys>(`/facturacion/cabys?q=${encodeURIComponent(q)}`),

  /**
   * Un nivel de la codificación oficial de ubicación. Sin argumentos
   * da las provincias; con provincia, sus cantones; y así.
   */
  ubicacion: (padre: { provincia?: string; canton?: string; distrito?: string } = {}) => {
    const q = new URLSearchParams();
    if (padre.provincia) q.set("provincia", padre.provincia);
    if (padre.canton) q.set("canton", padre.canton);
    if (padre.distrito) q.set("distrito", padre.distrito);
    return authedFetch<NivelUbicacion>(`/facturacion/ubicacion?${q.toString()}`);
  },

  emisor: () =>
    authedFetch<{ emisor: Emisor | null; credenciales: CredencialPublica[] }>("/facturacion/emisor"),

  guardarEmisor: (datos: Partial<Emisor>) =>
    authedFetch<{ emisor: Emisor }>("/facturacion/emisor", {
      method: "PUT",
      body: JSON.stringify(datos),
    }),

  /**
   * La llave `.p12` va como `multipart/form-data`. `apiFetch` ya detecta
   * un FormData y NO le pone Content-Type, para que el navegador arme su
   * propio boundary — así que esta llamada usa el mismo cliente que
   * todas las demás, sin un `fetch` a mano.
   */
  guardarCredenciales: (datos: {
    ambiente: "pruebas" | "produccion";
    usuarioApi: string;
    passwordApi: string;
    pinLlave: string;
    llave: File;
  }) => {
    const form = new FormData();
    form.set("ambiente", datos.ambiente);
    form.set("usuarioApi", datos.usuarioApi);
    form.set("passwordApi", datos.passwordApi);
    form.set("pinLlave", datos.pinLlave);
    form.set("llave", datos.llave, datos.llave.name);
    return authedFetch<{ credencial: CredencialPublica; certificado: Record<string, unknown> }>(
      "/facturacion/emisor/credenciales",
      { method: "PUT", body: form }
    );
  },

  borrarCredenciales: (ambiente: "pruebas" | "produccion") =>
    authedFetch<{ borrada: boolean }>(`/facturacion/emisor/credenciales/${ambiente}`, {
      method: "DELETE",
    }),

  listar: (filtros: FiltrosComprobantes = {}) =>
    authedFetch<{
      total: number;
      pagina: number;
      porPagina: number;
      comprobantes: ComprobanteListado[];
    }>(`/facturacion/comprobantes${queryDe(filtros)}`),

  detalle: (id: string) => authedFetch<DetalleComprobante>(`/facturacion/comprobantes/${id}`),

  emitir: (documento: DocumentoVenta) =>
    authedFetch<ResultadoEmision>("/facturacion/comprobantes", {
      method: "POST",
      body: JSON.stringify(documento),
    }),

  /** Totales exactos, del motor. La pantalla NO calcula por su cuenta. */
  vistaPrevia: (documento: DocumentoVenta) =>
    authedFetch<VistaPrevia>("/facturacion/comprobantes/vista-previa", {
      method: "POST",
      body: JSON.stringify(documento),
    }),

  /**
   * Solo CLIENTES. Es la que usan la caja (para el dueño de la cuenta),
   * la cuenta corriente y los encargos: ahí el receptor no aplica, lo
   * que hace falta es el cliente.
   */
  buscarClientes: (q: string) =>
    authedFetch<{ clientes: ReceptorEncontrado[] }>(
      `/facturacion/clientes?q=${encodeURIComponent(q)}`
    ),

  /** Busca en clientes Y perfiles de facturación. */
  buscarReceptores: (q: string) =>
    authedFetch<{ receptores: ReceptorPosible[] }>(
      `/facturacion/receptores?q=${encodeURIComponent(q)}`
    ),

  perfilesDeCliente: (propietarioId: string) =>
    authedFetch<{ perfiles: Array<PerfilFacturacion & { es_predeterminado: boolean }> }>(
      `/facturacion/clientes/${propietarioId}/perfiles-facturacion`
    ),
  perfiles: (q = "") =>
    authedFetch<{ perfiles: Array<PerfilFacturacion & { clientes: number }> }>(
      `/facturacion/perfiles-facturacion?q=${encodeURIComponent(q)}`
    ),
  perfil: (id: string) =>
    authedFetch<{ perfil: PerfilFacturacion }>(`/facturacion/perfiles-facturacion/${id}`),
  crearPerfil: (datos: Record<string, unknown>) =>
    authedFetch<{ id: string }>("/facturacion/perfiles-facturacion", {
      method: "POST",
      body: JSON.stringify(datos),
    }),
  editarPerfil: (id: string, datos: Record<string, unknown>) =>
    authedFetch<{ ok: true }>(`/facturacion/perfiles-facturacion/${id}`, {
      method: "PUT",
      body: JSON.stringify(datos),
    }),
  ligarPerfilACliente: (id: string, datos: Record<string, unknown>) =>
    authedFetch<{ ok: true }>(`/facturacion/perfiles-facturacion/${id}/clientes`, {
      method: "POST",
      body: JSON.stringify(datos),
    }),
  desligarPerfilDeCliente: (id: string, propietarioId: string) =>
    authedFetch<{ ok: true }>(
      `/facturacion/perfiles-facturacion/${id}/clientes/${propietarioId}`,
      { method: "DELETE" }
    ),

  crearReceptor: (datos: {
    nombre: string;
    telefono?: string;
    email?: string;
    tipoIdentificacionCodigo?: string;
    numeroIdentificacion?: string;
  }) =>
    authedFetch<{ id: string }>("/facturacion/receptores", {
      method: "POST",
      body: JSON.stringify(datos),
    }),

  guardarBorrador: (documento: DocumentoVenta, id?: string) =>
    authedFetch<{ id: string; estado: string }>(
      id ? `/facturacion/borradores/${id}` : "/facturacion/borradores",
      { method: id ? "PUT" : "POST", body: JSON.stringify(documento) }
    ),

  borrarBorrador: (id: string) =>
    authedFetch<void>(`/facturacion/borradores/${id}`, { method: "DELETE" }),

  emitirBorrador: (id: string) =>
    authedFetch<ResultadoEmision>(`/facturacion/borradores/${id}/emitir`, { method: "POST" }),

  nota: (id: string, tipo: "credito" | "debito", datos: { codigoReferencia: string; razon: string }) =>
    authedFetch<ResultadoEmision>(`/facturacion/comprobantes/${id}/nota-${tipo}`, {
      method: "POST",
      body: JSON.stringify(datos),
    }),

  reenviar: (id: string, destino: "hacienda" | "correo") =>
    authedFetch<{ destino: string; estado?: string; entrega?: { enviado: boolean; motivo?: string } }>(
      `/facturacion/comprobantes/${id}/reenviar`,
      { method: "POST", body: JSON.stringify({ destino }) }
    ),

  /**
   * El PDF y el XML se traen como blob autenticado y NO con un `<a
   * href>`: un enlace directo no manda el header Authorization, así que
   * la descarga daría 401. `apiFetchFile` además extrae el nombre de
   * archivo real del Content-Disposition que arma el backend —que es el
   * de la Nota 3, `clave.pdf`— en vez de inventar uno en el cliente.
   */
  descargarPdf: (id: string) =>
    apiFetchFile(`/facturacion/comprobantes/${id}/pdf`, { token: getStoredToken() }),
  descargarXml: (id: string) =>
    apiFetchFile(`/facturacion/comprobantes/${id}/xml`, { token: getStoredToken() }),

  recibidos: () => authedFetch<{ recibidos: Recibido[] }>("/facturacion/recibidos"),

  /** Las líneas del XML, con lo que la equivalencia ya reconoce (B2). */
  lineasDelRecibido: (id: string) =>
    authedFetch<{
      lineas: Array<{
        numeroLinea: number;
        codigoProveedor: string | null;
        descripcion: string;
        cantidad: number;
        precioUnitario: number;
        productoId: string | null;
        presentacionId: string | null;
        productoNombre: string | null;
      }>;
      proveedorId: string | null;
      proveedorNombre: string | null;
      yaRegistrado: boolean;
    }>(`/facturacion/recibidos/${id}/lineas`),

  registrarCompraDelRecibido: (id: string, d: Record<string, unknown>) =>
    authedFetch<{ compraId: string; movimientos: number; equivalenciasGuardadas: number }>(
      `/facturacion/recibidos/${id}/registrar-compra`,
      { method: "POST", body: JSON.stringify(d) }
    ),

  /** Las actividades económicas del emisor y sus reglas (B1). */
  actividadesEconomicas: () =>
    authedFetch<{
      actividades: Array<{
        id: string;
        codigo: string;
        descripcion: string | null;
        esPredeterminada: boolean;
      }>;
      reglas: Array<{ lineaNegocio: string; actividadId: string; codigo: string }>;
    }>("/facturacion/actividades"),
  guardarActividad: (d: Record<string, unknown>) =>
    authedFetch<{ id: string }>("/facturacion/actividades", {
      method: "POST",
      body: JSON.stringify(d),
    }),
  guardarReglaActividad: (d: Record<string, unknown>) =>
    authedFetch<{ ok: true }>("/facturacion/actividades/regla", {
      method: "PUT",
      body: JSON.stringify(d),
    }),

  cargarRecibido: (xml: string) =>
    authedFetch<{
      id: string;
      clave: string;
      validacionOk: boolean;
      validacionDetalle?: string;
      yaEstaba: boolean;
    }>("/facturacion/recibidos", { method: "POST", body: JSON.stringify({ xml }) }),

  mensajeReceptor: (
    id: string,
    datos: { mensaje: "1" | "2" | "3"; condicionImpuesto?: string; detalle?: string }
  ) =>
    authedFetch<{ consecutivo: string; estado: string; indEstado?: string }>(
      `/facturacion/recibidos/${id}/mensaje`,
      { method: "POST", body: JSON.stringify(datos) }
    ),
};

/**
 * El color del badge según el estado.
 *
 * Vive acá y no en cada pantalla porque las tres lo necesitan, y tres
 * mapas separados divergen: el día que se agregue un estado, dos se
 * actualizan y el tercero lo pinta gris.
 *
 * `en_cola` y `enviado` son INFO y no warning: no hay nada que corregir
 * —el comprobante está bien y va en camino— y pintarlos de amarillo haría
 * que una clínica crea que tiene un problema.
 */
export function varianteEstado(
  estado: EstadoComprobante
): "success" | "warning" | "error" | "info" | "neutral" {
  switch (estado) {
    case "aceptado":
      return "success";
    case "aceptado_parcial":
      return "warning";
    case "rechazado":
    case "error":
      return "error";
    case "enviado":
    case "en_cola":
      return "info";
    default:
      return "neutral";
  }
}

/** Montos con 5 decimales en la base, 2 en pantalla. */
export function formatearMonto(valor: string | number, moneda = "CRC"): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor);
  return `${moneda} ${n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
