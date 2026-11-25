import fs from "fs";
import path from "path";
import { validateXML } from "xmllint-wasm";
import { TIPOS_COMPROBANTE } from "./catalogos";
import { DIR_ESQUEMAS } from "./esquemas";

// ---------------------------------------------------------------------
// Validación de un XML contra el XSD OFICIAL de Hacienda, antes de
// firmarlo. Un XML que no valida no se firma ni se envía.
//
// LA LIBRERÍA: `xmllint-wasm`. Es libxml2 compilado a WebAssembly, o sea
// el MISMO validador que usa Hacienda del otro lado, sin compilación
// nativa ni una JVM. Las alternativas eran `libxmljs2` (requiere
// toolchain de C++ en la imagen alpine) y `xsd-schema-validator`
// (requiere Java instalado). Un validador escrito en JavaScript puro no
// era opción: XML Schema 1.1 con `xs:import`, tipos con nombre y
// restricciones de patrón es demasiado para una implementación parcial,
// y un validador que acepta un XML que Hacienda rechaza es peor que no
// tener validador.
//
// Los esquemas se leen UNA vez y se cachean en memoria: son ~800 KB en
// total y validar cada comprobante releyéndolos del disco sería un
// desperdicio. La caché vive acá y no en el llamador para que haya un
// solo lugar donde se cargan.
// ---------------------------------------------------------------------

/**
 * El esquema de la firma XML que los nueve XSD de Hacienda importan con
 * `schemaLocation="../../xmldsig-core-schema.xsd"`. Se le pasa a libxml
 * como "preload" con ese nombre exacto, que es cómo resuelve la ruta
 * relativa: desde `v4.4/<tipo>/X.xsd`, `../../` es la raíz.
 */
const ARCHIVO_DSIG = "xmldsig-core-schema.xsd";

const cacheEsquemas = new Map<string, string>();

function leerCacheado(relativa: string): string {
  const existente = cacheEsquemas.get(relativa);
  if (existente !== undefined) return existente;
  const contenido = fs.readFileSync(path.join(DIR_ESQUEMAS, relativa), "utf-8");
  cacheEsquemas.set(relativa, contenido);
  return contenido;
}

export interface ErrorValidacion {
  /** El mensaje de libxml2, que nombra el elemento y por qué falla. */
  mensaje: string;
  linea?: number;
}

export interface ResultadoValidacion {
  valido: boolean;
  errores: ErrorValidacion[];
  /** Qué XSD se usó, para que el error diga contra qué se validó. */
  esquema: string;
}

export interface OpcionesValidacion {
  /**
   * Valida un documento que todavía NO está firmado.
   *
   * Hace falta por una tensión real de la norma: el Anexo pide validar
   * contra el esquema ANTES de firmar ("un XML que no valida no se firma
   * ni se envía"), pero el esquema define `ds:Signature` con
   * `minOccurs="1"`, así que un documento sin firmar nunca validaría.
   *
   * La salida NO es filtrar el error de la firma faltante. Se probó y es
   * frágil: libxml2 no siempre lo redacta igual —en una nota de crédito,
   * donde `InformacionReferencia` puede repetirse, el mensaje nombra ESE
   * elemento y no la firma— así que el filtro por texto dejaba pasar
   * documentos válidos como inválidos y, peor, podría llegar a hacer lo
   * contrario.
   *
   * Lo que se hace es INSERTAR una firma de relleno estructuralmente
   * válida (vacía, sin valor criptográfico) y validar el documento
   * completo, sin tolerar ningún error. Es estrictamente más fuerte:
   * todo lo demás se valida igual que en un documento firmado, y no
   * depende de cómo libxml2 redacte un mensaje.
   */
  sinFirmar?: boolean;
}

/**
 * Una `ds:Signature` mínima que cumple el `xmldsig-core-schema`:
 * SignedInfo con su canonicalización, su método de firma y una
 * referencia con digest, más un SignatureValue. No firma nada — su único
 * propósito es completar la secuencia del XSD para poder validar el
 * resto del documento antes de firmarlo de verdad.
 */
const FIRMA_DE_RELLENO =
  '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
  "<ds:SignedInfo>" +
  '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
  '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
  '<ds:Reference URI="">' +
  '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
  "<ds:DigestValue>AA==</ds:DigestValue>" +
  "</ds:Reference>" +
  "</ds:SignedInfo>" +
  "<ds:SignatureValue>AA==</ds:SignatureValue>" +
  "</ds:Signature>";

/**
 * Mete la firma de relleno justo antes del cierre del elemento raíz.
 *
 * Con texto y no con un DOM: el XML que se valida tiene que ser EL MISMO
 * que se va a firmar, byte por byte salvo este agregado. Pasarlo por un
 * parser y reserializarlo podría normalizar algo —el orden de los
 * atributos, un espacio— y entonces se estaría validando un documento
 * distinto del que se firma.
 */
function conFirmaDeRelleno(xml: string): string {
  const ultimoCierre = xml.lastIndexOf("</");
  if (ultimoCierre === -1) {
    throw new Error("El documento no tiene un elemento raíz cerrado: no es XML válido.");
  }
  return xml.slice(0, ultimoCierre) + FIRMA_DE_RELLENO + xml.slice(ultimoCierre);
}

/**
 * Valida un XML contra el XSD del tipo de comprobante indicado.
 *
 * `tipoComprobante` es el código de dos dígitos de la Nota 2 ('01'
 * factura, '04' tiquete, '10' REP…). El XSD sale del catálogo
 * `TIPOS_COMPROBANTE`, no de un `switch` acá: así el mapa tipo → esquema
 * vive en un solo lugar y el verificador puede comprobar que los diez
 * archivos existen.
 */
export async function validarContraXsd(
  xml: string,
  tipoComprobante: string,
  opciones: OpcionesValidacion = {}
): Promise<ResultadoValidacion> {
  const tipo = TIPOS_COMPROBANTE.find((t) => t.codigo === tipoComprobante);
  if (!tipo?.archivoXsd) {
    throw new Error(
      `No hay un XSD para el tipo de comprobante "${tipoComprobante}". Los tipos conocidos son ${TIPOS_COMPROBANTE.map((t) => t.codigo).join(", ")}.`
    );
  }

  const aValidar = opciones.sinFirmar ? conFirmaDeRelleno(xml) : xml;

  const resultado = await validateXML({
    xml: [{ fileName: "comprobante.xml", contents: aValidar }],
    schema: [{ fileName: tipo.archivoXsd, contents: leerCacheado(tipo.archivoXsd) }],
    preload: [{ fileName: ARCHIVO_DSIG, contents: leerCacheado(ARCHIVO_DSIG) }],
  });

  const errores: ErrorValidacion[] = (resultado.errors ?? []).map((e) => ({
    mensaje: e.message ?? e.rawMessage ?? "(sin mensaje)",
    linea: e.loc?.lineNumber,
  }));

  return { valido: resultado.valid, esquema: tipo.archivoXsd, errores };
}

/**
 * Igual que `validarContraXsd`, pero lanza con el detalle en vez de
 * devolver un resultado. Es la forma que usa el flujo de emisión: si no
 * valida, no hay nada que decidir — no se firma ni se envía.
 *
 * El mensaje incluye los errores de libxml2 tal como vienen, que nombran
 * el elemento y el motivo ("Missing child element(s). Expected is
 * ( … Clave )"). Resumirlos a "el XML no es válido" obligaría a
 * reproducir el caso para saber qué campo falla.
 */
export async function exigirXmlValido(
  xml: string,
  tipoComprobante: string,
  opciones: OpcionesValidacion = {}
): Promise<void> {
  const r = await validarContraXsd(xml, tipoComprobante, opciones);
  if (r.valido) return;

  const detalle = r.errores
    .map((e) => `  - ${e.linea !== undefined ? `línea ${e.linea}: ` : ""}${e.mensaje}`)
    .join("\n");
  throw new Error(
    `El XML del comprobante no valida contra el esquema oficial ${r.esquema} y por lo tanto NO se firma ni se envía.\n${detalle}`
  );
}
