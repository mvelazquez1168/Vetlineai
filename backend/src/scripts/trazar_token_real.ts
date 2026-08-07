// No toco las credenciales del usuario real (vamzz@hotmail.com) — en
// cambio, registro una clínica descartable propia por el endpoint HTTP
// real y decodifico el access_token que devuelve, para ver exactamente
// qué claims trae de punta a punta (mismo client, mismos protocol
// mappers que usaría cualquier médico real).
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/trazar_token_real.ts
import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";

function decodificarJwtSinVerificar(token: string): any {
  const payload = token.split(".")[1];
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  return JSON.parse(json);
}

async function main() {
  const agentesResp = await fetch("http://localhost:4000/api/registro-publico/agentes");
  const { agentes } = (await agentesResp.json()) as { agentes: { id: string }[] };

  const email = `qa.trazatoken.${Date.now()}@solutechit.com`;
  const body = {
    paisCodigo: "CR",
    nombreComercial: "QA Traza Token",
    tipoPersona: "fisica",
    nombreTitular: "QA Traza Token",
    email,
    password: "ClaveSegura2026!",
    esMedico: true,
    colegiatura: "CR-VET-TRAZA-1",
    agenteId: agentes[0].id,
  };

  console.log("Registrando clínica descartable...");
  const resp = await fetch("http://localhost:4000/api/registro-publico", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const resultado = (await resp.json()) as any;
  if (!resultado.access_token) {
    console.error("No se recibió access_token:", resultado);
    process.exit(1);
  }

  const claims = decodificarJwtSinVerificar(resultado.access_token);
  console.log("\n=== Claims del access_token real ===");
  console.log(JSON.stringify(claims, null, 2));

  console.log("\n=== ¿Tiene 'tenant_id' el token? ===", "tenant_id" in claims ? `SÍ: ${claims.tenant_id}` : "NO — AUSENTE");

  // Limpieza
  const persona = await pool.query(`SELECT id, tenant_id, keycloak_user_id FROM personas WHERE email = $1`, [email]);
  const tenantId = persona.rows[0]?.tenant_id;
  const keycloakUserId = persona.rows[0]?.keycloak_user_id;
  if (tenantId) {
    await pool.query(`DELETE FROM movimientos_credito WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM medico_agente WHERE persona_id = $1`, [persona.rows[0].id]);
    await pool.query(`DELETE FROM personas WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`UPDATE tenants SET suscripcion_id = NULL WHERE id = $1`, [tenantId]);
    await pool.query(`DELETE FROM tenant_agentes WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM config_recarga WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM suscripciones WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM saldos_ia WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
  if (keycloakUserId) await eliminarUsuarioKeycloak(keycloakUserId);
  console.log("\nLimpiado.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
