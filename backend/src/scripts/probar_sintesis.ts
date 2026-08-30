import { pool } from "../db";
import { obtenerSintesisParaDashboard, obtenerSintesisParaInforme } from "../generarSintesis";
import { estadoSintesis } from "../sintesisClinica";
import { SINTESIS_TOOL } from "../sintesisClinica";

// Prueba del Paso 3 sobre un caso real: la síntesis se genera cuando hace
// falta, no se regenera cuando está vigente, y deja de estarlo cuando el
// caso avanza.
//
// Con --limpiar borra la síntesis del caso antes de empezar, para poder
// repetir la prueba desde cero.

async function main() {
  const client = await pool.connect();
  try {
    const caso = (
      await client.query(
        `SELECT c.id, c.motivo, count(m.id)::int mensajes
           FROM casos c JOIN agentes a ON a.id = c.agente_id
           LEFT JOIN mensajes m ON m.caso_id = c.id
          WHERE a.system_prompt IS NOT NULL AND c.estado <> 'completado'
          GROUP BY c.id, c.motivo ORDER BY count(m.id) DESC LIMIT 1`
      )
    ).rows[0];
    const tenant = (await client.query(`SELECT tenant_id FROM casos WHERE id = $1`, [caso.id])).rows[0]?.tenant_id
      ?? (await client.query(`SELECT id FROM tenants LIMIT 1`)).rows[0].id;

    console.log(`Caso: ${String(caso.id).slice(0, 8)} · ${caso.mensajes} mensajes · ${String(caso.motivo).slice(0, 50)}\n`);

    if (process.argv.includes("--limpiar")) {
      await client.query(
        `UPDATE casos SET sintesis = NULL, sintesis_huella = NULL, sintesis_generada_en = NULL WHERE id = $1`,
        [caso.id]
      );
      console.log("síntesis previa borrada\n");
    }

    // 1. No hay síntesis: se genera.
    const e0 = await estadoSintesis(client, caso.id);
    console.log(`1. antes: existe=${e0.existe} vigente=${e0.vigente}`);
    const t0 = Date.now();
    const r1 = await obtenerSintesisParaDashboard(client, caso.id, tenant);
    console.log(`   generó: ${r1.seGenero}   en ${Math.round((Date.now() - t0) / 1000)} s`);
    if (r1.usage) {
      const u = r1.usage;
      console.log(`   tokens: entrada ${u.input_tokens} · caché escrito ${u.cache_creation_input_tokens ?? 0} · caché leído ${u.cache_read_input_tokens ?? 0} · salida ${u.output_tokens}`);
    }

    // 2. Cobertura: qué campos llegaron y cuáles vinieron en null.
    const esperados = Object.keys(SINTESIS_TOOL.input_schema.properties);
    const llegaron = esperados.filter((k) => r1.sintesis[k] !== undefined);
    const conDatos = esperados.filter((k) => r1.sintesis[k] !== undefined && r1.sintesis[k] !== null);
    console.log(`\n2. campos del esquema: ${esperados.length} · presentes: ${llegaron.length} · con datos: ${conDatos.length}`);
    const ausentes = esperados.filter((k) => r1.sintesis[k] === undefined);
    if (ausentes.length) console.log(`   AUSENTES del JSON: ${ausentes.join(", ")}`);
    const enNull = esperados.filter((k) => r1.sintesis[k] === null);
    if (enNull.length) console.log(`   en null: ${enNull.join(", ")}`);

    // 3. Segunda llamada: no debe regenerar.
    const t1 = Date.now();
    const r2 = await obtenerSintesisParaDashboard(client, caso.id, tenant);
    console.log(`\n3. segunda llamada: generó=${r2.seGenero}${r2.seGenero ? "  ← DEBERÍA SER false" : ""}   en ${Date.now() - t1} ms`);

    // 4. El caso avanza: deja de estar vigente.
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO mensajes (caso_id, remitente, tipo, contenido)
       VALUES ($1, 'medico', 'consulta', 'un dato nuevo que cambia el caso')`,
      [caso.id]
    );
    const e2 = await estadoSintesis(client, caso.id);
    console.log(`4. tras un mensaje nuevo: vigente=${e2.vigente}${e2.vigente ? "  ← DEBERÍA SER false" : ""}`);
    await client.query("ROLLBACK");

    const ok = r1.seGenero && !r2.seGenero && !e2.vigente && ausentes.length === 0;
    console.log(`\n${ok ? "[OK] la síntesis se genera cuando hace falta y no cuando no." : "[FALLO] revisar"}`);
    process.exit(ok ? 0 : 1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("ERROR", e.message ?? e); process.exit(1); });
