import fs from "fs";
import path from "path";
import "dotenv/config";
import { Pool } from "pg";

// Ejecutor de migraciones — reemplaza el `node -e ...` inline que vivía en
// package.json#migrate. Reescrito por 3 fallas reales encontradas en el
// primer despliegue a AWS:
//
//   1. No quedaba compilado — ts-node no está en la imagen de producción
//      (Dockerfile.prod hace `npm ci --omit=dev`). Este archivo es un .ts
//      normal bajo src/ (no src/scripts, que tsconfig.build.json excluye
//      del build), así que compila a dist/migrate.js y corre con `node`
//      solo, sin ts-node.
//   2. Cada archivo se mandaba entero con pool.query(), que solo entiende
//      SQL real. La migración 025 traía un bloque de verificación con
//      \echo (meta-comando de psql, no SQL) y fallaba ahí — ya se sacó de
//      ese archivo, pero acá además se rechaza de entrada cualquier
//      migración que vuelva a traer algo así, señalando el archivo exacto
//      en vez de fallar a mitad de ejecución con un error de sintaxis
//      confuso.
//   3. No llevaba registro de lo aplicado — reintentaba TODO desde 001 en
//      cada corrida, chocando con lo que ya existía. Ahora lleva una tabla
//      schema_migrations (creada acá mismo si no existe, no es una
//      migración numerada — el ejecutor es dueño de su propia tabla de
//      control, no al revés) y solo aplica lo que todavía no está
//      registrado ahí.
//
// Uso: node dist/migrate.js (producción) o ts-node --transpile-only
// src/migrate.ts (dev, vía `npm run migrate`).

const MIGRATIONS_DIR = "src/migrations";
// Relativo al CWD (WORKDIR /app en el contenedor), no a __dirname: en
// dist/migrate.js compilado, __dirname apunta a dist/, pero
// Dockerfile.prod copia los .sql a ./src/migrations (archivos planos,
// tsc no los toca) — mismo criterio que ya usaba el runner original.

const PSQL_META_COMANDO = /^\s*\\/m;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const archivos = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const aplicadas = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map(
        (r: { filename: string }) => r.filename
      )
    );

    const pendientes = archivos.filter((f) => !aplicadas.has(f));

    const conMetaComandos = pendientes.filter((f) =>
      PSQL_META_COMANDO.test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    );
    if (conMetaComandos.length > 0) {
      throw new Error(
        `Estas migraciones tienen meta-comandos de psql (\\echo, \\connect, etc.), que no son SQL y este ejecutor no puede correr: ${conMetaComandos.join(
          ", "
        )}. Sacalos del archivo antes de aplicar — son solo para uso interactivo con psql, nunca deberían quedar en una migración versionada.`
      );
    }

    if (pendientes.length === 0) {
      console.log(
        `Nada por aplicar (${archivos.length} migraciones, todas ya registradas en schema_migrations).`
      );
      return;
    }

    console.log(`${pendientes.length} migración(es) pendiente(s) de ${archivos.length} totales.`);
    for (const f of pendientes) {
      console.log(`Aplicando ${f}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
        await client.query("COMMIT");
      } catch (err) {
        // La 025 trae su propio BEGIN/COMMIT interno (histórico, antes de
        // que este ejecutor existiera) — Postgres no anida transacciones:
        // su COMMIT interno cierra esta transacción antes de tiempo, y el
        // INSERT del ledger de acá arriba corre igual, ya auto-commiteado,
        // sin romper nada. Ningún archivo nuevo debería repetir ese patrón.
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Falló ${f}: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log("Migraciones aplicadas.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
