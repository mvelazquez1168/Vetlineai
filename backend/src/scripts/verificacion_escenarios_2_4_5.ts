// Escenarios 2, 4 y 5 del prompt de verificación de correo — vía código
// real (no mocks): generarYEnviarVerificacion, el endpoint HTTP real del
// webhook, y procesarCuentasNoOperativas/enviarAvisoCuentaNoOperativa
// directo. Tenants descartables, limpiados al final.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificacion_escenarios_2_4_5.ts
import { pool } from "../db";
import { generarYEnviarVerificacion } from "../verificacionCorreo";
import { enviarAvisoCuentaNoOperativa, procesarCuentasNoOperativas } from "../purga";

async function crearTenantPrueba(nombre: string, email: string, creadoHaceDias: number) {
  const t = await pool.query(
    `INSERT INTO tenants (nombre, idioma, pais_codigo, estado_suscripcion, creado_en)
     VALUES ($1, 'es', 'CR', 'prueba', now() - ($2 || ' days')::interval) RETURNING id`,
    [nombre, creadoHaceDias]
  );
  const tenantId = t.rows[0].id;
  const planResult = await pool.query(`SELECT id FROM planes ORDER BY orden LIMIT 1`);
  const s = await pool.query(
    `INSERT INTO suscripciones
       (tenant_id, plan_id, periodicidad, precio_pactado_usd, credito_pactado_usd, medicos_contratados, estado, periodo_inicio, periodo_fin)
     VALUES ($1, $2, 'mensual', 0, 0, 2, 'prueba', now() - interval '31 days', now() + interval '999 days') RETURNING id`,
    [tenantId, planResult.rows[0].id]
  );
  await pool.query(`UPDATE tenants SET suscripcion_id = $1 WHERE id = $2`, [s.rows[0].id, tenantId]);
  await pool.query(`INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd) VALUES ($1, 0, 0)`, [
    tenantId,
  ]);
  const p = await pool.query(
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico, estado)
     VALUES ($1, 'QA Admin', $2, 'n/a', true, false, 'activo') RETURNING id`,
    [tenantId, email]
  );
  return { tenantId, suscripcionId: s.rows[0].id, personaId: p.rows[0].id };
}

async function limpiar(tenantId: string) {
  await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM correos_enviados WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM personas WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`UPDATE tenants SET suscripcion_id = NULL WHERE id = $1`, [tenantId]);
  await pool.query(`DELETE FROM suscripciones WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM saldos_ia WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function main() {
  const tenantsCreados: string[] = [];

  try {
    // ---------------------------------------------------------------
    // ESCENARIO 2 — rebote. Tenant reciente (no toca el límite de 30
    // días), dispara la verificación, simula el webhook de Resend
    // contra el endpoint HTTP REAL (no la función interna).
    // ---------------------------------------------------------------
    console.log("\n=== ESCENARIO 2 — rebote ===");
    const t2 = await crearTenantPrueba("QA Correo — Rebote", "mvelazquez+qarebote@solutechit.com", 0);
    tenantsCreados.push(t2.tenantId);
    await generarYEnviarVerificacion(
      pool,
      t2.personaId,
      t2.tenantId,
      "mvelazquez+qarebote@solutechit.com",
      "QA Correo — Rebote"
    );

    const correo = await pool.query(
      `SELECT proveedor_message_id FROM correos_enviados WHERE tenant_id = $1 AND tipo = 'verificacion_correo'`,
      [t2.tenantId]
    );
    const messageId = correo.rows[0]?.proveedor_message_id;
    console.log("proveedor_message_id real:", messageId);
    if (!messageId) throw new Error("No se pudo enviar el correo de prueba (¿RESEND_API_KEY configurada?).");

    const eventoId = `qa-evt-${Date.now()}`;
    const payload = {
      type: "email.bounced",
      data: { email_id: messageId, to: ["mvelazquez+qarebote@solutechit.com"] },
    };
    const resp1 = await fetch("http://localhost:4000/api/webhooks/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json", "svix-id": eventoId },
      body: JSON.stringify(payload),
    });
    console.log("POST /webhooks/resend (1er intento) status:", resp1.status, await resp1.json());

    // Reintento con el MISMO svix-id — debe ser idempotente (no duplicar
    // el efecto, aunque el UPDATE de todos modos no duplicaría nada acá).
    const resp2 = await fetch("http://localhost:4000/api/webhooks/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json", "svix-id": eventoId },
      body: JSON.stringify(payload),
    });
    console.log("POST /webhooks/resend (reintento, mismo svix-id) status:", resp2.status, await resp2.json());

    const eventosGuardados = await pool.query(`SELECT count(*) FROM webhooks_resend_eventos WHERE id = $1`, [
      eventoId,
    ]);
    console.log("Filas en webhooks_resend_eventos para ese svix-id (debe ser 1, no 2):", eventosGuardados.rows[0].count);

    const personaTrasRebote = await pool.query(
      `SELECT correo_rebotado_en FROM personas WHERE id = $1`,
      [t2.personaId]
    );
    console.log("persona.correo_rebotado_en:", personaTrasRebote.rows[0].correo_rebotado_en);

    const correoTrasRebote = await pool.query(
      `SELECT rebotado_en FROM correos_enviados WHERE tenant_id = $1 AND tipo = 'verificacion_correo'`,
      [t2.tenantId]
    );
    console.log("correos_enviados.rebotado_en:", correoTrasRebote.rows[0].rebotado_en);

    // ---------------------------------------------------------------
    // ESCENARIO 4/5 — límite exterior de 30 días. Tenant creado hace 31
    // días, sin correo verificado, sin médico colegiado.
    // ---------------------------------------------------------------
    console.log("\n=== ESCENARIO 4/5 — límite de cuenta no operativa ===");
    const t4 = await crearTenantPrueba("QA Correo — No Operativa 31d", "qa.nooperativa@example.com", 31);
    tenantsCreados.push(t4.tenantId);

    const antes = await pool.query(
      `SELECT s.estado, s.credito_pactado_usd, t.credito_prueba_otorgado_en, t.purga_programada_para
       FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id WHERE t.id = $1`,
      [t4.tenantId]
    );
    console.log("Estado ANTES del job (reloj de prueba no debería haber corrido — crédito en 0):", antes.rows[0]);

    const resumenAviso = await enviarAvisoCuentaNoOperativa(pool);
    console.log("enviarAvisoCuentaNoOperativa:", resumenAviso);

    const resumenCierre = await procesarCuentasNoOperativas(pool);
    console.log("procesarCuentasNoOperativas:", resumenCierre);

    const despues = await pool.query(
      `SELECT s.estado, t.purga_programada_para, t.purga_aviso_en
       FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id WHERE t.id = $1`,
      [t4.tenantId]
    );
    console.log("Estado DESPUÉS del job (esperado: estado='ventana_purga', purga_programada_para seteada):", despues.rows[0]);

    const emailCierre = await pool.query(
      `SELECT tipo, resultado FROM correos_enviados WHERE tenant_id = $1 ORDER BY enviado_en`,
      [t4.tenantId]
    );
    console.log("Correos disparados para este tenant:", emailCierre.rows);
  } finally {
    for (const id of tenantsCreados) await limpiar(id);
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
