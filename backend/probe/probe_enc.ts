import { pool } from "../src/db";
import { conAlcanceTenant } from "../src/alcanceTenant";
import { encabezadoDeExpediente } from "../src/expediente/resumen";

(async () => {
  const t = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE es_demostracion LIMIT 1`);
  const tenantId = t.rows[0].id;
  const pacientes = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM pacientes WHERE tenant_id = $1 ORDER BY creado_en DESC`, [tenantId]);
  let fallos = 0;
  await conAlcanceTenant(tenantId, async (db) => {
    for (const p of pacientes.rows) {
      try {
        await encabezadoDeExpediente(db, p.id, { verSaldo: true });
      } catch (e) {
        fallos++;
        console.log(`FALLA ${p.nombre} (${p.id.slice(0,8)}): ${(e as Error).message}`);
      }
    }
  });
  console.log(`${pacientes.rows.length} pacientes, ${fallos} con el encabezado roto`);
  await pool.end();
})();
