import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------
// FINANZAS — prompt 10a.
//
// Lo que la clínica debe, lo que paga, sus gastos, lo que le deben y el
// cierre del día.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

function enviar<T>(path: string, metodo: string, cuerpo?: unknown): Promise<T> {
  return pedir<T>(path, {
    method: metodo,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

export interface CuentaPorPagar {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  documento: string | null;
  fecha: string;
  vencimiento: string;
  moneda: string;
  monto: string;
  exigible: string;
  saldo: string;
  estado: "pendiente" | "parcial" | "pagada" | "vencida";
  dias_para_vencer: number;
  sin_comprobante: boolean;
  recibido_id: string | null;
  compra_id: string | null;
}

export interface ResumenPorPagar {
  total: number;
  vencido: number;
  vence7: number;
  vence30: number;
  antiguedad: Array<{ tramo: string; monto: number }>;
  calendario: Array<{ semana: string; monto: number }>;
}

export interface CuentaBanco {
  id: string;
  nombre: string;
  banco: string | null;
  terminacion: string | null;
  moneda: string;
  activa: boolean;
}

export interface Gasto {
  id: string;
  fecha: string;
  descripcion: string;
  moneda: string;
  monto: string;
  linea_negocio: string | null;
  sin_comprobante: boolean;
  estado: "estimado" | "real" | "anulado";
  recibido_id: string | null;
  cuenta_pagar_id: string | null;
  recurrente_id: string | null;
  categoria: string;
  categoria_id: string;
  proveedor: string | null;
  registrado_por: string | null;
}

export interface ResumenGastos {
  total: number;
  totalMesAnterior: number;
  porCategoria: Array<{ categoria: string; monto: number }>;
  sinComprobante: number;
}

export interface CategoriaGasto {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
  orden: number;
}

export interface Recurrente {
  id: string;
  descripcion: string;
  monto_estimado: string;
  moneda: string;
  dia_del_mes: number;
  linea_negocio: string | null;
  activo: boolean;
  categoria: string;
  categoria_id: string;
  proveedor: string | null;
  proveedor_id: string | null;
}

export interface Deudor {
  propietario_id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  facturas: number;
  saldo: string;
  vencido: string;
  mas_antigua: string | null;
  dias_mas_vencida: number;
  ultimo_recordatorio: string | null;
}

export interface CierreDelDia {
  fecha: string;
  porMedio: Array<{ medio: string; moneda: string; monto: number; cantidad: number }>;
  totalVentas: number;
  sinpe: Array<{
    cobro_medio_id: string;
    monto: string;
    referencia: string | null;
    cliente: string | null;
    conciliado: boolean;
    conciliado_por: string | null;
  }>;
  datafono: Array<{
    banco: string | null;
    tipo_tarjeta: string | null;
    marca: string | null;
    declarado: number;
    cobrado: number;
    diferencia: number;
  }>;
  depositos: Array<{
    id: string;
    monto: string;
    moneda: string;
    referencia: string | null;
    cuenta_banco: string | null;
    conciliado_por: string | null;
  }>;
  efectivoDelDia: number;
  depositado: number;
  diferencia: number;
  cerrado: { cerrado_en: string; cerrado_por: string | null; justificacion: string | null } | null;
}

export const finanzasApi = {
  // --- Cuentas por pagar ----------------------------------------------
  porPagar: (filtros: { proveedorId?: string; estado?: string; hasta?: string } = {}) => {
    const q = new URLSearchParams();
    if (filtros.proveedorId) q.set("proveedorId", filtros.proveedorId);
    if (filtros.estado) q.set("estado", filtros.estado);
    if (filtros.hasta) q.set("hasta", filtros.hasta);
    const s = q.toString();
    return pedir<{ resumen: ResumenPorPagar; cuentas: CuentaPorPagar[] }>(
      `/finanzas/por-pagar${s ? `?${s}` : ""}`
    );
  },
  cuenta: (id: string) =>
    pedir<{
      cuenta: CuentaPorPagar;
      pagos: Array<Record<string, unknown>>;
      notas: Array<Record<string, unknown>>;
      comprobante: Record<string, unknown> | null;
      compra: Record<string, unknown> | null;
    }>(`/finanzas/por-pagar/${id}`),
  crearCuenta: (datos: {
    proveedorId: string;
    documento?: string | null;
    fecha: string;
    vencimiento?: string | null;
    moneda?: string;
    monto: number;
    exigible?: number;
    sinComprobante?: boolean;
    reduceACuentaId?: string | null;
    nota?: string | null;
  }) => enviar<{ id: string; vencimiento: string }>("/finanzas/por-pagar", "POST", datos),
  cuentaDesdeComprobante: (datos: {
    recibidoId: string;
    proveedorId: string;
    montoAceptado?: number;
  }) =>
    enviar<{ id: string; yaExistia: boolean }>(
      "/finanzas/por-pagar/desde-comprobante",
      "POST",
      datos
    ),

  // --- Pagos ----------------------------------------------------------
  pagar: (datos: {
    proveedorId: string;
    fecha: string;
    medio: string;
    cuentaBancoId?: string | null;
    referencia?: string | null;
    moneda?: string;
    tipoCambio?: number | null;
    aplicaciones: Array<{ cuentaId: string; monto: number }>;
    sesionCajaId?: string | null;
  }) =>
    enviar<{ id: string; total: number; movimientoEfectivoId: string | null }>(
      "/finanzas/pagos",
      "POST",
      datos
    ),
  anularPago: (id: string, motivo: string) =>
    enviar<{ contramovimiento: string | null }>(`/finanzas/pagos/${id}/anular`, "POST", { motivo }),
  pagosDelProveedor: (proveedorId: string) =>
    pedir<{ pagos: Array<Record<string, unknown>> }>(`/finanzas/pagos/proveedor/${proveedorId}`),

  // --- Cuentas bancarias ----------------------------------------------
  cuentasBanco: () => pedir<{ cuentas: CuentaBanco[] }>("/finanzas/cuentas-banco"),
  guardarCuentaBanco: (datos: {
    id?: string;
    nombre: string;
    banco?: string | null;
    terminacion?: string | null;
    moneda?: string;
    activa?: boolean;
  }) => enviar<{ id: string }>("/finanzas/cuentas-banco", "POST", datos),

  // --- Gastos ---------------------------------------------------------
  gastos: (filtros: { mes?: string; desde?: string; hasta?: string; categoriaId?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
    const s = q.toString();
    return pedir<{ resumen: ResumenGastos; gastos: Gasto[] }>(
      `/finanzas/gastos${s ? `?${s}` : ""}`
    );
  },
  registrarGasto: (datos: {
    fecha: string;
    categoriaId: string;
    proveedorId?: string | null;
    descripcion: string;
    moneda?: string;
    monto: number;
    lineaNegocio?: string | null;
    sinComprobante?: boolean;
    generaCuentaPorPagar?: boolean;
    vencimiento?: string | null;
    documento?: string | null;
  }) => enviar<{ id: string; cuentaPagarId: string | null }>("/finanzas/gastos", "POST", datos),
  gastoDesdeComprobante: (datos: {
    recibidoId: string;
    categoriaId: string;
    proveedorId?: string | null;
    lineaNegocio?: string | null;
    generaCuentaPorPagar?: boolean;
  }) =>
    enviar<{ id: string; cuentaPagarId: string | null; yaExistia: boolean }>(
      "/finanzas/gastos/desde-comprobante",
      "POST",
      datos
    ),
  anularGasto: (id: string, motivo: string) =>
    enviar<{ anulado: boolean }>(`/finanzas/gastos/${id}/anular`, "POST", { motivo }),
  categorias: (proveedorId?: string) =>
    pedir<{
      categorias: CategoriaGasto[];
      sugerida: { categoria_id: string; nombre: string } | null;
    }>(`/finanzas/categorias-gasto${proveedorId ? `?proveedorId=${proveedorId}` : ""}`),
  guardarCategoria: (datos: { id?: string; nombre: string; activo?: boolean; orden?: number }) =>
    enviar<{ id: string }>("/finanzas/categorias-gasto", "POST", datos),

  // --- Recurrentes ----------------------------------------------------
  recurrentes: () => pedir<{ recurrentes: Recurrente[] }>("/finanzas/recurrentes"),
  guardarRecurrente: (datos: {
    id?: string;
    categoriaId: string;
    proveedorId?: string | null;
    descripcion: string;
    montoEstimado: number;
    moneda?: string;
    diaDelMes?: number;
    lineaNegocio?: string | null;
    activo?: boolean;
  }) => enviar<{ id: string }>("/finanzas/recurrentes", "POST", datos),
  generarPendientes: (mes: string) =>
    enviar<{ generados: number }>("/finanzas/recurrentes/generar", "POST", { mes }),
  conciliarGasto: (
    id: string,
    datos: { recibidoId?: string | null; monto?: number; fecha?: string; generaCuentaPorPagar?: boolean }
  ) =>
    enviar<{ montoFinal: number; cambioElMonto: boolean; cuentaPagarId: string | null }>(
      `/finanzas/gastos/${id}/conciliar`,
      "POST",
      datos
    ),

  // --- Cuentas por cobrar ---------------------------------------------
  porCobrar: () =>
    pedir<{
      resumen: { total: number; vencido: number; clientes: number; antiguedad: Array<{ tramo: string; monto: number }> };
      deudores: Deudor[];
    }>("/finanzas/por-cobrar"),
  puedeRecordar: (propietarioId: string) =>
    pedir<{ puede: boolean; motivo: string | null }>(
      `/finanzas/por-cobrar/${propietarioId}/puede-recordar`
    ),
  recordar: (propietarioId: string, mensaje?: string) =>
    enviar<{ enviado: boolean; motivo?: string; canal?: string }>(
      `/finanzas/por-cobrar/${propietarioId}/recordar`,
      "POST",
      { mensaje }
    ),

  // --- Cierre del día -------------------------------------------------
  cierreDelDia: (fecha: string) => pedir<CierreDelDia>(`/finanzas/cierre-dia?fecha=${fecha}`),
  conciliarSinpe: (cobroMedioId: string, cuentaBancoId?: string | null) =>
    enviar<{ id: string }>(`/finanzas/cierre-dia/sinpe/${cobroMedioId}`, "POST", { cuentaBancoId }),
  desconciliarSinpe: (cobroMedioId: string) =>
    enviar<{ desconciliado: boolean }>(`/finanzas/cierre-dia/sinpe/${cobroMedioId}`, "DELETE"),
  registrarDeposito: (datos: {
    fecha: string;
    monto: number;
    moneda?: string;
    cuentaBancoId: string;
    referencia?: string | null;
  }) => enviar<{ id: string }>("/finanzas/cierre-dia/deposito", "POST", datos),
  cerrarDia: (fecha: string, justificacion?: string) =>
    enviar<{ diferencia: number }>("/finanzas/cierre-dia/cerrar", "POST", { fecha, justificacion }),

  // --- Exportación ----------------------------------------------------
  cuadernos: () => pedir<{ cuadernos: Array<{ clave: string; titulo: string }> }>("/finanzas/exportacion"),
  /** La URL de descarga: la arma el backend con los mismos filtros. */
  urlExportacion: (cuaderno: string, formato: "xlsx" | "pdf", desde: string, hasta: string) =>
    `/finanzas/exportacion/${cuaderno}.${formato}?desde=${desde}&hasta=${hasta}`,
};
