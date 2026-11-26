// Verificación de ajustes con aprobación, orden sugerida, recepción
// parcial, conteos e importación (prompt 06, secciones 2, 3 y 4).
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/verificar_inventario_compras.ts
//
// El caso de la orden sugerida está CALCULADO A MANO acá abajo, con sus
// números, para que el resultado se pueda contrastar sin leer el
// código.
import fs from "fs";
import os from "os";
import path from "path";
import { zipSync, strToU8 } from "fflate";
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { registrarMovimiento } from "../inventario/movimientos";
import { aprobarAjuste, rechazarAjuste, solicitarAjuste } from "../inventario/ajustes";
import { crearOrden, recibirOrden, sugerirOrden } from "../inventario/compras";
import { abrirConteo, anotarConteo, cerrarConteo } from "../inventario/conteos";
import { analizarImportacion, importarInventario } from "../inventario/importacion";
import { alertasDeInventario, consumoDeProducto, presentarExistencia } from "../inventario/consultas";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-inv-compras";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

let tenantId = "";
let bodegaId = "";
let personaId = "";

async function existencia(productoId: string): Promise<number> {
  const r = await pool.query<{ t: string | null }>(
    `SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE producto_id = $1`,
    [productoId]
  );
  return Number(r.rows[0].t ?? 0);
}

/** Una planilla .xlsx mínima, armada acá para no depender de un archivo. */
function planillaXlsx(filas: string[][]): Buffer {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const letras = (i: number) => String.fromCharCode(65 + i);
  const filasXml = filas
    .map(
      (f, y) =>
        `<row r="${y + 1}">` +
        f
          .map(
            (c, x) =>
              `<c r="${letras(x)}${y + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`
          )
          .join("") +
        `</row>`
    )
    .join("");

  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Inventario" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXml}</sheetData></worksheet>`
    ),
  };
  return Buffer.from(zipSync(archivos));
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_inventario_compras");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  console.log("=== 0. Clínica, bodega, persona ===");
  tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@invc.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  bodegaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,'FARM','Farmacia',true) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  personaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico)
       VALUES ($1,'Admin de prueba',$2,'x',true,false) RETURNING id`,
      [tenantId, `${PREFIJO}@probe.test`]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO inv_parametros (tenant_id, umbral_aprobacion_ajuste, dias_stock_seguridad)
     VALUES ($1, 5000, 7)`,
    [tenantId]
  );
  assert(!!tenantId && !!bodegaId && !!personaId, "clínica, bodega, persona y parámetros");

  // -------------------------------------------------------------------
  console.log("\n=== 1. La existencia se muestra en presentación y unidad base ===");
  igual(
    presentarExistencia(67, "tabletas", { nombre: "cajas", factor: 20 }).texto,
    "3 cajas y 7 tabletas (67 tabletas)",
    "67 tabletas con cajas de 20 se leen como '3 cajas y 7 tabletas'"
  );
  igual(
    presentarExistencia(40, "tabletas", { nombre: "cajas", factor: 20 }).texto,
    "2 cajas (40 tabletas)",
    "sin resto no se inventa un resto"
  );
  igual(
    presentarExistencia(7, "tabletas", { nombre: "cajas", factor: 20 }).texto,
    "7 tabletas",
    "menos de una caja se dice en la unidad base y ya"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. Ajustes: bajo el umbral se aplica, sobre el umbral espera ===");
  const producto = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                  minimo, punto_reorden)
       VALUES ($1,'P-1','Amoxicilina 500 mg','farmacia','tableta',50,80) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  const presCaja = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                       unidad_medida, precio_venta, para_compra, para_venta)
       VALUES ($1,$2,'C-1','Caja de 20',20,'Unid',5000,true,true) RETURNING id`,
      [tenantId, producto]
    )
  ).rows[0].id;

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: producto, bodegaId, cantidadBase: 200,
      lote: { numero: "L-1", vencimiento: "2027-12-31", costoUnitario: 100 },
    })
  );

  // 10 tabletas × 100 = 1 000 < 5 000 → se aplica sin aprobación.
  const chico = await conAlcanceTenant(tenantId, (db) =>
    solicitarAjuste(db, tenantId, {
      tipo: "negativo", motivo: "rotura",
      lineas: [{ productoId: producto, bodegaId, cantidadBase: 10 }],
      solicitadoPor: personaId,
    })
  );
  igual(chico.requiereAprobacion, false, "un ajuste de 1 000 contra un umbral de 5 000 no necesita aprobación");
  igual(chico.estado, "aplicado", "y se aplica solo");
  igual(await existencia(producto), 190, "la existencia bajó de 200 a 190");

  // 100 tabletas × 100 = 10 000 > 5 000 → queda pendiente.
  const grande = await conAlcanceTenant(tenantId, (db) =>
    solicitarAjuste(db, tenantId, {
      tipo: "negativo", motivo: "perdida",
      lineas: [{ productoId: producto, bodegaId, cantidadBase: 100 }],
      solicitadoPor: personaId,
    })
  );
  igual(grande.requiereAprobacion, true, "un ajuste de 10 000 SÍ necesita aprobación");
  igual(grande.estado, "pendiente", "y queda pendiente");
  igual(await existencia(producto), 190, "y NO movió la existencia mientras espera");

  await conAlcanceTenant(tenantId, (db) => aprobarAjuste(db, tenantId, grande.id, personaId));
  igual(await existencia(producto), 90, "al aprobarlo recién ahí se aplica");

  const quienes = await pool.query<{ solicitado_por: string; aprobado_por: string }>(
    `SELECT solicitado_por, aprobado_por FROM inv_ajustes WHERE id = $1`,
    [grande.id]
  );
  assert(
    !!quienes.rows[0].solicitado_por && !!quienes.rows[0].aprobado_por,
    "queda registrado quién lo pidió y quién lo aprobó"
  );

  const rechazado = await conAlcanceTenant(tenantId, (db) =>
    solicitarAjuste(db, tenantId, {
      tipo: "negativo", motivo: "perdida",
      lineas: [{ productoId: producto, bodegaId, cantidadBase: 80 }],
      solicitadoPor: personaId,
    })
  );
  await conAlcanceTenant(tenantId, (db) => rechazarAjuste(db, rechazado.id, personaId));
  igual(await existencia(producto), 90, "un ajuste rechazado no mueve nada");

  console.log("\n=== 3. 'Otro' como motivo exige decir cuál ===");
  try {
    await conAlcanceTenant(tenantId, (db) =>
      solicitarAjuste(db, tenantId, {
        tipo: "negativo", motivo: "otro",
        lineas: [{ productoId: producto, bodegaId, cantidadBase: 1 }],
      })
    );
    assert(false, "'Otro' sin detalle NO falló, y tenía que fallar");
  } catch (err) {
    assert(true, "'Otro' sin detalle se rechaza", (err as Error).message.slice(0, 70));
  }

  // -------------------------------------------------------------------
  console.log("\n=== 4. Orden sugerida: el caso calculado a mano ===");
  //
  // CÁLCULO A MANO, para contrastar sin leer el código:
  //   consumo de los últimos 90 días = 10 + 100 = 110 tabletas
  //     (el ajuste rechazado NO cuenta: no movió stock)
  //   consumo diario = 110 / 90 = 1,2222
  //   entrega del proveedor = 3 días; seguridad = 7 días
  //   punto de reorden = 80
  //   objetivo  = 1,2222 × (3 + 7) + 80 = 12,222 + 80 = 92,222
  //   existencia = 90
  //   faltan    = 2,222
  //   caja de 20 → ceil(2,222 / 20) = 1 caja
  const proveedor = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_proveedores (tenant_id, nombre, dias_entrega)
       VALUES ($1,'Droguería de Prueba',3) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO inv_proveedor_productos (tenant_id, proveedor_id, producto_id,
                                          presentacion_compra_id, ultimo_costo)
     VALUES ($1,$2,$3,$4,2000)`,
    [tenantId, proveedor, producto, presCaja]
  );

  const sugerida = await conAlcanceTenant(tenantId, (db) => sugerirOrden(db, tenantId, proveedor));
  igual(sugerida.length, 1, "la sugerida trae una línea");
  igual(sugerida[0].cantidadPedida, 1, "y pide 1 caja, que es lo calculado a mano");
  assert(
    sugerida[0].explicacion.includes("entrega en 3 días") &&
      sugerida[0].explicacion.includes("Hay 90"),
    "con una explicación que dice de dónde salió",
    sugerida[0].explicacion
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. Recepción parcial y después total ===");
  const orden = await conAlcanceTenant(tenantId, (db) =>
    crearOrden(db, tenantId, {
      proveedorId: proveedor,
      bodegaId,
      estado: "aprobada",
      creadoPor: personaId,
      lineas: [{ productoId: producto, presentacionId: presCaja, cantidadPedida: 5, costoUnitario: 100 }],
    })
  );
  const lineaOrden = (
    await pool.query<{ id: string }>(
      `SELECT id FROM inv_orden_compra_lineas WHERE orden_id = $1`,
      [orden.id]
    )
  ).rows[0].id;

  const parcial = await conAlcanceTenant(tenantId, (db) =>
    recibirOrden(db, tenantId, orden.id, {
      lineas: [{ lineaId: lineaOrden, cantidadRecibida: 2, lote: { numero: "L-2", vencimiento: "2028-06-30" }, costoUnitario: 100 }],
      facturaProveedor: "FAC-001",
      personaId,
    })
  );
  igual(parcial.estado, "recibida_parcial", "recibir 2 de 5 cajas deja la orden parcial");
  igual(parcial.diferencias[0].faltanBase, 60, "y señala que faltan 60 tabletas (3 cajas)");
  igual(await existencia(producto), 130, "entraron 40 tabletas: 90 + 40");

  const total = await conAlcanceTenant(tenantId, (db) =>
    recibirOrden(db, tenantId, orden.id, {
      lineas: [{ lineaId: lineaOrden, cantidadRecibida: 3, lote: { numero: "L-2" }, costoUnitario: 100 }],
      personaId,
    })
  );
  igual(total.estado, "recibida", "la segunda recepción la completa");
  igual(await existencia(producto), 190, "y la existencia llega a 190");

  // -------------------------------------------------------------------
  console.log("\n=== 6. Conteo físico: congela, compara y pide ajuste ===");
  const conteo = await conAlcanceTenant(tenantId, (db) =>
    abrirConteo(db, tenantId, { bodegaId, tipo: "total", creadoPor: personaId })
  );
  assert(conteo.lineas >= 1, "el conteo congeló las líneas con existencia", conteo.lineas);

  // Mientras se cuenta, la clínica sigue vendiendo: 10 tabletas.
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "venta", productoId: producto, bodegaId, cantidadBase: 10,
    })
  );

  const lineasConteo = await pool.query<{ id: string; cantidad_sistema: string; lote_id: string }>(
    `SELECT id, cantidad_sistema, lote_id FROM inv_conteo_lineas WHERE conteo_id = $1`,
    [conteo.id]
  );
  // Se cuenta EXACTAMENTE lo que el sistema tenía congelado: no debería
  // salir ninguna diferencia, aunque entre medio se haya vendido.
  for (const l of lineasConteo.rows) {
    await conAlcanceTenant(tenantId, (db) =>
      anotarConteo(db, conteo.id, l.id, { cantidad: l.cantidad_sistema })
    );
  }
  const cierre = await conAlcanceTenant(tenantId, (db) =>
    cerrarConteo(db, tenantId, conteo.id, personaId)
  );
  igual(
    cierre.diferencias.length,
    0,
    "contar lo mismo que decía la foto no genera diferencias, aunque entre medio se vendió"
  );

  // Ahora un conteo con una diferencia de verdad.
  const conteo2 = await conAlcanceTenant(tenantId, (db) =>
    abrirConteo(db, tenantId, { bodegaId, tipo: "total", creadoPor: personaId })
  );
  const lineas2 = await pool.query<{ id: string; cantidad_sistema: string }>(
    `SELECT id, cantidad_sistema FROM inv_conteo_lineas WHERE conteo_id = $1 AND cantidad_sistema > 0`,
    [conteo2.id]
  );
  await conAlcanceTenant(tenantId, (db) =>
    anotarConteo(db, conteo2.id, lineas2.rows[0].id, {
      cantidad: Number(lineas2.rows[0].cantidad_sistema) - 5,
    })
  );
  const cierre2 = await conAlcanceTenant(tenantId, (db) =>
    cerrarConteo(db, tenantId, conteo2.id, personaId)
  );
  igual(cierre2.diferencias.length, 1, "faltan 5: una diferencia");
  assert(!!cierre2.ajusteNegativoId, "y se pidió un ajuste NEGATIVO por esa diferencia");
  assert(!cierre2.ajustePositivoId, "sin ajuste positivo, porque no hubo sobrantes");

  // -------------------------------------------------------------------
  console.log("\n=== 7. Importación: rechaza lo inválido y carga lo válido, atómica ===");
  const encabezado = [
    "codigo","nombre","linea_negocio","unidad_base","categoria","codigo_cabys",
    "codigo_tarifa_iva","presentacion_codigo","presentacion_nombre","presentacion_factor",
    "presentacion_unidad_medida","precio_venta","minimo","punto_reorden",
    "existencia_inicial","lote","vencimiento","costo_unitario",
  ];
  const planilla = planillaXlsx([
    encabezado,
    ["IMP-1","Gasa estéril","farmacia","unidad","Insumos","","08","IMP-1-A","Paquete de 10","10","Unid","1500","20","40","100","L-IMP-1","2028-03-31","50"],
    // Fila inválida: factor 0.
    ["IMP-2","Jeringa 5 ml","farmacia","unidad","Insumos","","08","IMP-2-A","Unidad","0","Unid","300","10","20","50","L-IMP-2","","20"],
    // Fila inválida: línea de negocio inexistente.
    ["IMP-3","Collar","inventada","unidad","Pet shop","","08","IMP-3-A","Unidad","1","Unid","2500","5","10","10","L-IMP-3","","1000"],
    // Fila inválida: existencia sin lote.
    ["IMP-4","Alcohol","farmacia","ml","Insumos","","08","IMP-4-A","Litro","1000","L","3000","500","1000","1000","","",""],
  ]);
  const temporal = path.join(os.tmpdir(), `probe-import-${Date.now()}.xlsx`);
  fs.writeFileSync(temporal, planilla);

  const analisis = await conAlcanceTenant(tenantId, (db) => analizarImportacion(db, temporal));
  igual(analisis.validas, 1, "de cuatro filas, una es válida");
  igual(analisis.invalidas, 3, "y tres se rechazan");
  const motivos = analisis.filas.filter((f) => f.errores.length > 0).map((f) => f.errores[0]);
  assert(
    motivos.some((m) => m.includes("factor")) &&
      motivos.some((m) => m.includes("línea de negocio")) &&
      motivos.some((m) => m.includes("lote")),
    "cada una con SU motivo, no 'fila inválida'",
    motivos
  );

  const cargado = await conAlcanceTenant(tenantId, (db) =>
    importarInventario(db, tenantId, analisis, bodegaId, personaId)
  );
  igual(cargado.productos, 1, "se cargó solo el producto válido");
  igual(cargado.movimientos, 1, "con su existencia inicial");
  const impCargado = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM inv_productos WHERE tenant_id = $1 AND codigo LIKE 'IMP-%'`,
    [tenantId]
  );
  igual(impCargado.rows[0].n, "1", "y ninguno de los inválidos entró");
  fs.rmSync(temporal, { force: true });

  // -------------------------------------------------------------------
  console.log("\n=== 8. Drill-down: pacientes y movimientos sin paciente, separados ===");
  const propietario = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre) VALUES ($1,'Tutor de prueba') RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  const paciente = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
       VALUES ($1,$2,'Nina','canino',
               (SELECT COALESCE(max(numero_expediente),0) + 1 FROM pacientes WHERE tenant_id = $1))
       RETURNING id`,
      [tenantId, propietario]
    )
  ).rows[0].id;

  await conAlcanceTenant(tenantId, async (db) => {
    await registrarMovimiento(db, tenantId, {
      tipo: "atencion", productoId: producto, bodegaId, cantidadBase: 4, pacienteId: paciente,
    });
    await registrarMovimiento(db, tenantId, {
      tipo: "venta", productoId: producto, bodegaId, cantidadBase: 6,
    });
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const consumo = await conAlcanceTenant(tenantId, (db) =>
    consumoDeProducto(db, producto, "2000-01-01", hoy)
  );
  const porAtencion = consumo.find((c) => c.tipo === "atencion");
  const porVenta = consumo.find((c) => c.tipo === "venta");
  assert(
    porAtencion !== undefined && porAtencion.pacientes.some((p) => p.nombre === "Nina"),
    "el consumo por atención lista al paciente que lo usó",
    porAtencion?.pacientes
  );
  assert(
    porVenta !== undefined && porVenta.pacientes.length === 0,
    "y la venta aparece como su propio grupo, SIN paciente y sin esconderse",
    porVenta && { tipo: porVenta.tipo, cantidad: porVenta.cantidad }
  );

  // -------------------------------------------------------------------
  console.log("\n=== 9. Alertas ===");
  const bajo = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                  minimo, punto_reorden)
       VALUES ($1,'P-BAJO','Producto bajo mínimo','farmacia','unidad',100,150) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: bajo, bodegaId, cantidadBase: 10,
      lote: { numero: "L-BAJO", vencimiento: "2026-12-10", costoUnitario: 5 },
    })
  );

  const alertas = await conAlcanceTenant(tenantId, (db) => alertasDeInventario(db));
  assert(
    alertas.bajoMinimo.some((p) => p.id === bajo),
    "el producto con 10 y mínimo 100 aparece BAJO MÍNIMO"
  );
  assert(
    !alertas.enPuntoReorden.some((p) => p.id === bajo),
    "y NO se repite en punto de reorden: bajo mínimo ya es más grave"
  );
  assert(
    alertas.porVencer30.some((l) => l.numero === "L-BAJO"),
    "el lote que vence en menos de 30 días aparece por vencer",
    alertas.porVencer30.map((l) => l.numero)
  );

  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLAS");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
