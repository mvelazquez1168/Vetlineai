// Verificación real de los 4 correos transaccionales DISPARADOS DESDE SU
// PUNTO DE ENTRADA REAL (no llamando a enviarCorreoTransaccional directo,
// como ya se probó en verificar_correos_transaccionales.ts) — Prompt C,
// Paso 6.
//
// IMPORTANTE: procesarFinDePruebas/enviarRecordatoriosPurga/
// enviarAvisoPruebaPorTerminar son jobs por LOTE sobre toda la base — se
// confirmó antes de correr esto que ningún tenant real matchea sus
// condiciones hoy, así que solo van a tocar los tenants descartables que
// crea este script. Todo se borra al final.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_correos_transaccionales_e2e.ts destinatario@ejemplo.com
import { pool } from "../db";
import { procesarFinDePruebas, enviarRecordatoriosPurga, enviarAvisoPruebaPorTerminar } from "../purga";
import { crearInvitacion } from "../invitaciones";

// personas.email es único global — para no chocar con una cuenta real
// que ya use el destinatario de prueba, cada tenant descartable usa una
// variante con "+" (sigue entregando al mismo buzón real).
function emailConSufijo(email: string, sufijo: string): string {
  const [local, dominio] = email.split("@");
  return `${local}+${sufijo}@${dominio}`;
}

async function crearTenantPrueba(nombre: string, email: string, periodoFin: Date) {
  const t = await pool.query(
    `INSERT INTO tenants (nombre, idioma, pais_codigo, estado_suscripcion) VALUES ($1, 'es', 'CR', 'prueba') RETURNING id`,
    [nombre]
  );
  const tenantId = t.rows[0].id;
  const planResult = await pool.query(`SELECT id FROM planes ORDER BY orden LIMIT 1`);
  const s = await pool.query(
    `INSERT INTO suscripciones
       (tenant_id, plan_id, periodicidad, precio_pactado_usd, credito_pactado_usd, medicos_contratados, estado, periodo_inicio, periodo_fin)
     VALUES ($1, $2, 'mensual', 0, 0, 2, 'prueba', now() - interval '10 days', $3) RETURNING id`,
    [tenantId, planResult.rows[0].id, periodoFin.toISOString()]
  );
  await pool.query(`UPDATE tenants SET suscripcion_id = $1 WHERE id = $2`, [s.rows[0].id, tenantId]);
  await pool.query(`INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd) VALUES ($1, 5, 0)`, [
    tenantId,
  ]);
  await pool.query(
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico, estado)
     VALUES ($1, 'QA Admin Correos', $2, 'n/a', true, false, 'activo')`,
    [tenantId, email]
  );
  return tenantId;
}

async function limpiar(tenantId: string) {
  await pool.query(`DELETE FROM invitaciones_medico WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM personas WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`UPDATE tenants SET suscripcion_id = NULL WHERE id = $1`, [tenantId]);
  await pool.query(`DELETE FROM suscripciones WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM saldos_ia WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function main() {
  const destinatario = process.argv[2];
  if (!destinatario) {
    console.error("Uso: verificar_correos_transaccionales_e2e.ts destinatario@ejemplo.com");
    process.exit(1);
  }

  const tenantsCreados: string[] = [];

  try {
    // 1. prueba_por_terminar — periodo_fin en 1 día, todavía en 'prueba'.
    console.log("\n[1] prueba_por_terminar — via enviarAvisoPruebaPorTerminar()");
    const enUnDia = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tenantA = await crearTenantPrueba("QA Correos — Aviso Prueba", emailConSufijo(destinatario, "qacorreos1"), enUnDia);
    tenantsCreados.push(tenantA);
    const r1 = await enviarAvisoPruebaPorTerminar(pool);
    console.log(`  enviados: ${r1.enviados}`);

    // 2. prueba_terminada — periodo_fin ya pasado, dispara vía procesarFinDePruebas.
    console.log("\n[2] prueba_terminada — via procesarFinDePruebas()");
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tenantB = await crearTenantPrueba("QA Correos — Fin Prueba", emailConSufijo(destinatario, "qacorreos2"), ayer);
    tenantsCreados.push(tenantB);
    const r2 = await procesarFinDePruebas(pool);
    console.log(`  procesadas: ${r2.procesadas}`);

    // 3. recordatorio_eliminacion — el mismo tenant B ya quedó en
    // 'ventana_purga' tras el paso anterior; se acerca la fecha
    // programada para que caiga dentro de la ventana de recordatorio.
    console.log("\n[3] recordatorio_eliminacion — via enviarRecordatoriosPurga()");
    await pool.query(`UPDATE tenants SET purga_programada_para = now() + interval '1 day' WHERE id = $1`, [tenantB]);
    const r3 = await enviarRecordatoriosPurga(pool);
    console.log(`  enviados: ${r3.enviados}`);

    // 4. invitacion_medico — via crearInvitacion(), el punto de entrada
    // real del panel de admin.
    console.log("\n[4] invitacion_medico — via crearInvitacion()");
    const resultadoInvitacion = await crearInvitacion(pool, tenantB, "QA Correos — Fin Prueba", null, destinatario);
    console.log(`  ok: ${resultadoInvitacion.ok}`);

    const resultado = await pool.query(
      `SELECT tipo, destinatario, resultado, error, enviado_en
       FROM correos_enviados WHERE tenant_id = ANY($1::uuid[]) ORDER BY enviado_en`,
      [tenantsCreados]
    );
    console.log("\n=== correos_enviados (solo tenants de esta corrida) ===");
    console.table(resultado.rows);
  } finally {
    for (const id of tenantsCreados) await limpiar(id);
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
