import { getStoredToken } from "../hooks/useAuth";
import { apiFetch, apiFetchFile } from "./api";

// ---------------------------------------------------------------------
// Cliente de la API del módulo `inventario`.
//
// Mismo criterio que `facturacionCrApi`: acá viven los tipos y las
// llamadas, nada de lógica. La conversión a unidad base, el FEFO y el
// umbral de aprobación son del backend, y la pantalla no los replica —
// si los replicara habría dos reglas para lo mismo.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

function json<T>(path: string, metodo: string, cuerpo: unknown): Promise<T> {
  return pedir<T>(path, { method: metodo, body: JSON.stringify(cuerpo) });
}

export interface OpcionCodigo {
  codigo: string;
  nombre: string;
}

export interface CatalogosInventario {
  lineasNegocio: OpcionCodigo[];
  especialidades: OpcionCodigo[];
  tiposMovimiento: Array<OpcionCodigo & { direccion: "entrada" | "salida"; origen_tipico: string }>;
  motivos: Array<OpcionCodigo & { exige_detalle: boolean }>;
  unidadesMedida: Array<{ codigo: string; descripcion: string }>;
  tarifasIva: Array<OpcionCodigo & { tarifa: string }>;
}

export interface Bodega {
  id: string;
  codigo: string;
  nombre: string;
  es_default: boolean;
  activo: boolean;
}

export interface ProductoListado {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  linea_negocio: string;
  unidad_base: string;
  minimo: string;
  punto_reorden: string;
  requiere_receta: boolean;
  es_controlado: boolean;
  requiere_refrigeracion: boolean;
  medicamento_id: string | null;
  existencia: string;
  proximo_vencimiento: string | null;
  /** La existencia en presentacion natural, armada por el backend: "6 cajas y 4 tabletas (124 tabletas)". */
  existencia_presentada: string;
  presentacion_mayor: string | null;
}

export interface LineaKardex {
  id: string;
  tipo: string;
  tipo_nombre: string;
  direccion: "entrada" | "salida";
  producto: string;
  producto_id: string;
  unidad_base: string;
  cantidad_base: string;
  costo_unitario: string | null;
  creado_en: string;
  bodega: string;
  lote: string | null;
  presentacion: string | null;
  cantidad_presentacion: string | null;
  motivo: string | null;
  motivo_detalle: string | null;
  persona: string | null;
  paciente: string | null;
  atencion_id: string | null;
}

export interface Presentacion {
  id: string;
  codigo_interno: string;
  codigo_barras: string | null;
  nombre: string;
  factor: string;
  unidad_medida: string;
  precio_venta: string | null;
  para_compra: boolean;
  para_venta: boolean;
  para_consumo: boolean;
  activo: boolean;
}

export interface Lote {
  id: string;
  numero: string;
  bodega: string;
  bodega_id: string;
  vencimiento: string | null;
  vencimiento_efectivo: string | null;
  fecha_apertura: string | null;
  costo_unitario: string;
  cantidad: string;
}

export interface ExistenciaPresentada {
  bodegaId: string;
  bodegaNombre: string;
  cantidad: number;
  presentacion: { texto: string };
}

export interface DetalleProducto {
  producto: Record<string, unknown> & { id: string; nombre: string; unidad_base: string };
  presentaciones: Presentacion[];
  lotes: Lote[];
  existencias: ExistenciaPresentada[];
}


export interface ConsumoPorOrigen {
  tipo: string;
  tipoNombre: string;
  cantidad: number;
  movimientos: number;
  pacientes: Array<{ pacienteId: string; nombre: string; atencionId: string | null; cantidad: number }>;
}

/** Lo que muestra la tira de indicadores del catálogo. */
export interface ResumenInventario {
  valor_costo: string;
  bajo_minimo: number;
  por_vencer_60: number;
  ajustes_pendientes: number;
}

export interface Alertas {
  bajoMinimo: Array<Record<string, string>>;
  enPuntoReorden: Array<Record<string, string>>;
  porVencer30: Array<Record<string, string>>;
  porVencer60: Array<Record<string, string>>;
  porVencer90: Array<Record<string, string>>;
  envasesAbiertosVencidos: Array<Record<string, string>>;
  lotesVencidosConExistencia: Array<Record<string, string>>;
}

export interface Ajuste {
  id: string;
  tipo: "positivo" | "negativo";
  estado: "pendiente" | "aprobado" | "rechazado" | "aplicado";
  motivo_nombre: string;
  motivo_detalle: string | null;
  valor: string;
  solicitado_en: string;
  solicitado_por_nombre: string | null;
  aprobado_por_nombre: string | null;
  lineas: number;
}

export interface LineaSugerida {
  productoId: string;
  productoNombre: string;
  presentacionId: string;
  presentacionNombre: string;
  factor: number;
  existencia: number;
  cantidadPedida: number;
  costoUnitario: number;
  explicacion: string;
}

export interface OrdenListada {
  id: string;
  numero: number;
  estado: string;
  proveedor: string;
  bodega: string;
  factura_proveedor: string | null;
  creado_en: string;
  lineas: number;
}

export interface LineaOrdenDetalle {
  id: string;
  producto: string;
  unidad_base: string;
  presentacion: string;
  factor: string;
  cantidad_pedida: string;
  cantidad_recibida_base: string;
  costo_unitario: string;
  explicacion: string | null;
}

export interface Conteo {
  id: string;
  bodega: string;
  tipo: "total" | "ciclico" | "grupo";
  /** Por qué se agrupó, cuando el conteo es de un grupo. */
  grupo_criterio: string | null;
  grupo_valor: string | null;
  estado: "abierto" | "cerrado" | "cancelado";
  creado_en: string;
  lineas: number;
  contadas: number;
}

export interface Servicio {
  id: string;
  codigo: string;
  nombre: string;
  linea_negocio: string;
  especialidad: string | null;
  precio: string;
  duracion_min: number | null;
  costo_insumos: string;
}

export const inventarioApi = {
  catalogos: () => pedir<CatalogosInventario>("/inventario/catalogos"),
  bodegas: () => pedir<{ bodegas: Bodega[] }>("/inventario/bodegas"),
  crearBodega: (d: { codigo: string; nombre: string; esDefault?: boolean }) =>
    json<{ id: string }>("/inventario/bodegas", "POST", d),

  productos: (f: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "") q.set(k, String(v));
    return pedir<{ productos: ProductoListado[]; total: number }>(
      `/inventario/productos?${q.toString()}`
    );
  },
  producto: (id: string) => pedir<DetalleProducto>(`/inventario/productos/${id}`),
  crearProducto: (d: Record<string, unknown>) =>
    json<{ id: string }>("/inventario/productos", "POST", d),
  actualizarProducto: (id: string, d: Record<string, unknown>) =>
    json<{ ok: true }>(`/inventario/productos/${id}`, "PUT", d),
  crearPresentacion: (productoId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/inventario/productos/${productoId}/presentaciones`, "POST", d),
  borrarPresentacion: (id: string) =>
    pedir<{ ok: true }>(`/inventario/presentaciones/${id}`, { method: "DELETE" }),

  kardex: (id: string, f: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    return pedir<{ movimientos: LineaKardex[] }>(
      `/inventario/productos/${id}/kardex?${q.toString()}`
    );
  },
  consumo: (id: string, desde: string, hasta: string) =>
    pedir<{ origenes: ConsumoPorOrigen[] }>(
      `/inventario/productos/${id}/consumo?desde=${desde}&hasta=${hasta}`
    ),

  movimiento: (d: Record<string, unknown>) =>
    json<{ movimientos: unknown[] }>("/inventario/movimientos", "POST", d),
  traslado: (d: Record<string, unknown>) => json<unknown>("/inventario/traslados", "POST", d),

  alertas: () => pedir<Alertas>("/inventario/alertas"),

  /** Los cuatro indicadores del catálogo, en una sola consulta. */
  resumen: () => pedir<ResumenInventario>("/inventario/resumen"),

  ajustes: (estado?: string) =>
    pedir<{ ajustes: Ajuste[]; pendientes: number }>(
      `/inventario/ajustes${estado ? `?estado=${estado}` : ""}`
    ),
  solicitarAjuste: (d: Record<string, unknown>) =>
    json<{ id: string; estado: string; requiereAprobacion: boolean; valor: string; umbral: string }>(
      "/inventario/ajustes",
      "POST",
      d
    ),
  aprobarAjuste: (id: string) => json<{ ok: true }>(`/inventario/ajustes/${id}/aprobar`, "POST", {}),
  rechazarAjuste: (id: string) =>
    json<{ ok: true }>(`/inventario/ajustes/${id}/rechazar`, "POST", {}),

  servicios: () => pedir<{ servicios: Servicio[] }>("/inventario/servicios"),
  servicio: (id: string) =>
    pedir<{ servicio: Servicio; insumos: Array<Record<string, string>> }>(
      `/inventario/servicios/${id}`
    ),
  crearServicio: (d: Record<string, unknown>) =>
    json<{ id: string }>("/inventario/servicios", "POST", d),
  agregarInsumo: (servicioId: string, d: { presentacionId: string; cantidad: number }) =>
    json<{ id: string }>(`/inventario/servicios/${servicioId}/insumos`, "POST", d),
  quitarInsumo: (servicioId: string, id: string) =>
    pedir<void>(`/inventario/servicios/${servicioId}/insumos/${id}`, { method: "DELETE" }),

  proveedores: () =>
    pedir<{ proveedores: Array<Record<string, string>> }>("/inventario/proveedores"),
  crearProveedor: (d: Record<string, unknown>) =>
    json<{ id: string }>("/inventario/proveedores", "POST", d),
  vincularProducto: (proveedorId: string, d: Record<string, unknown>) =>
    json<{ ok: true }>(`/inventario/proveedores/${proveedorId}/productos`, "POST", d),
  ordenSugerida: (proveedorId: string) =>
    pedir<{ lineas: LineaSugerida[] }>(`/inventario/proveedores/${proveedorId}/orden-sugerida`),

  ordenes: (estado?: string) =>
    pedir<{ ordenes: OrdenListada[] }>(`/inventario/ordenes${estado ? `?estado=${estado}` : ""}`),
  orden: (id: string) =>
    pedir<{ orden: OrdenListada; lineas: LineaOrdenDetalle[] }>(`/inventario/ordenes/${id}`),
  crearOrden: (d: Record<string, unknown>) =>
    json<{ id: string; numero: number }>("/inventario/ordenes", "POST", d),
  cambiarEstadoOrden: (id: string, estado: string) =>
    json<{ ok: true }>(`/inventario/ordenes/${id}/estado`, "POST", { estado }),
  recibirOrden: (id: string, d: Record<string, unknown>) =>
    json<{ estado: string; diferencias: Array<Record<string, number | string>> }>(
      `/inventario/ordenes/${id}/recibir`,
      "POST",
      d
    ),

  conteos: () => pedir<{ conteos: Conteo[] }>("/inventario/conteos"),
  conteo: (id: string) =>
    pedir<{
      conteo: Conteo;
      lineas: Array<Record<string, string | null>>;
      presentaciones: Array<{
        id: string;
        producto_id: string;
        nombre: string;
        factor: string;
      }>;
    }>(`/inventario/conteos/${id}`),
  abrirConteo: (d: Record<string, unknown>) =>
    json<{ id: string; lineas: number }>("/inventario/conteos", "POST", d),
  anotarConteo: (conteoId: string, lineaId: string, d: Record<string, unknown>) =>
    json<{ cantidadBase: number }>(
      `/inventario/conteos/${conteoId}/lineas/${lineaId}`,
      "PUT",
      d
    ),
  cerrarConteo: (id: string) =>
    json<{ diferencias: unknown[]; sinContar: number }>(
      `/inventario/conteos/${id}/cerrar`,
      "POST",
      {}
    ),

  parametros: () =>
    pedir<{ parametros: { umbral_aprobacion_ajuste: string; dias_stock_seguridad: number } }>(
      "/inventario/parametros"
    ),
  guardarParametros: (d: Record<string, unknown>) =>
    json<{ ok: true }>("/inventario/parametros", "PUT", d),

  /** El kardex general: el producto es un filtro mas, no un requisito. */
  kardexGeneral: (f: Record<string, string>) =>
    pedir<{ movimientos: LineaKardex[]; tope: number; topeAlcanzado: boolean }>(
      `/inventario/kardex?${new URLSearchParams(f).toString()}`
    ),
  kardexPersonas: () =>
    pedir<{ personas: Array<{ id: string; nombre: string }> }>("/inventario/kardex/personas"),
  /**
   * La exportacion sale del BACKEND con los filtros aplicados, y se
   * trae como blob autenticado: un <a href> no puede mandar el header
   * Authorization, y un CSV armado en el navegador exportaria solo lo
   * que la pantalla tiene cargado.
   */
  exportarKardex: (formato: "excel" | "pdf", f: Record<string, string>) =>
    apiFetchFile(
      `/inventario/kardex/exportar?${new URLSearchParams({ ...f, formato }).toString()}`,
      { token: getStoredToken() }
    ),

  listasPrecio: () => pedir<{ listas: ListaPrecio[] }>("/inventario/listas-precio"),
  crearListaPrecio: (d: Record<string, unknown>) =>
    json<{ id: string }>("/inventario/listas-precio", "POST", d),
  editarListaPrecio: (id: string, d: Record<string, unknown>) =>
    json<{ ok: true }>(`/inventario/listas-precio/${id}`, "PUT", d),
  itemsListaPrecio: (id: string) =>
    pedir<{ items: ItemListaPrecio[] }>(`/inventario/listas-precio/${id}/items`),
  fijarItemListaPrecio: (id: string, d: Record<string, unknown>) =>
    json<{ ok: true }>(`/inventario/listas-precio/${id}/items`, "PUT", d),
  vistaPreviaPrecios: (d: Record<string, unknown>) =>
    json<{ filas: FilaPrecioMasivo[]; cuantos: number; sinPrecio: number }>(
      "/inventario/precios/vista-previa",
      "POST",
      d
    ),
  aplicarPrecios: (d: Record<string, unknown>) =>
    json<{ aplicadas: number; filas: FilaPrecioMasivo[] }>(
      "/inventario/precios/aplicar",
      "POST",
      d
    ),
};

export interface ListaPrecio {
  id: string;
  codigo: string;
  nombre: string;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  activo: boolean;
  items: number;
  vigenteHoy: boolean;
}

export interface ItemListaPrecio {
  id: string | null;
  presentacionId: string | null;
  servicioId: string | null;
  etiqueta: string;
  lineaNegocio: string | null;
  precioBase: number;
  precioLista: number | null;
}

export interface FilaPrecioMasivo {
  presentacionId: string | null;
  servicioId: string | null;
  etiqueta: string;
  actual: number;
  nuevo: number;
}

/** Montos en colones, con el mismo formato que usa el facturador. */
export function formatearMonto(valor: string | number, moneda = "CRC"): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor);
  return new Intl.NumberFormat("es-CR", { style: "currency", currency: moneda }).format(n);
}

/** Cantidades: sin decimales cuando es entero. */
export function formatearCantidad(valor: string | number): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
