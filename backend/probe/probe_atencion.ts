import { pool } from "../src/db";
import { conAlcanceTenant } from "../src/alcanceTenant";
import { abrirAtencion } from "../src/expediente/atencion";

(async () => {
  const t = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE es_demostracion LIMIT 1`);
  const tenantId = t.rows[0].id;
  const m = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM personas WHERE tenant_id = $1 AND es_medico LIMIT 1`, [tenantId]);
  const p = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM pacientes WHERE tenant_id = $1 AND estado = 'activo' LIMIT 1`, [tenantId]);
  console.log("tenant", tenantId, "medico", m.rows[0].nombre, "paciente", p.rows[0].nombre);
  try {
    const r = await conAlcanceTenant(tenantId, (db) =>
      abrirAtencion(db, tenantId, { pacienteId: p.rows[0].id, medicoId: m.rows[0].id })
    , m.rows[0].id);
    console.log("OK abrirAtencion:", JSON.stringify(r).slice(0, 300));
  } catch (e) {
    console.error("FALLÓ abrirAtencion:", (e as Error).message);
    console.error((e as Error).stack?.split("\n").slice(0, 6).join("\n"));
  }
  await pool.end();
})();
