import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// Prompt B (platform_admin_registro) — regla que retiene el crédito de
// prueba hasta que exista un médico con colegiatura en el tenant, y tope
// global mensual del sandbox.
//
// Se usa desde dos puntos:
//   1. POST /api/registro-publico, cuando el propio registrante marca
//      "también soy médico" — el crédito se otorga en el mismo alta.
//   2. POST /admin/medicos, cuando el primer médico invitado completa su
//      alta con colegiatura — recién ahí se otorga.
// Ambos casos pasan por esta misma función para no duplicar la lógica del
// tope ni el patrón de escritura doble (saldos_ia + movimientos_credito).
// ---------------------------------------------------------------------

interface ResultadoOtorgamiento {
  otorgado: boolean;
  montoUsd: number;
}

/**
 * Otorga el crédito de prueba de un tenant si todavía no se otorgó
 * (tenants.credito_prueba_otorgado_en IS NULL). Compara el consumo
 * agregado del mes de TODAS las cuentas en prueba contra
 * trial.tope_global_mensual_usd: si el tope ya se superó, el crédito se
 * reduce a lo que quede disponible (puede ser cero) en vez de dejar la
 * cuenta "en espera" — la clínica ya puede operar con lo que haya, y
 * vuelve a tener margen apenas el tope se reinicia el próximo mes. No
 * bloquea la creación de la cuenta en ningún caso.
 */
export async function otorgarCreditoPruebaSiCorresponde(
  db: PoolClient,
  tenantId: string
): Promise<ResultadoOtorgamiento> {
  const tenantResult = await db.query(
    `SELECT credito_prueba_otorgado_en, suscripcion_id FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantResult.rows[0];
  if (!tenant || tenant.credito_prueba_otorgado_en) {
    return { otorgado: false, montoUsd: 0 };
  }

  // Capa 4 del prompt de verificación de correo — el crédito de prueba
  // queda retenido hasta que el administrador confirme su correo, igual
  // criterio que la colegiatura del médico: ambos son "razones concretas
  // para verificar" en vez de fricción sin propósito. El resto del
  // producto sigue disponible; esto no bloquea nada más. Se llama de
  // nuevo (idempotente por el guard de arriba) desde verificacionCorreo.ts
  // apenas se confirma, por si la colegiatura ya estaba lista antes.
  const adminResult = await db.query(
    `SELECT correo_verificado_en FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true LIMIT 1`,
    [tenantId]
  );
  if (!adminResult.rows[0]?.correo_verificado_en) {
    return { otorgado: false, montoUsd: 0 };
  }

  const parametrosResult = await db.query(
    `SELECT clave, valor FROM parametros_plataforma
     WHERE clave IN ('trial.credito_usd', 'trial.tope_global_mensual_usd')`
  );
  const parametros = new Map(parametrosResult.rows.map((p) => [p.clave, Number(p.valor)]));
  const creditoBase = parametros.get("trial.credito_usd") ?? 0;
  const topeGlobal = parametros.get("trial.tope_global_mensual_usd") ?? 0;

  // El tope es mensual y hay que sumar dos fuentes: las cuentas en
  // prueba que siguen activas (uso_api en vivo) y las que ya se purgaron
  // dentro de este mismo mes (clinicas_purgadas_auditoria — migración
  // 046). Sin la segunda fuente, purgar una cuenta que consumió este mes
  // libera cupo retroactivamente y el tope se afloja solo (encontrado en
  // prompt_code_optimizacion_contexto, Cambio 4). Se usa
  // primera_llamada_en como criterio de pertenencia al mes: el trial dura
  // 5 días (trial.duracion_dias), así que su actividad cae casi siempre
  // dentro de un único mes calendario.
  const consumoResult = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(u.costo_usd_calculado), 0)
          FROM uso_api u
          JOIN suscripciones s ON s.tenant_id = u.tenant_id
         WHERE s.estado = 'prueba' AND u."timestamp" >= date_trunc('month', now()))
       +
       (SELECT COALESCE(SUM(consumo_total_usd), 0)
          FROM clinicas_purgadas_auditoria
         WHERE primera_llamada_en >= date_trunc('month', now()))
       AS consumo`
  );
  const consumoActual = Number(consumoResult.rows[0].consumo);

  const disponibleBajoTope = Math.max(topeGlobal - consumoActual, 0);
  const montoUsd = Math.min(creditoBase, disponibleBajoTope);

  await db.query(
    `UPDATE saldos_ia SET credito_plan_usd = credito_plan_usd + $1, actualizado_en = now()
     WHERE tenant_id = $2`,
    [montoUsd, tenantId]
  );

  if (montoUsd > 0) {
    const saldoResult = await db.query(
      `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1`,
      [tenantId]
    );
    await db.query(
      `INSERT INTO movimientos_credito
         (tenant_id, tipo, bolsa, monto_usd, saldo_plan_post, saldo_comprado_post, descripcion)
       VALUES ($1, 'credito_prueba', 'plan', $2, $3, $4, 'Crédito de prueba gratuita')`,
      [
        tenantId,
        montoUsd.toFixed(4),
        Number(saldoResult.rows[0].credito_plan_usd).toFixed(4),
        Number(saldoResult.rows[0].credito_comprado_usd).toFixed(4),
      ]
    );
  }

  if (tenant.suscripcion_id) {
    await db.query(`UPDATE suscripciones SET credito_pactado_usd = $1 WHERE id = $2`, [
      montoUsd,
      tenant.suscripcion_id,
    ]);
  }

  await db.query(`UPDATE tenants SET credito_prueba_otorgado_en = now() WHERE id = $1`, [tenantId]);

  return { otorgado: true, montoUsd };
}
