// Verificación de la clave numérica, el consecutivo y el cálculo de
// impuestos y totales (vetline-clinic-09a, punto 2).
//
// Los casos de cálculo están resueltos A MANO en los comentarios, con la
// aritmética escrita paso a paso. Eso es el punto: comparar el motor
// contra otra ejecución del motor no prueba nada. Si un número de acá no
// coincide, o el motor está mal o la cuenta a mano está mal, y las dos
// están a la vista.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_clave_y_calculo.ts
import { pool } from "../db";
import {
  armarClave,
  armarConsecutivo,
  consumirConsecutivo,
  desarmarClave,
  fechaParaClave,
  generarCodigoSeguridad,
  identificacionParaClave,
  nombresArchivo,
} from "../facturacion/claveConsecutivo";
import { aMonto, deMonto, repartirProporcional, sumar } from "../facturacion/decimal";
import { calcularComprobante, calcularLinea, esServicio } from "../facturacion/calculo";
import { DocumentoVenta, LineaDocumento } from "../facturacion/tipos";

const PREFIJO = "probe-clave-calculo";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}
/** Compara un monto en cienmilésimas contra el texto decimal esperado. */
function monto(obtenido: bigint, esperado: string, msg: string) {
  igual(deMonto(obtenido), esperado, msg);
}

async function debeFallar(descripcion: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    assert(false, `${descripcion} — NO falló, y tenía que fallar`);
  } catch (err) {
    assert(true, `${descripcion} — rechazado`, (err as Error).message.slice(0, 120));
  }
}

async function limpiar() {
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

// Una línea mínima reutilizable: una consulta veterinaria de ₡10 000 con
// IVA general. CABYS 8 = servicio.
function lineaBase(cambios: Partial<LineaDocumento> = {}): LineaDocumento {
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

function documentoBase(lineas: LineaDocumento[], cambios: Partial<DocumentoVenta> = {}): DocumentoVenta {
  return {
    tipoComprobante: "01",
    condicionVenta: "01",
    lineas,
    mediosPago: [{ codigo: "06" }],
    ...cambios,
  };
}

async function main() {
  await limpiar();

  // ===================================================================
  console.log("=== 1. Consecutivo de 20 posiciones (Nota 3) ===");
  // 001 casa matriz + 00001 terminal única + 01 factura + 0000000001
  igual(
    armarConsecutivo({ sucursal: "001", terminal: "00001", tipoComprobante: "01" }, 1),
    "00100001010000000001",
    "el primer consecutivo de la casa matriz, terminal única, factura"
  );
  igual(
    armarConsecutivo({ sucursal: "002", terminal: "00003", tipoComprobante: "04" }, 1234567890),
    "00200003041234567890",
    "sucursal 002, terminal 00003, tiquete, número 1 234 567 890 (tope de 10 dígitos)"
  );
  await debeFallar("un consecutivo 0 (la Nota 3 dice que inicia en 1)", () =>
    armarConsecutivo({ sucursal: "001", terminal: "00001", tipoComprobante: "01" }, 0)
  );
  await debeFallar("un consecutivo de 11 dígitos", () =>
    armarConsecutivo({ sucursal: "001", terminal: "00001", tipoComprobante: "01" }, 10_000_000_000)
  );
  await debeFallar("una sucursal de 2 dígitos", () =>
    armarConsecutivo({ sucursal: "01", terminal: "00001", tipoComprobante: "01" }, 1)
  );

  // ===================================================================
  console.log("\n=== 2. Identificación en la clave: Nota 4.1 ===");
  // "Cédula Física: Se debe agregar tres ceros antes de iniciar con el
  // número de cédula con el fin de completar 12 dígitos" → 9 dígitos + 3.
  igual(identificacionParaClave("01", "112345678"), "000112345678", "cédula física de 9 dígitos → 3 ceros");
  // "Cédula Jurídica: Se debe agregar dos ceros […] para completar 12" → 10 + 2.
  igual(identificacionParaClave("02", "3101123456"), "003101123456", "cédula jurídica de 10 dígitos → 2 ceros");
  // "DIMEX: En aquellos casos donde la cédula se encuentre compuesta de
  // 11 dígitos se debe agregar un cero al inicio".
  igual(identificacionParaClave("03", "12345678901"), "012345678901", "DIMEX de 11 dígitos → 1 cero");
  igual(identificacionParaClave("03", "123456789012"), "123456789012", "DIMEX de 12 dígitos → sin relleno");
  // "NITE: Se debe agregar dos ceros […] para completar 12 dígitos".
  igual(identificacionParaClave("04", "1234567890"), "001234567890", "NITE de 10 dígitos → 2 ceros");
  // Lo que la norma NO cubre: los tipos 05 y 06 admiten hasta 20
  // caracteres en el XML y la Nota 4.1 no dice cómo meterlos en la clave.
  await debeFallar("una identificación de 20 caracteres (tipo 05) en la clave", () =>
    identificacionParaClave("05", "12345678901234567890")
  );
  await debeFallar("una identificación con letras", () => identificacionParaClave("02", "3101ABC456"));

  // ===================================================================
  console.log("\n=== 3. Clave numérica de 50 posiciones (Nota 3) ===");
  // Armada a mano, pieza por pieza:
  //   506                 país                      (1-3)
  //   25 11 26            25 de noviembre de 2026   (4-9)
  //   003101123456        cédula jurídica rellenada (10-21)
  //   00100001010000000001 consecutivo              (22-41)
  //   1                   situación normal          (42)
  //   87654321            código de seguridad       (43-50)
  const CLAVE_ESPERADA =
    "506" + "251126" + "003101123456" + "00100001010000000001" + "1" + "87654321";
  const clave = armarClave({
    // 2026-11-25 a las 15:00 de Costa Rica = 21:00 UTC del mismo día.
    fechaEmision: new Date("2026-11-25T21:00:00Z"),
    tipoIdentificacionEmisor: "02",
    numeroIdentificacionEmisor: "3101123456",
    consecutivo: "00100001010000000001",
    situacion: "1",
    codigoSeguridad: "87654321",
  });
  igual(clave, CLAVE_ESPERADA, "la clave armada coincide con la escrita a mano");
  igual(clave.length, 50, "mide 50 caracteres");

  // La zona horaria NO es un detalle: a las 20:00 del 25 en Costa Rica
  // son las 02:00 del 26 en UTC, y la clave tiene que decir 25.
  igual(
    fechaParaClave(new Date("2026-11-26T02:00:00Z")),
    { dia: "25", mes: "11", anio: "26" },
    "02:00 UTC del 26 son las 20:00 del 25 en Costa Rica → la clave dice 25"
  );
  igual(
    fechaParaClave(new Date("2026-11-26T06:00:00Z")),
    { dia: "26", mes: "11", anio: "26" },
    "06:00 UTC del 26 son las 00:00 del 26 en Costa Rica → la clave dice 26"
  );
  // Cambio de año, que es donde un error de zona horaria se nota más.
  igual(
    fechaParaClave(new Date("2027-01-01T04:00:00Z")),
    { dia: "31", mes: "12", anio: "26" },
    "04:00 UTC del 1 de enero de 2027 son las 22:00 del 31/12/2026 en Costa Rica"
  );

  // Desarmarla devuelve las piezas, con otro código (slicing) que el del
  // armado: si las dos coinciden, las posiciones están bien.
  const piezas = desarmarClave(clave);
  igual(piezas.pais, "506", "pieza: país");
  igual(piezas.dia, "25", "pieza: día");
  igual(piezas.mes, "11", "pieza: mes");
  igual(piezas.anio, "26", "pieza: año");
  igual(piezas.identificacion, "003101123456", "pieza: identificación");
  igual(piezas.consecutivo, "00100001010000000001", "pieza: consecutivo");
  igual(piezas.situacion, "1", "pieza: situación");
  igual(piezas.codigoSeguridad, "87654321", "pieza: código de seguridad");
  igual(piezas.sucursal, "001", "pieza: sucursal, de adentro del consecutivo");
  igual(piezas.terminal, "00001", "pieza: terminal");
  igual(piezas.tipoComprobante, "01", "pieza: tipo de comprobante");
  igual(piezas.numero, 1, "pieza: número");

  // El código de seguridad: 8 dígitos y no predecible.
  const codigos = new Set(Array.from({ length: 200 }, () => generarCodigoSeguridad()));
  assert(
    Array.from(codigos).every((c) => /^[0-9]{8}$/.test(c)),
    "el código de seguridad siempre tiene 8 dígitos"
  );
  assert(codigos.size > 190, "200 códigos de seguridad dan al menos 190 valores distintos", codigos.size);

  // Nombres de archivo de la Nota 3.
  igual(nombresArchivo.xml(clave), `${clave}.xml`, "nombre del XML del comprobante");
  igual(nombresArchivo.respuesta(clave), `${clave}_respuesta.xml`, "nombre del XML de respuesta");
  igual(nombresArchivo.pdf(clave), `${clave}.pdf`, "nombre del PDF");
  igual(
    nombresArchivo.xmlConfirmacion(clave, "00100001050000000001"),
    `${clave}-00100001050000000001.xml`,
    "nombre del XML de confirmación: clave-consecutivo"
  );

  // ===================================================================
  console.log("\n=== 4. El consecutivo se consume de forma atómica ===");
  const t = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
    [`${PREFIJO}-tenant`]
  );
  const tenantId = t.rows[0].id;
  const e = await pool.query<{ id: string }>(
    `INSERT INTO fact_emisores (tenant_id, tipo_identificacion, numero_identificacion, nombre,
       codigo_actividad_economica, ubicacion_provincia, ubicacion_canton, ubicacion_distrito,
       ubicacion_otras_senas, correo, proveedor_sistemas)
     VALUES ($1, '02', '3101123456', 'Clínica Veterinaria de Prueba S.A.', '750000',
             '1', '01', '01', '200 metros norte', 'a@b.test', '3101999999') RETURNING id`,
    [tenantId]
  );
  const emisorId = e.rows[0].id;
  const alcance = { emisorId, sucursal: "001", terminal: "00001", tipoComprobante: "01" };

  const c1 = await pool.connect();
  try {
    await c1.query("BEGIN");
    const primero = await consumirConsecutivo(c1, tenantId, alcance);
    igual(primero.numero, 1, "el primer número es 1 (Nota 3: la numeración inicia en 1)");
    igual(primero.consecutivo, "00100001010000000001", "y su consecutivo de 20 posiciones");
    const segundo = await consumirConsecutivo(c1, tenantId, alcance);
    igual(segundo.numero, 2, "el segundo número es 2");
    await c1.query("COMMIT");
  } finally {
    c1.release();
  }

  // Si la transacción se revierte, el número NO se consume. Es la razón
  // por la que `consumirConsecutivo` recibe un client y no un pool.
  const c2 = await pool.connect();
  try {
    await c2.query("BEGIN");
    const tercero = await consumirConsecutivo(c2, tenantId, alcance);
    igual(tercero.numero, 3, "dentro de una transacción que se va a revertir, saca el 3");
    await c2.query("ROLLBACK");
  } finally {
    c2.release();
  }
  const trasRollback = await pool.query<{ ultimo_numero: string }>(
    `SELECT ultimo_numero FROM fact_consecutivos WHERE emisor_id = $1 AND tipo_comprobante = '01'`,
    [emisorId]
  );
  igual(
    trasRollback.rows[0].ultimo_numero,
    "2",
    "tras el ROLLBACK el contador sigue en 2: el número no se consumió"
  );

  // Dos emisiones SIMULTÁNEAS no pueden sacar el mismo número. Se
  // prueba con dos transacciones abiertas a la vez, no en secuencia:
  // en secuencia pasaría incluso con un `SELECT` + `UPDATE` separados,
  // que es justo el defecto que se quiere descartar.
  const paralelas = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const cli = await pool.connect();
      try {
        await cli.query("BEGIN");
        const r = await consumirConsecutivo(cli, tenantId, alcance);
        await cli.query("COMMIT");
        return r.numero;
      } finally {
        cli.release();
      }
    })
  );
  const unicos = new Set(paralelas);
  assert(
    unicos.size === 10,
    "10 emisiones simultáneas dan 10 números distintos",
    { numeros: paralelas.sort((a, b) => a - b) }
  );
  igual(
    paralelas.slice().sort((a, b) => a - b),
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    "y son exactamente del 3 al 12, sin huecos ni repeticiones"
  );

  // El contador se crea solo la primera vez que se usa un alcance nuevo.
  const c3 = await pool.connect();
  try {
    await c3.query("BEGIN");
    const tiquete = await consumirConsecutivo(c3, tenantId, {
      ...alcance,
      tipoComprobante: "04",
    });
    igual(tiquete.numero, 1, "un tipo de comprobante nuevo arranca su propio contador en 1");
    igual(tiquete.consecutivo, "00100001040000000001", "con el 04 en las posiciones 9-10");
    await c3.query("COMMIT");
  } finally {
    c3.release();
  }

  // ===================================================================
  console.log("\n=== 5. Aritmética de montos en coma fija ===");
  // El caso clásico donde el punto flotante falla: 0.1 + 0.2 ≠ 0.3.
  monto(sumar(aMonto("0.1"), aMonto("0.2")), "0.30000", "0,1 + 0,2 = 0,3 exacto");
  // El máximo del DecimalDineroType: 13 enteros y 5 decimales.
  monto(aMonto("9999999999999.99999"), "9999999999999.99999", "el máximo del XSD entra exacto");
  // Más de 5 decimales se redondea explícitamente, no se trunca.
  monto(aMonto("1.234565"), "1.23457", "1,234565 redondea a 1,23457 (half-up)");
  monto(aMonto("1.234564"), "1.23456", "1,234564 redondea a 1,23456");
  // El reparto proporcional suma exactamente el total, sin residuo.
  const partes = repartirProporcional(aMonto("100"), [aMonto("1"), aMonto("1"), aMonto("1")]);
  monto(sumar(...partes), "100.00000", "repartir 100 en 3 partes iguales suma exactamente 100");

  // ===================================================================
  console.log("\n=== 6. Servicio o mercancía según el primer dígito del CABYS ===");
  // Anexo: "códigos que empiecen con: 5,6,7,8,9 del CAByS" son servicios.
  for (const d of ["5", "6", "7", "8", "9"]) {
    assert(esServicio(d + "690100000000"), `CABYS que empieza con ${d} es servicio`);
  }
  for (const d of ["0", "1", "2", "3", "4"]) {
    assert(!esServicio(d + "690100000000"), `CABYS que empieza con ${d} es mercancía`);
  }

  // ===================================================================
  console.log("\n=== 7. Línea simple: una consulta con IVA general ===");
  // A mano:
  //   MontoTotal       = 1 × 10 000          = 10 000
  //   TotalDescuentos  = 0
  //   SubTotal         = 10 000 − 0          = 10 000
  //   BaseImponible    = 10 000 (no hay impuestos 02/04/05/12)
  //   Monto IVA        = 10 000 × 13 / 100   =  1 300
  //   ImpuestoNeto     =  1 300 − 0 − 0      =  1 300
  //   MontoTotalLinea  = 10 000 + 1 300      = 11 300
  const l1 = calcularLinea(lineaBase(), 1);
  monto(l1.montoTotal, "10000.00000", "MontoTotal = cantidad × precio");
  monto(l1.subtotal, "10000.00000", "SubTotal = monto total − descuentos");
  monto(l1.baseImponible, "10000.00000", "BaseImponible = subtotal");
  monto(l1.impuestos[0].monto, "1300.00000", "Monto del IVA = base × 13%");
  monto(l1.impuestoNeto, "1300.00000", "ImpuestoNeto = monto − exonerado − asumido");
  monto(l1.montoTotalLinea, "11300.00000", "MontoTotalLinea = subtotal + impuesto neto");

  // ===================================================================
  console.log("\n=== 8. Línea con descuento y cantidad fraccionada ===");
  // 2,5 unidades de ₡3 450,75 con ₡1 000 de descuento por volumen:
  //   MontoTotal      = 2,5 × 3 450,75 = 8 626,875
  //   SubTotal        = 8 626,875 − 1 000 = 7 626,875
  //   Monto IVA       = 7 626,875 × 13 / 100 = 991,49375
  //   ImpuestoNeto    = 991,49375
  //   MontoTotalLinea = 7 626,875 + 991,49375 = 8 618,36875
  const l2 = calcularLinea(
    lineaBase({
      cantidad: "2.5",
      precioUnitario: "3450.75",
      descuentos: [{ monto: 1000, codigoDescuento: "04" }],
    }),
    1
  );
  monto(l2.montoTotal, "8626.87500", "MontoTotal con cantidad fraccionada");
  monto(l2.totalDescuentos, "1000.00000", "TotalDescuentos de la línea");
  monto(l2.subtotal, "7626.87500", "SubTotal con descuento");
  monto(l2.impuestos[0].monto, "991.49375", "IVA sobre el subtotal, con 5 decimales");
  monto(l2.montoTotalLinea, "8618.36875", "MontoTotalLinea");

  // ===================================================================
  console.log("\n=== 9. Los TRES ceros del IVA van a totales distintos ===");
  // Mismo monto, misma tarifa efectiva (0%), tres significados fiscales:
  //   código 10 → exento      → TotalServExentos
  //   código 01 → no sujeto   → TotalServNoSujeto
  //   código 11 → no sujeto   → TotalServNoSujeto
  const docCeros = documentoBase([
    lineaBase({ precioUnitario: 1000, impuestos: [{ codigo: "01", codigoTarifaIva: "10" }] }),
    lineaBase({ precioUnitario: 2000, impuestos: [{ codigo: "01", codigoTarifaIva: "01" }] }),
    lineaBase({ precioUnitario: 4000, impuestos: [{ codigo: "01", codigoTarifaIva: "11" }] }),
  ]);
  const ceros = calcularComprobante(docCeros);
  monto(ceros.resumen.totalServExentos, "1000.00000", "la tarifa 10 suma en servicios EXENTOS");
  monto(ceros.resumen.totalServNoSujeto, "6000.00000", "las tarifas 01 y 11 suman en NO SUJETOS");
  monto(ceros.resumen.totalServGravados, "0.00000", "y ninguna de las tres suma en gravados");
  monto(ceros.resumen.totalImpuesto, "0.00000", "el impuesto total es 0");
  monto(ceros.resumen.totalComprobante, "7000.00000", "y el total del comprobante es la venta neta");

  // ===================================================================
  console.log("\n=== 10. Servicios y mercancías con tarifas distintas ===");
  // Tres líneas:
  //   A) servicio   CABYS 8…, 1 × 50 000, IVA 13%  → 50 000 gravado serv, IVA 6 500
  //   B) mercancía  CABYS 2…, 3 × 4 500, IVA  1%   → 13 500 gravado merc, IVA   135
  //   C) servicio   CABYS 9…, 1 × 20 000, exenta   → 20 000 exento serv,  IVA     0
  //
  //   TotalServGravados   = 50 000
  //   TotalMercGravadas   = 13 500
  //   TotalServExentos    = 20 000
  //   TotalGravado        = 63 500
  //   TotalExento         = 20 000
  //   TotalVenta          = 63 500 + 20 000 + 0 + 0 + 0 descuentos = 83 500
  //   TotalVentaNeta      = 83 500 − 0 = 83 500
  //   TotalImpuesto       =  6 500 + 135 = 6 635
  //   TotalComprobante    = 83 500 + 6 635 = 90 135
  const docMixto = documentoBase([
    lineaBase({ codigoCabys: "8690100000000", precioUnitario: 50000 }),
    lineaBase({
      codigoCabys: "2310100000000",
      cantidad: 3,
      unidadMedida: "Unid",
      detalle: "Alimento balanceado 1 kg",
      precioUnitario: 4500,
      impuestos: [{ codigo: "01", codigoTarifaIva: "02" }],
    }),
    lineaBase({
      codigoCabys: "9690100000000",
      precioUnitario: 20000,
      detalle: "Servicio exento de prueba",
      impuestos: [{ codigo: "01", codigoTarifaIva: "10" }],
    }),
  ]);
  const mixto = calcularComprobante(docMixto);
  monto(mixto.resumen.totalServGravados, "50000.00000", "TotalServGravados");
  monto(mixto.resumen.totalMercGravadas, "13500.00000", "TotalMercanciasGravadas");
  monto(mixto.resumen.totalServExentos, "20000.00000", "TotalServExentos");
  monto(mixto.resumen.totalGravado, "63500.00000", "TotalGravado = servicios + mercancías gravadas");
  monto(mixto.resumen.totalExento, "20000.00000", "TotalExento");
  monto(mixto.resumen.totalVenta, "83500.00000", "TotalVenta");
  monto(mixto.resumen.totalVentaNeta, "83500.00000", "TotalVentaNeta");
  monto(mixto.resumen.totalImpuesto, "6635.00000", "TotalImpuesto = 6 500 + 135");
  monto(mixto.resumen.totalComprobante, "90135.00000", "TotalComprobante");
  // El desglose se agrupa por código de impuesto Y código de tarifa: dos
  // tarifas de IVA distintas son dos filas, no una.
  igual(mixto.resumen.desgloseImpuesto.length, 3, "el desglose tiene 3 filas (tarifas 08, 02 y 10)");
  igual(
    mixto.resumen.desgloseImpuesto.map((d) => `${d.codigo}/${d.codigoTarifaIva}=${deMonto(d.totalMontoImpuesto)}`),
    ["01/08=6500.00000", "01/02=135.00000", "01/10=0.00000"],
    "y cada fila con su monto"
  );
  // Y el total del desglose tiene que ser el total de impuesto: si no,
  // Hacienda rechaza.
  monto(
    sumar(...mixto.resumen.desgloseImpuesto.map((d) => d.totalMontoImpuesto)),
    "6635.00000",
    "la suma del desglose es exactamente el TotalImpuesto"
  );

  // ===================================================================
  console.log("\n=== 11. Descuentos: TotalVenta − TotalDescuentos = TotalVentaNeta ===");
  // Dos líneas con descuento:
  //   A) 1 × 30 000 − 5 000 = 25 000 subtotal, IVA 13% = 3 250
  //   B) 1 × 10 000 − 2 500 =  7 500 subtotal, IVA 13% =   975
  //
  //   TotalServGravados = 25 000 + 7 500 = 32 500   (el subtotal, ya con descuento)
  //   TotalDescuentos   =  5 000 + 2 500 =  7 500
  //   TotalVenta        = 32 500 + 7 500 = 40 000   (el monto ANTES de descuentos)
  //   TotalVentaNeta    = 40 000 − 7 500 = 32 500
  //   TotalImpuesto     =  3 250 +   975 =  4 225
  //   TotalComprobante  = 32 500 + 4 225 = 36 725
  const docDesc = documentoBase([
    lineaBase({ precioUnitario: 30000, descuentos: [{ monto: 5000, codigoDescuento: "07" }] }),
    lineaBase({ precioUnitario: 10000, descuentos: [{ monto: 2500, codigoDescuento: "06" }] }),
  ]);
  const desc = calcularComprobante(docDesc);
  monto(desc.resumen.totalServGravados, "32500.00000", "TotalServGravados es el subtotal con descuento");
  monto(desc.resumen.totalDescuentos, "7500.00000", "TotalDescuentos");
  monto(desc.resumen.totalVenta, "40000.00000", "TotalVenta es el monto antes de descuentos");
  monto(desc.resumen.totalVentaNeta, "32500.00000", "TotalVentaNeta = TotalVenta − TotalDescuentos");
  monto(desc.resumen.totalImpuesto, "4225.00000", "TotalImpuesto");
  monto(desc.resumen.totalComprobante, "36725.00000", "TotalComprobante");

  // ===================================================================
  console.log("\n=== 12. Regalía: el IVA se calcula sobre el monto SIN descontar ===");
  // Anexo, campo "Monto": "Al utilizar el código de Naturaleza del
  // Descuento 01 correspondiente a Regalías […] se debe utilizar para el
  // cálculo del impuesto el campo denominado Monto Total y la Tarifa."
  //
  // 1 × 10 000 regalado del todo (descuento 10 000, código 01):
  //   MontoTotal      = 10 000
  //   SubTotal        = 10 000 − 10 000 = 0
  //   Monto IVA       = 10 000 × 13% = 1 300   ← sobre el MONTO TOTAL, no sobre 0
  //   ImpAsumidoEmisor= 1 300                   ← obligatorio con el código 01
  //   ImpuestoNeto    = 1 300 − 0 − 1 300 = 0
  //   MontoTotalLinea = 0 + 0 = 0               ← la clínica no le cobra nada
  const regalia = calcularLinea(
    lineaBase({ descuentos: [{ monto: 10000, codigoDescuento: "01" }] }),
    1
  );
  monto(regalia.subtotal, "0.00000", "el subtotal de una regalía total es 0");
  monto(regalia.impuestos[0].monto, "1300.00000", "pero el IVA se calcula sobre el monto total");
  monto(
    regalia.impuestoAsumidoEmisorFabrica,
    "1300.00000",
    "y ese IVA queda como impuesto asumido por el emisor"
  );
  monto(regalia.impuestoNeto, "0.00000", "ImpuestoNeto = monto − exonerado − asumido = 0");
  monto(regalia.montoTotalLinea, "0.00000", "MontoTotalLinea = 0: al cliente no se le cobra");

  // ===================================================================
  console.log("\n=== 13. Exoneración parcial ===");
  // Un servicio de ₡100 000 con IVA 13% y exoneración del 10%:
  //   SubTotal        = 100 000
  //   Monto IVA       = 100 000 × 13%  = 13 000
  //   MontoExoneracion= 100 000 × 10%  = 10 000   (tarifa exonerada × base)
  //   ImpuestoNeto    =  13 000 − 10 000 = 3 000
  //   MontoTotalLinea = 100 000 + 3 000 = 103 000
  //
  //   % de exoneración = 10 000 / 13 000 = 0,769230…
  //   TotalServExonerado = 100 000 × 0,769230… = 76 923,07692 (redondeado a 5)
  //   TotalServGravados  = 100 000 − 76 923,07692 = 23 076,92308 (por RESTA, para
  //                        que las dos partes sumen exactamente 100 000)
  const docExo = documentoBase([
    lineaBase({
      precioUnitario: 100000,
      impuestos: [
        {
          codigo: "01",
          codigoTarifaIva: "08",
          exoneracion: {
            tipoDocumento: "03",
            numeroDocumento: "AL-2026-0001",
            nombreInstitucion: "03",
            fechaEmision: "2026-01-15T00:00:00-06:00",
            tarifaExonerada: 10,
          },
        },
      ],
    }),
  ]);
  const exo = calcularComprobante(docExo);
  const lExo = exo.lineas[0];
  monto(lExo.impuestos[0].monto, "13000.00000", "Monto del IVA antes de exonerar");
  monto(lExo.impuestos[0].exoneracion!.monto, "10000.00000", "MontoExoneracion = base × tarifa exonerada");
  monto(lExo.impuestoNeto, "3000.00000", "ImpuestoNeto = 13 000 − 10 000");
  monto(lExo.montoTotalLinea, "103000.00000", "MontoTotalLinea = 100 000 + 3 000");
  monto(exo.resumen.totalServExonerado, "76923.07692", "TotalServExonerado");
  monto(exo.resumen.totalServGravados, "23076.92308", "TotalServGravados, por resta");
  monto(
    sumar(exo.resumen.totalServExonerado, exo.resumen.totalServGravados),
    "100000.00000",
    "y las dos partes suman EXACTAMENTE el monto de la línea (sin céntimo perdido)"
  );
  monto(exo.resumen.totalImpuesto, "3000.00000", "TotalImpuesto es el neto, no el bruto");
  monto(exo.resumen.totalComprobante, "103000.00000", "TotalComprobante");

  // ===================================================================
  console.log("\n=== 14. Moneda USD con tipo de cambio ===");
  // El XML lleva los montos EN LA MONEDA DEL COMPROBANTE, no convertidos
  // a colones: el tipo de cambio es un dato del resumen para que
  // Hacienda sepa a cuánto equivale. Así que el cálculo es el mismo y lo
  // que se verifica es que el tipo de cambio NO toque los montos.
  //   1 × 150,00 USD con IVA 13% = 19,50 → total 169,50 USD
  const docUsd = documentoBase(
    [lineaBase({ precioUnitario: "150.00", detalle: "Consulta en dólares" })],
    { moneda: "USD", tipoCambio: "512.45" }
  );
  const usd = calcularComprobante(docUsd);
  monto(usd.resumen.totalVentaNeta, "150.00000", "TotalVentaNeta en USD, sin convertir");
  monto(usd.resumen.totalImpuesto, "19.50000", "el IVA también en USD");
  monto(usd.resumen.totalComprobante, "169.50000", "TotalComprobante en USD");

  // ===================================================================
  console.log("\n=== 15. Otros cargos y pago mixto ===");
  // Un servicio de ₡100 000 + IVA 13% + un timbre de colegio
  // profesional de ₡300:
  //   TotalVentaNeta   = 100 000
  //   TotalImpuesto    =  13 000
  //   TotalOtrosCargos =     300
  //   TotalComprobante = 100 000 + 13 000 + 300 = 113 300
  // Pagado mitad en efectivo y mitad con tarjeta: los dos medios tienen
  // que sumar 113 300 o Hacienda rechaza.
  const docCargos = documentoBase([lineaBase({ precioUnitario: 100000 })], {
    otrosCargos: [
      { tipoDocumento: "07", detalle: "Timbre de colegio profesional", monto: 300 },
    ],
    mediosPago: [
      { codigo: "01", monto: "56650.00000" },
      { codigo: "02", monto: "56650.00000" },
    ],
  });
  const cargos = calcularComprobante(docCargos);
  monto(cargos.resumen.totalOtrosCargos, "300.00000", "TotalOtrosCargos");
  monto(cargos.resumen.totalComprobante, "113300.00000", "TotalComprobante con otros cargos");

  // Y si los medios de pago no suman el total, falla acá con el detalle
  // en vez de recibir un rechazo sin explicación de Hacienda.
  await debeFallar("dos medios de pago que no suman el total del comprobante", () =>
    calcularComprobante(
      documentoBase([lineaBase({ precioUnitario: 100000 })], {
        mediosPago: [
          { codigo: "01", monto: "50000.00000" },
          { codigo: "02", monto: "50000.00000" },
        ],
      })
    )
  );

  // ===================================================================
  console.log("\n=== 16. Lo que el motor NO inventa ===");
  await debeFallar("una línea sin ningún impuesto (el XSD exige al menos uno)", () =>
    calcularLinea(lineaBase({ impuestos: [] }), 1)
  );
  await debeFallar("IVA sin código de tarifa", () =>
    calcularLinea(lineaBase({ impuestos: [{ codigo: "01" }] }), 1)
  );
  await debeFallar("un código de tarifa que no está en la Nota 8.1", () =>
    calcularLinea(lineaBase({ impuestos: [{ codigo: "01", codigoTarifaIva: "99" }] }), 1)
  );
  await debeFallar("un impuesto específico sin cantidad ni impuesto por unidad", () =>
    calcularLinea(lineaBase({ impuestos: [{ codigo: "04" }] }), 1)
  );
  await debeFallar("el régimen de bienes usados sin factor de cálculo", () =>
    calcularLinea(lineaBase({ impuestos: [{ codigo: "08" }] }), 1)
  );
  await debeFallar("una base imponible editada sin el código 07 ni IVA de fábrica", () =>
    calcularLinea(lineaBase({ baseImponibleEditada: 999 }), 1)
  );
  await debeFallar("el código de impuesto 07 SIN la base imponible que obliga", () =>
    calcularLinea(lineaBase({ impuestos: [{ codigo: "07", codigoTarifaIva: "08" }] }), 1)
  );
  await debeFallar("un descuento mayor que el monto de la línea", () =>
    calcularLinea(lineaBase({ descuentos: [{ monto: 99999, codigoDescuento: "04" }] }), 1)
  );
  await debeFallar("un documento sin líneas", () => calcularComprobante(documentoBase([])));
  await debeFallar("un documento con 1001 líneas (el XSD admite 1000)", () =>
    calcularComprobante(documentoBase(Array.from({ length: 1001 }, () => lineaBase())))
  );

  // ===================================================================
  console.log("\n=== 17. El impuesto específico suma a la base del IVA ===");
  // Anexo, "Base Imponible": subtotal + los impuestos 02, 04, 05 y 12.
  // Una bebida alcohólica de ₡5 000 con ₡200 de impuesto específico por
  // unidad, 2 unidades:
  //   MontoTotal       = 2 × 5 000 = 10 000
  //   SubTotal         = 10 000
  //   Impuesto 04      = 2 × 200 = 400
  //   BaseImponible    = 10 000 + 400 = 10 400
  //   Monto IVA        = 10 400 × 13% = 1 352
  //   MontoImpuesto    =    400 + 1 352 = 1 752
  //   ImpuestoNeto     = 1 752
  //   MontoTotalLinea  = 10 000 + 1 752 = 11 752
  const conEspecifico = calcularLinea(
    lineaBase({
      codigoCabys: "1131100000000",
      cantidad: 2,
      unidadMedida: "L",
      detalle: "Producto con impuesto específico",
      precioUnitario: 5000,
      impuestos: [
        {
          codigo: "04",
          datosEspecificos: { cantidadUnidadMedida: 2, impuestoUnidad: 200 },
        },
        { codigo: "01", codigoTarifaIva: "08" },
      ],
    }),
    1
  );
  monto(conEspecifico.subtotal, "10000.00000", "SubTotal");
  monto(conEspecifico.impuestos[0].monto, "400.00000", "el impuesto específico = cantidad × impuesto por unidad");
  monto(conEspecifico.baseImponible, "10400.00000", "BaseImponible = subtotal + el específico");
  monto(conEspecifico.impuestos[1].monto, "1352.00000", "el IVA se calcula SOBRE esa base");
  monto(conEspecifico.impuestoNeto, "1752.00000", "ImpuestoNeto = 400 + 1 352");
  monto(conEspecifico.montoTotalLinea, "11752.00000", "MontoTotalLinea");

  // ===================================================================
  console.log("\n=== 18. Veinte líneas: la suma de las partes cuadra ===");
  // El caso que el punto flotante rompería: montos con decimales que no
  // son exactos en binario, veinte veces.
  const docVeinte = documentoBase(
    Array.from({ length: 20 }, (_, i) =>
      lineaBase({ precioUnitario: `${1000 + i}.10`, cantidad: "1.1" })
    )
  );
  const veinte = calcularComprobante(docVeinte);
  const sumaLineas = sumar(...veinte.lineas.map((l) => l.montoTotalLinea));
  monto(
    sumaLineas,
    deMonto(veinte.resumen.totalComprobante),
    "TotalComprobante = suma de los MontoTotalLinea de las 20 líneas"
  );
  monto(
    sumar(veinte.resumen.totalVentaNeta, veinte.resumen.totalImpuesto),
    deMonto(veinte.resumen.totalComprobante),
    "y TotalVentaNeta + TotalImpuesto da lo mismo"
  );
  monto(
    sumar(...veinte.lineas.map((l) => l.subtotal)),
    deMonto(veinte.resumen.totalVentaNeta),
    "la suma de los subtotales es el TotalVentaNeta"
  );

  await limpiar();
  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await limpiar().catch(() => undefined);
  await pool.end();
  process.exit(1);
});
