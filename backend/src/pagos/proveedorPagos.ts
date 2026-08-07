// ---------------------------------------------------------------------
// Frontera con la pasarela de pagos — ÚNICA interfaz (no hay una
// "PasarelaPagos" en paralelo: dos abstracciones para lo mismo es
// exactamente el problema que tenía el registro de consumo antes del
// bloque 1 del motor de crédito, con cuatro copias en tres archivos).
// Todo lo que cobra (recarga, autorecarga, upgrade, conversión de
// prueba, ciclo recurrente) pasa por acá, nunca por Tilopay directo.
//
// Motor de cobros — cambio de contrato respecto de la versión de
// "Pantallas de pago": ejecutarCargo YA NO devuelve éxito/fallo. Ninguna
// pasarela real confirma un cobro en la respuesta síncrona del cargo —
// eso siempre llega por notificación asíncrona (el callback). Confiar en
// la respuesta síncrona fue justamente el bug real que motivó este
// prompt ("se constató un pago confirmado por la pasarela que activó un
// tenant sin dejar registro"). El simulador reproduce esto a propósito:
// incluso el escenario "éxito inmediato" entrega el resultado por el
// mismo camino de callback que usaría la pasarela real, nunca en el
// mismo tick de ejecutarCargo.
//
// Credenciales por país: cada operación recibe paisCodigo y resuelve sus
// credenciales con obtenerCredencialesPais() — el simulador también las
// exige (aunque no las use para nada real) para que "país sin
// credenciales" sea un camino de error probado incluso en desarrollo.
// ---------------------------------------------------------------------

import crypto from "crypto";
import { obtenerCredencialesPais } from "./credencialesPasarela";
import { procesarNotificacionCallback } from "./callbackCobros";

export interface DatosTarjeta {
  numero: string;
  nombreTitular: string;
  vencimientoMes: number;
  vencimientoAnio: number;
  cvv: string;
}

export interface ResultadoTokenizacion {
  exito: boolean;
  metodoPago?: {
    referenciaExterna: string;
    marca: string;
    ultimos4: string;
    vencimientoMes: number;
    vencimientoAnio: number;
  };
  mensajeError?: string;
}

export type MotivoFallaCobro = "fondos_insuficientes" | "tarjeta_rechazada" | "error_desconocido";

// Confirmación INMEDIATA de que la orden se mandó a la pasarela — nunca
// dice si el cobro se aprobó. `enviado: false` es un fallo de envío (red
// caída, orden mal formada), no un rechazo del cobro.
export interface ResultadoEnvioCargo {
  enviado: boolean;
  mensajeError?: string;
}

export interface ResultadoConsultaCargo {
  estado: "pendiente" | "exitoso" | "fallido";
  motivoFalla?: MotivoFallaCobro;
  referenciaExterna?: string;
}

export interface ResultadoReversion {
  exito: boolean;
  mensajeError?: string;
}

export interface ProveedorPagos {
  tokenizarTarjeta(paisCodigo: string, datos: DatosTarjeta): Promise<ResultadoTokenizacion>;
  ejecutarCargo(
    paisCodigo: string,
    params: { referenciaMetodoPago: string; montoUsd: number; ordenId: string; descripcion: string }
  ): Promise<ResultadoEnvioCargo>;
  consultarEstadoCargo(paisCodigo: string, referenciaExterna: string): Promise<ResultadoConsultaCargo>;
  reversarOAnular(paisCodigo: string, referenciaExterna: string): Promise<ResultadoReversion>;
}

const DELAY_MS = Number(process.env.PAGOS_SIMULACION_DELAY_MS ?? 600);
// Escenario "éxito con demora" — el que ejercita de verdad el camino del
// callback y la reconciliación (Paso 1, pedido explícito): la orden
// queda "pendiente" un rato largo antes de que el callback simulado la
// resuelva, en vez de resolverse casi al toque como el resto de los
// escenarios.
const DELAY_CALLBACK_MS = Number(process.env.PAGOS_SIMULACION_DELAY_CALLBACK_MS ?? 8000);

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectarMarca(numero: string): string {
  const limpio = numero.replace(/\s+/g, "");
  if (limpio.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(limpio)) return "Mastercard";
  if (/^3[47]/.test(limpio)) return "American Express";
  return "Tarjeta";
}

// El "escenario" queda codificado en la referencia externa del método de
// pago (sim_<escenario>_<random>) — así ejecutarCargo, que solo recibe
// esa referencia guardada (nunca el número de tarjeta de nuevo), sabe qué
// resultado reproducir cuando llegue el momento de "callbackear".
type Escenario = "exito" | "exito_demora" | "fondos_insuficientes" | "tarjeta_rechazada";

function escenarioPorUltimosDigitos(numero: string): Escenario {
  const limpio = numero.replace(/\s+/g, "");
  const ultimos4 = limpio.slice(-4);
  if (ultimos4 === "0001") return "fondos_insuficientes";
  if (ultimos4 === "0002") return "tarjeta_rechazada";
  if (ultimos4 === "0003") return "exito_demora";
  return "exito";
}

function mensajeParaMotivo(motivo: MotivoFallaCobro): string {
  switch (motivo) {
    case "fondos_insuficientes":
      return "La tarjeta no tiene fondos suficientes para este cobro.";
    case "tarjeta_rechazada":
      return "La tarjeta fue rechazada por el banco emisor.";
    default:
      return "No se pudo procesar el cobro por un error inesperado.";
  }
}

class ProveedorPagosSimulado implements ProveedorPagos {
  async tokenizarTarjeta(paisCodigo: string, datos: DatosTarjeta): Promise<ResultadoTokenizacion> {
    obtenerCredencialesPais(paisCodigo); // valida que el país tenga afiliación — lanza si no
    await esperar(DELAY_MS);

    const limpio = datos.numero.replace(/\s+/g, "");
    if (limpio.length < 4 || !/^\d+$/.test(limpio)) {
      return { exito: false, mensajeError: "El número de tarjeta no es válido." };
    }

    const referenciaExterna = `sim_${escenarioPorUltimosDigitos(limpio)}_${crypto.randomUUID()}`;

    return {
      exito: true,
      metodoPago: {
        referenciaExterna,
        marca: detectarMarca(limpio),
        ultimos4: limpio.slice(-4),
        vencimientoMes: datos.vencimientoMes,
        vencimientoAnio: datos.vencimientoAnio,
      },
    };
  }

  async ejecutarCargo(
    paisCodigo: string,
    params: { referenciaMetodoPago: string; montoUsd: number; ordenId: string; descripcion: string }
  ): Promise<ResultadoEnvioCargo> {
    obtenerCredencialesPais(paisCodigo);

    const match = params.referenciaMetodoPago.match(
      /^sim_(exito_demora|exito|fondos_insuficientes|tarjeta_rechazada)_/
    );
    const escenario: Escenario = (match?.[1] as Escenario) ?? "exito";
    const delay = escenario === "exito_demora" ? DELAY_CALLBACK_MS : DELAY_MS;

    // El envío en sí siempre "llega" a la pasarela simulada — el único
    // fallo de ENVÍO posible acá sería de red, que este simulador no
    // reproduce. El resultado del cobro (éxito/fondos/rechazo) NUNCA se
    // devuelve acá: se entrega más tarde por el mismo camino de callback
    // que usaría la pasarela real, disparado en segundo plano, fuera del
    // ciclo de esta llamada.
    setTimeout(() => {
      const exito = escenario === "exito" || escenario === "exito_demora";
      const motivoFalla: MotivoFallaCobro | undefined = exito
        ? undefined
        : (escenario as MotivoFallaCobro);
      procesarNotificacionCallback({
        orderNumber: params.ordenId,
        exito,
        motivoFalla,
        referenciaExterna: exito ? `chg_${crypto.randomUUID()}` : undefined,
        mensajeError: exito ? undefined : mensajeParaMotivo(motivoFalla!),
      }).catch((err) => console.error(`[pagos] Error al entregar el callback simulado de ${params.ordenId}`, err));
    }, delay);

    return { enviado: true };
  }

  async consultarEstadoCargo(paisCodigo: string, referenciaExterna: string): Promise<ResultadoConsultaCargo> {
    obtenerCredencialesPais(paisCodigo);
    // El simulador no tiene un estado propio que consultar más allá de lo
    // que el callback ya resolvió — esta operación existe para cumplir la
    // interfaz que el proveedor real sí necesita (reconciliación de
    // cobros que se quedaron sin callback). Se apoya en el mismo prefijo
    // de referencia que ejecutarCargo ya usa para decidir el desenlace.
    if (referenciaExterna.startsWith("chg_")) {
      return { estado: "exitoso", referenciaExterna };
    }
    return { estado: "pendiente" };
  }

  async reversarOAnular(paisCodigo: string, referenciaExterna: string): Promise<ResultadoReversion> {
    obtenerCredencialesPais(paisCodigo);
    await esperar(DELAY_MS);
    void referenciaExterna;
    return { exito: true };
  }
}

const proveedorSimulado = new ProveedorPagosSimulado();

// Punto único de conexión con el proveedor real: cuando se confirme la
// tokenización con Tilopay bajo el modelo facilitador, acá se decide (por
// config) devolver una implementación real en vez de la simulada — el
// resto del código nunca vuelve a tocarse.
export function obtenerProveedorPagos(): ProveedorPagos {
  return proveedorSimulado;
}
