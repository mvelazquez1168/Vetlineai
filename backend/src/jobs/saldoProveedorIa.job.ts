import cron from "node-cron";
import { pool } from "../db";
import { verificarYNotificarSaldoBajo } from "../saldoProveedorIa";

// ---------------------------------------------------------------------
// prompt_code_panel_consumo_sin_api, Paso 3 — aviso de saldo bajo.
// Corre después de los demás jobs diarios (5-9 AM) para que el saldo
// derivado ya refleje el consumo/crédito procesado ese día.
// ---------------------------------------------------------------------
export function iniciarJobSaldoProveedorIa() {
  cron.schedule("0 10 * * *", () => {
    verificarYNotificarSaldoBajo(pool).catch((err) =>
      console.error("[saldoProveedorIa.job] Error en el job de saldo del proveedor de IA", err)
    );
  });
}
