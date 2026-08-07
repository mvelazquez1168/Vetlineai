import { PoolClient } from "pg";
import { pool } from "../db";
import type { MotivoFallaCobro } from "./proveedorPagos";
import { emitirDocumentoFiscal } from "./documentoFiscal";
import { confirmarCobroSuscripcionExitoso, confirmarCobroSuscripcionFallido } from "./cicloCobro";
import { confirmarRecargaExitosa, confirmarRecargaFallida } from "./recargas";
import { confirmarUpgradeExitoso, confirmarUpgradeFallido } from "../upgrade";
import { confirmarConversionExitosa, confirmarConversionFallida } from "./conversionPrueba";

// ---------------------------------------------------------------------
// Motor de cobros, Paso 5 — el componente más crítico. Punto ÚNICO por
// el que un cobro puede pasar a exitoso/fallido y disparar sus efectos
// (crédito, plan, cupos, documento fiscal). Nada más en el código llama
// a estas funciones de "confirmar" — ni ejecutarCargo, ni ningún router.
//
// Ya hubo un incidente real con esto: un pago confirmado por la pasarela
// que activó un tenant sin dejar registro. Por eso acá:
//   1. Se REGISTRA SIEMPRE la notificación entrante, exista o no el
//      order_number — un pago que no se puede imputar es un problema,
//      uno que no deja rastro es peor.
//   2. Es IDEMPOTENTE — si `cobros.estado` ya no es 'pendiente' (porque
//      esta misma notificación ya se procesó antes), no se vuelve a
//      aplicar el efecto. La atribución por order_number (único en
//      `cobros`) resuelve sola el país/afiliación: no hace falta un
//      endpoint de callback separado por país.
// ---------------------------------------------------------------------

export interface NotificacionCallback {
  orderNumber: string;
  exito: boolean;
  motivoFalla?: MotivoFallaCobro;
  referenciaExterna?: string;
  mensajeError?: string;
}

export async function procesarNotificacionCallback(notificacion: NotificacionCallback): Promise<void> {
  const notifResult = await pool.query(
    `INSERT INTO notificaciones_callback (order_number, payload) VALUES ($1, $2) RETURNING id`,
    [notificacion.orderNumber, JSON.stringify(notificacion)]
  );
  const notificacionId = notifResult.rows[0].id;

  try {
    const cobroResult = await pool.query(
      `SELECT id, tenant_id, tipo, estado, suscripcion_id, metodo_pago_id, monto, neto_usd, impuesto_usd, moneda,
              periodo_inicio, periodo_fin
       FROM cobros WHERE order_number = $1`,
      [notificacion.orderNumber]
    );
    const cobro = cobroResult.rows[0];

    if (!cobro) {
      await pool.query(`UPDATE notificaciones_callback SET resultado_atribuido = 'huerfano' WHERE id = $1`, [
        notificacionId,
      ]);
      console.error(
        `[callbackCobros] Notificación para order_number "${notificacion.orderNumber}" no coincide con ningún ` +
          `cobro — quedó registrada como huérfana (notificacion ${notificacionId}).`
      );
      return;
    }

    await pool.query(`UPDATE notificaciones_callback SET cobro_id = $1 WHERE id = $2`, [cobro.id, notificacionId]);

    if (cobro.estado !== "pendiente") {
      await pool.query(`UPDATE notificaciones_callback SET resultado_atribuido = 'duplicado' WHERE id = $1`, [
        notificacionId,
      ]);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (notificacion.exito) {
        await client.query(`UPDATE cobros SET estado = 'exitoso', referencia_externa = $1 WHERE id = $2`, [
          notificacion.referenciaExterna ?? null,
          cobro.id,
        ]);
        await aplicarEfectoExitoso(client, cobro);
        // Paso 8 — documento fiscal CON la confirmación, para todo cobro
        // exitoso (no solo suscripción): es lo que permite que la
        // verificación del Paso 9 ("cobros exitosos sin documento fiscal
        // emitido") tenga sentido para cualquier tipo.
        await emitirDocumentoFiscal(client, cobro);
      } else {
        await client.query(
          `UPDATE cobros SET estado = 'fallido', motivo_falla = $1, mensaje_error = $2 WHERE id = $3`,
          [notificacion.motivoFalla ?? null, notificacion.mensajeError ?? null, cobro.id]
        );
        await aplicarEfectoFallido(client, cobro, notificacion.motivoFalla);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await pool.query(`UPDATE notificaciones_callback SET resultado_atribuido = 'atribuido' WHERE id = $1`, [
      notificacionId,
    ]);
  } catch (err) {
    await pool.query(`UPDATE notificaciones_callback SET resultado_atribuido = 'error', error = $1 WHERE id = $2`, [
      err instanceof Error ? err.message : String(err),
      notificacionId,
    ]);
    console.error(`[callbackCobros] Error procesando la notificación de "${notificacion.orderNumber}"`, err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function aplicarEfectoExitoso(client: PoolClient, cobro: any): Promise<void> {
  switch (cobro.tipo) {
    case "suscripcion":
      return confirmarCobroSuscripcionExitoso(client, cobro);
    case "recarga":
      return confirmarRecargaExitosa(client, cobro);
    case "prorrateo_upgrade":
      return confirmarUpgradeExitoso(client, cobro);
    case "conversion_prueba":
      return confirmarConversionExitosa(client, cobro);
    case "ajuste":
      return;
    default:
      console.error(`[callbackCobros] Tipo de cobro desconocido "${cobro.tipo}" en cobro ${cobro.id} — sin efecto aplicado.`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function aplicarEfectoFallido(client: PoolClient, cobro: any, motivoFalla?: MotivoFallaCobro): Promise<void> {
  switch (cobro.tipo) {
    case "suscripcion":
      return confirmarCobroSuscripcionFallido(client, cobro, motivoFalla);
    case "recarga":
      return confirmarRecargaFallida(client, cobro);
    case "prorrateo_upgrade":
      return confirmarUpgradeFallido(client, cobro);
    case "conversion_prueba":
      return confirmarConversionFallida(client, cobro);
    case "ajuste":
      return;
    default:
      console.error(`[callbackCobros] Tipo de cobro desconocido "${cobro.tipo}" en cobro ${cobro.id} — sin efecto aplicado.`);
  }
}
