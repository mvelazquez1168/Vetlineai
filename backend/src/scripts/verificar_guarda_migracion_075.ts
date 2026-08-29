import fs from "fs";
import path from "path";
import { pool } from "../db";

// ---------------------------------------------------------------------
// Prueba que la guarda de la migración 075 realmente muerda.
//
// El valor de esa migración no está en el UPDATE (eso es trivial) sino en
// que NO se quede callada cuando no puede aplicar el cambio. Un despliegue
// que corre entero, termina bien y deja el prompt roto es exactamente el
// escenario que hay que evitar. Así que se prueban los tres casos, cada
// uno dentro de una transacción que se revierte.
//
//   1. Prompt corrupto pero distinto del esperado (alguien lo editó)
//      → la migración NO pisa el texto, y LEVANTA EXCEPCIÓN.
//   2. Prompt ya restaurado (segunda corrida)
//      → no cambia nada y no falla.
//   3. Agente sin prompt (base nueva)
//      → no falla; lo siembra seedPlataforma.
//
// No deja ningún efecto: todo va en BEGIN/ROLLBACK.
// ---------------------------------------------------------------------

const ID_GCIS = "fc0adced-e371-4fd3-915e-54344c4fa207";
const SQL = path.join(__dirname, "..", "migrations", "075_prompt_gastroenterologia_restaurado.sql");

async function caso(nombre: string, preparar: string, esperaExcepcion: boolean, sql: string) {
  const client = await pool.connect();
  let resultado = "";
  try {
    await client.query("BEGIN");
    await client.query(preparar, [ID_GCIS]);
    try {
      await client.query(sql);
      resultado = esperaExcepcion ? "FALLO: no levantó excepción" : "OK: pasó sin fallar";
    } catch (e: any) {
      const msg = String(e.message ?? e).split("\n")[0];
      resultado = esperaExcepcion ? `OK: levantó excepción — ${msg.slice(0, 96)}` : `FALLO: excepción inesperada — ${msg}`;
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
  const ok = resultado.startsWith("OK");
  console.log(`   [${ok ? "OK " : "MAL"}] ${nombre}\n         ${resultado}`);
  return ok;
}

async function main() {
  const sql = fs.readFileSync(SQL, "utf8");
  console.log("GUARDA DE LA MIGRACIÓN 075\n");

  const r1 = await caso(
    "prompt corrupto PERO editado a mano (no coincide con el esperado)",
    `UPDATE agentes SET system_prompt = 'Texto editado a mano que todav??a trae residuos' WHERE id = $1`,
    true,
    sql
  );
  const r2 = await caso(
    "prompt ya restaurado (segunda corrida de la migración)",
    `UPDATE agentes SET system_prompt = system_prompt WHERE id = $1`,
    false,
    sql
  );
  const r3 = await caso(
    "agente sin prompt (base nueva: lo siembra seedPlataforma)",
    `UPDATE agentes SET system_prompt = NULL WHERE id = $1`,
    false,
    sql
  );

  const todo = r1 && r2 && r3;
  console.log(`\n   ${todo ? "[OK] 3/3 — la guarda muerde donde tiene que morder." : "[FALLO] revisar antes de desplegar"}`);
  await pool.end();
  process.exit(todo ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
