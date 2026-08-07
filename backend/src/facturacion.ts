import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------
// Único punto de entrada para escribir en eventos_facturacion. Antes de
// esto, cada flujo de pago armaba su propio INSERT a mano (Stripe en dos
// lugares de webhooks.routes.ts, los jobs de cancelación/excedente en
// suscripciones.job.ts, la factura manual en platform-admin.routes.ts) —
// y el de Tilopay en registro.routes.ts directamente nunca lo escribió:
// activaba el tenant sin dejar rastro en facturación. Centralizar acá no
// "arregla" ese INSERT olvidado por sí solo — lo que evita que se repita
// es que ahora hay un solo lugar obvio para llamar en vez de un patrón
// que cada flujo nuevo tiene que reinventar (y puede reinventar mal, u
// olvidar directamente).
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export type TipoEventoFacturacion =
  | "pago_exitoso"
  | "pago_fallido"
  | "cancelacion"
  | "factura_manual"
  | "excedente_aplicado";

export async function registrarEventoFacturacion(
  db: EjecutorSql,
  tenantId: string,
  tipo: TipoEventoFacturacion,
  montoUsd: number | null,
  referenciaExterna: string | null,
  detalle: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO eventos_facturacion (tenant_id, tipo, monto_usd, referencia_externa, detalle)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, tipo, montoUsd, referenciaExterna, detalle]
  );
}
