// Relevamiento de esquema antes de escribir la migración 039.
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/relevamiento_schema_correo.ts
import { pool } from "../db";

async function main() {
  const constraintName = await pool.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'correos_enviados'::regclass AND contype = 'c'`
  );
  console.log("Constraints CHECK de correos_enviados:", constraintName.rows);

  const columnasPersonas = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'personas' ORDER BY ordinal_position`
  );
  console.log(
    "\nColumnas de personas:",
    columnasPersonas.rows.map((r) => r.column_name).join(", ")
  );

  const columnasTenants = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants' AND column_name LIKE '%purga%' OR column_name LIKE '%aviso%' OR column_name LIKE '%trial%'`
  );
  console.log("\nColumnas relevantes de tenants:", columnasTenants.rows.map((r) => r.column_name).join(", "));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
