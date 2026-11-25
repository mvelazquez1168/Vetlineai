import * as forge from "node-forge";

// ---------------------------------------------------------------------
// Genera un PKCS#12 (.p12) autofirmado para VERIFICAR la firma, nunca
// para emitir.
//
// Vive en `facturacion/` y no en `scripts/` porque la API de carga de
// credenciales también lo usa: permite probar el camino completo
// —cargar la llave, firmar, verificar— sin pedirle a nadie su llave
// real. Las credenciales reales de una clínica no se tocan para probar
// nada; esa regla ya costó un incidente.
//
// Qué NO es: este certificado no está emitido por el BCCR ni por ninguna
// autoridad que Hacienda reconozca. Sirve para comprobar que la firma
// XAdES se construye y se verifica bien; un comprobante firmado con él
// lo rechaza Hacienda, y eso es lo correcto.
// ---------------------------------------------------------------------

export interface CertificadoPrueba {
  /** El .p12 completo, como el archivo que entregaría un banco. */
  p12: Buffer;
  pin: string;
  /** Para poder comparar en un test contra lo que devuelve `abrirLlaveP12`. */
  nombreComun: string;
  numeroSerie: string;
}

export interface OpcionesCertificadoPrueba {
  nombreComun?: string;
  pin?: string;
  /** Para probar el rechazo de una llave que la norma no acepta. */
  bits?: number;
  validoDesde?: Date;
  validoHasta?: Date;
}

export function generarCertificadoPrueba(
  opciones: OpcionesCertificadoPrueba = {}
): CertificadoPrueba {
  const nombreComun = opciones.nombreComun ?? "PRUEBA VETLINE CLINIC (FIRMA)";
  const pin = opciones.pin ?? "1234";
  const bits = opciones.bits ?? 2048;

  const llaves = forge.pki.rsa.generateKeyPair({ bits, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = llaves.publicKey;
  // Un serial fijo haría que dos certificados de prueba distintos se
  // vieran iguales en el `IssuerSerial` de la firma.
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = opciones.validoDesde ?? new Date(Date.UTC(2026, 0, 1));
  cert.validity.notAfter = opciones.validoHasta ?? new Date(Date.UTC(2028, 0, 1));

  const atributos = [
    { name: "commonName", value: nombreComun },
    { name: "countryName", value: "CR" },
    { name: "organizationName", value: "NO ES UNA AUTORIDAD RECONOCIDA - SOLO PRUEBAS" },
  ];
  cert.setSubject(atributos);
  cert.setIssuer(atributos);
  cert.sign(llaves.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(llaves.privateKey, [cert], pin, {
    algorithm: "3des",
  });
  const p12 = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");

  return { p12, pin, nombreComun, numeroSerie: cert.serialNumber };
}
