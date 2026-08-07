import * as fs from "fs";
import * as path from "path";
import { pool } from "../db";

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "040_trial_medicos_incluidos.sql"), "utf-8");
  await pool.query(sql);
  console.log("Migración 040 aplicada.");
  const check = await pool.query(
    `SELECT s.id, t.nombre, s.medicos_contratados FROM suscripciones s JOIN tenants t ON t.suscripcion_id = s.id WHERE s.estado = 'prueba'`
  );
  console.table(check.rows);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
