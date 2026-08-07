// Verificación real end-to-end de UNA raza mapeada por alias (Galgo
// Español — la más compleja: sección agrupada + nota), contra el
// endpoint real de chat. Confirma que NO cae en razas_sin_coincidencia_log
// (el alias debe evitarlo) y que el mensaje se procesa con éxito.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_alias_raza_e2e.ts
import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();
let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function main() {
  const tipoId = await pool.query(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
  );
  const tipoIdentificacionId = tipoId.rows[0].id;
  const agenteResult = await pool.query(`SELECT id FROM agentes WHERE nombre = 'Medicina General / Triage'`);
  const agenteId = agenteResult.rows[0].id;
  const razaResult = await pool.query(`SELECT id FROM razas WHERE nombre = 'Galgo Español'`);
  const razaId = razaResult.rows[0].id;

  const email = `verif.alias.${sufijo}@vetlineai-test.com`;
  const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica Alias Test ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${sufijo}-5555`,
      nombreFiscal: `Clinica Alias Test ${sufijo}`,
      nombreTitular: "Dra Alias Test",
      email,
      telefono: "88885555",
      password: "ClaveTest123!",
      esMedico: true,
      colegiatura: `COL-ALIAS-${sufijo}`,
      agenteId,
    }),
  });
  const dataReg = (await respReg.json()) as any;
  if (respReg.status !== 201) {
    console.error("No se pudo registrar", dataReg);
    process.exit(1);
  }
  const token = dataReg.access_token as string;
  const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meData = (await me.json()) as any;
  const tenantId = meData.auth.tenantId as string;
  await pool.query(`UPDATE saldos_ia SET credito_plan_usd = 20 WHERE tenant_id = $1`, [tenantId]);

  try {
    const respProp = await fetch(`${BASE_URL}/api/propietarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre: "Propietario Galgo" }),
    });
    const propietarioId = ((await respProp.json()) as any).propietario.id;
    const respPac = await fetch(`${BASE_URL}/api/pacientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ propietarioId, nombre: "Veloz", especie: "Canino", razaId }),
    });
    const pacienteId = ((await respPac.json()) as any).paciente.id;
    const respCaso = await fetch(`${BASE_URL}/api/workspace/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pacienteId, agenteId, motivo: "Chequeo general de rutina." }),
    });
    const casoId = ((await respCaso.json()) as any).caso.id;

    console.log("\nEnviando mensaje real (Galgo Español, raza con alias)...");
    const respMsg = await fetch(`${BASE_URL}/api/workspace/casos/${casoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contenido: "Chequeo general de rutina, paciente sin signos clínicos evidentes." }),
    });
    assert(respMsg.status === 201, "Mensaje real (Galgo Español) procesado", { status: respMsg.status });

    const logResult = await pool.query(`SELECT 1 FROM razas_sin_coincidencia_log WHERE caso_id = $1`, [casoId]);
    assert(logResult.rows.length === 0, "Galgo Español NO quedó en razas_sin_coincidencia_log (el alias evitó el miss)");
  } finally {
    console.log("\n=== Limpieza ===");
    const personaKc = await pool.query(`SELECT keycloak_user_id FROM personas WHERE tenant_id = $1`, [tenantId]);
    for (const fila of personaKc.rows) {
      if (fila.keycloak_user_id) await eliminarUsuarioKeycloak(fila.keycloak_user_id);
    }
    await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM razas_sin_coincidencia_log WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    console.log(`Tenant ${tenantId} y usuarios Keycloak eliminados.`);
  }

  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
