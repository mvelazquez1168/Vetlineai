import crypto from "crypto";
import { PoolClient } from "pg";
import { TIPOS_IDENTIFICACION } from "./catalogos";

// ---------------------------------------------------------------------
// La numeración consecutiva (20 posiciones) y la clave numérica (50) de
// un comprobante electrónico de Costa Rica.
//
// Todo lo de este archivo sale de la **Nota 3** del
// `ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` (composición de las dos) y de la
// **Nota 4.1** (cómo se rellena la identificación del emisor para
// llegar a 12 caracteres). Las posiciones están escritas en los
// comentarios tal como las enumera la norma, porque un error de una
// posición produce un comprobante que Hacienda rechaza con un mensaje
// que no dice dónde está el problema.
// ---------------------------------------------------------------------

/** Posiciones 1-3 de la clave: el código de país de Costa Rica. */
const CODIGO_PAIS = "506";

/** Las tres situaciones de la posición 42 de la clave. */
export type SituacionComprobante = "1" | "2" | "3";

export const SITUACION_NORMAL: SituacionComprobante = "1";
/**
 * OJO: "contingencia" acá NO significa "Hacienda no respondió". Según la
 * Nota 3 es el comprobante que SUSTITUYE a un comprobante FÍSICO emitido
 * durante una contingencia. Un comprobante que no se pudo transmitir
 * porque Hacienda no contestó sigue siendo situación 1: se emitió y se
 * transmite cuando se pueda. Confundirlas declara algo distinto de lo que
 * pasó.
 */
export const SITUACION_SUSTITUYE_FISICO_CONTINGENCIA: SituacionComprobante = "2";
/** Generado sin acceso a internet, conforme la norma. */
export const SITUACION_SIN_INTERNET: SituacionComprobante = "3";

// ---------------------------------------------------------------------
// Numeración consecutiva — 20 posiciones (Nota 3):
//   1-3    local o establecimiento ('001' = casa matriz)
//   4-8    terminal o punto de venta ('00001' = única o centralizada)
//   9-10   tipo de comprobante
//   11-20  el consecutivo, empezando en 1
// ---------------------------------------------------------------------

export interface AlcanceConsecutivo {
  emisorId: string;
  sucursal: string;
  terminal: string;
  tipoComprobante: string;
}

/** El tope de las 10 posiciones del consecutivo. */
export const TOPE_CONSECUTIVO = 9_999_999_999;

export function armarConsecutivo(alcance: Omit<AlcanceConsecutivo, "emisorId">, numero: number): string {
  if (!/^[0-9]{3}$/.test(alcance.sucursal)) {
    throw new Error(`Sucursal inválida "${alcance.sucursal}": son 3 dígitos (Nota 3, posiciones 1-3).`);
  }
  if (!/^[0-9]{5}$/.test(alcance.terminal)) {
    throw new Error(`Terminal inválida "${alcance.terminal}": son 5 dígitos (Nota 3, posiciones 4-8).`);
  }
  if (!/^[0-9]{2}$/.test(alcance.tipoComprobante)) {
    throw new Error(
      `Tipo de comprobante inválido "${alcance.tipoComprobante}": son 2 dígitos (Nota 3, posiciones 9-10).`
    );
  }
  if (!Number.isInteger(numero) || numero < 1 || numero > TOPE_CONSECUTIVO) {
    throw new Error(
      `Consecutivo ${numero} fuera de rango: la Nota 3 lo define de 1 a ${TOPE_CONSECUTIVO} (10 posiciones).`
    );
  }
  return (
    alcance.sucursal + alcance.terminal + alcance.tipoComprobante + String(numero).padStart(10, "0")
  );
}

/**
 * Consume el siguiente número del contador y devuelve el consecutivo de
 * 20 posiciones ya armado.
 *
 * **Recibe un `PoolClient`, no un pool, y es a propósito**: el número se
 * consume en la MISMA transacción que crea el comprobante. Si esa
 * transacción se revierte, el número no se consume — que es exactamente
 * lo que el prompt pide. Con un pool, el `UPDATE` haría su propio commit
 * y un rollback posterior dejaría un hueco.
 *
 * El `INSERT ... ON CONFLICT DO UPDATE` hace tres cosas de un saque:
 *   1. crea el contador la primera vez que ese alcance se usa, sin que
 *      nadie tenga que sembrarlo;
 *   2. incrementa y devuelve el valor nuevo en una sola sentencia, así
 *      que no hay ventana entre leer y escribir;
 *   3. toma el bloqueo de fila, así que dos emisiones simultáneas se
 *      serializan y no pueden sacar el mismo número.
 */
export async function consumirConsecutivo(
  client: PoolClient,
  tenantId: string,
  alcance: AlcanceConsecutivo
): Promise<{ numero: number; consecutivo: string }> {
  const r = await client.query<{ ultimo_numero: string }>(
    `INSERT INTO fact_consecutivos (tenant_id, emisor_id, sucursal, terminal, tipo_comprobante, ultimo_numero)
     VALUES ($1, $2, $3, $4, $5, 1)
     ON CONFLICT (emisor_id, sucursal, terminal, tipo_comprobante)
       DO UPDATE SET ultimo_numero = fact_consecutivos.ultimo_numero + 1,
                     actualizado_en = now()
     RETURNING ultimo_numero`,
    [tenantId, alcance.emisorId, alcance.sucursal, alcance.terminal, alcance.tipoComprobante]
  );

  // `ultimo_numero` es BIGINT y `pg` lo devuelve como string para no
  // perder precisión. El tope real son 10 dígitos, que entran de sobra en
  // un number, así que la conversión es segura — pero el parseo explícito
  // evita que un `+1` en JavaScript concatene en vez de sumar.
  const numero = Number(r.rows[0].ultimo_numero);

  return { numero, consecutivo: armarConsecutivo(alcance, numero) };
}

// ---------------------------------------------------------------------
// Clave numérica — 50 posiciones (Nota 3):
//   1-3    código de país ('506')
//   4-5    día de generación
//   6-7    mes de generación
//   8-9    año de generación (2 dígitos)
//   10-21  identificación del emisor, 12 caracteres (Nota 4.1)
//   22-41  la numeración consecutiva completa, las 20 posiciones
//   42     situación del comprobante
//   43-50  código de seguridad, 8 posiciones, generado por el emisor
// ---------------------------------------------------------------------

/**
 * La identificación del emisor rellenada a 12 caracteres según la
 * **Nota 4.1**.
 *
 * La nota describe cuántos ceros agregar por tipo, pero el resultado que
 * pide en todos los casos es el mismo: completar 12. Así que el relleno
 * se calcula —`padStart(12, "0")`— en vez de escribir "tres ceros para
 * física, dos para jurídica, uno para DIMEX de 11": esa tabla de ceros
 * es correcta SOLO si la cédula tiene el largo canónico, y una cédula
 * física guardada con un cero de más produciría 13 caracteres sin que
 * nada avise.
 *
 * Lo que sí se valida es que el largo no PASE de 12, porque ahí el
 * relleno no alcanza y hay que parar: los tipos 05 (extranjero no
 * domiciliado) y 06 (no contribuyente) admiten hasta 20 caracteres en el
 * campo del XML y la Nota 4.1 no dice cómo meterlos en la clave. Es un
 * caso que la norma no cubre y que el motor no puede inventar.
 */
export function identificacionParaClave(tipoIdentificacion: string, numero: string): string {
  const limpio = numero.trim();

  if (!/^[0-9]+$/.test(limpio)) {
    throw new Error(
      `La identificación "${numero}" tiene caracteres que no son dígitos: las posiciones 10-21 de la clave numérica son numéricas (Nota 3).`
    );
  }

  const tipo = TIPOS_IDENTIFICACION.find((t) => t.codigo === tipoIdentificacion);
  if (!tipo) {
    throw new Error(
      `Tipo de identificación "${tipoIdentificacion}" desconocido: los de la Nota 4 son ${TIPOS_IDENTIFICACION.map((t) => t.codigo).join(", ")}.`
    );
  }

  if (limpio.length > 12) {
    throw new Error(
      `La identificación "${limpio}" tiene ${limpio.length} dígitos y no entra en las 12 posiciones de la clave numérica. ` +
        `La Nota 4.1 solo define el relleno para cédula física, jurídica, DIMEX y NITE; para el tipo ${tipo.codigo} (${tipo.nombre}) la norma no dice cómo armar la clave.`
    );
  }

  return limpio.padStart(12, "0");
}

/**
 * Las 8 posiciones del código de seguridad (43-50). "Debe ser generado
 * por el sistema del obligado tributario" (Nota 3) y no dice más: no
 * tiene que ser derivable ni verificable, solo impredecible, porque la
 * clave completa es lo que se usa para consultar el comprobante por su
 * código QR. De ahí `crypto.randomInt` y no `Math.random`.
 */
export function generarCodigoSeguridad(): string {
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
}

/**
 * El día, mes y año de las posiciones 4-9, en la hora de Costa Rica.
 *
 * La zona horaria importa y la norma no la nombra: dice "el día en que se
 * genere el comprobante". Un comprobante emitido a las 20:00 del día 25
 * en Costa Rica son las 02:00 del 26 en UTC, y la clave tiene que decir
 * 25 — es la fecha del hecho generador. Usar la fecha UTC desplazaría un
 * día todos los comprobantes emitidos después de las 18:00.
 */
export function fechaParaClave(fecha: Date): { dia: string; mes: string; anio: string } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(fecha);
  const buscar = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  return { dia: buscar("day"), mes: buscar("month"), anio: buscar("year") };
}

export interface DatosClave {
  fechaEmision: Date;
  tipoIdentificacionEmisor: string;
  numeroIdentificacionEmisor: string;
  /** Las 20 posiciones completas, tal como van en el XML. */
  consecutivo: string;
  situacion: SituacionComprobante;
  /** Si no se pasa, se genera uno. Se acepta para poder reproducir una clave en un test. */
  codigoSeguridad?: string;
}

export function armarClave(datos: DatosClave): string {
  if (!/^[0-9]{20}$/.test(datos.consecutivo)) {
    throw new Error(
      `El consecutivo "${datos.consecutivo}" no tiene 20 dígitos: las posiciones 22-41 de la clave son la numeración consecutiva completa (Nota 3).`
    );
  }
  if (!["1", "2", "3"].includes(datos.situacion)) {
    throw new Error(
      `Situación "${datos.situacion}" inválida: la Nota 3 define 1 (normal), 2 (contingencia) y 3 (sin internet).`
    );
  }

  const codigoSeguridad = datos.codigoSeguridad ?? generarCodigoSeguridad();
  if (!/^[0-9]{8}$/.test(codigoSeguridad)) {
    throw new Error(
      `El código de seguridad "${codigoSeguridad}" no tiene 8 dígitos (Nota 3, posiciones 43-50).`
    );
  }

  const { dia, mes, anio } = fechaParaClave(datos.fechaEmision);
  const identificacion = identificacionParaClave(
    datos.tipoIdentificacionEmisor,
    datos.numeroIdentificacionEmisor
  );

  const clave =
    CODIGO_PAIS + dia + mes + anio + identificacion + datos.consecutivo + datos.situacion + codigoSeguridad;

  // Las 50 posiciones son fijas. Esta comprobación no debería poder
  // fallar después de las validaciones de arriba, y está igual porque el
  // costo de equivocarse es un comprobante rechazado por Hacienda sin
  // explicación útil: es más barato fallar acá, con el detalle de qué
  // pieza mide mal.
  if (clave.length !== 50) {
    throw new Error(
      `La clave armada tiene ${clave.length} caracteres y no 50. Piezas: pais=${CODIGO_PAIS.length}, ` +
        `fecha=${dia.length + mes.length + anio.length}, identificacion=${identificacion.length}, ` +
        `consecutivo=${datos.consecutivo.length}, situacion=1, seguridad=${codigoSeguridad.length}.`
    );
  }

  return clave;
}

/**
 * Lee una clave de vuelta a sus piezas. Sirve para dos cosas concretas:
 * mostrar el desglose en la pantalla de detalle, y verificar en un test
 * que lo que se armó es lo que se quiso armar sin volver a usar la misma
 * función de armado (que probaría nada).
 */
export function desarmarClave(clave: string): {
  pais: string;
  dia: string;
  mes: string;
  anio: string;
  identificacion: string;
  consecutivo: string;
  situacion: string;
  codigoSeguridad: string;
  // Las piezas del consecutivo, que viaja adentro de la clave.
  sucursal: string;
  terminal: string;
  tipoComprobante: string;
  numero: number;
} {
  if (!/^[0-9]{50}$/.test(clave)) {
    throw new Error(`"${clave}" no es una clave numérica: son 50 dígitos.`);
  }
  const consecutivo = clave.slice(21, 41);
  return {
    pais: clave.slice(0, 3),
    dia: clave.slice(3, 5),
    mes: clave.slice(5, 7),
    anio: clave.slice(7, 9),
    identificacion: clave.slice(9, 21),
    consecutivo,
    situacion: clave.slice(41, 42),
    codigoSeguridad: clave.slice(42, 50),
    sucursal: consecutivo.slice(0, 3),
    terminal: consecutivo.slice(3, 8),
    tipoComprobante: consecutivo.slice(8, 10),
    numero: Number(consecutivo.slice(10, 20)),
  };
}

/**
 * Los nombres de archivo que la Nota 3 exige para el correo y el
 * almacenamiento. Están acá, junto a la clave, porque todos se derivan de
 * ella: si vivieran en el módulo de correo se volverían a armar a mano.
 */
export const nombresArchivo = {
  xml: (clave: string) => `${clave}.xml`,
  respuesta: (clave: string) => `${clave}_respuesta.xml`,
  pdf: (clave: string) => `${clave}.pdf`,
  /** Los mensajes de confirmación llevan clave-consecutivo. */
  xmlConfirmacion: (claveConfirmada: string, consecutivoMensaje: string) =>
    `${claveConfirmada}-${consecutivoMensaje}.xml`,
  pdfConfirmacion: (claveConfirmada: string, consecutivoMensaje: string) =>
    `${claveConfirmada}-${consecutivoMensaje}.pdf`,
  respuestaConfirmacion: (claveConfirmada: string, consecutivoMensaje: string) =>
    `${claveConfirmada}-${consecutivoMensaje}_respuesta.xml`,
};
