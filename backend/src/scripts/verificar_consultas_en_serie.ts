// Una consulta a la vez por conexión — punto 8 del 2026-11-27.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_consultas_en_serie.ts
//
// SIN --transpile-only.
//
// Prueba las dos mitades del arreglo, y las prueba DISPARANDO el
// problema de verdad en vez de leyendo código:
//
//   1. que un cliente pelado con `Promise.all` emite el aviso de `pg`
//      —si no lo emitiera, el resto de esta prueba no probaría nada—;
//   2. que el mismo `Promise.all` a través de `enSerie` NO lo emite;
//   3. que las consultas igual devuelven lo suyo, en orden y sin
//      mezclarse.

import { pool } from "../db";
import { enSerie } from "../clienteEnSerie";
import {
  exigirEntornoDeDesarrollo,
  seEsperaElAvisoDeConcurrencia,
} from "./guardaDesarrollo";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

/** Corre algo y dice si `pg` se quejó de consultas superpuestas. */
async function seQuejaPg(fn: () => Promise<unknown>): Promise<boolean> {
  let hubo = false;
  const escucha = (aviso: Error) => {
    if (/already executing a query/i.test(aviso.message)) hubo = true;
  };
  process.on("warning", escucha);
  try {
    await fn();
  } finally {
    // El aviso llega en el siguiente turno del bucle de eventos.
    await new Promise((r) => setImmediate(r));
    process.off("warning", escucha);
  }
  return hubo;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_consultas_en_serie");
  // Acá el aviso se provoca a propósito: es el control de la prueba.
  seEsperaElAvisoDeConcurrencia();

  // Node emite cada aviso de obsolescencia UNA sola vez por proceso.
  // Sin esto, la segunda mitad de la prueba «pasaría» porque el aviso
  // ya se gastó, no porque el arreglo funcione.
  process.noDeprecation = false;
  (process as unknown as { throwDeprecation?: boolean }).throwDeprecation = false;

  const crudo = await pool.connect();
  try {
    console.log("\n=== Sin el arreglo: pg se queja ===");
    // TRES, no dos, y el detalle importa: `pg` avisa cuando la COLA ya
    // tiene algo al encolar (`_queryQueue.length > 0`, client.js:713).
    // La primera consulta sale de la cola enseguida, así que con dos no
    // hay aviso. Con tres sí — y por eso el aviso del log salía en los
    // `Promise.all` grandes (los catálogos de inventario son seis) y no
    // en los de dos.
    const sePorta = await seQuejaPg(() =>
      Promise.all([
        crudo.query("SELECT pg_sleep(0.05)"),
        crudo.query("SELECT 2 AS b"),
        crudo.query("SELECT 3 AS c"),
      ])
    );
    assert(
      sePorta,
      "un Promise.all de tres sobre el cliente pelado dispara el aviso de pg (si esto falla, la prueba de abajo no prueba nada)"
    );
  } finally {
    crudo.release();
  }

  const envuelto = await pool.connect();
  try {
    console.log("\n=== Con enSerie: no se queja ===");
    let resultados: Array<{ rows: Array<Record<string, number>> }> = [];
    const serio = enSerie(envuelto);
    const hubo = await seQuejaPg(async () => {
      resultados = (await Promise.all([
        serio.query("SELECT pg_sleep(0.05)"),
        serio.query("SELECT 2 AS b"),
        serio.query("SELECT 3 AS c"),
        serio.query("SELECT 4 AS d"),
      ])) as Array<{ rows: Array<Record<string, number>> }>;
    });
    assert(!hubo, "el mismo Promise.all a través de enSerie NO dispara el aviso");
    assert(
      resultados.length === 4 &&
        Number(resultados[1].rows[0].b) === 2 &&
        Number(resultados[2].rows[0].c) === 3 &&
        Number(resultados[3].rows[0].d) === 4,
      "y cada consulta devuelve LO SUYO, en su orden",
      resultados.map((r) => Object.values(r.rows[0])[0])
    );

    // Un error en una no envenena la cola.
    let fallo: unknown = null;
    try {
      await serio.query("SELECT * FROM una_tabla_que_no_existe");
    } catch (err) {
      fallo = err;
    }
    assert(!!fallo, "una consulta que falla le entrega el error a quien la hizo");
    const despues = await serio.query("SELECT 9 AS d");
    assert(
      Number((despues.rows[0] as Record<string, number>).d) === 9,
      "y la siguiente de la fila sigue funcionando"
    );
  } finally {
    envuelto.release();
  }

  await pool.end();
  console.log(ok ? "\nTodo OK." : "\nHAY FALLOS.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
