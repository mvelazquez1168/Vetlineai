// Siembra de DEMOSTRACIÓN de lo que se agregó después de los prompts
// 06 y 08: las listas de precio y el ciclo completo del encargo.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/sembrar_demo_precios_encargos.ts <tenantId>
//
// POR QUÉ ES UN SCRIPT APARTE Y NO UN BLOQUE EN LOS OTROS DOS:
// `sembrar_demo_inventario` y `sembrar_demo_ventas` son de UNA SOLA
// CORRIDA por diseño —un movimiento de inventario no se borra y un
// cierre de caja es inmutable, así que una segunda corrida duplicaría
// el kardex y los cobros— y las dos se niegan a correr si la clínica ya
// tiene datos. Meter esto adentro habría significado o aflojar esa
// negativa, o no poder sembrar lo nuevo en la clínica que ya está
// sembrada.
//
// Este sí es RE-CORRIBLE: cada bloque mira si lo suyo ya existe. Lo que
// crea son objetos que se pueden volver a crear sin romper nada (una
// lista de precio, un encargo), no dinero ni movimientos.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { aplicarMasiva, crearLista, fijarItem, listas } from "../inventario/precios";
import { crearEncargo, marcarRecibido, pedirAlProveedor } from "../ventas/encargos";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

function paso(t: string) {
  console.log(`\n=== ${t} ===`);
}

async function main() {
  exigirEntornoDeDesarrollo("sembrar_demo_precios_encargos");

  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: … sembrar_demo_precios_encargos.ts <tenantId>");
    process.exit(1);
  }
  const t = await pool.query<{ nombre: string }>(`SELECT nombre FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  if (t.rows.length === 0) {
    console.error(`No existe la clínica ${tenantId}.`);
    process.exit(1);
  }
  console.log(`Clínica: ${t.rows[0].nombre} — ${tenantId}`);

  // -------------------------------------------------------------------
  paso("1. Listas de precio");
  const existentes = await conAlcanceTenant(tenantId, (db) => listas(db, tenantId));

  let nocturnoId = existentes.find((l) => l.codigo === "NOCTURNO")?.id;
  if (nocturnoId) {
    console.log("La lista NOCTURNO ya existe: no se toca.");
  } else {
    nocturnoId = (
      await conAlcanceTenant(tenantId, (db) =>
        crearLista(db, tenantId, { codigo: "NOCTURNO", nombre: "Tarifa nocturna y feriados" })
      )
    ).id;
    // Se carga con la masiva, que es como la va a usar la clínica: un
    // 25% sobre el precio base de todo lo vendible.
    const r = await conAlcanceTenant(tenantId, (db) =>
      aplicarMasiva(db, tenantId, {
        destino: "lista",
        listaId: nocturnoId!,
        porcentaje: 25,
        redondeo: "cinco",
      })
    );
    console.log(`Lista NOCTURNO creada con ${r.aplicadas} precios (+25% sobre el base).`);
  }

  if (!existentes.some((l) => l.codigo === "CONVENIO")) {
    const convenio = await conAlcanceTenant(tenantId, (db) =>
      crearLista(db, tenantId, {
        codigo: "CONVENIO",
        nombre: "Convenio con el refugio municipal",
        vigenteDesde: "2026-01-01",
        vigenteHasta: "2026-12-31",
      })
    );
    // Esta se carga a mano, ítem por ítem, para que la pantalla muestre
    // las dos formas: la masiva y el precio puesto uno por uno.
    const aMano = await pool.query<{ id: string; nombre: string }>(
      `SELECT pr.id, pr.nombre FROM inv_presentaciones pr
         JOIN inv_productos p ON p.id = pr.producto_id
        WHERE pr.tenant_id = $1 AND pr.para_venta AND pr.precio_venta IS NOT NULL
        ORDER BY pr.precio_venta DESC LIMIT 2`,
      [tenantId]
    );
    for (const pr of aMano.rows) {
      const base = await pool.query<{ precio_venta: string }>(
        `SELECT precio_venta FROM inv_presentaciones WHERE id = $1`,
        [pr.id]
      );
      await conAlcanceTenant(tenantId, (db) =>
        fijarItem(db, tenantId, convenio.id, {
          presentacionId: pr.id,
          // 15% menos que el base, redondeado al colón.
          precio: Math.round(Number(base.rows[0].precio_venta) * 0.85),
        })
      );
    }
    console.log(
      `Lista CONVENIO creada (vigencia 2026) con ${aMano.rows.length} precios puestos a mano.`
    );
  } else {
    console.log("La lista CONVENIO ya existe: no se toca.");
  }

  // Una tercera VENCIDA, para que se vea que una lista fuera de
  // vigencia no cambia el precio aunque esté elegida.
  if (!existentes.some((l) => l.codigo === "PROMO-ENE")) {
    await conAlcanceTenant(tenantId, (db) =>
      crearLista(db, tenantId, {
        codigo: "PROMO-ENE",
        nombre: "Promoción de enero (vencida)",
        vigenteDesde: "2026-01-01",
        vigenteHasta: "2026-01-31",
      })
    );
    console.log("Lista PROMO-ENE creada, ya vencida a propósito.");
  }

  // -------------------------------------------------------------------
  paso("2. Encargos");
  // El marcador es el encargo CON ANTICIPO, que es lo que este script
  // agrega: la siembra base del prompt 08 ya deja uno pendiente, y
  // mirar "Alimento renal" lo confundía con el suyo.
  const yaHay = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM vta_encargos e
      WHERE e.tenant_id = $1
        AND EXISTS (SELECT 1 FROM vta_anticipos a WHERE a.encargo_id = e.id)`,
    [tenantId]
  );
  if (Number(yaHay.rows[0].n) > 0) {
    console.log("Los encargos de demostración ya están: no se siembran de nuevo.");
    await cerrar();
    return;
  }

  const cliente = (
    await pool.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM propietarios WHERE tenant_id = $1 ORDER BY creado_en LIMIT 1`,
      [tenantId]
    )
  ).rows[0];
  if (!cliente) {
    console.log("Esta clínica no tiene clientes: no se puede encargar nada. Se omite el bloque.");
    await cerrar();
    return;
  }

  const sesion = (
    await pool.query<{ id: string }>(
      `SELECT id FROM vta_sesiones_caja WHERE tenant_id = $1 AND estado = 'abierta' LIMIT 1`,
      [tenantId]
    )
  ).rows[0];

  const producto = (
    await pool.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM inv_productos WHERE tenant_id = $1 AND activo ORDER BY nombre LIMIT 1`,
      [tenantId]
    )
  ).rows[0];

  // (a) Uno pendiente de pedir, sin anticipo: lo más común. Si la
  // siembra del prompt 08 ya dejó uno, no se duplica.
  const pendienteYa = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM vta_encargos
      WHERE tenant_id = $1 AND estado = 'pendiente'`,
    [tenantId]
  );
  if (Number(pendienteYa.rows[0].n) > 0) {
    console.log("Ya hay un encargo pendiente de pedir: no se agrega otro.");
  } else {
    const pendiente = await conAlcanceTenant(tenantId, (db) =>
      crearEncargo(db, tenantId, {
        propietarioId: cliente.id,
        descripcion: "Alimento renal 7,5 kg (marca que no se maneja)",
        cantidad: 1,
      })
    );
    console.log(`Encargo pendiente de pedir: ${pendiente.id}`);
  }

  // (b) Uno con anticipo, ya pedido con su orden de compra.
  if (!sesion) {
    console.log(
      "No hay sesión de caja abierta, así que el encargo con anticipo no se siembra: " +
        "un anticipo entra a una caja."
    );
  } else {
    const proveedor = (
      await pool.query<{ id: string }>(
        `SELECT id FROM inv_proveedores WHERE tenant_id = $1 ORDER BY nombre LIMIT 1`,
        [tenantId]
      )
    ).rows[0];
    const presentacion = (
      await pool.query<{ id: string }>(
        `SELECT id FROM inv_presentaciones WHERE producto_id = $1 AND para_compra LIMIT 1`,
        [producto?.id ?? null]
      )
    ).rows[0];
    const bodega = (
      await pool.query<{ id: string }>(
        `SELECT id FROM inv_bodegas WHERE tenant_id = $1 AND es_default LIMIT 1`,
        [tenantId]
      )
    ).rows[0];

    const conAnticipo = await conAlcanceTenant(tenantId, (db) =>
      crearEncargo(db, tenantId, {
        propietarioId: cliente.id,
        productoId: producto?.id,
        descripcion: `${producto?.nombre ?? "Producto"} — pedido especial del cliente`,
        cantidad: 20,
        anticipo: 5000,
        sesionId: sesion.id,
      })
    );
    console.log(
      `Encargo con anticipo de ₡5 000 para ${cliente.nombre}: ${conAnticipo.id} ` +
        `(el anticipo ya entra al esperado del arqueo)`
    );

    if (proveedor && presentacion && bodega) {
      const pedido = await conAlcanceTenant(tenantId, (db) =>
        pedirAlProveedor(db, tenantId, conAnticipo.id, {
          proveedorId: proveedor.id,
          bodegaId: bodega.id,
          presentacionId: presentacion.id,
        })
      );
      console.log(`  pedido con la orden de compra #${pedido.numeroOrden}`);

      // (c) Y uno RECIBIDO, con el stock reservado: es el estado que
      // hace visible la reserva en la pantalla y en el inventario.
      const recibido = await conAlcanceTenant(tenantId, (db) =>
        marcarRecibido(db, conAnticipo.id, { bodegaId: bodega.id })
      );
      console.log(
        `  recibido: ${recibido.reservado} unidad(es) reservadas del lote ${recibido.loteId}`
      );
      console.log(
        "  (intentar vender ese stock desde Cobro ahora falla nombrando al cliente que lo espera)"
      );
    } else {
      console.log("  sin proveedor/presentación/bodega: no se armó la orden de compra.");
    }
  }

  await cerrar();
}

async function cerrar() {
  console.log("\nListo. Pantallas: /inventario/precios · /ventas/encargos");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
