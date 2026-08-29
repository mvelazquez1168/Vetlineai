import { pool } from "../db";
import { requerirAnthropic } from "../anthropic";
import { obtenerDocumentosParaContexto, construirBloqueDocumentos } from "../routes/casos.routes";
import { CACHE_PREFIJO_COMPARTIDO, HERRAMIENTAS_AGENTE } from "../herramientasAgente";

// ---------------------------------------------------------------------
// ¿La partición en dos bloques hace lo que promete?
//
// Lo que hay que probar, y solo se puede probar llamando de verdad y
// leyendo usage:
//   1. El chat manda SOLO el bloque A y lo escribe.
//   2. Dashboard/informe/receta LEEN ese mismo A —no lo reescriben— y
//      además escriben B una vez.
//   3. El segundo camino de generación lee A y B: ninguna reescritura.
//   4. El chat que viene después sigue leyendo A, sin que B lo moleste.
//
// El punto 4 es el que justifica todo el diseño: si el chat tuviera que
// reescribir por culpa de B, la partición sería una pérdida.
//
// Cuesta una escritura de A + una de B, más lecturas.
// ---------------------------------------------------------------------

const MODELO = "claude-sonnet-4-6";

async function main() {
  const casoId = process.argv[2];
  const caso = (
    await pool.query(
      `SELECT c.id, c.agente_id, c.tenant_id, a.nombre AS agente, a.system_prompt
         FROM casos c JOIN agentes a ON a.id = c.agente_id
        WHERE ${casoId ? "c.id = $1" : "a.system_prompt IS NOT NULL"} LIMIT 1`,
      casoId ? [casoId] : []
    )
  ).rows[0];

  const cliente = await pool.connect();
  let docs: Awaited<ReturnType<typeof obtenerDocumentosParaContexto>>;
  try {
    docs = await obtenerDocumentosParaContexto(cliente, caso.agente_id, caso.tenant_id);
  } finally {
    cliente.release();
  }

  const bloqueA = `${caso.system_prompt}\n\n---\n\n${construirBloqueDocumentos(docs.clinicos as any)}`;
  const bloqueB = docs.generacion.length > 0 ? construirBloqueDocumentos(docs.generacion as any) : null;

  console.log(`\nCaso ${caso.id} — agente ${caso.agente}`);
  console.log(`   bloque A: ${docs.clinicos.length} documentos, ${bloqueA.length} caracteres`);
  console.log(`   bloque B: ${docs.generacion.length} documentos, ${bloqueB?.length ?? 0} caracteres`);
  if (!bloqueB) {
    console.log("\n   No hay documentos de ámbito 'generacion': no hay nada que verificar todavía.");
    process.exit(1);
  }

  const anthropic = requerirAnthropic();
  const llamar = async (etiqueta: string, conB: boolean, toolChoice: any) => {
    const r = await anthropic.beta.messages.create({
      model: MODELO,
      max_tokens: 16,
      betas: ["files-api-2025-04-14"],
      system: [
        { type: "text", text: bloqueA, cache_control: CACHE_PREFIJO_COMPARTIDO },
        ...(conB ? [{ type: "text" as const, text: bloqueB, cache_control: CACHE_PREFIJO_COMPARTIDO }] : []),
      ],
      tools: HERRAMIENTAS_AGENTE,
      tool_choice: toolChoice,
      messages: [{ role: "user", content: "Respondé solo: OK" }],
    });
    const u: any = r.usage;
    return {
      etiqueta,
      escritos: u.cache_creation_input_tokens ?? 0,
      leidos: u.cache_read_input_tokens ?? 0,
    };
  };

  const r: Record<string, { etiqueta: string; escritos: number; leidos: number }> = {};
  r.chat1 = await llamar("1. chat (solo A)", false, { type: "none" });
  r.dash = await llamar("2. dashboard (A+B)", true, { type: "tool", name: "generar_dashboard" });
  r.informe = await llamar("3. informe (A+B)", true, { type: "tool", name: "generar_informe" });
  r.receta = await llamar("4. receta (A+B)", true, { type: "tool", name: "validar_receta" });
  r.chat2 = await llamar("5. chat otra vez (solo A)", false, { type: "none" });

  console.log("\nCAMINO                        ESCRITOS    LEÍDOS");
  console.log("------------------------------------------------");
  for (const k of ["chat1", "dash", "informe", "receta", "chat2"]) {
    console.log(r[k].etiqueta.padEnd(30) + String(r[k].escritos).padStart(9) + String(r[k].leidos).padStart(10));
  }

  let ok = true;
  const rep = (n: string, cond: boolean, d?: unknown) => {
    console.log(`[${cond ? "OK" : "FALLO"}] ${n}`, d ?? "");
    if (!cond) ok = false;
  };

  console.log("");
  rep("1. el chat escribe A y no manda B", r.chat1.escritos > 0, { escritos: r.chat1.escritos });
  rep("2. el dashboard LEE la A del chat, no la reescribe", r.dash.leidos >= r.chat1.escritos, {
    leidos: r.dash.leidos,
  });
  rep("2b. el dashboard escribe B (solo la parte nueva)", r.dash.escritos > 0 && r.dash.escritos < r.chat1.escritos, {
    escritos: r.dash.escritos,
  });
  rep("3. el informe lee A+B sin reescribir nada", r.informe.escritos === 0 && r.informe.leidos > r.dash.leidos, {
    escritos: r.informe.escritos,
    leidos: r.informe.leidos,
  });
  rep("4. la receta lee A+B sin reescribir nada", r.receta.escritos === 0, { escritos: r.receta.escritos });
  rep("5. el chat posterior sigue leyendo A, sin reescribir", r.chat2.escritos === 0 && r.chat2.leidos > 0, {
    escritos: r.chat2.escritos,
    leidos: r.chat2.leidos,
  });
  rep("5b. el chat lee SOLO A, no paga B", r.chat2.leidos < r.informe.leidos, {
    chat: r.chat2.leidos,
    generacion: r.informe.leidos,
  });

  const usd = (t: number, m: number) => ((t * 3 * m) / 1_000_000).toFixed(3);
  console.log(`\nUn turno de chat: lee ${r.chat2.leidos} tokens = $${usd(r.chat2.leidos, 0.1)}`);
  console.log(`Antes de partir leía ${r.informe.leidos} = $${usd(r.informe.leidos, 0.1)}`);
  console.log(
    `Escritura fría del chat: $${usd(r.chat1.escritos, 2)} contra $${usd(r.chat1.escritos + r.dash.escritos, 2)} de antes`
  );

  console.log(`\n${ok ? "TODO OK" : "HAY HALLAZGOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
