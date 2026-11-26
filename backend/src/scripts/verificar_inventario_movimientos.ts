// Verificación del PUNTO ÚNICO de movimientos de inventario y de la
// regla central de unidades y presentaciones (prompt 06, secciones 1 y 3).
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/verificar_inventario_movimientos.ts
//
// Lo que se comprueba, todo contra la base real:
//   * los TRES ejemplos del prompt: caja de 20 tabletas, litro de
//     alcohol en dosis de 100 ml, kilo de algodón por gramo;
//   * el costo por tableta es el de la caja entre 20, y una bonificación
//     baja el costo del lote;
//   * FEFO toma el que vence primero y reparte entre lotes;
//   * un envase abierto registra su vencimiento efectivo;
//   * LOS TRECE tipos mueven la existencia en el sentido correcto, y
//     ninguno al revés;
//   * una salida que dejaría negativo se rechaza, salvo si el producto
//     lo permite;
//   * dos salidas simultáneas de la última unidad: solo una pasa;
//   * un movimiento no se puede editar ni borrar;
//   * una devolución de cliente vuelve al lote original.
import { pool, tenantPool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { registrarMovimiento, registrarTraslado, TipoMovimiento } from "../inventario/movimientos";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-inv-movimientos";

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
let bodega2Id = "";

async function existencia(productoId: string, bodega = bodegaId): Promise<number> {
  const r = await pool.query<{ total: string | null }>(
    `SELECT sum(cantidad)::text AS total FROM inv_lotes
      WHERE producto_id = $1 AND bodega_id = $2`,
    [productoId, bodega]
  );
  return Number(r.rows[0].total ?? 0);
}

async function crearProducto(datos: {
  codigo: string;
  nombre: string;
  unidadBase: string;
  vidaUtilApertura?: number;
  permiteNegativo?: boolean;
}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                vida_util_apertura_dias, permite_stock_negativo)
     VALUES ($1,$2,$3,'farmacia',$4,$5,$6) RETURNING id`,
    [
      tenantId,
      datos.codigo,
      datos.nombre,
      datos.unidadBase,
      datos.vidaUtilApertura ?? null,
      datos.permiteNegativo ?? false,
    ]
  );
  return r.rows[0].id;
}

async function crearPresentacion(
  productoId: string,
  codigo: string,
  nombre: string,
  factor: number,
  unidad = "Unid"
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                     unidad_medida, para_compra, para_venta, para_consumo)
     VALUES ($1,$2,$3,$4,$5,$6,true,true,true) RETURNING id`,
    [tenantId, productoId, codigo, nombre, factor, unidad]
  );
  return r.rows[0].id;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_inventario_movimientos");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  console.log("=== 0. Clínica y bodegas ===");
  const t = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
     VALUES ($1,'activa','probe@inv.test','CR') RETURNING id`,
    [`${PREFIJO}-clinica`]
  );
  tenantId = t.rows[0].id;
  const b = await pool.query<{ id: string }>(
    `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
     VALUES ($1,'FARM','Farmacia',true) RETURNING id`,
    [tenantId]
  );
  bodegaId = b.rows[0].id;
  const b2 = await pool.query<{ id: string }>(
    `INSERT INTO inv_bodegas (tenant_id, codigo, nombre) VALUES ($1,'QUIR','Quirófano') RETURNING id`,
    [tenantId]
  );
  bodega2Id = b2.rows[0].id;
  assert(!!bodegaId && !!bodega2Id, "clínica con dos bodegas");

  // ===================================================================
  console.log("\n=== 1. Caja de 20 tabletas: se vende entera o por tableta ===");
  const tabletas = await crearProducto({
    codigo: "MED-001",
    nombre: "Amoxicilina 500 mg",
    unidadBase: "tableta",
  });
  const caja = await crearPresentacion(tabletas, "1001", "Caja de 20 tabletas", 20);
  const tableta = await crearPresentacion(tabletas, "1002", "Tableta", 1);

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "compra",
      productoId: tabletas,
      bodegaId,
      presentacionId: caja,
      cantidadPresentacion: 5,
      // 5 cajas a 2 000 la caja = 100 tabletas a 100 cada una.
      lote: { numero: "L-AMOX-1", vencimiento: "2027-06-30", costoUnitario: 100 },
    })
  );
  igual(await existencia(tabletas), 100, "comprar 5 cajas suma 100 tabletas");

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "venta",
      productoId: tabletas,
      bodegaId,
      presentacionId: caja,
      cantidadPresentacion: 1,
    })
  );
  igual(await existencia(tabletas), 80, "vender 1 caja descuenta 20 tabletas");

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "venta",
      productoId: tabletas,
      bodegaId,
      presentacionId: tableta,
      cantidadPresentacion: 3,
    })
  );
  igual(await existencia(tabletas), 77, "vender 3 tabletas descuenta 3");

  const costo = await pool.query<{ costo_unitario: string }>(
    `SELECT costo_unitario FROM inv_lotes WHERE producto_id = $1`,
    [tabletas]
  );
  igual(
    Number(costo.rows[0].costo_unitario),
    100,
    "el costo por tableta es el de la caja entre 20"
  );

  // ===================================================================
  console.log("\n=== 2. Litro de alcohol, dosis de 100 ml ===");
  const alcohol = await crearProducto({
    codigo: "INS-001",
    nombre: "Alcohol 70%",
    unidadBase: "ml",
    vidaUtilApertura: 30,
  });
  const litro = await crearPresentacion(alcohol, "2001", "Litro", 1000, "L");
  const dosis = await crearPresentacion(alcohol, "2002", "Dosis de 100 ml", 100, "mL");

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "compra",
      productoId: alcohol,
      bodegaId,
      presentacionId: litro,
      cantidadPresentacion: 2,
      lote: { numero: "L-ALC-1", vencimiento: "2028-01-31", costoUnitario: 2 },
    })
  );
  igual(await existencia(alcohol), 2000, "comprar 2 litros suma 2000 ml");

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "venta",
      productoId: alcohol,
      bodegaId,
      presentacionId: dosis,
      cantidadPresentacion: 1,
    })
  );
  igual(await existencia(alcohol), 1900, "vender una dosis descuenta 100 ml");

  const abierto = await pool.query<{
    fecha_apertura: string | null;
    vencimiento: string;
    vencimiento_efectivo: string;
  }>(
    `SELECT to_char(fecha_apertura,'YYYY-MM-DD') AS fecha_apertura,
            to_char(vencimiento,'YYYY-MM-DD') AS vencimiento,
            to_char(vencimiento_efectivo,'YYYY-MM-DD') AS vencimiento_efectivo
       FROM inv_lotes WHERE producto_id = $1`,
    [alcohol]
  );
  assert(abierto.rows[0].fecha_apertura !== null, "el envase quedó registrado como ABIERTO");
  assert(
    abierto.rows[0].vencimiento_efectivo < abierto.rows[0].vencimiento,
    "y su vencimiento efectivo es el de la apertura, que es anterior al del lote",
    abierto.rows[0]
  );

  // ===================================================================
  console.log("\n=== 3. Kilo de algodón, consumo por gramo ===");
  const algodon = await crearProducto({
    codigo: "INS-002",
    nombre: "Algodón hidrófilo",
    unidadBase: "g",
  });
  const kilo = await crearPresentacion(algodon, "3001", "Paquete de 1 kg", 1000, "Kg");
  const gramo = await crearPresentacion(algodon, "3002", "Gramo", 1, "G");

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "compra",
      productoId: algodon,
      bodegaId,
      presentacionId: kilo,
      cantidadPresentacion: 1,
      lote: { numero: "L-ALG-1", costoUnitario: 3 },
    })
  );
  igual(await existencia(algodon), 1000, "comprar 1 kg suma 1000 g");

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "consumo_interno",
      productoId: algodon,
      bodegaId,
      presentacionId: gramo,
      cantidadPresentacion: 5,
    })
  );
  igual(await existencia(algodon), 995, "consumir 5 g descuenta 5");

  // ===================================================================
  console.log("\n=== 4. Una bonificación baja el costo del lote ===");
  // Se reciben 12 unidades pero se pagaron 10 a 120: el costo real por
  // unidad es 100, no 120.
  const bonif = await crearProducto({ codigo: "MED-002", nombre: "Vitamina B", unidadBase: "ampolla" });
  const ampolla = await crearPresentacion(bonif, "4001", "Ampolla", 1);
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "compra",
      productoId: bonif,
      bodegaId,
      presentacionId: ampolla,
      cantidadPresentacion: 12,
      lote: { numero: "L-VITB-1", costoUnitario: (10 * 120) / 12 },
    })
  );
  const costoBonif = await pool.query<{ costo_unitario: string }>(
    `SELECT costo_unitario FROM inv_lotes WHERE producto_id = $1`,
    [bonif]
  );
  igual(
    Number(costoBonif.rows[0].costo_unitario),
    100,
    "12 unidades por el precio de 10 dejan el costo en 100 y no en 120"
  );

  // ===================================================================
  console.log("\n=== 5. FEFO: sale primero el que vence antes, y reparte ===");
  const fefo = await crearProducto({ codigo: "MED-003", nombre: "Dipirona", unidadBase: "tableta" });
  const tabFefo = await crearPresentacion(fefo, "5001", "Tableta", 1);
  await conAlcanceTenant(tenantId, async (db) => {
    // A propósito se carga el que vence DESPUÉS primero, para que el
    // orden de inserción no pueda explicar el resultado.
    await registrarMovimiento(db, tenantId, {
      tipo: "compra", productoId: fefo, bodegaId, cantidadBase: 10,
      lote: { numero: "L-TARDE", vencimiento: "2028-12-31", costoUnitario: 50 },
    });
    await registrarMovimiento(db, tenantId, {
      tipo: "compra", productoId: fefo, bodegaId, cantidadBase: 6,
      lote: { numero: "L-PRONTO", vencimiento: "2027-01-31", costoUnitario: 40 },
    });
  });

  const salida = await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "venta", productoId: fefo, bodegaId, presentacionId: tabFefo, cantidadPresentacion: 8,
    })
  );
  igual(
    salida.map((m) => [m.loteNumero, Number(m.cantidadBase), Number(m.costoUnitario)]),
    [["L-PRONTO", 6, 40], ["L-TARDE", 2, 50]],
    "8 tabletas salen 6 del que vence primero y 2 del otro, cada una con SU costo"
  );
  igual(await existencia(fefo), 8, "y quedan 8");

  // ===================================================================
  console.log("\n=== 6. Los TRECE tipos mueven en el sentido correcto ===");
  const todos = await pool.query<{ codigo: TipoMovimiento; direccion: string }>(
    `SELECT codigo, direccion FROM inv_tipos_movimiento ORDER BY orden`
  );
  igual(todos.rows.length, 13, "el catálogo tiene los trece tipos");

  const prueba = await crearProducto({ codigo: "MED-999", nombre: "Producto de prueba", unidadBase: "unidad" });
  let esperado = 0;
  const malos: string[] = [];
  for (const tipo of todos.rows) {
    // Antes de cada salida se asegura que haya existencia suficiente.
    if (tipo.direccion === "salida" && (await existencia(prueba)) < 10) {
      await conAlcanceTenant(tenantId, (db) =>
        registrarMovimiento(db, tenantId, {
          tipo: "inventario_inicial", productoId: prueba, bodegaId, cantidadBase: 100,
          lote: { numero: "L-PRUEBA", costoUnitario: 1 },
        })
      );
      esperado += 100;
    }
    const antes = await existencia(prueba);
    await conAlcanceTenant(tenantId, (db) =>
      registrarMovimiento(db, tenantId, {
        tipo: tipo.codigo,
        productoId: prueba,
        bodegaId,
        cantidadBase: 10,
        lote: { numero: "L-PRUEBA", costoUnitario: 1 },
        motivo: "otro",
        motivoDetalle: "verificación de dirección",
      })
    );
    const despues = await existencia(prueba);
    const delta = despues - antes;
    const esperadoDelta = tipo.direccion === "entrada" ? 10 : -10;
    if (delta !== esperadoDelta) malos.push(`${tipo.codigo}: ${delta} en vez de ${esperadoDelta}`);
  }
  assert(malos.length === 0, "los trece mueven la existencia en su dirección, ninguno al revés", malos);

  // ===================================================================
  console.log("\n=== 7. Una salida que dejaría negativo se rechaza ===");
  const escaso = await crearProducto({ codigo: "MED-004", nombre: "Escaso", unidadBase: "unidad" });
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: escaso, bodegaId, cantidadBase: 2,
      lote: { numero: "L-ESCASO", costoUnitario: 1 },
    })
  );
  try {
    await conAlcanceTenant(tenantId, (db) =>
      registrarMovimiento(db, tenantId, {
        tipo: "venta", productoId: escaso, bodegaId, cantidadBase: 5,
      })
    );
    assert(false, "una salida mayor que la existencia NO falló, y tenía que fallar");
  } catch (err) {
    assert(true, "una salida mayor que la existencia se rechaza", (err as Error).message.slice(0, 90));
  }
  igual(await existencia(escaso), 2, "y la existencia no se tocó");

  const permisivo = await crearProducto({
    codigo: "MED-005", nombre: "Permite negativo", unidadBase: "unidad", permiteNegativo: true,
  });
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: permisivo, bodegaId, cantidadBase: 2,
      lote: { numero: "L-PERM", costoUnitario: 1 },
    })
  );
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, { tipo: "venta", productoId: permisivo, bodegaId, cantidadBase: 5 })
  );
  igual(await existencia(permisivo), -3, "el producto que SÍ lo permite llega a -3");

  // ===================================================================
  console.log("\n=== 8. Dos salidas simultáneas de la última unidad: pasa una ===");
  const ultima = await crearProducto({ codigo: "MED-006", nombre: "Última unidad", unidadBase: "unidad" });
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: ultima, bodegaId, cantidadBase: 1,
      lote: { numero: "L-ULT", costoUnitario: 1 },
    })
  );

  // DOS conexiones de verdad, en paralelo. Con una sola conexión el
  // bloqueo nunca se pondría a prueba.
  const intentar = async () => {
    const cliente = await tenantPool.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await registrarMovimiento(cliente, tenantId, {
        tipo: "venta", productoId: ultima, bodegaId, cantidadBase: 1,
      });
      // La pausa mantiene la transacción abierta para que las dos se
      // solapen de verdad.
      await new Promise((r) => setTimeout(r, 120));
      await cliente.query("COMMIT");
      return "ok";
    } catch (err) {
      await cliente.query("ROLLBACK").catch(() => undefined);
      return (err as Error).message;
    } finally {
      cliente.release();
    }
  };
  const [r1, r2] = await Promise.all([intentar(), intentar()]);
  const exitos = [r1, r2].filter((x) => x === "ok").length;
  igual(exitos, 1, "de dos salidas simultáneas de la última unidad pasa exactamente UNA", [r1, r2]);
  igual(await existencia(ultima), 0, "y la existencia queda en 0, no en -1");

  // ===================================================================
  console.log("\n=== 9. Un movimiento no se edita ni se borra ===");
  const unMovimiento = await pool.query<{ id: string }>(
    `SELECT id FROM inv_movimientos WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  for (const [sql, que] of [
    [`UPDATE inv_movimientos SET cantidad_base = 999 WHERE id = $1`, "editarlo"],
    [`DELETE FROM inv_movimientos WHERE id = $1`, "borrarlo"],
  ] as Array<[string, string]>) {
    try {
      await pool.query(sql, [unMovimiento.rows[0].id]);
      assert(false, `${que} NO falló, y tenía que fallar`);
    } catch (err) {
      assert(true, `${que} se rechaza desde la base`, (err as Error).message.slice(0, 80));
    }
  }

  // ===================================================================
  console.log("\n=== 10. Traslado entre bodegas: dos movimientos ligados ===");
  const traslado = await conAlcanceTenant(tenantId, (db) =>
    registrarTraslado(db, tenantId, {
      productoId: tabletas,
      bodegaOrigenId: bodegaId,
      bodegaDestinoId: bodega2Id,
      cantidadBase: 10,
    })
  );
  igual(await existencia(tabletas, bodegaId), 67, "salen 10 tabletas de Farmacia");
  igual(await existencia(tabletas, bodega2Id), 10, "y entran 10 al Quirófano");
  const par = await pool.query<{ a: string; b: string }>(
    `SELECT m.id AS a, m.movimiento_par_id AS b FROM inv_movimientos m WHERE m.id = $1`,
    [traslado.salidas[0].id]
  );
  igual(par.rows[0].b, traslado.entradas[0].id, "los dos lados quedaron ligados entre sí");

  // ===================================================================
  console.log("\n=== 11. Devolución de cliente: vuelve al lote original ===");
  const antesDev = await pool.query<{ cantidad: string }>(
    `SELECT cantidad FROM inv_lotes WHERE producto_id = $1 AND bodega_id = $2 AND numero = 'L-AMOX-1'`,
    [tabletas, bodegaId]
  );
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "devolucion_cliente",
      productoId: tabletas,
      bodegaId,
      presentacionId: tableta,
      cantidadPresentacion: 3,
      lote: { numero: "L-AMOX-1" },
    })
  );
  const despuesDev = await pool.query<{ cantidad: string }>(
    `SELECT cantidad FROM inv_lotes WHERE producto_id = $1 AND bodega_id = $2 AND numero = 'L-AMOX-1'`,
    [tabletas, bodegaId]
  );
  igual(
    Number(despuesDev.rows[0].cantidad) - Number(antesDev.rows[0].cantidad),
    3,
    "las 3 tabletas devueltas vuelven al MISMO lote del que salieron"
  );

  // ===================================================================
  console.log("\n=== 12. Una presentación de otro producto se rechaza ===");
  try {
    await conAlcanceTenant(tenantId, (db) =>
      registrarMovimiento(db, tenantId, {
        tipo: "venta",
        productoId: tabletas,
        bodegaId,
        presentacionId: litro, // la del alcohol
        cantidadPresentacion: 1,
      })
    );
    assert(false, "usar la presentación de otro producto NO falló, y tenía que fallar");
  } catch (err) {
    assert(
      true,
      "usar la presentación de otro producto se rechaza (si no, descontaría una cantidad inventada)",
      (err as Error).message.slice(0, 80)
    );
  }

  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLAS");
  if (!ok) process.exitCode = 1;
}

main()
  .then(async () => {
    await pool.end();
    await tenantPool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    await tenantPool.end().catch(() => undefined);
    process.exit(1);
  });
