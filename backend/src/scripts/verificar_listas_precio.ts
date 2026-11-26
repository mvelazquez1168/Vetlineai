// Verificación de las LISTAS DE PRECIO (prompt 06, sección 2) y de que
// el cargo las use de verdad.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_listas_precio.ts
//
// Sin --transpile-only a propósito: correr con el chequeo de tipos
// apagado ya tapó cuatro defectos en los verificadores de inventario.
//
// Lo que se comprueba, todo contra la base real:
//   * sin lista se cobra el precio base;
//   * una lista vigente REEMPLAZA el base, y queda registrado en el
//     cargo cuál lista lo hizo;
//   * una lista VENCIDA o inactiva no aplica, ni elegida a mano;
//   * un ítem que la lista no cubre cae al base;
//   * un precio escrito a mano gana sobre la lista, y NO se le atribuye
//     a ninguna lista;
//   * la vista previa no escribe nada;
//   * aplicar da exactamente lo que la previa mostró;
//   * el redondeo y el límite del −100%;
//   * la lista preseleccionada de la caja se usa cuando el pedido no
//     dice nada, y un `null` explícito la anula;
//   * RLS: la lista de otra clínica no se ve ni se puede usar.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { registrarMovimiento } from "../inventario/movimientos";
import {
  aplicarMasiva,
  crearLista,
  editarLista,
  fijarItem,
  itemsDeLista,
  listas,
  precioVigente,
  vistaPreviaMasiva,
} from "../inventario/precios";
import { abrirCuenta, agregarCargo } from "../ventas/cuentas";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-precios";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string, contexto?: unknown) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(
    mismo,
    msg,
    mismo
      ? `= ${JSON.stringify(obtenido)}`
      : { obtenido, esperado, ...(contexto === undefined ? {} : { contexto }) }
  );
}

let tenantId = "";
let otroTenantId = "";
let bodegaId = "";
let personaId = "";
let productoId = "";
let presCaja = "";
let presTableta = "";
let servicioId = "";

/** El precio con el que QUEDÓ un cargo, leído de la base. */
async function cargoDe(cargoId: string): Promise<{ precio: number; lista: string | null }> {
  const r = await pool.query<{ precio_unitario: string; lista_precio_id: string | null }>(
    `SELECT precio_unitario, lista_precio_id FROM vta_cargos WHERE id = $1`,
    [cargoId]
  );
  return { precio: Number(r.rows[0].precio_unitario), lista: r.rows[0].lista_precio_id };
}

async function crearClinica(nombre: string, email: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
     VALUES ($1,'activa',$2,'CR') RETURNING id`,
    [nombre, email]
  );
  return r.rows[0].id;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_listas_precio");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  console.log("=== 0. Clínica, catálogo y una cuenta abierta ===");
  tenantId = await crearClinica(`${PREFIJO}-clinica`, "probe@precios.test");
  otroTenantId = await crearClinica(`${PREFIJO}-otra`, "otra@precios.test");

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

  productoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio,
                                  unidad_base, codigo_cabys, codigo_tarifa_iva, minimo)
       VALUES ($1,'AMOX','Amoxicilina 500 mg','farmacia','Unid',
               '3521100000000','08',0) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  presCaja = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                       unidad_medida, precio_venta, para_venta, para_compra)
       VALUES ($1,$2,'AMOX-CAJA','Caja de 20',20,'Unid',10000,true,true) RETURNING id`,
      [tenantId, productoId]
    )
  ).rows[0].id;
  presTableta = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                       unidad_medida, precio_venta, para_venta)
       VALUES ($1,$2,'AMOX-TAB','Tableta',1,'Unid',600,true) RETURNING id`,
      [tenantId, productoId]
    )
  ).rows[0].id;
  servicioId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_servicios (tenant_id, codigo, nombre, linea_negocio, codigo_cabys,
                                  codigo_tarifa_iva, precio)
       VALUES ($1,'CONS','Consulta general','consulta','9312200000000','04',20000)
       RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;

  // Stock para que el cargo pueda descargar.
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "compra",
      productoId,
      bodegaId,
      presentacionId: presCaja,
      cantidadPresentacion: 50,
      lote: { numero: "L-1", vencimiento: "2027-12-31", costoUnitario: 300 },
      personaId,
    })
  );

  const cuenta = await conAlcanceTenant(tenantId, (db) => abrirCuenta(db, tenantId, {}));
  assert(!!cuenta.id, "clínica, catálogo, stock y cuenta abierta", { cuenta: cuenta.numero });

  // -------------------------------------------------------------------
  console.log("\n=== 1. Sin lista: el precio base ===");
  const base = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presCaja })
  );
  igual([base.precio, base.origen], [10000, "base"], "la caja de 20 vale su precio base");

  const cargoBase = await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta.id,
      origen: "mostrador",
      presentacionId: presCaja,
      cantidad: 1,
      bodegaId,
      personaId,
    })
  );
  const leidoBase = await cargoDe(cargoBase.id);
  igual([leidoBase.precio, leidoBase.lista], [10000, null], "y el cargo queda al base, sin lista");

  // -------------------------------------------------------------------
  console.log("\n=== 2. Una lista vigente reemplaza el base ===");
  const nocturno = await conAlcanceTenant(tenantId, (db) =>
    crearLista(db, tenantId, { codigo: "NOCTURNO", nombre: "Tarifa nocturna" })
  );
  await conAlcanceTenant(tenantId, (db) =>
    fijarItem(db, tenantId, nocturno.id, { presentacionId: presCaja, precio: 13000 })
  );

  const conLista = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presCaja }, { listaId: nocturno.id })
  );
  igual(
    [conLista.precio, conLista.origen, conLista.listaNombre],
    [13000, "lista", "Tarifa nocturna"],
    "la lista nocturna manda sobre el base"
  );

  const cargoLista = await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta.id,
      origen: "mostrador",
      presentacionId: presCaja,
      cantidad: 1,
      bodegaId,
      personaId,
      listaPrecioId: nocturno.id,
    })
  );
  const leidoLista = await cargoDe(cargoLista.id);
  igual(
    [leidoLista.precio, leidoLista.lista === nocturno.id],
    [13000, true],
    "y el cargo guarda el precio Y cuál lista lo determinó"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. Un ítem que la lista no cubre cae al base ===");
  const sinCubrir = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presTableta }, { listaId: nocturno.id })
  );
  igual(
    [sinCubrir.precio, sinCubrir.origen],
    [600, "base"],
    "la tableta no está en la lista, así que sale a su precio base"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 4. Una lista VENCIDA no aplica, ni elegida a mano ===");
  const vieja = await conAlcanceTenant(tenantId, (db) =>
    crearLista(db, tenantId, {
      codigo: "VIEJA",
      nombre: "Promo de enero",
      vigenteDesde: "2026-01-01",
      vigenteHasta: "2026-01-31",
    })
  );
  await conAlcanceTenant(tenantId, (db) =>
    fijarItem(db, tenantId, vieja.id, { presentacionId: presCaja, precio: 5000 })
  );
  const porVieja = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presCaja }, { listaId: vieja.id })
  );
  igual(
    [porVieja.precio, porVieja.origen],
    [10000, "base"],
    "la promo vencida NO baja el precio: una lista vencida no es un precio"
  );

  console.log("\n=== 4b. Y una lista desactivada tampoco ===");
  await conAlcanceTenant(tenantId, (db) =>
    editarLista(db, tenantId, nocturno.id, { activo: false })
  );
  const desactivada = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presCaja }, { listaId: nocturno.id })
  );
  igual([desactivada.precio, desactivada.origen], [10000, "base"], "desactivada = precio base");
  await conAlcanceTenant(tenantId, (db) =>
    editarLista(db, tenantId, nocturno.id, { activo: true })
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. Un precio escrito a mano gana, y no se le atribuye a la lista ===");
  const aMano = await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta.id,
      origen: "manual",
      presentacionId: presCaja,
      cantidad: 1,
      precioUnitario: 7777,
      bodegaId,
      personaId,
      listaPrecioId: nocturno.id,
    })
  );
  const leidoMano = await cargoDe(aMano.id);
  igual(
    [leidoMano.precio, leidoMano.lista],
    [7777, null],
    "el precio a mano queda, y la lista NO se anota: ninguna lista lo decidió"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 6. La lista preseleccionada de la caja ===");
  await pool.query(
    `INSERT INTO vta_parametros (tenant_id, umbral_diferencia_arqueo, descuento_maximo_pct,
                                 lista_precio_id)
     VALUES ($1, 2000, 10, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET lista_precio_id = EXCLUDED.lista_precio_id`,
    [tenantId, nocturno.id]
  );
  const porDefecto = await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta.id,
      origen: "mostrador",
      presentacionId: presCaja,
      cantidad: 1,
      bodegaId,
      personaId,
    })
  );
  const leidoDefecto = await cargoDe(porDefecto.id);
  igual(
    [leidoDefecto.precio, leidoDefecto.lista === nocturno.id],
    [13000, true],
    "sin decir nada, el cargo toma la lista preseleccionada de la clínica"
  );

  const anulandoDefecto = await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta.id,
      origen: "mostrador",
      presentacionId: presCaja,
      cantidad: 1,
      bodegaId,
      personaId,
      listaPrecioId: null,
    })
  );
  const leidoAnulado = await cargoDe(anulandoDefecto.id);
  igual(
    [leidoAnulado.precio, leidoAnulado.lista],
    [10000, null],
    "y un null explícito vuelve al base, aunque la clínica tenga una preseleccionada"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 7. La tabla de la lista muestra TODO lo vendible ===");
  const items = await conAlcanceTenant(tenantId, (db) =>
    itemsDeLista(db, tenantId, nocturno.id)
  );
  igual(items.length, 3, "dos presentaciones vendibles más el servicio", items.map((i) => i.etiqueta));
  igual(
    items.filter((i) => i.precioLista !== null).length,
    1,
    "y solo uno tiene precio propio: el resto se cobra al base"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 8. La vista previa NO escribe ===");
  const antes = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presTableta })
  );
  const previa = await conAlcanceTenant(tenantId, (db) =>
    vistaPreviaMasiva(db, tenantId, {
      destino: "base",
      porcentaje: 10,
      incluirServicios: false,
      redondeo: "colon",
    })
  );
  const despues = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presTableta })
  );
  igual(antes.precio, despues.precio, "después de la previa, el precio es EL MISMO");
  igual(previa.cuantos, 2, "la previa alcanza las dos presentaciones vendibles");
  igual(
    previa.filas.find((f) => f.presentacionId === presTableta)?.nuevo,
    660,
    "y propone 600 + 10% = 660"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 9. Aplicar da exactamente lo que la previa mostró ===");
  const aplicado = await conAlcanceTenant(tenantId, (db) =>
    aplicarMasiva(db, tenantId, {
      destino: "base",
      porcentaje: 10,
      incluirServicios: false,
      redondeo: "colon",
    })
  );
  const tabletaAhora = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presTableta })
  );
  igual(tabletaAhora.precio, 660, "la tableta quedó en 660");
  const cajaAhora = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presCaja })
  );
  igual(cajaAhora.precio, 11000, "y la caja en 11 000");
  igual(aplicado.aplicadas, 2, "se aplicaron las dos que la previa anunció");
  igual(
    aplicado.filas.map((f) => f.nuevo).sort((a, b) => a - b),
    previa.filas.map((f) => f.nuevo).sort((a, b) => a - b),
    "y los números aplicados son los MISMOS de la previa"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 10. Actualizar la lista parte del precio de la lista ===");
  const previaLista = await conAlcanceTenant(tenantId, (db) =>
    vistaPreviaMasiva(db, tenantId, {
      destino: "lista",
      listaId: nocturno.id,
      porcentaje: 100,
      incluirServicios: false,
      redondeo: "colon",
    })
  );
  igual(
    previaLista.filas.find((f) => f.presentacionId === presCaja)?.nuevo,
    26000,
    "el +100% sobre la caja parte de los 13 000 de la lista, no de los 11 000 del base"
  );
  igual(
    previaLista.filas.find((f) => f.presentacionId === presTableta)?.nuevo,
    1320,
    "y para la tableta, que la lista no cubre, parte del base (660 × 2)"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 11. Redondeo y límites ===");
  const redondeos: Array<[("ninguno" | "colon" | "decena" | "cinco"), number]> = [
    ["ninguno", 666.6],
    ["colon", 667],
    ["cinco", 665],
    ["decena", 670],
  ];
  for (const [modo, esperado] of redondeos) {
    const p = await conAlcanceTenant(tenantId, (db) =>
      vistaPreviaMasiva(db, tenantId, {
        destino: "base",
        porcentaje: 1,
        incluirServicios: false,
        redondeo: modo,
      })
    );
    igual(
      p.filas.find((f) => f.presentacionId === presTableta)?.nuevo,
      esperado,
      `redondeo "${modo}": 660 + 1% = ${esperado}`
    );
  }

  for (const [pct, que] of [
    [-100, "un −100% dejaría todo en cero"],
    [-150, "y un −150% en negativo"],
  ] as Array<[number, string]>) {
    try {
      await conAlcanceTenant(tenantId, (db) =>
        vistaPreviaMasiva(db, tenantId, { destino: "base", porcentaje: pct })
      );
      assert(false, `${que} — tendría que haberse rechazado`);
    } catch (err) {
      assert(true, `${que} — rechazado`, (err as Error).message);
    }
  }

  try {
    await conAlcanceTenant(tenantId, (db) =>
      vistaPreviaMasiva(db, tenantId, { destino: "lista", porcentaje: 10 })
    );
    assert(false, "actualizar 'la lista' sin decir cuál — tendría que fallar");
  } catch (err) {
    assert(true, "actualizar 'la lista' sin decir cuál — rechazado", (err as Error).message);
  }

  // -------------------------------------------------------------------
  console.log("\n=== 12. El servicio también entra en la masiva ===");
  const conServicios = await conAlcanceTenant(tenantId, (db) =>
    aplicarMasiva(db, tenantId, {
      destino: "base",
      porcentaje: 5,
      incluirProductos: false,
      incluirServicios: true,
      redondeo: "colon",
    })
  );
  const servicioAhora = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { servicioId })
  );
  igual(servicioAhora.precio, 21000, "la consulta pasó de 20 000 a 21 000 (+5%)");
  igual(conServicios.aplicadas, 1, "y solo tocó el servicio: los productos quedaron afuera");

  // -------------------------------------------------------------------
  console.log("\n=== 13. RLS: la lista de otra clínica no existe para esta ===");
  const deLaOtra = await conAlcanceTenant(otroTenantId, (db) =>
    crearLista(db, otroTenantId, { codigo: "AJENA", nombre: "Lista ajena" })
  );
  const vistas = await conAlcanceTenant(tenantId, (db) => listas(db, tenantId));
  assert(
    !vistas.some((l) => l.id === deLaOtra.id),
    "la lista de la otra clínica no aparece en el listado",
    vistas.map((l) => l.codigo)
  );

  const usandoLaAjena = await conAlcanceTenant(tenantId, (db) =>
    precioVigente(db, { presentacionId: presCaja }, { listaId: deLaOtra.id })
  );
  igual(
    [usandoLaAjena.precio, usandoLaAjena.origen],
    [11000, "base"],
    "y usar su id a mano no cambia el precio: RLS la hace invisible"
  );

  try {
    await conAlcanceTenant(tenantId, (db) =>
      editarLista(db, tenantId, deLaOtra.id, { nombre: "Secuestrada" })
    );
    assert(false, "editar la lista de otra clínica — tendría que fallar");
  } catch (err) {
    assert(true, "editar la lista de otra clínica — rechazado", (err as Error).message);
  }

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
