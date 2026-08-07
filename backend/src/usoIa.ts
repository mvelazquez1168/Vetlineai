import { PoolClient } from "pg";
import { requerirStripe } from "./stripe";

// Mínimo necesario de PoolClient/Pool para estas funciones — así se
// pueden llamar tanto desde un handler de request (req.db, un PoolClient
// ya dentro de una transacción tenant-scoped) como desde un job de
// background (el `pool` compartido, sin transacción ni tenant activo).
interface Queryable {
  query: PoolClient["query"];
}

// ---------------------------------------------------------------------
// Cálculo del ciclo de facturación actual de un tenant — EXACTAMENTE la
// misma lógica que ya usaba GET /api/admin/uso-facturacion (trial vs.
// suscripción real de Stripe vs. fallback calendario), extraída acá para
// que la detección de umbrales/bloqueo (workspace.routes.ts) y la vista
// agregada de Platform Admin usen el mismo cálculo, sin duplicarlo.
// ---------------------------------------------------------------------
interface TenantCicloInfo {
  estado_suscripcion: string;
  trial_termina_en: string | Date | null;
  creado_en: string | Date;
  stripe_subscription_id: string | null;
}

export interface Ciclo {
  cicloInicio: Date;
  cicloFin: Date;
}

// La cuenta de Stripe conectada devuelve current_period_start/end en el
// ítem de la suscripción (suscripcion.items.data[0]), no en el objeto de
// la suscripción en sí — la versión del SDK instalada todavía tipa esos
// campos como si vivieran en el nivel superior (el shape viejo de la
// API), así que acá se leen "a mano" con un fallback al nivel superior
// por si algún día vuelve a aparecer ahí. Sin este fallback al item,
// current_period_end salía `undefined` y la fecha calculada era "Invalid
// Date" — se detectó recién al probar con una suscripción real. Único
// lugar que hace esta lectura — todo lo demás (calcularCicloActual, el
// webhook de Stripe, el job de excedente) pasa por acá.
export async function obtenerPeriodoDeSuscripcionStripe(stripeSubscriptionId: string): Promise<Ciclo | null> {
  try {
    const stripe = requerirStripe();
    const suscripcion = await stripe.subscriptions.retrieve(stripeSubscriptionId);

    const item = suscripcion.items?.data?.[0] as
      | { current_period_start?: number; current_period_end?: number }
      | undefined;
    const inicioUnix = item?.current_period_start ?? (suscripcion as any).current_period_start;
    const finUnix = item?.current_period_end ?? (suscripcion as any).current_period_end;

    if (!inicioUnix || !finUnix) {
      throw new Error("La suscripción de Stripe no trajo current_period_start/end en ningún lugar esperado.");
    }

    return {
      cicloInicio: new Date(inicioUnix * 1000),
      cicloFin: new Date(finUnix * 1000),
    };
  } catch (err) {
    console.error("No se pudo leer el período de la suscripción en Stripe", err);
    return null;
  }
}

export async function calcularCicloActual(tenant: TenantCicloInfo): Promise<Ciclo> {
  if (tenant.estado_suscripcion === "trial") {
    return {
      cicloInicio: new Date(tenant.creado_en),
      cicloFin: tenant.trial_termina_en ? new Date(tenant.trial_termina_en) : new Date(),
    };
  }

  if (tenant.stripe_subscription_id) {
    const periodo = await obtenerPeriodoDeSuscripcionStripe(tenant.stripe_subscription_id);
    if (periodo) return periodo;
  }

  const hoy = new Date();
  return {
    cicloInicio: new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)),
    cicloFin: new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 1)),
  };
}

export async function calcularConsumoCiclo(
  db: Queryable,
  tenantId: string,
  ciclo: Ciclo
): Promise<number> {
  const usoResult = await db.query(
    `SELECT COALESCE(SUM(costo_usd_calculado), 0) AS total
     FROM uso_api
     WHERE tenant_id = $1 AND "timestamp" >= $2 AND "timestamp" < $3`,
    [tenantId, ciclo.cicloInicio.toISOString(), ciclo.cicloFin.toISOString()]
  );
  return Number(usoResult.rows[0].total);
}

export interface EstadoUsoTenant {
  ciclo: Ciclo;
  montoUsado: number;
  presupuestoUsdIncluido: number | null;
  limiteUsdConfigurado: number | null;
  limiteAccion: "solo_notificar" | "bloquear";
}

export async function obtenerEstadoUso(db: PoolClient, tenantId: string): Promise<EstadoUsoTenant | null> {
  const tenantResult = await db.query(
    `SELECT t.estado_suscripcion, t.trial_termina_en, t.creado_en, t.stripe_subscription_id,
            t.limite_usd_configurado, t.limite_accion, p.presupuesto_usd_incluido
     FROM tenants t LEFT JOIN planes p ON p.id = t.plan_id
     WHERE t.id = $1`,
    [tenantId]
  );
  const tenant = tenantResult.rows[0];
  if (!tenant) return null;

  const ciclo = await calcularCicloActual(tenant);
  const montoUsado = await calcularConsumoCiclo(db, tenantId, ciclo);

  return {
    ciclo,
    montoUsado,
    presupuestoUsdIncluido:
      tenant.presupuesto_usd_incluido != null ? Number(tenant.presupuesto_usd_incluido) : null,
    limiteUsdConfigurado:
      tenant.limite_usd_configurado != null ? Number(tenant.limite_usd_configurado) : null,
    limiteAccion: tenant.limite_accion,
  };
}

// ---------------------------------------------------------------------
// Motor de crédito, Bloque 4 — avisos. Reemplaza la versión anterior de
// esta función, que calculaba umbrales contra el modelo heredado
// (planes.presupuesto_usd_incluido / tenants.limite_usd_configurado,
// completamente desconectado de saldos_ia). Fuente de verdad ahora:
// saldos_ia (bolsas + colchón) y parametros_plataforma (umbral de aviso),
// igual que verificarAntesDeGenerar en tarifas.ts.
//
// tope_recargas y autorecarga_fallida NO se emiten desde acá — son del
// motor de cobros, que todavía no dispara nada (ver CHECK de
// notificaciones_uso, que ya contempla los 7 valores).
//
// No repetición: un umbral se emite una sola vez por ciclo de
// facturación — se resuelve consultando si ya existe una notificación de
// ese umbral con fecha posterior a suscripciones.periodo_inicio de la
// suscripción vigente del tenant (la tabla no tiene columna de ciclo
// propia). Es el mecanismo que el propio prompt de este bloque sugirió
// como default.
// ---------------------------------------------------------------------
export async function verificarUmbralesYNotificar(db: PoolClient, tenantId: string): Promise<void> {
  const suscripcionResult = await db.query(
    `SELECT s.estado, s.periodo_inicio, s.periodo_fin, s.credito_pactado_usd
     FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE t.id = $1`,
    [tenantId]
  );
  const suscripcion = suscripcionResult.rows[0];
  if (!suscripcion) return;

  const saldoResult = await db.query(
    `SELECT credito_plan_usd, credito_comprado_usd, colchon_usado_usd FROM saldos_ia WHERE tenant_id = $1`,
    [tenantId]
  );
  const saldo = saldoResult.rows[0];
  if (!saldo) return;

  const creditoPlan = Number(saldo.credito_plan_usd);
  const creditoComprado = Number(saldo.credito_comprado_usd);
  const saldoDisponible = creditoPlan + creditoComprado;
  const colchonUsado = Number(saldo.colchon_usado_usd);

  const candidatos: { umbral: string; mensaje: string }[] = [];

  if (suscripcion.estado === "prueba") {
    // Prueba gratuita: el umbral es el crédito pactado de la suscripción
    // (trial.credito_usd al momento de crearla), no saldo.umbral_aviso_usd
    // — ese es para clínicas con plan pago.
    const creditoPactado = Number(suscripcion.credito_pactado_usd);
    const agotadaPorTiempo = suscripcion.periodo_fin && new Date(suscripcion.periodo_fin) <= new Date();
    if (saldoDisponible <= 0 || agotadaPorTiempo) {
      candidatos.push({
        umbral: "trial_agotado",
        mensaje: agotadaPorTiempo
          ? "Tu período de prueba terminó — elegí un plan para seguir generando con IA."
          : "Tu prueba agotó el crédito incluido — elegí un plan para seguir generando con IA.",
      });
    } else if (creditoPactado > 0 && creditoPactado - saldoDisponible >= creditoPactado * 0.8) {
      candidatos.push({
        umbral: "trial_80",
        mensaje: `Tu prueba ya usó el 80% del crédito incluido ($${(creditoPactado - saldoDisponible).toFixed(2)} de $${creditoPactado.toFixed(2)}) — elegí un plan antes de que se agote.`,
      });
    }
  } else {
    const parametroResult = await db.query(
      `SELECT valor FROM parametros_plataforma WHERE clave = 'saldo.umbral_aviso_usd'`
    );
    const umbralAvisoUsd = Number(parametroResult.rows[0]?.valor ?? 0);

    if (saldoDisponible <= 0) {
      candidatos.push({
        umbral: "saldo_agotado",
        mensaje: "Tu clínica se quedó sin saldo de IA.",
      });
    } else if (umbralAvisoUsd > 0 && saldoDisponible < umbralAvisoUsd) {
      // Contenido del aviso: indica qué va a pasar, no solo "hay poco
      // saldo" — con autorecarga activa, que no hace falta hacer nada;
      // sin ella, invita a recargar. Nunca le ofrece al médico una acción
      // que no puede ejecutar (recargar es del administrador de la
      // clínica) — el mensaje es el mismo para ambos lectores.
      const configResult = await db.query(
        `SELECT cr.autorecarga_activa, cr.umbral_usd, p.credito_acreditado_usd
         FROM config_recarga cr
         LEFT JOIN paquetes_recarga p ON p.id = cr.paquete_id
         WHERE cr.tenant_id = $1`,
        [tenantId]
      );
      const config = configResult.rows[0];
      const mensaje =
        config?.autorecarga_activa && config.credito_acreditado_usd != null
          ? `Tu clínica tiene poco saldo de IA (USD ${saldoDisponible.toFixed(2)}) — la recarga automática de ` +
            `USD ${Number(config.credito_acreditado_usd).toFixed(2)} se activa apenas el saldo baje de ` +
            `USD ${Number(config.umbral_usd).toFixed(2)}, no hace falta hacer nada.`
          : `Tu clínica tiene poco saldo de IA (USD ${saldoDisponible.toFixed(2)}) — avisale a tu administrador de ` +
            `clínica para recargar.`;
      candidatos.push({ umbral: "saldo_bajo", mensaje });
    }
  }

  if (colchonUsado > 0) {
    candidatos.push({
      umbral: "colchon_agotado",
      mensaje: "Tu clínica agotó el margen de gracia de este ciclo — avisale a tu administrador de clínica para recargar.",
    });
  }

  for (const { umbral, mensaje } of candidatos) {
    const existe = await db.query(
      `SELECT 1 FROM notificaciones_uso
       WHERE tenant_id = $1 AND umbral = $2 AND fecha >= $3 LIMIT 1`,
      [tenantId, umbral, new Date(suscripcion.periodo_inicio).toISOString()]
    );
    if (existe.rows.length > 0) continue;

    await db.query(
      `INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje) VALUES ($1, $2, $3)`,
      [tenantId, umbral, mensaje]
    );
  }
}

// ---------------------------------------------------------------------
// Si la clínica configuró limite_accion='bloquear' y el consumo del ciclo
// ya alcanzó o superó su limite_usd_configurado, la próxima respuesta de
// IA no debe generarse.
// ---------------------------------------------------------------------
export async function debeBloquearseMensaje(db: PoolClient, tenantId: string): Promise<boolean> {
  const estado = await obtenerEstadoUso(db, tenantId);
  if (!estado) return false;

  return (
    estado.limiteAccion === "bloquear" &&
    estado.limiteUsdConfigurado != null &&
    estado.montoUsado >= estado.limiteUsdConfigurado
  );
}
