import {
  CredencialesHacienda,
  DatosEnvio,
  ErrorHaciendaSinRespuesta,
  EstadoConsultado,
  ProveedorHacienda,
  ResultadoEnvio,
} from "./proveedorHacienda";

// ---------------------------------------------------------------------
// El proveedor SIMULADO. Es el que se usa en desarrollo y el único con
// el que se puede probar lo que importa: que Hacienda acepte, rechace,
// demore o no conteste.
//
// Mismo criterio que `pagos/proveedorPagos.ts` (el proveedor de pagos
// simulado con sus números mágicos): no imita a Hacienda "a ver si pega",
// reproduce los CUATRO comportamientos que cambian la decisión del motor,
// y cada caso se programa a propósito desde un test.
//
// Cómo se elige el comportamiento: por la clave del comprobante. Es la
// única forma de que un escenario se programe antes de emitir y se
// cumpla después, cuando el motor llame por su cuenta — un parámetro no
// serviría, porque el motor no sabe de escenarios.
// ---------------------------------------------------------------------

export type Escenario =
  /** Recibe y después acepta. El camino feliz. */
  | "acepta"
  /** Recibe y después rechaza, con un motivo. */
  | "rechaza"
  /** Recibe y acepta parcialmente. */
  | "acepta_parcial"
  /**
   * Recibe, pero queda "RECIBIDO" por N consultas antes de resolver. Es
   * el caso normal de Hacienda: la aceptación no es inmediata.
   */
  | "demora"
  /**
   * No contesta al enviar. El comprobante queda firmado y en cola, y el
   * job de contingencia lo reintenta.
   */
  | "sin_respuesta"
  /**
   * No contesta las primeras N veces y después acepta. Es el escenario
   * completo de contingencia: sin respuesta → reintento → aceptado.
   */
  | "sin_respuesta_luego_acepta";

export interface ConfiguracionEscenario {
  escenario: Escenario;
  /** Cuántas consultas o intentos faltan para que resuelva. */
  vueltas?: number;
  /** El motivo del rechazo, para `rechaza`. */
  motivo?: string;
}

interface EstadoSimulado extends ConfiguracionEscenario {
  /** Cuántas veces se intentó enviar. */
  intentos: number;
  /** Cuántas veces se consultó el estado. */
  consultas: number;
  recibido: boolean;
  /** El XML que se recibió, para poder comprobar que llegó el firmado. */
  xmlRecibido?: string;
}

const porClave = new Map<string, EstadoSimulado>();

/** El escenario que se aplica a una clave que nadie programó. */
let escenarioPorDefecto: ConfiguracionEscenario = { escenario: "acepta" };

/**
 * Programa el comportamiento de una clave. Se llama ANTES de emitir.
 *
 * `vueltas` significa distinto según el escenario y está a propósito en
 * un solo campo: en `demora` son las consultas que siguen devolviendo
 * RECIBIDO; en `sin_respuesta_luego_acepta`, los envíos que fallan antes
 * del que entra.
 */
export function programarEscenario(clave: string, config: ConfiguracionEscenario): void {
  porClave.set(clave, {
    ...config,
    vueltas: config.vueltas ?? 1,
    intentos: 0,
    consultas: 0,
    recibido: false,
  });
}

export function fijarEscenarioPorDefecto(config: ConfiguracionEscenario): void {
  escenarioPorDefecto = config;
}

/** Qué pasó con una clave. Para que un verificador compruebe los efectos. */
export function inspeccionar(clave: string): Readonly<EstadoSimulado> | undefined {
  return porClave.get(clave);
}

/** Borra todo. Lo usan los verificadores entre escenarios. */
export function reiniciarSimulado(): void {
  porClave.clear();
  escenarioPorDefecto = { escenario: "acepta" };
}

function estadoDe(clave: string): EstadoSimulado {
  let e = porClave.get(clave);
  if (!e) {
    e = {
      ...escenarioPorDefecto,
      vueltas: escenarioPorDefecto.vueltas ?? 1,
      intentos: 0,
      consultas: 0,
      recibido: false,
    };
    porClave.set(clave, e);
  }
  return e;
}

export const haciendaSimulado: ProveedorHacienda = {
  nombre: "hacienda-simulado",

  async enviar(datos: DatosEnvio, cred: CredencialesHacienda): Promise<ResultadoEnvio> {
    // Las credenciales se exigen aunque no se usen: "emitir sin
    // credenciales cargadas" es un camino de error que también hay que
    // poder probar, y si el simulado las ignorara ese camino solo
    // aparecería en producción. Mismo criterio que el proveedor de pagos
    // simulado con las credenciales por país.
    if (!cred.usuarioApi || !cred.passwordApi) {
      throw new Error(
        "El proveedor simulado también exige credenciales cargadas: emitir sin ellas tiene que fallar igual que en producción."
      );
    }

    const e = estadoDe(datos.clave);
    e.intentos++;

    // El XML que llega se guarda para que un verificador pueda comprobar
    // que lo que se envió es el XML FIRMADO y no el borrador.
    e.xmlRecibido = datos.xmlFirmado;

    if (e.escenario === "sin_respuesta") {
      throw new ErrorHaciendaSinRespuesta(
        "[simulado] Hacienda no respondió (escenario 'sin_respuesta')."
      );
    }

    if (e.escenario === "sin_respuesta_luego_acepta" && e.intentos <= (e.vueltas ?? 1)) {
      throw new ErrorHaciendaSinRespuesta(
        `[simulado] Hacienda no respondió (intento ${e.intentos} de ${(e.vueltas ?? 1) + 1}).`
      );
    }

    // IDEMPOTENCIA DEL LADO DE HACIENDA: si la misma clave ya entró, el
    // segundo envío NO crea otro comprobante. Lo simula porque es
    // justamente lo que hace que un reintento sea seguro, y el motor no
    // debería depender de eso igual.
    if (e.recibido) {
      return {
        recibido: true,
        codigoHttp: 200,
        detalle: "[simulado] La clave ya había sido recibida; no se duplica.",
      };
    }

    e.recibido = true;
    return { recibido: true, codigoHttp: 202, detalle: "[simulado] Recibido para proceso." };
  },

  async consultarEstado(
    clave: string,
    cred: CredencialesHacienda
  ): Promise<EstadoConsultado | null> {
    if (!cred.usuarioApi || !cred.passwordApi) {
      throw new Error("El proveedor simulado exige credenciales cargadas para consultar el estado.");
    }

    const e = porClave.get(clave);
    // Nadie envió esta clave: Hacienda no la conoce. Es el 404 real.
    if (!e || !e.recibido) return null;

    e.consultas++;

    if (e.escenario === "demora" && e.consultas <= (e.vueltas ?? 1)) {
      return {
        clave,
        indEstado: "RECIBIDO",
        fecha: "2026-11-25T15:00:00-06:00",
        respuestaXml: respuestaXmlSimulada(clave, "recibido"),
      };
    }

    if (e.escenario === "rechaza") {
      const motivo = e.motivo ?? "[simulado] Comprobante rechazado por la Administración Tributaria.";
      return {
        clave,
        indEstado: "RECHAZADO",
        fecha: "2026-11-25T15:00:00-06:00",
        respuestaXml: respuestaXmlSimulada(clave, "rechazado", motivo),
        detalle: motivo,
      };
    }

    if (e.escenario === "acepta_parcial") {
      const motivo = e.motivo ?? "[simulado] Aceptado parcialmente.";
      return {
        clave,
        indEstado: "ACEPTADO_PARCIAL",
        fecha: "2026-11-25T15:00:00-06:00",
        respuestaXml: respuestaXmlSimulada(clave, "aceptado parcialmente", motivo),
        detalle: motivo,
      };
    }

    return {
      clave,
      indEstado: "ACEPTADO",
      fecha: "2026-11-25T15:00:00-06:00",
      respuestaXml: respuestaXmlSimulada(clave, "aceptado"),
    };
  },
};

/**
 * Un `MensajeHacienda` con la forma del XSD oficial.
 *
 * Que sea un XML de verdad y no un texto cualquiera importa: el motor lo
 * guarda en `fact_comprobantes.respuesta_xml` y el extractor de motivos
 * busca `DetalleMensaje`, así que con un texto suelto el camino que se
 * probaría no sería el real.
 */
function respuestaXmlSimulada(clave: string, estado: string, detalle?: string): string {
  const mensaje = estado === "aceptado" ? "1" : estado === "rechazado" ? "3" : "2";
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda">' +
    `<Clave>${clave}</Clave>` +
    "<NombreEmisor>Clinica de prueba</NombreEmisor>" +
    "<TipoIdentificacionEmisor>02</TipoIdentificacionEmisor>" +
    "<NumeroCedulaEmisor>3101123456</NumeroCedulaEmisor>" +
    `<Mensaje>${mensaje}</Mensaje>` +
    `<DetalleMensaje>${detalle ?? `Comprobante ${estado} (simulado)`}</DetalleMensaje>` +
    "<MontoTotalImpuesto>0.00000</MontoTotalImpuesto>" +
    "<TotalFactura>0.00000</TotalFactura>" +
    "</MensajeHacienda>"
  );
}
