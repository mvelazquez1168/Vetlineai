import { pool } from "../db";
import { requerirAnthropic } from "../anthropic";
import { HERRAMIENTAS_AGENTE, CACHE_PREFIJO_COMPARTIDO } from "../herramientasAgente";

// Reproduce la llamada que falla con 400 e imprime el mensaje COMPLETO.
// El arnés lo trunca a 60 caracteres, que alcanza para ver que hubo un
// error y no para saber cuál.

const MODELO = "claude-sonnet-4-6";

async function main() {
  const slug = process.argv[2] ?? "endocrino";
  const a = (await pool.query(`SELECT id, system_prompt FROM agentes WHERE slug = $1`, [slug])).rows[0];
  const docs = (
    await pool.query(
      `SELECT nombre, contenido_texto FROM documentos_conocimiento
        WHERE estado='activo' AND incluir_en_contexto = true AND (agente_id IS NULL OR agente_id = $1)
          AND ambito <> 'generacion' ORDER BY fecha_carga DESC, id`,
      [a.id]
    )
  ).rows;
  const system = `${a.system_prompt}\n\n===== BASE DE CONOCIMIENTO =====\n\n${docs
    .map((d) => `--- ${d.nombre} ---\n${d.contenido_texto ?? ""}`)
    .join("\n\n")}`;

  console.log(`agente: ${slug}`);
  console.log(`system: ${system.length.toLocaleString("es")} caracteres  (~${Math.round(system.length / 3.6).toLocaleString("es")} tokens)`);
  console.log(`tools:  ${JSON.stringify(HERRAMIENTAS_AGENTE).length.toLocaleString("es")} caracteres\n`);

  const anthropic = requerirAnthropic();
  try {
    const r = await anthropic.beta.messages.create({
      model: MODELO,
      max_tokens: 1500,
      betas: ["files-api-2025-04-14"],
      system: [{ type: "text", text: system, cache_control: CACHE_PREFIJO_COMPARTIDO }],
      messages: [{ role: "user", content: "Hola, ¿podés confirmar que recibiste el contexto?" }],
      tools: HERRAMIENTAS_AGENTE,
      tool_choice: { type: "none" },
    });
    console.log("OK — la llamada funcionó.");
    console.log("uso:", JSON.stringify((r as any).usage));
  } catch (e: any) {
    console.log("FALLÓ\n");
    console.log("status:", e.status);
    console.log("mensaje completo:\n", e.message);
    if (e.error) console.log("\nerror:", JSON.stringify(e.error, null, 2));
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
