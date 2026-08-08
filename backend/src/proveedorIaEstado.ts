import { pool } from "./db";

// Registra si el proveedor de IA (hoy solo Anthropic) está rechazando
// llamadas reales por falta de crédito, para que Platform Admin lo muestre
// como alerta (ver GET /platform-admin/tarifas/alertas) — sin esto, un
// saldo agotado tumba el chat/Dashboard/Informe/recetas en silencio hasta
// que una clínica real se queja. Anthropic no expone un endpoint para
// consultar el saldo de antemano: la única señal es el error real de la
// próxima llamada, así que se detecta ahí, reactivamente, en cada uno de
// los 4 puntos de llamada real (workspace/casos x2/recetas).
//
// No hay un código de error específico de Anthropic para "sin crédito" —
// llega como 400 invalid_request_error, el mismo tipo que cualquier
// request malformado — así que la única señal utilizable es el texto del
// mensaje (en inglés, controlado por Anthropic, no traducible).
const PROVEEDOR = "anthropic";

function esErrorCreditoAgotado(err: unknown): boolean {
  const mensaje = err instanceof Error ? err.message : String(err);
  return /credit balance is too low/i.test(mensaje);
}

export async function registrarResultadoAnthropic(err: unknown): Promise<void> {
  try {
    if (esErrorCreditoAgotado(err)) {
      await pool.query(
        `INSERT INTO proveedor_ia_estado (proveedor, bloqueado, motivo, detectado_en, actualizado_en)
         VALUES ($1, true, $2, now(), now())
         ON CONFLICT (proveedor) DO UPDATE SET
           bloqueado = true,
           motivo = EXCLUDED.motivo,
           -- detectado_en NO se pisa si ya estaba bloqueado — es la fecha
           -- del primer fallo de esta racha, no del último.
           detectado_en = CASE WHEN proveedor_ia_estado.bloqueado THEN proveedor_ia_estado.detectado_en ELSE now() END,
           actualizado_en = now()`,
        [PROVEEDOR, err instanceof Error ? err.message : String(err)]
      );
    }
  } catch (errInterno) {
    // Nunca deja que un fallo de esta bitácora tape el error real que ya
    // se le está por devolver al médico.
    console.error("[proveedorIaEstado] No se pudo registrar el fallo de Anthropic", errInterno);
  }
}

// Se llama tras cada llamada real EXITOSA — así la alerta se resuelve sola
// apenas se recarga crédito, sin que alguien tenga que apagarla a mano.
export async function registrarExitoAnthropic(): Promise<void> {
  try {
    await pool.query(
      `UPDATE proveedor_ia_estado SET bloqueado = false, actualizado_en = now()
       WHERE proveedor = $1 AND bloqueado = true`,
      [PROVEEDOR]
    );
  } catch (errInterno) {
    console.error("[proveedorIaEstado] No se pudo registrar el éxito de Anthropic", errInterno);
  }
}

export async function obtenerEstadoProveedorIa(): Promise<{
  bloqueado: boolean;
  detectadoEn: Date | null;
} | null> {
  const result = await pool.query(
    `SELECT bloqueado, detectado_en FROM proveedor_ia_estado WHERE proveedor = $1`,
    [PROVEEDOR]
  );
  if (result.rows.length === 0) return null;
  return { bloqueado: result.rows[0].bloqueado, detectadoEn: result.rows[0].detectado_en };
}
