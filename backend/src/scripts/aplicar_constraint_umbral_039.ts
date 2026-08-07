import { pool } from "../db";

async function main() {
  await pool.query(`ALTER TABLE notificaciones_uso DROP CONSTRAINT notificaciones_uso_umbral_check`);
  await pool.query(
    `ALTER TABLE notificaciones_uso ADD CONSTRAINT notificaciones_uso_umbral_check
     CHECK (umbral IN ('saldo_bajo', 'saldo_agotado', 'colchon_agotado',
                       'tope_recargas', 'trial_80', 'trial_agotado',
                       'autorecarga_fallida', 'cobro_fallido', 'suscripcion_suspendida',
                       'cuenta_no_operativa'))`
  );
  console.log("Constraint actualizado.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
