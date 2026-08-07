import * as fs from "fs";
import * as path from "path";
import { pool } from "../db";

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "039_verificacion_correo.sql"), "utf-8");
  await pool.query(sql);
  console.log("Migración 039 aplicada.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
