import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";

async function main() {
  const tenantId = "75f458ca-d0f1-4ee9-a211-965bfbb0bcef";
  const nombre = await pool.query(`SELECT nombre FROM tenants WHERE id = $1`, [tenantId]);
  if (nombre.rows.length === 0) {
    console.log("Ya no existe, nada que limpiar.");
    await pool.end();
    return;
  }
  console.log("Limpiando tenant de prueba:", nombre.rows[0].nombre);

  const personas = await pool.query(`SELECT keycloak_user_id FROM personas WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM bitacora_auditoria WHERE persona_id IN (SELECT id FROM personas WHERE tenant_id = $1)`, [tenantId]);
  await pool.query(`DELETE FROM correos_enviados WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM movimientos_credito WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM personas WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`UPDATE tenants SET suscripcion_id = NULL WHERE id = $1`, [tenantId]);
  await pool.query(`DELETE FROM tenant_agentes WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM config_recarga WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM suscripciones WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM saldos_ia WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  console.log("Tenant y filas relacionadas eliminadas de la base.");

  if (personas.rows[0]?.keycloak_user_id) {
    await eliminarUsuarioKeycloak(personas.rows[0].keycloak_user_id);
    console.log("Usuario de Keycloak eliminado:", personas.rows[0].keycloak_user_id);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
