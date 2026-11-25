import { webcrypto } from "node:crypto";
import type { webcrypto as tiposWebcrypto } from "node:crypto";
import * as forge from "node-forge";
import * as xadesjs from "xadesjs";
import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";

// `Crypto`, `CryptoKey` y `Algorithm` son tipos del DOM, y el tsconfig de
// este backend NO incluye la librería "dom" a propósito: agregarla haría
// aparecer `document`, `window` y `fetch` como globales en todo el
// backend, y ahí un error de tipeo en código de servidor dejaría de
// fallar al compilar. Así que los tipos se toman de `node:crypto`, que es
// de donde sale el motor criptográfico real.
type ClaveCripto = tiposWebcrypto.CryptoKey;
type MotorCripto = tiposWebcrypto.Crypto;
type AlgoritmoCripto = tiposWebcrypto.Algorithm;

// ---------------------------------------------------------------------
// Firma XAdES-EPES de un comprobante electrónico. ÚNICO módulo de firma:
// nada más en el backend toca la llave criptográfica ni el nodo
// ds:Signature.
//
// LA LIBRERÍA: `xadesjs` (sobre `xmldsigjs`). Es la única del ecosistema
// de Node que implementa XAdES-EPES completo —SignedProperties,
// SigningCertificate con su CertDigest e IssuerSerial, y
// SignaturePolicyIdentifier con el hash de la política— que es
// exactamente lo que Hacienda exige; `xml-crypto` firma XMLDSig pero no
// construye las propiedades XAdES, así que habría que escribirlas a mano
// y canonicalizarlas, que es la parte difícil y la que no conviene
// improvisar en un documento fiscal.
//
// `node-forge` se usa solo para abrir el PKCS#12 (.p12) y sacar de ahí el
// certificado y la llave privada: WebCrypto no lee PKCS#12.
//
// LO QUE PIDE LA NORMA (Anexo 2 de ANEXOS_Y_ESTRUCTURAS_V4.4, páginas
// 84-88), punto por punto:
//   * firma XAdES-EPES según ETSI TS 101 903 v1.3.2 o superior;
//   * empaquetado ENVELOPED, "no se aceptará ningún otro";
//   * la etiqueta en el XPath `/FacturaElectronica/ds:Signature`;
//   * certificados RSA 2048 o RSA 4096;
//   * digest SHA-256 o SHA-512;
//   * la URL del PDF de la política, con su hash.
// ---------------------------------------------------------------------

/**
 * La URL del PDF de la política de firma, tal como la escribe el Anexo 2.
 * Va literal dentro de cada firma.
 */
export const URL_POLITICA_FIRMA =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf";

/**
 * El SHA-256 del PDF de la política, en base64.
 *
 * NO está copiado del ejemplo del anexo "porque ahí dice eso": se
 * descargó el PDF de la URL de arriba y se calculó su hash, y coincide
 * exactamente con el del ejemplo oficial. El PDF quedó guardado en
 * `docs/facturacion/fuentes/documentos/` con su hash en `sumas.sha256`,
 * así que la afirmación se puede volver a comprobar sin internet.
 */
export const HASH_POLITICA_FIRMA = "DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=";

/** Anexo 2: "los algoritmos de digest de la firma deben ser SHA-256 y SHA-512". */
const ALGORITMO_FIRMA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** Anexo 2: RSA 2048 o RSA 4096. */
const BITS_RSA_ACEPTADOS = [2048, 4096];

let inicializado = false;

/**
 * Registra el motor criptográfico y las implementaciones de DOM que
 * `xadesjs` necesita en Node (en el navegador las toma del entorno).
 *
 * Es idempotente y se llama sola: si hubiera que llamarla a mano desde
 * cada punto de entrada —una ruta, un job, un script— alguno se
 * olvidaría, y el síntoma sería "Node dependency not found: DOMParser"
 * en el momento de firmar, que es el peor momento para enterarse.
 */
function inicializar(): void {
  if (inicializado) return;
  xadesjs.Application.setEngine("NodeJS", webcrypto as unknown as MotorCripto);
  // `xpath` va por require y no por import: su export es CommonJS y el
  // namespace de un `import` dinámico deja `select` abajo de `.default`,
  // donde xml-core no lo busca.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const xpath = require("xpath");
  xadesjs.setNodeDependencies({ DOMParser, XMLSerializer, DOMImplementation, xpath });
  inicializado = true;
}

export interface LlaveFirma {
  /** El certificado X.509 del firmante, en base64 (DER), como va en `ds:X509Certificate`. */
  certificadoBase64: string;
  /** La llave privada importada a WebCrypto, lista para firmar. */
  llave: ClaveCripto;
  /** Datos del certificado para mostrar y para avisar antes de que venza. */
  info: {
    sujeto: string;
    emisor: string;
    numeroSerie: string;
    validoDesde: Date;
    validoHasta: Date;
    bitsRsa: number;
  };
}

/**
 * Abre un PKCS#12 (.p12) con su PIN y devuelve el certificado y la llave
 * privada listos para firmar.
 *
 * Valida el tamaño de la llave contra lo que el Anexo 2 acepta: una
 * llave de 1024 bits produciría una firma que Hacienda rechaza, y es
 * mejor decirlo al cargar la credencial que al emitir la primera
 * factura.
 */
export async function abrirLlaveP12(p12: Buffer, pin: string): Promise<LlaveFirma> {
  inicializar();

  let p12Asn1: forge.asn1.Asn1;
  try {
    p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12.toString("binary")));
  } catch {
    throw new Error("El archivo de la llave criptográfica no es un PKCS#12 válido (.p12).");
  }

  let pkcs12: forge.pkcs12.Pkcs12Pfx;
  try {
    pkcs12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pin);
  } catch {
    // El PIN equivocado y un archivo corrupto dan el mismo error en
    // forge; el mensaje nombra las dos posibilidades en vez de afirmar
    // una.
    throw new Error(
      "No se pudo abrir la llave criptográfica: el PIN es incorrecto o el archivo está dañado."
    );
  }

  const bolsasCert = pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  const bolsasLlave =
    pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? pkcs12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];

  const cert = bolsasCert?.[0]?.cert;
  const llavePrivada = bolsasLlave?.[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!cert || !llavePrivada) {
    throw new Error(
      "La llave criptográfica no contiene a la vez un certificado y una llave privada. Hace falta el .p12 completo que entrega el banco o el BCCR, no solo el certificado."
    );
  }

  const bitsRsa = llavePrivada.n.bitLength();
  if (!BITS_RSA_ACEPTADOS.includes(bitsRsa)) {
    throw new Error(
      `La llave es RSA de ${bitsRsa} bits y el Anexo 2 de Hacienda solo acepta RSA 2048 o RSA 4096. Una firma con esta llave se rechaza.`
    );
  }

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const certificadoBase64 = Buffer.from(certDer, "binary").toString("base64");

  const pkcs8 = forge.asn1
    .toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(llavePrivada)))
    .getBytes();
  const llave = await webcrypto.subtle.importKey(
    "pkcs8",
    Buffer.from(pkcs8, "binary"),
    { name: ALGORITMO_FIRMA.name, hash: ALGORITMO_FIRMA.hash },
    false,
    ["sign"]
  );

  return {
    certificadoBase64,
    llave: llave as unknown as ClaveCripto,
    info: {
      sujeto: cert.subject.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(","),
      emisor: cert.issuer.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(","),
      numeroSerie: cert.serialNumber,
      validoDesde: cert.validity.notBefore,
      validoHasta: cert.validity.notAfter,
      bitsRsa,
    },
  };
}

/**
 * Firma el XML de un comprobante y devuelve el XML con el nodo
 * `ds:Signature` agregado al final, como último hijo del elemento raíz.
 *
 * `momentoFirma` existe para poder reproducir una firma en un test. En
 * producción se omite y se usa la hora real.
 */
export async function firmarXml(
  xml: string,
  llaveFirma: LlaveFirma,
  momentoFirma?: Date
): Promise<string> {
  inicializar();

  const doc = xadesjs.Parse(xml);
  const firmador = new xadesjs.SignedXml();

  const firma = await firmador.Sign(
    { name: ALGORITMO_FIRMA.name, hash: ALGORITMO_FIRMA.hash } as unknown as AlgoritmoCripto,
    llaveFirma.llave,
    doc,
    {
      // Canonicalización exclusiva también para el `ds:SignedInfo`, no
      // solo para las referencias: el ejemplo del Anexo 2 usa
      // `xml-exc-c14n` en el `ds:CanonicalizationMethod`, y el valor por
      // defecto de la librería es la c14n inclusiva.
      canonicalization: "exc-c14n",
      // EL CERTIFICADO EN `ds:KeyInfo/ds:X509Data/ds:X509Certificate`.
      // Esto no es decorativo y costó encontrarlo: sin `x509`, la firma
      // se genera igual y parece correcta, pero no hay ninguna llave
      // pública en el documento, así que NADIE puede verificarla —
      // `verificarFirma` devolvía false sobre un XML intacto. La opción
      // `signingCertificate` de abajo es otra cosa: agrega la propiedad
      // `xades:SigningCertificate` (el digest del certificado), que es un
      // requisito de XAdES pero no sirve para verificar la firma.
      // El ejemplo oficial del Anexo 2 lleva los dos.
      x509: [llaveFirma.certificadoBase64],
      // La referencia al documento completo. `uri: ""` más la transforma
      // `enveloped` es el empaquetado ENVELOPED que exige el Anexo 2, y
      // `exc-c14n` la canonicalización exclusiva del ejemplo oficial.
      references: [
        { id: "r-id-1", uri: "", hash: ALGORITMO_FIRMA.hash, transforms: ["enveloped", "exc-c14n"] },
      ],
      // El digest del certificado, en `xades:SigningCertificate`.
      signingCertificate: llaveFirma.certificadoBase64,
      signingTime: momentoFirma ? { value: momentoFirma } : {},
      // Lo que vuelve a la firma "EPES" y no solo "BES": la política.
      policy: {
        identifier: { value: URL_POLITICA_FIRMA },
        hash: ALGORITMO_FIRMA.hash,
        digestValue: HASH_POLITICA_FIRMA,
      },
      signedPropertiesReference: {
        hash: ALGORITMO_FIRMA.hash,
        transforms: ["exc-c14n"],
      },
    }
  );

  // El nodo va como ÚLTIMO hijo del raíz: el XSD lo pone al final de la
  // secuencia y el Anexo 2 fija el XPath `/FacturaElectronica/ds:Signature`.
  doc.documentElement!.appendChild(firma.GetXml()!);

  return new XMLSerializer().serializeToString(doc as never);
}

export interface ResultadoVerificacion {
  valida: boolean;
  motivo?: string;
}

/**
 * Verifica la firma de un XML ya firmado.
 *
 * Devuelve `false` con motivo en vez de lanzar: verificar es una
 * pregunta, y "la firma no corresponde" es una respuesta legítima, no un
 * error del programa. Quien la use decide qué hacer.
 */
export async function verificarFirma(xmlFirmado: string): Promise<ResultadoVerificacion> {
  inicializar();

  let doc;
  try {
    doc = xadesjs.Parse(xmlFirmado);
  } catch {
    return { valida: false, motivo: "El documento no es XML bien formado." };
  }

  const nodos = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
  if (nodos.length === 0) {
    return { valida: false, motivo: "El documento no tiene ningún nodo ds:Signature." };
  }

  const firmador = new xadesjs.SignedXml(doc);
  firmador.LoadXml(nodos[0]);

  try {
    const valida = await firmador.Verify();
    return valida
      ? { valida: true }
      : {
          valida: false,
          motivo:
            "La firma no corresponde al contenido del documento: el XML se modificó después de firmarlo, o la firma no es del certificado que dice.",
        };
  } catch (err) {
    return { valida: false, motivo: `No se pudo verificar la firma: ${(err as Error).message}` };
  }
}
