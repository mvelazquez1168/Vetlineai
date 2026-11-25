// Verificación del armado del XML, su validación contra los XSD
// oficiales y la firma XAdES (vetline-clinic-09a, punto 2).
//
// Los dos criterios del prompt:
//   * "Un XML de cada tipo valida contra el XSD oficial. Y un XML con un
//     campo obligatorio quitado a propósito NO valida: el verificador
//     falla contra el defecto antes de creerle."
//   * "La firma se verifica con un certificado de prueba generado para
//     el test (nunca una llave real), y un XML alterado después de
//     firmar no pasa la verificación."
//
// No toca la base de datos: todo es en memoria.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_xml_y_firma.ts
import { calcularComprobante } from "../facturacion/calculo";
import { generarCertificadoPrueba } from "../facturacion/certificadoPrueba";
import {
  HASH_POLITICA_FIRMA,
  URL_POLITICA_FIRMA,
  abrirLlaveP12,
  firmarXml,
  verificarFirma,
} from "../facturacion/firma";
import { DocumentoVenta, LineaDocumento, TipoComprobanteEmitible } from "../facturacion/tipos";
import { validarContraXsd } from "../facturacion/validacionXsd";
import { EmisorXml, armarXml } from "../facturacion/xml";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

const EMISOR: EmisorXml = {
  nombre: "Clínica Veterinaria de Prueba Sociedad Anónima",
  tipoIdentificacion: "02",
  numeroIdentificacion: "3101123456",
  nombreComercial: "Vetline Clinic Demo",
  codigoActividadEconomica: "750000",
  ubicacionProvincia: "1",
  ubicacionCanton: "01",
  ubicacionDistrito: "01",
  ubicacionBarrio: "Barrio Escalante",
  ubicacionOtrasSenas: "200 metros norte de la iglesia, local 3",
  telefonoCodigoPais: "506",
  telefonoNumero: "22334455",
  correo: "facturacion@clinica-prueba.test",
  proveedorSistemas: "3101999999",
};

function linea(cambios: Partial<LineaDocumento> = {}): LineaDocumento {
  return {
    codigoCabys: "8690100000000",
    cantidad: 1,
    unidadMedida: "Sp",
    detalle: "Consulta veterinaria general",
    precioUnitario: 10000,
    impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
    ...cambios,
  };
}

const RECEPTOR = {
  nombre: "Ana María Rodríguez Jiménez",
  identificacion: { tipo: "01", numero: "112345678" },
  correo: "ana.rodriguez@correo-prueba.test",
};

function documento(
  tipo: TipoComprobanteEmitible,
  cambios: Partial<DocumentoVenta> = {}
): DocumentoVenta {
  return {
    tipoComprobante: tipo,
    condicionVenta: "01",
    receptor: RECEPTOR,
    lineas: [linea()],
    mediosPago: [{ codigo: "06" }],
    ...cambios,
  };
}

const CLAVE = "50625112600310112345600100001010000000001187654321";
const CONSECUTIVO = "00100001010000000001";
const FECHA = new Date("2026-11-25T21:00:00Z");

function construir(doc: DocumentoVenta, clave = CLAVE, consecutivo = CONSECUTIVO): string {
  const calculo = calcularComprobante(doc);
  return armarXml({
    clave,
    consecutivo,
    tipoComprobante: doc.tipoComprobante,
    fechaEmision: FECHA,
    emisor: EMISOR,
    documento: doc,
    calculo,
  });
}

/** Los cinco tipos que el motor emite, con lo que cada XSD exige de más. */
const CASOS: Array<{ tipo: TipoComprobanteEmitible; nombre: string; doc: DocumentoVenta }> = [
  { tipo: "01", nombre: "Factura electrónica", doc: documento("01") },
  {
    tipo: "04",
    nombre: "Tiquete electrónico (sin receptor)",
    doc: documento("04", { receptor: undefined }),
  },
  {
    tipo: "03",
    nombre: "Nota de crédito",
    doc: documento("03", {
      referencias: [
        {
          tipoDocumento: "01",
          numero: CLAVE,
          fechaEmision: "2026-11-20T10:00:00-06:00",
          codigo: "01",
          razon: "Anulación de la factura por error en el monto",
        },
      ],
    }),
  },
  {
    tipo: "02",
    nombre: "Nota de débito",
    doc: documento("02", {
      referencias: [
        {
          tipoDocumento: "01",
          numero: CLAVE,
          fechaEmision: "2026-11-20T10:00:00-06:00",
          codigo: "02",
          razon: "Corrige monto de la factura original",
        },
      ],
    }),
  },
  {
    tipo: "10",
    nombre: "Recibo electrónico de pago",
    doc: documento("10", {
      // El XSD del REP solo acepta las condiciones de venta 09 y 11.
      condicionVenta: "09",
      lineas: [
        {
          cantidad: 1,
          unidadMedida: "Sp",
          detalle: "Pago de la factura 00100001010000000001",
          precioUnitario: 10000,
          impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
        },
      ],
      mediosPago: [{ codigo: "04" }],
      referencias: [
        {
          tipoDocumento: "01",
          numero: CLAVE,
          fechaEmision: "2026-11-20T10:00:00-06:00",
          codigo: "17",
          razon: "Pago de la factura referenciada",
        },
      ],
    }),
  },
];

async function main() {
  // ===================================================================
  console.log("=== 1. Un XML de cada tipo valida contra su XSD oficial ===");
  const xmlPorTipo = new Map<string, string>();
  for (const caso of CASOS) {
    const xml = construir(caso.doc);
    xmlPorTipo.set(caso.tipo, xml);
    const r = await validarContraXsd(xml, caso.tipo, { sinFirmar: true });
    assert(
      r.valido,
      `${caso.nombre} (${caso.tipo}) valida contra ${r.esquema}`,
      r.valido ? "" : r.errores.slice(0, 4)
    );
  }

  // ===================================================================
  console.log("\n=== 2. El verificador FALLA con un campo obligatorio quitado ===");
  // Sin esto, lo de arriba también pasaría con un validador que no mira
  // nada. Cada caso quita un campo DISTINTO y obligatorio, y el XSD
  // tiene que nombrarlo.
  const mutilaciones: Array<{ descripcion: string; elemento: string }> = [
    { descripcion: "sin Clave", elemento: "Clave" },
    { descripcion: "sin NumeroConsecutivo", elemento: "NumeroConsecutivo" },
    { descripcion: "sin FechaEmision", elemento: "FechaEmision" },
    { descripcion: "sin CodigoActividadEmisor", elemento: "CodigoActividadEmisor" },
    { descripcion: "sin ProveedorSistemas", elemento: "ProveedorSistemas" },
    { descripcion: "sin TotalComprobante", elemento: "TotalComprobante" },
    { descripcion: "sin BaseImponible en la línea", elemento: "BaseImponible" },
    { descripcion: "sin MontoTotalLinea", elemento: "MontoTotalLinea" },
    { descripcion: "sin CodigoCABYS", elemento: "CodigoCABYS" },
    { descripcion: "sin CondicionVenta", elemento: "CondicionVenta" },
  ];
  const xmlFactura = xmlPorTipo.get("01")!;
  for (const m of mutilaciones) {
    const roto = quitarElemento(xmlFactura, m.elemento);
    assert(roto !== xmlFactura, `  (el XML de prueba contenía <${m.elemento}>)`);
    const r = await validarContraXsd(roto, "01", { sinFirmar: true });
    const nombraElemento = r.errores.some((e) => e.mensaje.includes(m.elemento));
    assert(
      !r.valido && nombraElemento,
      `una factura ${m.descripcion} NO valida, y el error nombra el elemento`,
      !r.valido && nombraElemento ? "" : { valido: r.valido, errores: r.errores.slice(0, 2) }
    );
  }

  // Y un valor fuera de la enumeración oficial tampoco pasa: no alcanza
  // con que estén todos los elementos.
  const tarifaInventada = xmlFactura.replace(
    "<CodigoTarifaIVA>08</CodigoTarifaIVA>",
    "<CodigoTarifaIVA>99</CodigoTarifaIVA>"
  );
  const rTarifa = await validarContraXsd(tarifaInventada, "01", { sinFirmar: true });
  assert(
    !rTarifa.valido,
    "un código de tarifa de IVA que no está en la Nota 8.1 NO valida",
    rTarifa.valido ? "" : rTarifa.errores[0]?.mensaje.slice(0, 100)
  );

  // Una clave de 49 dígitos: el XSD la acota con un patrón, no solo con
  // la presencia del elemento.
  const claveCorta = xmlFactura.replace(CLAVE, CLAVE.slice(0, 49));
  const rClave = await validarContraXsd(claveCorta, "01", { sinFirmar: true });
  assert(!rClave.valido, "una clave de 49 dígitos NO valida (el XSD exige exactamente 50)");

  // ===================================================================
  console.log("\n=== 3. La validación previa descarta SOLO la firma faltante ===");
  const sinFirmaEstricto = await validarContraXsd(xmlFactura, "01");
  assert(
    !sinFirmaEstricto.valido,
    "sin la opción, un XML sin firmar NO valida (el XSD exige ds:Signature)"
  );
  assert(
    sinFirmaEstricto.errores.every((e) => e.mensaje.includes("Signature")),
    "y el ÚNICO error es el de la firma faltante",
    sinFirmaEstricto.errores.map((e) => e.mensaje.slice(0, 80))
  );
  // La opción no es un "aceptá todo": un campo faltante sigue fallando.
  const rotoYSinFirma = await validarContraXsd(quitarElemento(xmlFactura, "Clave"), "01", {
    sinFirmar: true,
  });
  assert(
    !rotoYSinFirma.valido,
    "con la opción puesta, un XML sin Clave SIGUE sin validar"
  );

  // ===================================================================
  console.log("\n=== 4. Firma XAdES con un certificado de prueba ===");
  const prueba = generarCertificadoPrueba();
  assert(prueba.p12.length > 1000, "se generó un .p12 de prueba", `${prueba.p12.length} bytes`);

  const llave = await abrirLlaveP12(prueba.p12, prueba.pin);
  assert(llave.info.bitsRsa === 2048, "la llave es RSA 2048, de los dos tamaños que acepta el Anexo 2");
  assert(
    llave.info.sujeto.includes(prueba.nombreComun),
    "el certificado que sale del .p12 es el que se generó",
    llave.info.sujeto
  );
  assert(llave.certificadoBase64.length > 500, "y trae su certificado en base64 para el ds:KeyInfo");

  // El PIN equivocado no abre la llave.
  try {
    await abrirLlaveP12(prueba.p12, "0000");
    assert(false, "abrir el .p12 con el PIN equivocado — NO falló, y tenía que fallar");
  } catch (err) {
    assert(true, "abrir el .p12 con el PIN equivocado — rechazado", (err as Error).message);
  }

  // Una llave de 1024 bits se rechaza al cargarla, no al emitir.
  const debil = generarCertificadoPrueba({ bits: 1024, nombreComun: "LLAVE DEBIL DE PRUEBA" });
  try {
    await abrirLlaveP12(debil.p12, debil.pin);
    assert(false, "una llave RSA de 1024 bits — NO falló, y tenía que fallar");
  } catch (err) {
    assert(
      (err as Error).message.includes("1024"),
      "una llave RSA de 1024 bits se rechaza al cargarla",
      (err as Error).message
    );
  }

  // ===================================================================
  console.log("\n=== 5. El XML firmado valida contra el XSD, ahora SIN excepción ===");
  const firmado = await firmarXml(xmlFactura, llave, new Date("2026-11-25T21:00:05Z"));
  const rFirmado = await validarContraXsd(firmado, "01");
  assert(
    rFirmado.valido,
    "la factura FIRMADA valida contra el XSD oficial completo",
    rFirmado.valido ? "" : rFirmado.errores.slice(0, 4)
  );

  // Lo que el Anexo 2 exige de la firma, comprobado en el XML resultante.
  assert(firmado.includes("XAdES") || firmado.includes("xades:"), "la firma lleva propiedades XAdES");
  assert(
    firmado.includes("http://uri.etsi.org/01903/v1.3.2#"),
    "con el namespace de ETSI TS 101 903 v1.3.2"
  );
  assert(
    firmado.includes("http://www.w3.org/2001/10/xml-exc-c14n#"),
    "canonicalización exclusiva (exc-c14n)"
  );
  assert(
    firmado.includes("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"),
    "firma RSA con SHA-256"
  );
  assert(
    firmado.includes("http://www.w3.org/2000/09/xmldsig#enveloped-signature"),
    "empaquetado ENVELOPED, el único que el Anexo 2 acepta"
  );
  assert(firmado.includes("SignaturePolicyIdentifier"), "con la política de firma (EPES, no solo BES)");
  assert(firmado.includes(URL_POLITICA_FIRMA), "y la URL exacta del PDF de la política");
  assert(
    firmado.includes(HASH_POLITICA_FIRMA),
    "y el hash del PDF de la política, el mismo que se calculó del archivo real"
  );
  assert(firmado.includes("<xades:SigningTime>"), "con la hora de firma");
  assert(firmado.includes("SigningCertificate"), "y el digest del certificado firmante");
  // El nodo tiene que estar en el XPath que fija el Anexo 2.
  const posFirma = firmado.indexOf("Signature");
  const posResumen = firmado.indexOf("ResumenFactura");
  assert(
    posFirma > posResumen,
    "el nodo de firma está al final, como último hijo del elemento raíz"
  );

  // ===================================================================
  console.log("\n=== 6. La firma se verifica, y un XML alterado NO pasa ===");
  const verificada = await verificarFirma(firmado);
  assert(verificada.valida, "la firma del XML sin tocar se verifica", verificada.motivo ?? "");

  // La alteración que importa: cambiar un MONTO después de firmar. Es el
  // ataque real —emitir por ₡10 000 y guardar un XML que dice ₡1 000— y
  // es lo que la firma tiene que impedir.
  const alterado = firmado.replace(
    "<TotalComprobante>11300.00000</TotalComprobante>",
    "<TotalComprobante>1130.00000</TotalComprobante>"
  );
  assert(alterado !== firmado, "  (se pudo alterar el total en el XML firmado)");
  const verificadaAlterada = await verificarFirma(alterado);
  assert(
    !verificadaAlterada.valida,
    "un XML con el total cambiado después de firmar NO pasa la verificación",
    verificadaAlterada.motivo
  );

  // Otra alteración, en otro lugar: el nombre del receptor.
  const receptorCambiado = firmado.replace(
    "Ana María Rodríguez Jiménez",
    "Otra Persona Distinta XX"
  );
  assert(receptorCambiado !== firmado, "  (se pudo cambiar el nombre del receptor)");
  const verificadaReceptor = await verificarFirma(receptorCambiado);
  assert(
    !verificadaReceptor.valida,
    "un XML con el receptor cambiado después de firmar NO pasa la verificación"
  );

  // Y un XML sin firma, o con una firma de otro documento.
  const sinFirma = await verificarFirma(xmlFactura);
  assert(!sinFirma.valida, "un XML sin firma no pasa la verificación", sinFirma.motivo);

  const otroDoc = construir(
    documento("01", { lineas: [linea({ precioUnitario: 77777 })] }),
    "50625112600310112345600100001010000000002187654321",
    "00100001010000000002"
  );
  const firmaDeOtro = otroDoc.replace(
    "</FacturaElectronica>",
    firmado.slice(firmado.indexOf("<ds:Signature"), firmado.lastIndexOf("</ds:Signature>") + 15) +
      "</FacturaElectronica>"
  );
  const verificadaInjertada = await verificarFirma(firmaDeOtro);
  assert(
    !verificadaInjertada.valida,
    "la firma de un comprobante pegada en OTRO comprobante no pasa la verificación"
  );

  // ===================================================================
  console.log("\n=== 7. Los cinco tipos se firman y validan ===");
  for (const caso of CASOS) {
    const xml = xmlPorTipo.get(caso.tipo)!;
    const f = await firmarXml(xml, llave, new Date("2026-11-25T21:00:05Z"));
    const r = await validarContraXsd(f, caso.tipo);
    const v = await verificarFirma(f);
    assert(
      r.valido && v.valida,
      `${caso.nombre} (${caso.tipo}): firmado valida contra el XSD y su firma se verifica`,
      r.valido && v.valida ? "" : { errores: r.errores.slice(0, 3), firma: v.motivo }
    );
  }

  // ===================================================================
  console.log("\n=== 8. Lo que el armador NO deja emitir ===");
  const noDebePoder: Array<{ descripcion: string; doc: DocumentoVenta }> = [
    { descripcion: "una factura sin receptor", doc: documento("01", { receptor: undefined }) },
    {
      descripcion: "una factura con receptor sin identificación",
      doc: documento("01", { receptor: { nombre: "Sin cédula" } }),
    },
    {
      descripcion: "una nota de crédito sin referencia al comprobante que corrige",
      doc: documento("03"),
    },
    { descripcion: "un REP sin referencia a la factura que cancela", doc: documento("10", { condicionVenta: "09" }) },
    {
      descripcion: "una línea de factura sin código CABYS",
      doc: documento("01", { lineas: [linea({ codigoCabys: undefined })] }),
    },
  ];
  for (const caso of noDebePoder) {
    try {
      construir(caso.doc);
      assert(false, `${caso.descripcion} — NO falló, y tenía que fallar`);
    } catch (err) {
      assert(true, `${caso.descripcion} — rechazado`, (err as Error).message.slice(0, 110));
    }
  }

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  if (!ok) process.exit(1);
}

/**
 * Quita la primera aparición de un elemento del XML, con su contenido.
 *
 * Con texto y no con un parser de XML a propósito: el objetivo es romper
 * el documento exactamente como lo rompería un bug, y un parser podría
 * "arreglar" algo al reserializar y hacer que la prueba pruebe otra cosa.
 */
function quitarElemento(xml: string, nombre: string): string {
  const apertura = `<${nombre}>`;
  const cierre = `</${nombre}>`;
  const i = xml.indexOf(apertura);
  if (i === -1) return xml;
  const j = xml.indexOf(cierre, i);
  if (j === -1) return xml;
  return xml.slice(0, i) + xml.slice(j + cierre.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
