// Verificación real de los 4 correos de cobro (prompt_code_correos_y_logo).
// Provoca cada condición con el proveedor SIMULADO real (tarjetas
// terminadas en 0002 = rechazada) contra un tenant descartable, y
// confirma que correos_enviados quedó en 'enviado' para cada uno.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_correos_cobro.ts destinatario@dominio.com
import { pool } from "../db";
import { ejecutarJobCicloCobro } from "../pagos/cicloCobro";
import { dispararAutorecargaSiCorresponde } from "../pagos/recargas";
import { ejecutarJobTarjetaPorVencer } from "../jobs/tarjetaPorVencer.job";

const PLAN_BASICO_QUERY = `SELECT id FROM planes WHERE activo = true ORDER BY precio_mensual_usd LIMIT 1`;
const PAQUETE_QUERY = `SELECT id, monto_pagado_usd FROM paquetes_recarga WHERE activo = true ORDER BY orden LIMIT 1`;

const destinatario = process.argv[2];
if (!destinatario) {
  console.error("Uso: ts-node verificar_correos_cobro.ts destinatario@dominio.com");
  process.exit(1);
}

function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let ok = true;
function assert(cond: boolean, msg: string) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`);
  if (!cond) ok = false;
}

// personas.email es único global — cada tenant descartable necesita su
// propia variante "+sufijo" del mismo destinatario (mismo criterio que
// otros scripts de verificación de correos de esta sesión).
function emailConSufijo(base: string, sufijo: string): string {
  const [usuario, dominio] = base.split("@");
  return `${usuario}+${sufijo}@${dominio}`;
}

async function crearTenant(nombre: string, emailDestino: string) {
  const plan = await pool.query(PLAN_BASICO_QUERY);
  const planId = plan.rows[0].id;

  const t = await pool.query(
    `INSERT INTO tenants (nombre, idioma, pais_codigo, estado_suscripcion, tipo_persona, numero_identificacion, nombre_fiscal)
     VALUES ($1, 'es', 'CR', 'activa', 'juridica', '3-101-888888', $1) RETURNING id`,
    [nombre]
  );
  const tenantId = t.rows[0].id;
  const s = await pool.query(
    `INSERT INTO suscripciones
       (tenant_id, plan_id, periodicidad, precio_pactado_usd, credito_pactado_usd, medicos_contratados,
        estado, periodo_inicio, periodo_fin)
     VALUES ($1, $2, 'mensual', 49, 10, 2, 'activa', now() - interval '35 days', now() - interval '1 day')
     RETURNING id`,
    [tenantId, planId]
  );
  const suscripcionId = s.rows[0].id;
  await pool.query(`UPDATE tenants SET suscripcion_id = $1 WHERE id = $2`, [suscripcionId, tenantId]);
  await pool.query(`INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd) VALUES ($1, 5, 0)`, [
    tenantId,
  ]);
  await pool.query(
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico, estado)
     VALUES ($1, 'QA Correos Cobro', $2, 'n/a', true, false, 'activo')`,
    [tenantId, emailDestino]
  );
  return { tenantId, suscripcionId };
}

async function agregarMetodo(tenantId: string, escenario: string, vencMes?: number, vencAnio?: number) {
  const referencia = `sim_${escenario}_${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(`UPDATE metodos_pago SET predeterminado = false WHERE tenant_id = $1`, [tenantId]);
  await pool.query(
    `INSERT INTO metodos_pago (tenant_id, proveedor, referencia_externa, pais_codigo, marca, ultimos4, vencimiento_mes, vencimiento_anio, predeterminado, estado)
     VALUES ($1, 'simulado', $2, 'CR', 'Visa', '0002', $3, $4, true, 'activo')`,
    [tenantId, referencia, vencMes ?? 12, vencAnio ?? 2030]
  );
}

async function limpiarTenant(tenantId: string) {
  await pool.query(`DELETE FROM notificaciones_callback WHERE cobro_id IN (SELECT id FROM cobros WHERE tenant_id = $1)`, [
    tenantId,
  ]);
  await pool.query(`DELETE FROM documentos_fiscales WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM movimientos_credito WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM correos_enviados WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM recargas WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM config_recarga WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM cobros WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM metodos_pago WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`UPDATE tenants SET suscripcion_id = NULL WHERE id = $1`, [tenantId]);
  await pool.query(`DELETE FROM suscripciones WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM saldos_ia WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM personas WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function ultimoCorreo(tenantId: string, tipo: string) {
  const r = await pool.query(
    `SELECT resultado, error FROM correos_enviados WHERE tenant_id = $1 AND tipo = $2 ORDER BY enviado_en DESC LIMIT 1`,
    [tenantId, tipo]
  );
  return r.rows[0];
}

async function main() {
  // -----------------------------------------------------------------
  // Escenarios 1 y 2 — cobro_fallido (intentos 1-3) y cuenta_suspendida
  // (intento 4), mismo tenant, misma tarjeta rechazada de punta a punta.
  // -----------------------------------------------------------------
  console.log("\n=== Escenarios 1-2: cobro_fallido → cuenta_suspendida ===");
  const t1 = await crearTenant(`QA Correos Cobro ${Date.now()}`, emailConSufijo(destinatario, `qacobro${Date.now()}`));
  await agregarMetodo(t1.tenantId, "tarjeta_rechazada");

  for (let intento = 1; intento <= 4; intento++) {
    const { evaluadas, intentadas } = await ejecutarJobCicloCobro(pool);
    console.log(`  intento ${intento} del ciclo — evaluadas=${evaluadas} intentadas=${intentadas}`);
    await esperar(1500);

    if (intento < 4) {
      const correo = await ultimoCorreo(t1.tenantId, "cobro_fallido");
      assert(correo?.resultado === "enviado", `cobro_fallido intento ${intento} quedó 'enviado' en correos_enviados`);
      // Forzar que el próximo tick del ciclo ya considere vencida la
      // ventana de reintentos (política real, sin esperar los días reales).
      await pool.query(`UPDATE suscripciones SET cobro_intento_desde = now() - interval '15 days' WHERE id = $1`, [
        t1.suscripcionId,
      ]);
    } else {
      const correo = await ultimoCorreo(t1.tenantId, "cuenta_suspendida");
      assert(correo?.resultado === "enviado", "cuenta_suspendida quedó 'enviado' en correos_enviados");
      const estado = await pool.query(`SELECT estado FROM suscripciones WHERE id = $1`, [t1.suscripcionId]);
      assert(estado.rows[0].estado === "suspendida", "La suscripción quedó en estado 'suspendida'");
    }
  }
  await limpiarTenant(t1.tenantId);

  // -----------------------------------------------------------------
  // Escenario 3 — autorecarga_fallida.
  // -----------------------------------------------------------------
  console.log("\n=== Escenario 3: autorecarga_fallida ===");
  const t2 = await crearTenant(`QA Correos Autorecarga ${Date.now()}`, emailConSufijo(destinatario, `qaautorecarga${Date.now()}`));
  await agregarMetodo(t2.tenantId, "tarjeta_rechazada");
  const paquete = await pool.query(PAQUETE_QUERY);
  await pool.query(
    `INSERT INTO config_recarga (tenant_id, autorecarga_activa, umbral_usd, paquete_id)
     VALUES ($1, true, 100, $2)`,
    [t2.tenantId, paquete.rows[0].id]
  );
  await pool.query(`UPDATE saldos_ia SET credito_plan_usd = 1, credito_comprado_usd = 0 WHERE tenant_id = $1`, [
    t2.tenantId,
  ]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await dispararAutorecargaSiCorresponde(client, t2.tenantId, null);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await esperar(1500);
  const correoAutorecarga = await ultimoCorreo(t2.tenantId, "autorecarga_fallida");
  assert(correoAutorecarga?.resultado === "enviado", "autorecarga_fallida quedó 'enviado' en correos_enviados");
  await limpiarTenant(t2.tenantId);

  // -----------------------------------------------------------------
  // Escenario 4 — tarjeta_por_vencer. Se sube temporalmente la
  // anticipación configurada (parámetro de plataforma) para que una
  // tarjeta que vence este mes caiga dentro de la ventana, sin fingir
  // fechas — se restaura el valor original al final.
  // -----------------------------------------------------------------
  console.log("\n=== Escenario 4: tarjeta_por_vencer ===");
  const t3 = await crearTenant(`QA Correos Vencimiento ${Date.now()}`, emailConSufijo(destinatario, `qavencimiento${Date.now()}`));
  const hoy = new Date();
  await agregarMetodo(t3.tenantId, "exito", hoy.getMonth() + 1, hoy.getFullYear());

  const paramOriginal = await pool.query(`SELECT valor FROM parametros_plataforma WHERE clave = 'cobro.aviso_vencimiento_dias'`);
  await pool.query(`UPDATE parametros_plataforma SET valor = '31' WHERE clave = 'cobro.aviso_vencimiento_dias'`);
  try {
    const { evaluadas, avisadas } = await ejecutarJobTarjetaPorVencer(pool);
    console.log(`  job tarjeta por vencer — evaluadas=${evaluadas} avisadas=${avisadas}`);
  } finally {
    await pool.query(`UPDATE parametros_plataforma SET valor = $1 WHERE clave = 'cobro.aviso_vencimiento_dias'`, [
      paramOriginal.rows[0].valor,
    ]);
  }
  const correoVencimiento = await ultimoCorreo(t3.tenantId, "tarjeta_por_vencer");
  assert(correoVencimiento?.resultado === "enviado", "tarjeta_por_vencer quedó 'enviado' en correos_enviados");
  await limpiarTenant(t3.tenantId);

  console.log(`\n${ok ? "TODOS LOS ESCENARIOS PASARON" : "HAY ESCENARIOS FALLIDOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
