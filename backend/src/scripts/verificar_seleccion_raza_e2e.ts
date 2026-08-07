// Verificación real end-to-end de la carga selectiva de predisposiciones
// raciales: un caso real (Golden Retriever) y un caso mestizo, contra el
// endpoint real de chat, confirmando que razas_sin_coincidencia_log se
// llena solo quien corresponde.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_seleccion_raza_e2e.ts
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
  const razaGoldenResult = await pool.query(`SELECT id FROM razas WHERE nombre = 'Golden Retriever'`);
  const razaGoldenId = razaGoldenResult.rows[0].id;

  const email = `verif.raza.${sufijo}@vetlineai-test.com`;
  const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica Raza Test ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${sufijo}-6666`,
      nombreFiscal: `Clinica Raza Test ${sufijo}`,
      nombreTitular: "Dra Raza Test",
      email,
      telefono: "88886666",
      password: "ClaveTest123!",
      esMedico: true,
      colegiatura: `COL-RAZA-${sufijo}`,
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

  // Crédito de prueba por defecto no alcanza para dos llamadas reales
  // seguidas (Golden Retriever ya consume una parte importante) — se
  // sube a mano para este tenant descartable, solo para no depender de
  // que el saldo por defecto del trial rinda para la verificación.
  await pool.query(`UPDATE saldos_ia SET credito_plan_usd = 50 WHERE tenant_id = $1`, [tenantId]);

  try {
    // -------------------------------------------------------------
    // Caso 1 — Golden Retriever (debe matchear).
    // -------------------------------------------------------------
    const respProp = await fetch(`${BASE_URL}/api/propietarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre: "Propietario Golden" }),
    });
    const propietarioId = ((await respProp.json()) as any).propietario.id;
    const respPac = await fetch(`${BASE_URL}/api/pacientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ propietarioId, nombre: "Rocky", especie: "Canino", razaId: razaGoldenId }),
    });
    const pacienteId = ((await respPac.json()) as any).paciente.id;
    const respCaso = await fetch(`${BASE_URL}/api/workspace/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pacienteId, agenteId, motivo: "Chequeo general de rutina." }),
    });
    const casoId = ((await respCaso.json()) as any).caso.id;

    console.log("\nEnviando mensaje real (Golden Retriever)...");
    const respMsg = await fetch(`${BASE_URL}/api/workspace/casos/${casoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contenido: "Chequeo general de rutina, paciente sin signos clínicos evidentes." }),
    });
    assert(respMsg.status === 201, "Mensaje real (Golden Retriever) procesado", { status: respMsg.status });

    const usoResult = await pool.query(
      `SELECT tokens_entrada, tokens_cache_escritura, tokens_cache_lectura
       FROM uso_api WHERE caso_id = $1 ORDER BY timestamp DESC LIMIT 1`,
      [casoId]
    );
    if (usoResult.rows.length !== 1) {
      const usoTenant = await pool.query(`SELECT id, caso_id, modelo FROM uso_api WHERE tenant_id = $1`, [tenantId]);
      console.error(`Debug — casoId=${casoId}, filas de uso_api para el tenant:`, usoTenant.rows);
    }
    assert(usoResult.rows.length === 1, "Quedó registrado un uso_api real para el caso", usoResult.rows[0]);

    const logGoldenResult = await pool.query(`SELECT 1 FROM razas_sin_coincidencia_log WHERE caso_id = $1`, [casoId]);
    assert(
      logGoldenResult.rows.length === 0,
      "Golden Retriever NO quedó registrado en razas_sin_coincidencia_log (matcheó)"
    );

    // -------------------------------------------------------------
    // Caso 2 — Mestizo (no matchea con el documento; debe loguearse).
    // -------------------------------------------------------------
    const respPac2 = await fetch(`${BASE_URL}/api/pacientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ propietarioId, nombre: "Firulais", especie: "Canino" }),
    });
    const dataPac2 = (await respPac2.json()) as any;
    if (respPac2.status !== 201) {
      console.error("Fallo al crear paciente 2", respPac2.status, dataPac2);
    }
    const pacienteId2 = dataPac2.paciente.id;
    // Sin razaId — pacientes.raza queda NULL (mestizo/no especificada).
    const respCaso2 = await fetch(`${BASE_URL}/api/workspace/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pacienteId: pacienteId2, agenteId, motivo: "Chequeo general de rutina." }),
    });
    const dataCaso2 = (await respCaso2.json()) as any;
    if (respCaso2.status !== 201) {
      console.error("Fallo al crear caso 2", respCaso2.status, dataCaso2);
    }
    const casoId2 = dataCaso2.caso.id;

    console.log("\nEnviando mensaje real (mestizo, sin raza)...");
    const respMsg2 = await fetch(`${BASE_URL}/api/workspace/casos/${casoId2}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contenido: "Chequeo general de rutina, paciente sin signos clínicos evidentes." }),
    });
    const dataMsg2 = await respMsg2.json().catch(() => null);
    assert(respMsg2.status === 201, "Mensaje real (mestizo) procesado", { status: respMsg2.status, dataMsg2 });

    const logMestizoResult = await pool.query(`SELECT especie, raza_texto FROM razas_sin_coincidencia_log WHERE caso_id = $1`, [
      casoId2,
    ]);
    assert(
      logMestizoResult.rows.length === 1,
      "Mestizo (sin raza) SÍ quedó registrado en razas_sin_coincidencia_log",
      logMestizoResult.rows[0]
    );
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
