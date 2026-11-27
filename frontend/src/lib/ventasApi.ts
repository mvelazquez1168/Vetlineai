import { getStoredToken } from "../hooks/useAuth";
import { apiFetch, apiFetchFile } from "./api";

// ---------------------------------------------------------------------
// Cliente de la API del módulo `ventas`.
//
// Mismo criterio que los otros dos: tipos y llamadas, nada de lógica.
// La conversión de dólares, el vuelto, el umbral del arqueo y la
// política de descuentos viven en el backend, y la pantalla no los
// replica.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}
function json<T>(path: string, metodo: string, cuerpo: unknown): Promise<T> {
  return pedir<T>(path, { method: metodo, body: JSON.stringify(cuerpo) });
}

export type MedioArqueo = "efectivo" | "tarjeta" | "sinpe" | "otros";

export interface Caja {
  id: string;
  nombre: string;
  bodega: string;
  bodega_id: string;
  sucursal: string;
  terminal: string;
  imprime_tiquete: boolean;
  sesion_abierta: string | null;
}

export interface Sesion {
  id: string;
  caja: string;
  estado: "abierta" | "cerrada";
  fondo_crc: string;
  fondo_usd: string;
  abierta_en: string;
  abierta_por_nombre: string | null;
  cerrada_en: string | null;
  cerrada_por_nombre: string | null;
}

export interface LineaEsperada {
  medio: MedioArqueo;
  moneda: string;
  esperado: number;
}

export interface CobroListado {
  id: string;
  total: string;
  vuelto_crc: string;
  creado_en: string;
  estado: string;
  cajero: string | null;
  cuenta_numero: number | null;
  cliente_nombre: string | null;
  consecutivo: string | null;
  tipo_comprobante: string | null;
}

export interface MovimientoEfectivo {
  id: string;
  tipo: string;
  moneda: string;
  monto: string;
  categoria_gasto: string | null;
  motivo: string;
  persona: string | null;
  creado_en: string;
}

export interface CuentaListada {
  id: string;
  numero: number;
  cliente_nombre: string | null;
  estado: string;
  abierta_en: string;
  cargos: number;
  total: string;
  /** Las descripciones de los cargos, para no tener que abrir la cuenta. */
  resumen: string | null;
  /** Cuántas mascotas distintas tienen cargos en la cuenta. */
  pacientes: number;
  primer_paciente: string | null;
  antiguedad_segundos: number;
}

/** Cuánto entró por cada medio de pago en la sesión. */
export interface LineaPorMedio {
  medio: string;
  moneda: string;
  es_fiscal: boolean;
  monto: string;
  monto_crc: string;
  cobros: number;
}

export interface Cargo {
  id: string;
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  descuento: string;
  paciente: string | null;
  creado_por_nombre: string | null;
  anulado_en: string | null;
  /** Nombre de la lista de precio que determinó el precio, si hubo una. */
  lista_precio_nombre?: string | null;
}

export interface TotalesCuenta {
  neto: number;
  descuentos: number;
  impuesto: number;
  total: number;
  cobrado: number;
  saldo: number;
}

export interface Aprobacion {
  id: string;
  tipo: string;
  estado: "pendiente" | "aprobada" | "rechazada";
  monto: string | null;
  motivo: string;
  solicitada_en: string;
  resuelta_en: string | null;
  solicitada_por_nombre: string | null;
  resuelta_por_nombre: string | null;
}

export interface Encargo {
  id: string;
  cliente: string;
  propietario_id: string;
  producto: string | null;
  producto_id: string | null;
  descripcion: string;
  cantidad: string;
  estado: string;
  creado_en: string;
  /** Lo que el cliente dejó al encargarlo, y lo que todavía no se aplicó. */
  anticipo: string;
  anticipo_disponible: string;
  /** La orden de compra con la que se pidió, si se armó una. */
  orden_numero: number | null;
  orden_compra_id: string | null;
  lote_reservado_id: string | null;
  cantidad_reservada: string;
}

export interface Provisional {
  id: string;
  numero: number;
  estado: string;
  caja: string | null;
  fecha_venta: string | null;
}


// ---------------------------------------------------------------------
// LA CONFIGURACIÓN DE LA CAJA — prompt 08b, A2, A3 y A4.
// ---------------------------------------------------------------------

export interface TopeDescuento {
  id: string;
  rol: string;
  /** `null` = sin tope propio: rige el general de la clínica. */
  tope_pct: string | null;
  puede_autorizar: boolean;
}

export interface MotivoDescuento {
  id: string;
  etiqueta: string;
  codigo_hacienda: string;
  codigo_hacienda_otro: string | null;
  exige_autorizacion: boolean;
}

export interface Denominacion {
  id: string;
  moneda: string;
  valor: string;
  especie: string;
  de_la_clinica: boolean;
}

export interface ComisionTarjeta {
  id: string;
  banco: string;
  tipo_tarjeta: string;
  marca: string | null;
  comision_pct: string;
  comision_fija: string;
  vigente_desde: string;
}

/** Hasta cuánto puede descontar quien pregunta, en esta línea. */
export interface TopeVigente {
  topePct: number | null;
  origen: "producto" | "servicio" | "rol" | "clinica" | "sin_tope";
  detalle: { producto: number | null; servicio: number | null; rol: number | null; clinica: number | null };
  puedeAutorizar: boolean;
}

export interface ConciliacionTarjetas {
  filas: Array<{
    banco: string | null;
    tipoTarjeta: string | null;
    marca: string | null;
    sistemaCantidad: number;
    sistemaMonto: number;
    loteCantidad: number | null;
    loteMonto: number | null;
    diferencia: number | null;
  }>;
  cobros: Array<{
    cobroId: string;
    banco: string | null;
    tipoTarjeta: string | null;
    monto: number;
    referencia: string | null;
    comisionEstimada: number | null;
    netoEsperado: number | null;
    cobradoEn: string;
  }>;
  totalSistema: number;
  totalLote: number | null;
  diferenciaDelTotal: number | null;
  cobrosSinBanco: number;
  diferenciaTotal: number;
  comisionTotal: number;
}


// ---------------------------------------------------------------------
// PRESUPUESTOS — prompt 08b, A1.
// ---------------------------------------------------------------------

export interface PresupuestoListado {
  id: string;
  numero: number;
  estado: string;
  cliente_nombre: string | null;
  propietario_id: string | null;
  paciente_nombre: string | null;
  vence_el: string | null;
  creado_en: string;
  vencido: boolean;
  total: number;
}

export interface PresupuestoDetalleDatos {
  id: string;
  numero: number;
  estado: string;
  cliente_nombre: string | null;
  propietario_id: string | null;
  paciente_id: string | null;
  paciente_nombre: string | null;
  atencion_id: string | null;
  observaciones: string | null;
  vigencia_dias: number;
  vence_el: string | null;
  vencido: boolean;
  respondido_como: string | null;
  respuesta_nota: string | null;
  cuenta_id: string | null;
  cuenta_numero: number | null;
  anticipado: number;
  total: number;
  lineas: Array<{
    id: string;
    descripcion: string;
    cantidad: string;
    precio_unitario: string;
    descuento: string;
    nota: string | null;
    descuento_naturaleza: string | null;
  }>;
}

export const ventasApi = {
  // ------------------------------------------------------------------
  // Presupuestos (prompt 08b, A1).
  // ------------------------------------------------------------------
  presupuestos: (q: { estado?: string; cliente?: string; porVencer?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (q.estado) p.set("estado", q.estado);
    if (q.cliente) p.set("cliente", q.cliente);
    if (q.porVencer) p.set("porVencer", "1");
    return pedir<{ presupuestos: PresupuestoListado[] }>(`/ventas/presupuestos?${p.toString()}`);
  },
  presupuesto: (id: string) =>
    pedir<{ presupuesto: PresupuestoDetalleDatos }>(`/ventas/presupuestos/${id}`),
  crearPresupuesto: (d: Record<string, unknown>) =>
    json<{ id: string; numero: number; total: number }>("/ventas/presupuestos", "POST", d),
  enviarPresupuesto: (id: string) =>
    json<{ ok: true }>(`/ventas/presupuestos/${id}/enviar`, "POST", {}),
  responderPresupuesto: (id: string, d: { acepta: boolean; como: string; nota?: string }) =>
    json<{ ok: true }>(`/ventas/presupuestos/${id}/respuesta`, "POST", d),
  convertirPresupuesto: (
    id: string,
    d: { cuentaId?: string; sesionId?: string; bodegaId?: string; precioVencido?: string } = {}
  ) =>
    json<{
      cuentaId: string;
      cuentaNumero: number;
      cargos: number;
      total: number;
      anticipoDisponible: number;
      avisos: string[];
    }>(`/ventas/presupuestos/${id}/convertir`, "POST", d),
  presupuestoPdf: (id: string) =>
    apiFetchFile(`/ventas/presupuestos/${id}/pdf`, { token: getStoredToken() }),

  // ------------------------------------------------------------------
  // Configuración de la caja (prompt 08b, A2, A3 y A4).
  // ------------------------------------------------------------------
  /** El personal de la clínica: quién recibió un vale, quién hizo un servicio. */
  personalDeLaClinica: () =>
    pedir<{
      personas: Array<{ id: string; nombre: string; es_medico: boolean; es_admin_clinica: boolean }>;
    }>("/ventas/personal"),
  denominaciones: () => pedir<{ denominaciones: Denominacion[] }>("/ventas/denominaciones"),
  crearDenominacion: (d: Record<string, unknown>) =>
    json<{ id: string }>("/ventas/denominaciones", "POST", d),
  motivosDescuento: () => pedir<{ motivos: MotivoDescuento[] }>("/ventas/motivos-descuento"),
  topesDescuento: () => pedir<{ topes: TopeDescuento[] }>("/ventas/topes-descuento"),
  guardarTopeDescuento: (d: { rol: string; topePct: number | null; puedeAutorizar: boolean }) =>
    json<{ ok: true }>("/ventas/topes-descuento", "PUT", d),
  /** El tope que rige para una línea concreta, antes de escribir el descuento. */
  topeVigente: (q: { presentacion?: string; servicio?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.presentacion) p.set("presentacion", q.presentacion);
    if (q.servicio) p.set("servicio", q.servicio);
    return pedir<TopeVigente>(`/ventas/tope-descuento?${p.toString()}`);
  },
  comisionesTarjeta: () => pedir<{ comisiones: ComisionTarjeta[] }>("/ventas/comisiones-tarjeta"),
  crearComisionTarjeta: (d: Record<string, unknown>) =>
    json<{ id: string }>("/ventas/comisiones-tarjeta", "POST", d),
  guardarLoteDatafono: (sesionId: string, lineas: Array<Record<string, unknown>>) =>
    json<{ guardadas: number }>(`/ventas/sesiones/${sesionId}/lote-datafono`, "PUT", { lineas }),
  conciliacionTarjetas: (sesionId: string) =>
    pedir<ConciliacionTarjetas>(`/ventas/sesiones/${sesionId}/conciliacion-tarjetas`),

  cajas: () => pedir<{ cajas: Caja[] }>("/ventas/cajas"),
  crearCaja: (d: Record<string, unknown>) => json<{ id: string }>("/ventas/cajas", "POST", d),

  sesion: (id: string) =>
    pedir<{
      sesion: Sesion;
      comprobantes: { facturas: number; tiquetes: number; sinComprobante: number };
      esperado: LineaEsperada[];
      cobros: CobroListado[];
      movimientos: MovimientoEfectivo[];
      cuentasAbiertas: CuentaListada[];
      porMedio: LineaPorMedio[];
    }>(`/ventas/sesiones/${id}`),
  abrirSesion: (d: { cajaId: string; fondoCrc?: number; fondoUsd?: number }) =>
    json<{ id: string }>("/ventas/sesiones", "POST", d),
  cerrarSesion: (id: string, d: Record<string, unknown>) =>
    json<{
      cerrada: boolean;
      lineas: Array<LineaEsperada & { declarado: number; diferencia: number }>;
      diferenciaTotalCrc: number;
      umbral: number;
      aprobacionId?: string;
    }>(`/ventas/sesiones/${id}/cerrar`, "POST", d),
  movimientoEfectivo: (sesionId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/ventas/sesiones/${sesionId}/efectivo`, "POST", d),

  tipoCambio: () => pedir<{ valor: number | null; aviso?: string }>("/ventas/tipo-cambio"),
  guardarTipoCambio: (valor: number) => json<{ ok: true }>("/ventas/tipo-cambio", "PUT", { valor }),

  cuentas: (estado = "abierta") =>
    pedir<{ cuentas: CuentaListada[] }>(`/ventas/cuentas?estado=${estado}`),
  cuenta: (id: string) =>
    pedir<{ cuenta: CuentaListada; cargos: Cargo[]; totales: TotalesCuenta }>(
      `/ventas/cuentas/${id}`
    ),
  abrirCuenta: (d: { propietarioId?: string; sesionId?: string }) =>
    json<{ id: string; numero: number }>("/ventas/cuentas", "POST", d),
  agregarCargo: (cuentaId: string, d: Record<string, unknown>) =>
    json<{ id: string; descripcion: string; total: number; totales: TotalesCuenta }>(
      `/ventas/cuentas/${cuentaId}/cargos`,
      "POST",
      d
    ),
  cobrar: (cuentaId: string, d: Record<string, unknown>) =>
    json<{
      cobroId: string;
      total: number;
      recibidoCrc: number;
      vueltoCrc: number;
      comprobanteId?: string;
      consecutivo?: string;
      estadoComprobante?: string;
    }>(`/ventas/cuentas/${cuentaId}/cobrar`, "POST", d),

  tiquete: (cobroId: string) =>
    pedir<{
      cobro: Record<string, string | number | null>;
      medios: Array<Record<string, string | null>>;
      lineas: Array<Record<string, string>>;
    }>(`/ventas/cobros/${cobroId}/tiquete`),

  cuentaCorriente: (propietarioId: string) =>
    pedir<{
      facturas: Array<Record<string, string | number | null>>;
      abonos: Array<Record<string, string | null>>;
      anticipos: Array<Record<string, string | null>>;
      credito: { habilitado: boolean; limite: number; plazoDias: number; usado: number; disponible: number };
      saldoAFavor: number;
    }>(`/ventas/clientes/${propietarioId}/cuenta-corriente`),
  guardarCredito: (propietarioId: string, d: Record<string, unknown>) =>
    json<{ ok: true }>(`/ventas/clientes/${propietarioId}/credito`, "PUT", d),
  abonar: (d: Record<string, unknown>) =>
    json<{ abonoId: string; repConsecutivo?: string; repEstado?: string; aplicado: number }>(
      "/ventas/abonos",
      "POST",
      d
    ),
  anticipo: (d: Record<string, unknown>) => json<{ id: string }>("/ventas/anticipos", "POST", d),

  encargos: () => pedir<{ encargos: Encargo[] }>("/ventas/encargos"),
  crearEncargo: (d: Record<string, unknown>) =>
    json<{ id: string; anticipoId?: string }>("/ventas/encargos", "POST", d),
  /**
   * Cada transición lleva sus datos: la orden de compra al pedir, el
   * lote al recibir, la cuenta al entregar. Por eso el cuerpo es
   * abierto y no tres parámetros fijos.
   */
  estadoEncargo: (id: string, estado: string, datos: Record<string, unknown> = {}) =>
    json<{
      ok?: true;
      ordenCompraId?: string | null;
      numeroOrden?: number;
      loteId?: string;
      reservado?: number;
      cargoId?: string;
      anticipoDisponible?: number;
      saldoAFavorDelCliente?: number;
    }>(`/ventas/encargos/${id}/estado`, "POST", { estado, ...datos }),

  aprobaciones: () => pedir<{ aprobaciones: Aprobacion[] }>("/ventas/aprobaciones"),
  solicitarAprobacion: (d: Record<string, unknown>) =>
    json<{ id: string }>("/ventas/aprobaciones", "POST", d),
  resolverAprobacion: (id: string, aprobar: boolean, nota?: string) =>
    json<{ aplicada: boolean; detalle?: Record<string, unknown> }>(
      `/ventas/aprobaciones/${id}/resolver`,
      "POST",
      { aprobar, nota }
    ),

  provisionales: () => pedir<{ provisionales: Provisional[] }>("/ventas/provisionales"),
  emitirTalonario: (cantidad: number, cajaId?: string) =>
    json<{ desde: number; hasta: number; numeros: number[] }>(
      "/ventas/provisionales/talonario",
      "POST",
      { cantidad, cajaId }
    ),
  regularizar: (d: Record<string, unknown>) =>
    json<{ comprobanteId: string; consecutivo: string; estado: string }>(
      "/ventas/provisionales/regularizar",
      "POST",
      d
    ),

  parametros: () =>
    pedir<{
      parametros: {
        umbral_diferencia_arqueo: string;
        descuento_maximo_pct: string;
        lista_precio_id?: string | null;
        /** Si el cierre abre contando por denominación (prompt 08b, A2). */
        arqueo_por_denominacion?: boolean;
      };
    }>("/ventas/parametros"),
  guardarParametros: (d: Record<string, unknown>) =>
    json<{ ok: true }>("/ventas/parametros", "PUT", d),

  /**
   * La exportación del reporte sale del BACKEND con el mismo cálculo que
   * la pantalla, y se trae como blob autenticado: un <a href> no puede
   * mandar el header Authorization.
   */
  exportarReporte: (cual: string, desde: string, hasta: string, formato: "excel" | "pdf") =>
    apiFetchFile(
      `/ventas/reportes/${cual}/exportar?desde=${desde}&hasta=${hasta}&formato=${formato}`,
      { token: getStoredToken() }
    ),

  /**
   * El comprobante del cierre, en PDF (prompt 08b, A2 y A4).
   *
   * Blob autenticado y no un `<a href>`: la ruta exige el token y un
   * enlace directo no lo manda.
   */
  comprobanteDeCierre: (sesionId: string) =>
    apiFetchFile(`/ventas/sesiones/${sesionId}/cierre.pdf`, { token: getStoredToken() }),

  reporte: (cual: string, desde: string, hasta: string) =>
    pedir<{
      titulo: string;
      // El backend declara las columnas al lado de su consulta, y la
      // exportación usa las mismas: una sola lista para los dos caminos.
      columnas: Array<{
        clave: string;
        titulo: string;
        tipo?: "texto" | "numero" | "dinero" | "fecha";
      }>;
      filas: Array<Record<string, string | number | null>>;
      ignoraPeriodo?: boolean;
    }>(`/ventas/reportes/${cual}?desde=${desde}&hasta=${hasta}`),
};

export function formatearMonto(valor: string | number, moneda = "CRC"): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor);
  return new Intl.NumberFormat("es-CR", { style: "currency", currency: moneda }).format(n);
}

/** Etiquetas de los medios del arqueo, en el orden del cuadro del cliente. */
export const ETIQUETA_MEDIO: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjetas",
  sinpe: "SINPE Móvil",
  otros: "Otros",
  // `anticipo` y `credito` NO son medios de Hacienda: son formas
  // internas de saldar una cuenta, y la tabla las distingue con
  // `es_fiscal`. Aparecen igual en el resumen del dia porque el cajero
  // necesita saber cuanto se cobro contra un anticipo o a credito —no
  // entro plata, pero la cuenta se salda—.
  anticipo: "Contra anticipo",
  credito: "A crédito",
};

/** Qué tiene que declarar el cajero en cada medio, en palabras. */
export const QUE_DECLARAR: Record<string, string> = {
  efectivo: "Lo contado",
  tarjeta: "El total del cierre del datáfono",
  sinpe: "El total confirmado",
  otros: "El total confirmado",
};
