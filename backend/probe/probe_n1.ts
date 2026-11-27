import { pool } from "../src/db";
import { conAlcanceTenant } from "../src/alcanceTenant";
import { productosParaAtencion } from "../src/expediente/preventivos";


(async () => {
  const t = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE es_demostracion LIMIT 1`);
  const tenantId = t.rows[0].id;
  await conAlcanceTenant(tenantId, async (db) => {
    const prods = await db.query<{ id: string }>(
      `SELECT id FROM inv_productos WHERE activo ORDER BY nombre LIMIT 100`
    );
    console.log("productos activos tomados:", prods.rows.length);

    const t1 = Date.now();
    let conteo = 0;
    for (const p of prods.rows) {
      const [pres] = await Promise.all([
        db.query(`SELECT * FROM inv_presentaciones WHERE producto_id = $1 ORDER BY factor DESC`, [p.id]),
        db.query(`SELECT l.*, b.nombre AS bodega FROM inv_lotes l JOIN inv_bodegas b ON b.id = l.bodega_id WHERE l.producto_id = $1`, [p.id]),
      ]);
      conteo += pres.rows.length;
    }
    console.log(`N+1 (lo que hace la pantalla hoy): ${Date.now() - t1} ms para ${prods.rows.length} productos, ${conteo} presentaciones`);

    const t2 = Date.now();
    const uno = await productosParaAtencion(db, { excluir: ["vacuna", "antiparasitario"] });
    console.log(`Una sola llamada: ${Date.now() - t2} ms, ${uno.length} presentaciones`);
  });
  await pool.end();
})();
