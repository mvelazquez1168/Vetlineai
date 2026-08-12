import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";

const BASE = "http://localhost:4000/api";
const SUFIJO = Date.now().toString(36);
let assertOk = 0;
let assertFail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    assertOk++;
    console.log(`OK   - ${label}`);
  } else {
    assertFail++;
    console.log(`FAIL - ${label}`);
  }
}

async function fetchJson(path: string, opts: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(rest.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function main() {
  let tenantId = "";
  let personaId = "";
  let kcUserId = "";
  const email = `verif.resolucion.${SUFIJO}@example.com`;

  try {
    const tenantRes = await pool.query(
      `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
      [`Clínica Verif Resolución ${SUFIJO}`]
    );
    tenantId = tenantRes.rows[0].id;

    const planId = (await pool.query(`SELECT id FROM planes WHERE activo = true ORDER BY precio_mensual_usd LIMIT 1`))
      .rows[0].id;
    const suscripcionRes = await pool.query(
      `INSERT INTO suscripciones
         (tenant_id, plan_id, periodicidad, precio_pactado_usd, credito_pactado_usd, medicos_contratados,
          estado, periodo_inicio, periodo_fin)
       VALUES ($1, $2, 'mensual', 49, 10, 1, 'activa', now() - interval '5 days', now() + interval '25 days')
       RETURNING id`,
      [tenantId, planId]
    );
    await pool.query(`UPDATE tenants SET suscripcion_id = $1 WHERE id = $2`, [suscripcionRes.rows[0].id, tenantId]);
    await pool.query(`INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd) VALUES ($1, 0, 0)`, [
      tenantId,
    ]);

    kcUserId = await crearUsuarioKeycloak({
      email,
      nombreCompleto: `Dra. Verif Resolución ${SUFIJO}`,
      password: "Vp" + SUFIJO + "!1",
      tenantId,
      rol: "VETERINARIO",
    });

    // Médico + admin de clínica a la vez (rol binario) — un solo usuario
    // puede pegarle tanto a /workspace/consumo como a /admin/plan-consumo.
    const personaRes = await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
       VALUES ($1, 'Dra. Verif Resolución', $2, 'x', true, true, $3, 'COL-999')
       RETURNING id`,
      [tenantId, email, kcUserId]
    );
    personaId = personaRes.rows[0].id;

    const token = (await obtenerTokenParaUsuario(email, "Vp" + SUFIJO + "!1")).access_token;

    const umbralResult = await pool.query(
      `SELECT valor FROM parametros_plataforma WHERE clave = 'saldo.umbral_aviso_usd'`
    );
    const umbralAvisoUsd = Number(umbralResult.rows[0]?.valor ?? 0);
    assert(umbralAvisoUsd > 0, `parámetro saldo.umbral_aviso_usd configurado (USD ${umbralAvisoUsd})`);

    // ------------------------------------------------------------------
    // Escenario A — colchón agotado, después saldado "por afuera" (misma
    // forma en que se sospecha que pasó en producción: un ajuste directo
    // en saldos_ia, sin pasar por el ciclo ni por un admin marcando leída
    // la notificación). El aviso debe resolverse solo al consultar.
    // ------------------------------------------------------------------
    await pool.query(
      `UPDATE saldos_ia SET credito_plan_usd = 0, credito_comprado_usd = 0, colchon_usado_usd = 5 WHERE tenant_id = $1`,
      [tenantId]
    );
    const debugSaldo = await pool.query(`SELECT * FROM saldos_ia WHERE tenant_id = $1`, [tenantId]);
    const debugSusc = await pool.query(
      `SELECT s.estado, s.periodo_inicio, s.periodo_fin FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id WHERE t.id = $1`,
      [tenantId]
    );
    console.log("DEBUG saldo", JSON.stringify(debugSaldo.rows[0]));
    console.log("DEBUG suscripcion", JSON.stringify(debugSusc.rows[0]));
    const consumoA = await fetchJson("/workspace/consumo", { token });
    console.log("DEBUG consumoA", consumoA.status, JSON.stringify(consumoA.json));
    const debugNotif = await pool.query(`SELECT umbral, leida, fecha FROM notificaciones_uso WHERE tenant_id = $1`, [
      tenantId,
    ]);
    console.log("DEBUG notificaciones_uso tras GET", JSON.stringify(debugNotif.rows));
    assert(consumoA.json.aviso?.umbral === "colchon_agotado", "A1: colchón agotado -> aviso = colchon_agotado");

    await pool.query(
      `UPDATE saldos_ia SET colchon_usado_usd = 0, credito_comprado_usd = 50 WHERE tenant_id = $1`,
      [tenantId]
    );
    const consumoA2 = await fetchJson("/workspace/consumo", { token });
    assert(consumoA2.json.aviso === null, "A2: colchón saldado + saldo recargado por afuera -> aviso desaparece solo");

    const notifColchon = await pool.query(
      `SELECT leida FROM notificaciones_uso WHERE tenant_id = $1 AND umbral = 'colchon_agotado' ORDER BY fecha DESC LIMIT 1`,
      [tenantId]
    );
    assert(notifColchon.rows[0]?.leida === true, "A3: la fila colchon_agotado quedó marcada leída (no borrada, resuelta)");

    // ------------------------------------------------------------------
    // Escenario B — saldo bajo, se resuelve, y vuelve a cumplirse en el
    // MISMO ciclo. Antes del fix, la segunda vez no se re-emitía porque
    // ya "existía" una fila de ese umbral en el ciclo (sin importar si
    // estaba leída). Ahora sí debe reaparecer.
    // ------------------------------------------------------------------
    await pool.query(
      `UPDATE saldos_ia SET credito_plan_usd = 0, credito_comprado_usd = $1 WHERE tenant_id = $2`,
      [(umbralAvisoUsd - 1).toFixed(4), tenantId]
    );
    const consumoB1 = await fetchJson("/workspace/consumo", { token });
    assert(consumoB1.json.aviso?.umbral === "saldo_bajo", "B1: saldo bajo -> aviso = saldo_bajo");

    await pool.query(`UPDATE saldos_ia SET credito_comprado_usd = 100 WHERE tenant_id = $1`, [tenantId]);
    const consumoB2 = await fetchJson("/workspace/consumo", { token });
    assert(consumoB2.json.aviso === null, "B2: saldo recargado por encima del umbral -> aviso desaparece solo");

    await pool.query(
      `UPDATE saldos_ia SET credito_comprado_usd = $1 WHERE tenant_id = $2`,
      [(umbralAvisoUsd - 1).toFixed(4), tenantId]
    );
    const consumoB3 = await fetchJson("/workspace/consumo", { token });
    assert(
      consumoB3.json.aviso?.umbral === "saldo_bajo",
      "B3: saldo vuelve a bajar en el MISMO ciclo -> se re-emite (antes se quedaba mudo)"
    );

    // ------------------------------------------------------------------
    // Escenario C — mismo patrón visto desde /admin/plan-consumo (Platform
    // Admin / pantalla de la clínica), que tenía el mismo bug y además le
    // faltaba el filtro por periodo_inicio.
    // ------------------------------------------------------------------
    await pool.query(
      `UPDATE saldos_ia SET credito_plan_usd = 0, credito_comprado_usd = 0, colchon_usado_usd = 5 WHERE tenant_id = $1`,
      [tenantId]
    );
    const planC1 = await fetchJson("/admin/plan-consumo", { token });
    assert(planC1.json.aviso?.umbral === "colchon_agotado", "C1: /admin/plan-consumo también ve colchon_agotado vigente");

    await pool.query(
      `UPDATE saldos_ia SET colchon_usado_usd = 0, credito_comprado_usd = 50 WHERE tenant_id = $1`,
      [tenantId]
    );
    const planC2 = await fetchJson("/admin/plan-consumo", { token });
    assert(planC2.json.aviso === null, "C2: /admin/plan-consumo también se resuelve solo al consultar");
  } finally {
    await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [
      tenantId || "00000000-0000-0000-0000-000000000000",
    ]).catch(() => {});
    if (personaId) {
      await pool.query(`DELETE FROM bitacora_auditoria WHERE persona_id = $1`, [personaId]).catch(() => {});
      await pool.query(`DELETE FROM personas WHERE id = $1`, [personaId]).catch(() => {});
    }
    if (tenantId) {
      await pool.query(`UPDATE tenants SET suscripcion_id = NULL WHERE id = $1`, [tenantId]).catch(() => {});
      await pool.query(`DELETE FROM suscripciones WHERE tenant_id = $1`, [tenantId]).catch(() => {});
      await pool.query(`DELETE FROM saldos_ia WHERE tenant_id = $1`, [tenantId]).catch(() => {});
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => {});
    }
    if (kcUserId) await eliminarUsuarioKeycloak(kcUserId).catch(() => {});

    console.log(`\n${assertOk} OK, ${assertFail} FAIL`);
    await pool.end();
  }
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
