import cron from "node-cron";
import { pool } from "../db";
import { vencerPresupuestos } from "../ventas/presupuestos";

// ---------------------------------------------------------------------
// VENCER LOS PRESUPUESTOS CUYA VIGENCIA PASÓ — prompt 08b, A1.
//
// El paso a «vencido» es automático: lo pide el prompt y es lo único que
// no puede depender de que alguien abra la pantalla.
//
// POR QUÉ NO ES SOLO UN CÁLCULO AL LEER. Las pantallas YA calculan
// `vencido` sobre la fecha, así que el estado guardado no es lo que hace
// que la lista se vea bien. Es lo que hace que:
//
//   * filtrar por «vencidos» no tenga que recalcular 200 filas;
//   * el dashboard pueda contar cuántos se vencieron sin convertirse,
//     que es el número que dice si los presupuestos sirven o si la
//     clínica los manda y nadie los sigue.
//
// CORRE SOBRE TODAS LAS CLÍNICAS CON EL POOL ADMIN, igual que los demás
// jobs: el `UPDATE` no lleva `tenant_id` porque la condición es la fecha
// y es la misma para todos. Es una de las poquísimas escrituras del
// sistema que cruza clínicas a propósito, y por eso no toca ningún dato
// que no sea el estado derivado de una fecha.
// ---------------------------------------------------------------------

export async function ejecutarJobPresupuestos(): Promise<number> {
  const db = await pool.connect();
  try {
    const vencidos = await vencerPresupuestos(db);
    if (vencidos > 0) {
      console.log(`[jobs:presupuestos] ${vencidos} presupuesto(s) pasaron a vencido.`);
    }
    return vencidos;
  } catch (err) {
    console.error("[jobs:presupuestos] Error al vencer presupuestos", err);
    return 0;
  } finally {
    db.release();
  }
}

// 6:10 AM: diez minutos después del job de notificaciones, para no
// arrancar las dos cosas a la vez sobre la misma base.
export function iniciarJobPresupuestos(): void {
  cron.schedule("10 6 * * *", () => {
    ejecutarJobPresupuestos();
  });
}
