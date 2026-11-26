// Datos de demostración del prompt 07c.
//
//   docker compose exec backend npx ts-node src/scripts/sembrar_demo_07c.ts
//
// Lo que falta en la clínica de demostración para poder recorrer el 07c
// en el navegador:
//
//   * un ANTIPARASITARIO con existencia —sin eso, la acción
//     «Desparasitación» abre un catálogo vacío y no se puede verificar;
//   * el TIPO CLÍNICO de los productos que la migración 115 no pudo
//     inferir sin adivinar (el alcohol, el algodón, la jeringa). Son
//     insumos, y el que no esté puesto hace que aparezcan en la acción
//     «Producto», que es donde corresponde, pero conviene que estén
//     clasificados para que el catálogo se vea completo.
//
// Re-corrible: no duplica nada.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { registrarMovimiento } from "../inventario/movimientos";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

async function main() {
  exigirEntornoDeDesarrollo("sembrar_demo_07c");

  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: npx ts-node src/scripts/sembrar_demo_07c.ts <tenantId>");
    process.exit(1);
  }

  // --- 1. El tipo clínico de lo que quedó sin clasificar --------------
  const porNombre: Array<[string, string]> = [
    ["%alcohol%", "insumo"],
    ["%algod%", "insumo"],
    ["%jeringa%", "insumo"],
    ["%gasa%", "insumo"],
  ];
  for (const [patron, tipo] of porNombre) {
    const r = await pool.query(
      `UPDATE inv_productos SET tipo_clinico = $3
        WHERE tenant_id = $1 AND nombre ILIKE $2 AND tipo_clinico IS NULL`,
      [tenantId, patron, tipo]
    );
    if (r.rowCount) console.log(`  ${r.rowCount} producto(s) marcados como ${tipo} (${patron})`);
  }

  // --- 2. El antiparasitario ------------------------------------------
  const existe = await pool.query<{ id: string }>(
    `SELECT id FROM inv_productos WHERE tenant_id = $1 AND codigo = 'FARM-002'`,
    [tenantId]
  );

  let productoId = existe.rows[0]?.id;
  if (!productoId) {
    productoId = (
      await pool.query<{ id: string }>(
        `INSERT INTO inv_productos
           (tenant_id, codigo, nombre, principio_activo, concentracion, categoria,
            linea_negocio, codigo_cabys, codigo_tarifa_iva, unidad_base,
            requiere_receta, minimo, punto_reorden, tipo_clinico)
         VALUES ($1,'FARM-002','Desparasitante interno (praziquantel)','praziquantel','50 mg',
                 'Antiparasitarios','farmacia','3564012000000','08','tableta',
                 false, 10, 20, 'antiparasitario')
         RETURNING id`,
        [tenantId]
      )
    ).rows[0].id;
    console.log("  producto creado: Desparasitante interno (praziquantel)");
  }

  const presExiste = await pool.query<{ id: string }>(
    `SELECT id FROM inv_presentaciones WHERE producto_id = $1 AND codigo_interno = 'DES-TAB'`,
    [productoId]
  );
  if (presExiste.rows.length === 0) {
    await pool.query(
      `INSERT INTO inv_presentaciones
         (tenant_id, producto_id, codigo_interno, nombre, factor, unidad_medida,
          precio_venta, para_venta)
       VALUES ($1,$2,'DES-TAB','Tableta',1,'Unid',4500,true)`,
      [tenantId, productoId]
    );
    console.log("  presentación creada: Tableta · ₡4 500");
  }

  // --- 3. Su existencia, en dos lotes ---------------------------------
  const lotes = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM inv_lotes WHERE producto_id = $1`,
    [productoId]
  );
  if (Number(lotes.rows[0].c) === 0) {
    const bodega = await pool.query<{ id: string }>(
      `SELECT id FROM inv_bodegas WHERE tenant_id = $1 ORDER BY es_default DESC LIMIT 1`,
      [tenantId]
    );
    if (bodega.rows.length === 0) {
      console.error("  esta clínica no tiene bodega: corra antes sembrar_demo_inventario.ts");
      process.exit(1);
    }
    await conAlcanceTenant(tenantId, async (db) => {
      // DOS LOTES con vencimientos distintos, para que se vea que el
      // sugerido es el que vence antes y no el primero que se cargó.
      await registrarMovimiento(db, tenantId, {
        tipo: "inventario_inicial",
        productoId: productoId!,
        bodegaId: bodega.rows[0].id,
        cantidadBase: 24,
        lote: { numero: "DES-2026-B", vencimiento: "2028-08-31", costoUnitario: 1800 },
      });
      await registrarMovimiento(db, tenantId, {
        tipo: "inventario_inicial",
        productoId: productoId!,
        bodegaId: bodega.rows[0].id,
        cantidadBase: 12,
        lote: { numero: "DES-2026-A", vencimiento: "2027-06-30", costoUnitario: 1750 },
      });
    });
    console.log("  dos lotes cargados: DES-2026-A (vence antes) y DES-2026-B");
  }

  const resumen = await pool.query(
    `SELECT nombre, tipo_clinico FROM inv_productos WHERE tenant_id = $1 ORDER BY nombre`,
    [tenantId]
  );
  console.log("\nEl catálogo clínico de esta clínica queda así:");
  console.table(resumen.rows);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
