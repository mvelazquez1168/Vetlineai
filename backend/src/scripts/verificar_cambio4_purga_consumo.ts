// prompt_code_optimizacion_contexto — Cambio 4, verificación real:
// registra una clínica de prueba, genera consumo real de uso_api,
// fuerza su purga (adelantando purga_programada_para) y confirma que
// clinicas_purgadas_auditoria queda con la contabilidad agregada
// correcta. Además confirma que el tope global mensual ya suma el
// agregado de cuentas purgadas (registroPrueba.ts).
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_cambio4_purga_consumo.ts
import { pool } from "../db";
import { ejecutarPurgas } from "../purga";
import { otorgarCreditoPruebaSiCorresponde } from "../registroPrueba";
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

  const email = `verif.cambio4.${sufijo}@vetlineai-test.com`;
  const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica Cambio4 ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${sufijo}-6666`,
      nombreFiscal: `Clinica Cambio4 ${sufijo}`,
      nombreTitular: "Dra Cambio4 Test",
      email,
      telefono: "88886666",
      password: "ClaveTest123!",
      esMedico: true,
      colegiatura: `COL-CAMBIO4-${sufijo}`,
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

  // El registro público verifica correo antes de otorgar crédito de
  // prueba real (Capa 4) — para esta verificación se fuerza el correo
  // como verificado, igual que otros scripts de esta sesión que
  // necesitan crédito real sin pasarlo por Resend.
  await pool.query(`UPDATE personas SET correo_verificado_en = now() WHERE tenant_id = $1 AND es_admin_clinica = true`, [
    tenantId,
  ]);
  const clienteDb = await pool.connect();
  let montoOtorgado = 0;
  try {
    montoOtorgado = (await otorgarCreditoPruebaSiCorresponde(clienteDb, tenantId)).montoUsd;
  } finally {
    clienteDb.release();
  }
  assert(montoOtorgado > 0, "Crédito de prueba otorgado", { montoOtorgado });

  try {
    const respProp = await fetch(`${BASE_URL}/api/propietarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre: "Propietario Cambio4" }),
    });
    const propietarioId = ((await respProp.json()) as any).propietario.id;
    const respPac = await fetch(`${BASE_URL}/api/pacientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ propietarioId, nombre: "Testigo", especie: "Canino" }),
    });
    const pacienteId = ((await respPac.json()) as any).paciente.id;
    const respCaso = await fetch(`${BASE_URL}/api/workspace/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pacienteId, agenteId, motivo: "Chequeo general de rutina." }),
    });
    const casoId = ((await respCaso.json()) as any).caso.id;

    console.log("\nEnviando 2 mensajes reales...");
    for (const contenido of [
      "Paciente sin signos clínicos evidentes, chequeo de rutina.",
      "Se agrega peso 12kg, sin más hallazgos por ahora.",
    ]) {
      const resp = await fetch(`${BASE_URL}/api/workspace/casos/${casoId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contenido }),
      });
      assert(resp.status === 201, `Mensaje real procesado`, { status: resp.status });
    }

    const usoAntes = await pool.query(
      `SELECT count(*) AS cantidad, COALESCE(SUM(costo_usd_calculado),0) AS total FROM uso_api WHERE tenant_id = $1`,
      [tenantId]
    );
    const cantidadReal = Number(usoAntes.rows[0].cantidad);
    const totalReal = Number(usoAntes.rows[0].total);
    assert(cantidadReal === 2, "uso_api real tiene 2 filas antes de purgar", { cantidadReal, totalReal });

    // Forzar que el tenant sea candidato a purga YA (en vez de esperar
    // trial.duracion_dias + purga.plazo_dias reales).
    await pool.query(
      `UPDATE tenants SET purga_programada_para = now() - interval '1 minute' WHERE id = $1`,
      [tenantId]
    );
    await pool.query(`UPDATE suscripciones SET estado = 'ventana_purga' WHERE tenant_id = $1`, [tenantId]);

    console.log("\nEjecutando ejecutarPurgas()...");
    await ejecutarPurgas(pool);

    const tenantSigueExistiendo = await pool.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
    assert(tenantSigueExistiendo.rows.length === 0, "El tenant fue eliminado por la purga");

    const auditoria = await pool.query(
      `SELECT consumo_total_usd, cantidad_llamadas, primera_llamada_en, ultima_llamada_en, credito_otorgado_usd
       FROM clinicas_purgadas_auditoria WHERE tenant_id = $1`,
      [tenantId]
    );
    const fila = auditoria.rows[0];
    assert(!!fila, "Quedó un registro en clinicas_purgadas_auditoria");
    assert(Number(fila.cantidad_llamadas) === 2, "cantidad_llamadas coincide con lo real", {
      esperado: 2,
      real: fila.cantidad_llamadas,
    });
    assert(Math.abs(Number(fila.consumo_total_usd) - totalReal) < 0.0001, "consumo_total_usd coincide con lo real", {
      esperado: totalReal,
      real: fila.consumo_total_usd,
    });
    assert(fila.primera_llamada_en !== null && fila.ultima_llamada_en !== null, "primera/ultima llamada quedaron pobladas");
    assert(Math.abs(Number(fila.credito_otorgado_usd) - montoOtorgado) < 0.0001, "credito_otorgado_usd coincide con lo otorgado", {
      esperado: montoOtorgado,
      real: fila.credito_otorgado_usd,
    });

    const usoDespues = await pool.query(`SELECT count(*) AS cantidad FROM uso_api WHERE tenant_id = $1`, [tenantId]);
    assert(Number(usoDespues.rows[0].cantidad) === 0, "uso_api real quedó borrado tras la purga");

    // Tope global: simular otro registro en prueba y confirmar que el
    // consumo ya purgado de ESTE tenant se sigue contando dentro del mes.
    const parametroTope = await pool.query(
      `SELECT valor FROM parametros_plataforma WHERE clave = 'trial.tope_global_mensual_usd'`
    );
    const topeConfigurado = Number(parametroTope.rows[0].valor);
    const consumoConPurgados = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(u.costo_usd_calculado), 0)
            FROM uso_api u JOIN suscripciones s ON s.tenant_id = u.tenant_id
           WHERE s.estado = 'prueba' AND u."timestamp" >= date_trunc('month', now()))
         +
         (SELECT COALESCE(SUM(consumo_total_usd), 0) FROM clinicas_purgadas_auditoria
           WHERE primera_llamada_en >= date_trunc('month', now()))
         AS consumo`
    );
    const consumoTotalDelMes = Number(consumoConPurgados.rows[0].consumo);
    assert(
      consumoTotalDelMes >= totalReal,
      "El consumo del tenant purgado sigue contando en la query real del tope global",
      { consumoTotalDelMes, totalReal, topeConfigurado }
    );
  } finally {
    console.log("\n=== Limpieza ===");
    const personaKc = await pool.query(
      `SELECT keycloak_user_id FROM personas WHERE email = $1`,
      [email]
    );
    for (const fila of personaKc.rows) {
      if (fila.keycloak_user_id) await eliminarUsuarioKeycloak(fila.keycloak_user_id);
    }
    await pool.query(`DELETE FROM clinicas_purgadas_auditoria WHERE tenant_id = $1`, [tenantId]);
    console.log(`Registro de clinicas_purgadas_auditoria de la clínica descartable eliminado.`);
  }

  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
