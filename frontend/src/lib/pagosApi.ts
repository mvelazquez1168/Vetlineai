import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------
// Pantallas de pago — cliente para /api/pagos. Las pantallas nunca
// calculan montos de cobro ni prorrateo: todo llega resuelto acá desde
// el backend, que a su vez pasa siempre por el proveedor simulado
// (ver backend/src/pagos/proveedorPagos.ts).
// ---------------------------------------------------------------------

export interface PaqueteRecarga {
  id: string;
  nombre: string;
  montoPagadoUsd: number;
  creditoAcreditadoUsd: number;
  esMinimo: boolean;
  orden: number;
}

export interface MetodoPago {
  id: string;
  marca: string | null;
  ultimos4: string | null;
  vencimientoMes: number | null;
  vencimientoAnio: number | null;
  estado: "activo" | "vencido" | "eliminado";
  estadoVencimiento: "vencido" | "por_vencer" | "vigente" | null;
}

export interface ConfigRecarga {
  autorecargaActiva: boolean;
  umbralUsd: number;
  paqueteId: string | null;
  topeMensualRecargasUsd: number | null;
}

export interface RecargaEjecutada {
  id: string;
  estado: "acreditada" | "fallida";
  montoPagadoUsd: number;
  creditoAcreditadoUsd: number;
  motivoFalla?: "fondos_insuficientes" | "tarjeta_rechazada" | "error_desconocido";
  mensajeError?: string;
  superaTopeMensual: boolean;
}

export interface RecargaHistorial {
  id: string;
  paqueteNombre: string | null;
  origen: "manual" | "automatica";
  montoPagadoUsd: number;
  creditoAcreditadoUsd: number;
  estado: "pendiente" | "acreditada" | "fallida";
  creadaEn: string;
}

export interface CotizacionUpgrade {
  planDestinoId: string;
  planDestinoNombre: string;
  montoACobrarHoyUsd: number;
  creditoAdicionalUsd: number;
  agentesIncluidos: number | null;
  medicosIncluidos: number;
  precioProximaRenovacionUsd: number;
  fechaProximaRenovacion: string;
}

export interface ResultadoUpgrade {
  exitoCobro: boolean;
  cotizacion?: CotizacionUpgrade;
  motivoFalla?: "fondos_insuficientes" | "tarjeta_rechazada" | "error_desconocido";
  mensajeError?: string;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export const pagosApi = {
  listarPaquetesRecarga: () => authedFetch<{ paquetes: PaqueteRecarga[] }>("/pagos/paquetes-recarga"),

  obtenerMetodoPago: () => authedFetch<{ metodo: MetodoPago | null }>("/pagos/metodos"),

  registrarMetodoPago: (datos: {
    numero: string;
    nombreTitular: string;
    vencimientoMes: number;
    vencimientoAnio: number;
    cvv: string;
  }) => authedFetch<{ metodo: MetodoPago }>("/pagos/metodos", { method: "POST", body: JSON.stringify(datos) }),

  obtenerConfigRecarga: () => authedFetch<{ config: ConfigRecarga }>("/pagos/config-recarga"),

  actualizarConfigRecarga: (config: ConfigRecarga) =>
    authedFetch<{ config: ConfigRecarga }>("/pagos/config-recarga", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  listarRecargas: () => authedFetch<{ recargas: RecargaHistorial[] }>("/pagos/recargas"),

  ejecutarRecarga: (paqueteId: string) =>
    authedFetch<{ recarga: RecargaEjecutada }>("/pagos/recargas", {
      method: "POST",
      body: JSON.stringify({ paqueteId }),
    }),

  cotizarUpgrade: (planId: string) => authedFetch<{ cotizacion: CotizacionUpgrade }>(`/pagos/upgrade/${planId}/cotizacion`),

  ejecutarUpgrade: (planDestinoId: string) =>
    authedFetch<ResultadoUpgrade>("/pagos/upgrade", { method: "POST", body: JSON.stringify({ planDestinoId }) }),
};
