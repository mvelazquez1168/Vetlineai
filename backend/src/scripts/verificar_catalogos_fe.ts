// Verificación de los catálogos oficiales de facturación electrónica
// (vetline-clinic-09a, punto 1).
//
// El criterio de la guía rectora: un verificador no vale nada hasta que
// falla contra el defecto que dice detectar. Acá el defecto que importa
// es UN ERROR DE TRANSCRIPCIÓN — que `catalogos.ts` tenga un código que
// Hacienda no acepta, o que le falte uno que sí acepta. Eso no lo
// detecta "correr el cargador y ver que no explota".
//
// Así que la comparación no es contra otra lista escrita a mano: es
// contra la enumeración REAL de los XSD oficiales, que es lo que Hacienda
// valida. Y al final el script se autoprueba: inyecta un código falso y
// borra uno verdadero, y confirma que la comparación los señala.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_catalogos_fe.ts
import { pool } from "../db";
import {
  CODIGOS_DESCUENTO,
  CODIGOS_IMPUESTO,
  CODIGOS_REFERENCIA,
  CONDICIONES_IMPUESTO,
  CONDICIONES_VENTA,
  MEDIOS_PAGO,
  MONEDAS,
  TARIFAS_IVA,
  TIPOS_COMPROBANTE,
  TIPOS_DOC_REFERENCIA,
  TIPOS_IDENTIFICACION,
  UNIDADES_MEDIDA,
} from "../facturacion/catalogos";
import {
  enumeracionDeElemento,
  enumeracionDelEsquema,
  rutaEsquema,
} from "../facturacion/esquemas";
import { cargarCatalogosFacturacion } from "../facturacion/cargarCatalogos";
import fs from "fs";

const FACTURA = "v4.4/facturaElectronica/FacturaElectronica_V4.4.xsd";
const REP = "v4.4/reciboElectronicoPago/ReciboElectronicoPago_V4.4.xsd";
const MENSAJE = "v4.4/mensajeReceptor/MensajeReceptor_V4.4.xsd";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

/**
 * Compara, como conjuntos, los códigos de un catálogo nuestro contra la
 * enumeración del XSD. Devuelve qué sobra y qué falta — no solo si
 * coinciden, porque "no coinciden" no dice dónde mirar.
 */
function comparar(
  nombre: string,
  nuestros: string[],
  delXsd: string[],
  // Las comparaciones de autoprueba TIENEN que diferir: marcarlas evita
  // que el log muestre un [FALLO] que en realidad es el resultado
  // esperado, que es la clase de ruido que hace que nadie lea el log.
  seEsperaDiferencia = false
): { sobran: string[]; faltan: string[] } {
  const setXsd = new Set(delXsd);
  const setNuestros = new Set(nuestros);
  const sobran = nuestros.filter((c) => !setXsd.has(c));
  const faltan = delXsd.filter((c) => !setNuestros.has(c));
  const coinciden = sobran.length === 0 && faltan.length === 0;
  if (seEsperaDiferencia) {
    console.log(
      `   ${nombre}: ${nuestros.length} nuestro(s) vs ${delXsd.length} del XSD ->`,
      { sobran, faltan }
    );
  } else {
    assert(
      coinciden,
      `${nombre}: ${nuestros.length} código(s), igual al XSD (${delXsd.length})`,
      coinciden ? "" : { sobran, faltan }
    );
  }
  return { sobran, faltan };
}

async function main() {
  // -------------------------------------------------------------------
  console.log("=== 0. Los diez XSD oficiales están donde el código los busca ===");
  const archivosEsperados = [
    FACTURA,
    REP,
    MENSAJE,
    "v4.4/tiqueteElectronico/TiqueteElectronico_V4.4.xsd",
    "v4.4/notaCreditoElectronica/NotaCreditoElectronica_V4.4.xsd",
    "v4.4/notaDebitoElectronica/NotaDebitoElectronica_V4.4.xsd",
    "v4.4/facturaElectronicaCompra/FacturaElectronicaCompra_V4.4.xsd",
    "v4.4/facturaElectronicaExportacion/FacturaElectronicaExportacion_V4.4.xsd",
    "v4.4/mensajeHacienda/MensajeHacienda_V4.4.xsd",
    "xmldsig-core-schema.xsd",
  ];
  for (const rel of archivosEsperados) {
    assert(fs.existsSync(rutaEsquema(rel)), `existe ${rel}`);
  }

  // Cada tipo de comprobante del catálogo apunta a un XSD que existe.
  // Esta es la aserción que detectaría un `archivo_xsd` mal escrito, que
  // de otro modo solo se vería al intentar emitir.
  for (const t of TIPOS_COMPROBANTE) {
    if (!t.archivoXsd) continue;
    assert(
      fs.existsSync(rutaEsquema(t.archivoXsd)),
      `tipo ${t.codigo} (${t.nombre}) apunta a un XSD que existe`
    );
  }

  // -------------------------------------------------------------------
  console.log("\n=== 1. Cada catálogo coincide EXACTAMENTE con la enumeración del XSD ===");

  comparar(
    "tipos de identificación (IdentificacionType)",
    TIPOS_IDENTIFICACION.map((t) => t.codigo),
    enumeracionDelEsquema(FACTURA, "IdentificacionType")
  );

  // Condición de venta: la unión del XSD de factura (sin 09 ni 11) y el
  // del REP (solo 09 y 11). Dos fuentes porque la norma reparte el
  // catálogo entre dos comprobantes, no porque falte una.
  const condicionFactura = enumeracionDeElemento(FACTURA, "CondicionVenta");
  const condicionRep = enumeracionDeElemento(REP, "CondicionVenta");
  comparar(
    "condiciones de venta (factura + REP)",
    CONDICIONES_VENTA.map((c) => c.codigo),
    Array.from(new Set([...condicionFactura, ...condicionRep]))
  );
  // Y que el reparto esté bien marcado: `soloEnRep` tiene que ser
  // exactamente los que el XSD de factura NO acepta.
  const soloRepNuestros = CONDICIONES_VENTA.filter((c) => c.soloEnRep).map((c) => c.codigo).sort();
  const soloRepXsd = condicionRep.filter((c) => !condicionFactura.includes(c)).sort();
  assert(
    JSON.stringify(soloRepNuestros) === JSON.stringify(soloRepXsd),
    "`soloEnRep` marca exactamente los códigos que el XSD de factura no acepta",
    { nuestros: soloRepNuestros, xsd: soloRepXsd }
  );

  comparar(
    "medios de pago (TipoMedioPago)",
    MEDIOS_PAGO.map((m) => m.codigo),
    enumeracionDeElemento(FACTURA, "TipoMedioPago")
  );

  comparar(
    "códigos de impuesto (CodigoImpuestoType)",
    CODIGOS_IMPUESTO.map((c) => c.codigo),
    enumeracionDelEsquema(FACTURA, "CodigoImpuestoType")
  );

  comparar(
    "tarifas de IVA (CodigoTarifaIVAType)",
    TARIFAS_IVA.map((t) => t.codigo),
    enumeracionDelEsquema(FACTURA, "CodigoTarifaIVAType")
  );

  comparar(
    "unidades de medida (UnidadMedidaType)",
    UNIDADES_MEDIDA.map((u) => u.codigo),
    enumeracionDelEsquema(FACTURA, "UnidadMedidaType")
  );

  comparar(
    "monedas (CodigoMonedaType)",
    Object.keys(MONEDAS),
    enumeracionDelEsquema(FACTURA, "CodigoMonedaType")
  );

  comparar(
    "códigos de descuento (CodigoDescuentoType)",
    CODIGOS_DESCUENTO.map((c) => c.codigo),
    enumeracionDelEsquema(FACTURA, "CodigoDescuentoType")
  );

  comparar(
    "tipos de documento de referencia (TipoDocReferenciaType)",
    TIPOS_DOC_REFERENCIA.map((t) => t.codigo),
    enumeracionDelEsquema(FACTURA, "TipoDocReferenciaType")
  );

  // Códigos de referencia: igual que la condición de venta, el 17 solo
  // está en el XSD del REP.
  const refFactura = enumeracionDelEsquema(FACTURA, "CodigoReferenciaType");
  const refRep = enumeracionDelEsquema(REP, "CodigoReferenciaType");
  comparar(
    "códigos de referencia (factura + REP)",
    CODIGOS_REFERENCIA.map((c) => c.codigo),
    Array.from(new Set([...refFactura, ...refRep]))
  );
  const soloRepRefNuestros = CODIGOS_REFERENCIA.filter((c) => c.soloEnRep)
    .map((c) => c.codigo)
    .sort();
  const soloRepRefXsd = refRep.filter((c) => !refFactura.includes(c)).sort();
  assert(
    JSON.stringify(soloRepRefNuestros) === JSON.stringify(soloRepRefXsd),
    "`soloEnRep` de los códigos de referencia coincide con el XSD",
    { nuestros: soloRepRefNuestros, xsd: soloRepRefXsd }
  );

  comparar(
    "condición del impuesto (MensajeReceptor/CondicionImpuesto)",
    CONDICIONES_IMPUESTO.map((c) => c.codigo),
    enumeracionDeElemento(MENSAJE, "CondicionImpuesto")
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. El verificador FALLA contra un error de transcripción ===");
  // Sin esto, todo lo de arriba podría estar comparando listas vacías.
  const reales = enumeracionDelEsquema(FACTURA, "CodigoImpuestoType");

  const conSobrante = comparar(
    "con un código inventado",
    [...CODIGOS_IMPUESTO.map((c) => c.codigo), "11"],
    reales,
    true
  );
  assert(
    conSobrante.sobran.length === 1 && conSobrante.sobran[0] === "11",
    "el código inventado '11' se reporta como sobrante (el XSD de impuestos salta del 08 al 12)"
  );

  const conFaltante = comparar(
    "con un código omitido",
    CODIGOS_IMPUESTO.map((c) => c.codigo).filter((c) => c !== "08"),
    reales,
    true
  );
  assert(
    conFaltante.faltan.length === 1 && conFaltante.faltan[0] === "08",
    "el código omitido '08' se reporta como faltante"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. Los códigos están en la base, y el cargador es idempotente ===");
  const tablas: Array<[string, number]> = [
    ["fact_cat_tipo_comprobante", TIPOS_COMPROBANTE.length],
    ["fact_cat_tipo_identificacion", TIPOS_IDENTIFICACION.length],
    ["fact_cat_condicion_venta", CONDICIONES_VENTA.length],
    ["fact_cat_medio_pago", MEDIOS_PAGO.length],
    ["fact_cat_codigo_impuesto", CODIGOS_IMPUESTO.length],
    ["fact_cat_tarifa_iva", TARIFAS_IVA.length],
    ["fact_cat_unidad_medida", UNIDADES_MEDIDA.length],
    ["fact_cat_moneda", Object.keys(MONEDAS).length],
    ["fact_cat_codigo_descuento", CODIGOS_DESCUENTO.length],
    ["fact_cat_tipo_doc_referencia", TIPOS_DOC_REFERENCIA.length],
    ["fact_cat_codigo_referencia", CODIGOS_REFERENCIA.length],
    ["fact_cat_condicion_impuesto", CONDICIONES_IMPUESTO.length],
  ];
  for (const [tabla, esperados] of tablas) {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${tabla} WHERE activo = true`
    );
    assert(Number(r.rows[0].n) === esperados, `${tabla}: ${esperados} código(s) activo(s)`, r.rows[0].n);
  }

  // Idempotencia real: una segunda corrida no inserta nada y no
  // desactiva nada.
  const segunda = await cargarCatalogosFacturacion(pool);
  const insertados = segunda.resultados.reduce((a, r) => a + r.insertados, 0);
  const desactivados = segunda.resultados.reduce((a, r) => a + r.desactivados, 0);
  assert(insertados === 0, "la segunda corrida no inserta ningún código nuevo", insertados);
  assert(desactivados === 0, "la segunda corrida no desactiva ningún código", desactivados);

  // -------------------------------------------------------------------
  console.log("\n=== 4. Un código que Hacienda quita se DESACTIVA, no se borra ===");
  // Es la regla que protege un comprobante viejo: su código tiene que
  // seguir existiendo para poder leerlo.
  await pool.query(
    `INSERT INTO fact_cat_medio_pago (codigo, nombre, activo) VALUES ('98', 'Código de prueba', true)
     ON CONFLICT (codigo) DO UPDATE SET activo = true`
  );
  const tras = await cargarCatalogosFacturacion(pool);
  const mp = tras.resultados.find((r) => r.tabla === "fact_cat_medio_pago")!;
  assert(mp.desactivados === 1, "el código ajeno al catálogo queda desactivado", mp);
  const sigue = await pool.query<{ activo: boolean }>(
    `SELECT activo FROM fact_cat_medio_pago WHERE codigo = '98'`
  );
  assert(sigue.rows.length === 1, "y NO se borró: la fila sigue ahí");
  assert(sigue.rows[0]?.activo === false, "con activo = false");
  await pool.query(`DELETE FROM fact_cat_medio_pago WHERE codigo = '98'`);

  // -------------------------------------------------------------------
  console.log("\n=== 5. CABYS: reportado como vacío, no inventado ===");
  const cabys = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM fact_cat_cabys");
  assert(
    cabys.rows[0].n === "0",
    "fact_cat_cabys está vacía y el cargador lo avisa (el catálogo no se pudo descargar)"
  );
  assert(tras.cabysVacio === true, "el cargador devuelve cabysVacio = true");

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
