import { pool } from "../db";
import { registrarEventoFacturacion } from "../facturacion";
import { requerirStripe } from "../stripe";
import { calcularCicloActual, calcularConsumoCiclo } from "../usoIa";

/**
 * Mecanismo GENÉRICO de jobs programados del backend. Es un setInterval
 * simple porque el proyecto no tiene un scheduler real instalado todavía
 * (cron, BullMQ, etc.). En producción esto se reemplaza por eso — no por
 * agregar más setIntervals sueltos.
 */
const INTERVALO_CANCELACIONES_MS = 60_000; // cada 1 minuto
const INTERVALO_TRIALS_MS = 60 * 60_000; // cada 1 hora — "está bien para desarrollo"
const INTERVALO_EXCEDENTE_MS = 24 * 60 * 60_000; // una vez al día

async function procesarCancelacionesVencidas() {
  try {
    const result = await pool.query(
      `UPDATE tenants
       SET estado_suscripcion = 'cancelada'
       WHERE cancelacion_solicitada = true
         AND cancelacion_efectiva_en IS NOT NULL
         AND cancelacion_efectiva_en < now()
         AND estado_suscripcion = 'activa'
       RETURNING id, nombre`
    );
    if (result.rows.length > 0) {
      console.log(
        `[jobs] ${result.rows.length} clínica(s) pasaron a 'cancelada':`,
        result.rows.map((r) => r.nombre).join(", ")
      );
      for (const tenant of result.rows) {
        await registrarEventoFacturacion(
          pool,
          tenant.id,
          "cancelacion",
          null,
          null,
          `Cancelación efectiva de "${tenant.nombre}"`
        );
      }
    }
  } catch (err) {
    console.error("[jobs] Error al procesar cancelaciones vencidas", err);
  }
}

// ---------------------------------------------------------------------
// Excedente de uso de IA: un día antes de que cierre el ciclo de cada
// tenant activo (stripe_periodo_actual_fin, mantenido al día por el
// webhook de Stripe), si el consumo de uso_api superó el presupuesto
// incluido en su plan, se crea un ítem de factura en Stripe por la
// diferencia — Stripe lo adjunta automáticamente a la próxima factura de
// ese customer. Dedupe por mes/año del ciclo: no vuelve a aplicar el
// excedente de un ciclo que ya se facturó, aunque el backend se reinicie
// varias veces el mismo día.
// ---------------------------------------------------------------------
export async function procesarExcedentesDeUso() {
  try {
    const candidatos = await pool.query(
      `SELECT t.id, t.nombre, t.estado_suscripcion, t.trial_termina_en, t.creado_en,
              t.stripe_subscription_id, t.stripe_customer_id, t.stripe_periodo_actual_fin,
              p.presupuesto_usd_incluido, p.nombre AS plan_nombre
       FROM tenants t
       JOIN planes p ON p.id = t.plan_id
       WHERE t.estado_suscripcion = 'activa'
         AND t.stripe_periodo_actual_fin IS NOT NULL
         AND t.stripe_periodo_actual_fin::date = (CURRENT_DATE + interval '1 day')::date`
    );

    for (const tenant of candidatos.rows) {
      try {
        const yaAplicado = await pool.query(
          `SELECT 1 FROM eventos_facturacion
           WHERE tenant_id = $1 AND tipo = 'excedente_aplicado'
             AND date_trunc('month', fecha) = date_trunc('month', $2::timestamptz)
           LIMIT 1`,
          [tenant.id, tenant.stripe_periodo_actual_fin]
        );
        if (yaAplicado.rows.length > 0) continue;

        if (!tenant.stripe_customer_id) {
          console.error(
            `[jobs] "${tenant.nombre}" no tiene stripe_customer_id — no se puede facturar el excedente.`
          );
          continue;
        }

        const ciclo = await calcularCicloActual(tenant);
        const montoUsado = await calcularConsumoCiclo(pool, tenant.id, ciclo);
        const presupuesto =
          tenant.presupuesto_usd_incluido != null ? Number(tenant.presupuesto_usd_incluido) : 0;
        const excedente = montoUsado - presupuesto;

        if (excedente <= 0) continue;

        const stripe = requerirStripe();
        const descripcion = `Excedente de uso de IA — ciclo ${ciclo.cicloFin.toISOString().slice(0, 10)}`;
        await stripe.invoiceItems.create({
          customer: tenant.stripe_customer_id,
          amount: Math.round(excedente * 100),
          currency: "usd",
          description: descripcion,
        });

        await registrarEventoFacturacion(
          pool,
          tenant.id,
          "excedente_aplicado",
          Number(excedente.toFixed(2)),
          null,
          descripcion
        );

        console.log(`[jobs] Excedente de uso aplicado a "${tenant.nombre}": $${excedente.toFixed(2)}`);
      } catch (err) {
        console.error(`[jobs] Error al procesar el excedente de "${tenant.nombre}"`, err);
      }
    }
  } catch (err) {
    console.error("[jobs] Error al procesar excedentes de uso", err);
  }
}

// ---------------------------------------------------------------------
// Conversión de trial vencido: si el admin ya eligió un plan de pago
// (plan_id apunta a un plan con es_plan_prueba=false) se crea la
// suscripción real en Stripe; si no, el tenant pasa a 'trial_expirado'
// (sin borrar nada — el login queda bloqueado con mensaje claro, ver
// auth.routes.ts).
// ---------------------------------------------------------------------
async function procesarTrialsVencidos() {
  try {
    const result = await pool.query(
      `SELECT t.id, t.nombre, t.stripe_customer_id, t.stripe_payment_method_id,
              p.es_plan_prueba, p.stripe_price_id, p.precio_cupo_extra_usd,
              p.cupos_agente_medico, p.nombre AS plan_nombre
       FROM tenants t
       JOIN planes p ON p.id = t.plan_id
       WHERE t.estado_suscripcion = 'prueba' AND t.trial_termina_en < now()`
    );

    for (const tenant of result.rows) {
      if (tenant.es_plan_prueba) {
        await pool.query(
          `UPDATE tenants SET estado_suscripcion = 'ventana_purga' WHERE id = $1`,
          [tenant.id]
        );
        console.log(`[jobs] Trial vencido sin plan elegido: "${tenant.nombre}" -> ventana_purga`);
        continue;
      }

      if (!tenant.stripe_price_id) {
        console.error(
          `[jobs] El plan "${tenant.plan_nombre}" de "${tenant.nombre}" no tiene stripe_price_id ` +
            `configurado todavía — no se puede convertir este trial hasta que se complete."`
        );
        continue;
      }

      try {
        const stripe = requerirStripe();

        const cuposResult = await pool.query(
          `SELECT COUNT(*) FROM medico_agente ma
           JOIN personas per ON per.id = ma.persona_id
           WHERE per.tenant_id = $1 AND ma.habilitado = true`,
          [tenant.id]
        );
        const cuposConsumidos = Number(cuposResult.rows[0].count);
        const cuposExtra = Math.max(cuposConsumidos - tenant.cupos_agente_medico, 0);

        // Ítem base del plan (price ya creado en Stripe) + un segundo
        // ítem de cantidad variable para los cupos extra. Este segundo
        // ítem usa price_data inline en vez de un Price pre-creado porque
        // el precio por cupo extra varía por plan (precio_cupo_extra_usd)
        // y no hay una columna para guardar un price id separado de eso
        // — Stripe permite crear el Price al vuelo sin necesidad de tenerlo
        // configurado de antemano en el dashboard.
        const suscripcion = await stripe.subscriptions.create({
          customer: tenant.stripe_customer_id,
          default_payment_method: tenant.stripe_payment_method_id,
          items: [
            { price: tenant.stripe_price_id },
            {
              price_data: {
                currency: "usd",
                product_data: { name: `Cupos de agente adicionales — ${tenant.plan_nombre}` },
                unit_amount: Math.round(Number(tenant.precio_cupo_extra_usd) * 100),
                recurring: { interval: "month" },
              },
              quantity: cuposExtra,
            },
          ],
        });

        const itemCupos = suscripcion.items.data[1];

        await pool.query(
          `UPDATE tenants
           SET estado_suscripcion = 'activa', stripe_subscription_id = $1, stripe_cupos_item_id = $2
           WHERE id = $3`,
          [suscripcion.id, itemCupos.id, tenant.id]
        );
        console.log(`[jobs] Trial convertido a suscripción activa: "${tenant.nombre}"`);
      } catch (err) {
        console.error(`[jobs] Error al convertir el trial de "${tenant.nombre}" a suscripción real`, err);
      }
    }
  } catch (err) {
    console.error("[jobs] Error al procesar trials vencidos", err);
  }
}

// ---------------------------------------------------------------------
// DESACTIVADO 2026-08-04 — motor de crédito, bloque 5.
//
// Los 3 jobs de este archivo son el modelo viejo completo (Stripe +
// cupos + tenants.estado_suscripcion), desconectado de suscripciones/
// saldos_ia (el modelo que los bloques 1-4 ya usan como única fuente de
// verdad). Seguían corriendo cada minuto/hora/día pese a estar
// desconectados, y ya habían hecho divergir datos reales: Tupets quedó
// con tenants.estado_suscripcion='cancelada' mientras suscripciones.estado
// seguía en 'activa' (el backfill de la migración 025 no trasladó su
// cancelación previa — corregido a mano, ver memoria del proyecto).
//
// Se desactiva la programación acá, no se borra el código: son la
// referencia de la lógica de cupos/Stripe para cuando se adapte el resto
// del código heredado (ver la lista en la memoria del proyecto sobre la
// migración 026 retenida) antes de decidir su baja definitiva.
//
// El reemplazo (ciclo de facturación sobre el modelo nuevo) vive en
// ./ciclo.job.ts.
// ---------------------------------------------------------------------
export function iniciarJobsProgramados() {
  // setInterval(procesarCancelacionesVencidas, INTERVALO_CANCELACIONES_MS);
  // setInterval(procesarTrialsVencidos, INTERVALO_TRIALS_MS);
  // setInterval(procesarExcedentesDeUso, INTERVALO_EXCEDENTE_MS);
}
