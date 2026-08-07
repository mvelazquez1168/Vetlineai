// Traza el camino de lectura de GET /api/workspace/agentes para la
// clínica recién registrada que el usuario reportó. No modifica nada.
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/trazar_medico_agente_lectura.ts
import { pool, tenantPool } from "../db";

async function main() {
  console.log("=== 1. Schema de medico_agente ===");
  const columnas = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'medico_agente' ORDER BY ordinal_position`
  );
  console.table(columnas.rows);

  console.log("\n=== 2. RLS habilitado + forzado en medico_agente ===");
  const rls = await pool.query(
    `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'medico_agente'`
  );
  console.log(rls.rows[0]);

  console.log("\n=== 3. Políticas RLS de medico_agente ===");
  const politicas = await pool.query(
    `SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr, pg_get_expr(polwithcheck, polrelid) AS check_expr
     FROM pg_policy WHERE polrelid = 'medico_agente'::regclass`
  );
  console.table(politicas.rows);

  console.log("\n=== 4. La clínica más reciente y su médico ===");
  const clinica = await pool.query(
    `SELECT t.id AS tenant_id, t.nombre, p.id AS persona_id, p.nombre AS persona_nombre, p.email,
            p.keycloak_user_id, p.tenant_id AS persona_tenant_id
     FROM tenants t
     JOIN personas p ON p.tenant_id = t.id
     WHERE p.es_medico = true
     ORDER BY t.creado_en DESC LIMIT 1`
  );
  console.log(clinica.rows[0]);

  const { tenant_id: tenantId, persona_id: personaId } = clinica.rows[0];

  console.log("\n=== 5. medico_agente para esa persona (vía pool admin, sin RLS) ===");
  const filas = await pool.query(`SELECT * FROM medico_agente WHERE persona_id = $1`, [personaId]);
  console.table(filas.rows);

  console.log("\n=== 6. La MISMA consulta que usa GET /workspace/agentes, pero vía tenantPool con RLS forzado y app.tenant_id seteado (como en producción) ===");
  const client = await tenantPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const resultado = await client.query(
      `SELECT a.id, a.nombre, ma.rol, ma.habilitado
       FROM medico_agente ma
       JOIN agentes a ON a.id = ma.agente_id
       WHERE ma.persona_id = $1 AND ma.habilitado = true
       ORDER BY a.nombre`,
      [personaId]
    );
    console.log("Filas devueltas:", resultado.rows.length);
    console.table(resultado.rows);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  console.log("\n=== 7. Verificar qué usuario/rol usa tenantPool ===");
  const rol = await tenantPool.query(`SELECT current_user`);
  console.log(rol.rows[0]);

  await pool.end();
  await tenantPool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
