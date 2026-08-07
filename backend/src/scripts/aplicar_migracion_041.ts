import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "../db";

async function main() {
  const sql = readFileSync(join(__dirname, "../migrations/041_estados_agentes_paises.sql"), "utf-8");
  await pool.query(sql);
  console.log("Migración 041 aplicada.");

  const agentes = await pool.query(`SELECT id, nombre, estado FROM agentes ORDER BY nombre`);
  console.log("agentes.estado tras la migración:", agentes.rows);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'paises' AND column_name = 'motivo_inactivacion'`
  );
  console.log("paises.motivo_inactivacion existe:", cols.rows.length === 1);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
