// ---------------------------------------------------------------------
// LA INTERFAZ del proveedor de Hacienda, con sus dos implementaciones
// detrás: la real (`haciendaReal.ts`) y la simulada
// (`haciendaSimulado.ts`).
//
// Por qué una interfaz y no llamar directo a la API: para poder probar
// los cuatro comportamientos que importan —acepta, rechaza, demora, no
// responde— sin depender de los servidores de Hacienda, que además no se
// tocan en desarrollo. Es el mismo patrón que `pagos/proveedorPagos.ts`
// ya usa para la pasarela de pagos.
//
// La distinción que organiza todo este archivo: **"Hacienda rechazó" y
// "Hacienda no contestó" son cosas DISTINTAS.**
//
//   * Rechazó  → el comprobante queda rechazado, se guarda el motivo tal
//                cual y la corrección es un comprobante NUEVO.
//   * No contestó → el comprobante queda firmado y en cola, y un job lo
//                reintenta. La venta NO se bloquea.
//
// Confundirlas es el defecto más caro posible acá: tratar un "no
// contestó" como rechazo descarta un comprobante que Hacienda
// probablemente recibió, y tratar un rechazo como "no contestó" reintenta
// para siempre algo que nunca va a pasar. De ahí que "no contestó" sea un
// tipo de error propio (`ErrorHaciendaSinRespuesta`) y no un string.
// ---------------------------------------------------------------------

/**
 * El `indEstado` que devuelve Hacienda, TAL CUAL. No se traduce ni se
 * normaliza: el motor guarda el valor crudo en
 * `fact_comprobantes.respuesta_ind_estado` y lo interpreta en un solo
 * lugar (`interpretarIndEstado`).
 *
 * Los valores conocidos vienen del ejemplo del Anexo 3 ("RECIBIDO") y de
 * los tres estados finales que la norma describe. La lista NO es cerrada
 * a propósito: si Hacienda devuelve algo que no está acá, el motor lo
 * guarda y lo trata como "todavía no resuelto" en vez de perderlo.
 */
export type IndEstado = string;

/** Cómo el motor interpreta un `indEstado`, en un solo lugar. */
export type EstadoInterpretado = "en_proceso" | "aceptado" | "aceptado_parcial" | "rechazado";

export function interpretarIndEstado(indEstado: IndEstado): EstadoInterpretado {
  const v = indEstado.trim().toUpperCase();
  if (v === "ACEPTADO") return "aceptado";
  if (v === "ACEPTADO_PARCIAL" || v === "ACEPTADOPARCIAL") return "aceptado_parcial";
  if (v === "RECHAZADO") return "rechazado";
  // "RECIBIDO", "PROCESANDO" y cualquier valor desconocido: todavía no
  // hay veredicto. Un valor desconocido NO se toma como rechazo —
  // descartaría un comprobante bueno— y tampoco como aceptación.
  return "en_proceso";
}

export interface DatosEnvio {
  clave: string;
  /** La fecha de emisión en ISO con el desplazamiento de Costa Rica. */
  fechaEmision: string;
  emisor: { tipoIdentificacion: string; numeroIdentificacion: string };
  receptor?: { tipoIdentificacion: string; numeroIdentificacion: string };
  /** El XML FIRMADO, tal como se va a guardar. El proveedor lo codifica. */
  xmlFirmado: string;
}

export interface ResultadoEnvio {
  /**
   * Hacienda recibió el comprobante y lo va a procesar. NO quiere decir
   * aceptado: la aceptación se consulta después.
   */
  recibido: boolean;
  codigoHttp: number;
  /** El cuerpo de la respuesta, si trajo algo. Para la bitácora. */
  detalle?: string;
}

export interface EstadoConsultado {
  clave: string;
  indEstado: IndEstado;
  fecha?: string;
  /** El XML de respuesta de Hacienda, ya decodificado de base64. */
  respuestaXml?: string;
  /**
   * El motivo del rechazo, extraído del XML de respuesta. Se guarda tal
   * cual lo devuelve Hacienda, sin reescribir.
   */
  detalle?: string;
}

/**
 * Hacienda no contestó: timeout, error de red o un 5xx.
 *
 * Es su propio tipo porque el motor tiene que distinguirlo de un rechazo
 * (ver la nota de arriba). Un `catch` que trate todos los errores igual
 * descartaría comprobantes buenos.
 */
export class ErrorHaciendaSinRespuesta extends Error {
  constructor(
    message: string,
    /** El código HTTP, si llegó alguno. `undefined` si fue timeout o red. */
    readonly codigoHttp?: number
  ) {
    super(message);
    this.name = "ErrorHaciendaSinRespuesta";
  }
}

/**
 * Las credenciales que el proveedor necesita. Llegan DESCIFRADAS y vivas
 * solo durante la llamada: nunca se guardan en una variable de módulo ni
 * se escriben a ningún log.
 */
export interface CredencialesHacienda {
  usuarioApi: string;
  passwordApi: string;
  ambiente: "pruebas" | "produccion";
}

export interface ProveedorHacienda {
  /** Para la bitácora: qué implementación atendió esta operación. */
  readonly nombre: string;

  /**
   * `POST /recepcion`. Devuelve si Hacienda lo recibió.
   *
   * Lanza `ErrorHaciendaSinRespuesta` cuando no hubo respuesta, y
   * devuelve `recibido: false` cuando Hacienda contestó rechazando la
   * recepción (p. ej. una clave repetida).
   */
  enviar(datos: DatosEnvio, credenciales: CredencialesHacienda): Promise<ResultadoEnvio>;

  /**
   * `GET /recepcion/{clave}`. `null` si Hacienda todavía no conoce la
   * clave (404), que no es un error: significa que el envío no llegó.
   */
  consultarEstado(
    clave: string,
    credenciales: CredencialesHacienda
  ): Promise<EstadoConsultado | null>;
}
