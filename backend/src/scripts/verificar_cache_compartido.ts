import { pool } from "../db";
import { requerirAnthropic } from "../anthropic";
import { obtenerDocumentosParaContexto, construirBloqueDocumentos } from "../routes/casos.routes";
import { CACHE_PREFIJO_COMPARTIDO, HERRAMIENTAS_AGENTE } from "../herramientasAgente";

// ---------------------------------------------------------------------
// ¿Los cuatro caminos comparten UNA sola entrada de caché?
//
// No se puede responder mirando el código: hay que hacer las llamadas y
// leer usage. La primera escribe el caché (cache_creation_input_tokens > 0)
// y las tres siguientes tienen que LEERLO (cache_read_input_tokens > 0 y
// cache_creation ≈ 0). Si alguna vuelve a escribir, no comparten prefijo.
//
// Reproduce el prefijo exacto de cada camino: mismo array de herramientas,
// mismo bloque cacheado, y el tool_choice propio de cada uno (que no debe
// invalidar el caché). Los bloques de system posteriores al breakpoint se
// omiten a propósito: no participan del prefijo cacheado.
//
// Cuesta una escritura real de caché (~$0,84 en un caso de GCIS) más tres
// lecturas. Es el precio de comprobarlo de verdad.
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
  if (!caso) throw new Error("No hay caso para verificar.");

  const cliente = await pool.connect();
  let documentos: any[];
  try {
    documentos = await obtenerDocumentosParaContexto(cliente, caso.agente_id, caso.tenant_id);
  } finally {
    cliente.release();
  }
  const systemCacheado = `${caso.system_prompt}\n\n---\n\n${construirBloqueDocumentos(documentos as any)}`;

  const anthropic = requerirAnthropic();
  const llamar = async (etiqueta: string, toolChoice: any) => {
    const r = await anthropic.beta.messages.create({
      model: MODELO,
      max_tokens: 16,
      betas: ["files-api-2025-04-14"],
      system: [{ type: "text", text: systemCacheado, cache_control: CACHE_PREFIJO_COMPARTIDO }],
      tools: HERRAMIENTAS_AGENTE,
      tool_choice: toolChoice,
      messages: [{ role: "user", content: "Respondé solo: OK" }],
    });
    const u: any = r.usage;
    return {
      etiqueta,
      escritos: u.cache_creation_input_tokens ?? 0,
      leidos: u.cache_read_input_tokens ?? 0,
      sinCachear: u.input_tokens,
    };
  };

  const resultados = [];
  // El orden importa: el primero paga la escritura, los otros tres tienen
  // que encontrarla escrita.
  resultados.push(await llamar("chat (tool_choice none)", { type: "none" }));
  resultados.push(await llamar("dashboard (forzado)", { type: "tool", name: "generar_dashboard" }));
  resultados.push(await llamar("informe (forzado)", { type: "tool", name: "generar_informe" }));
  resultados.push(await llamar("receta (forzado)", { type: "tool", name: "validar_receta" }));

  console.log(`\nCaso ${caso.id} — agente ${caso.agente}\n`);
  console.log("CAMINO                        ESCRITOS   LEÍDOS  SIN CACHEAR");
  console.log("--------------------------------------------------------------");
  for (const r of resultados) {
    console.log(
      r.etiqueta.padEnd(28) +
        String(r.escritos).padStart(9) +
        String(r.leidos).padStart(9) +
        String(r.sinCachear).padStart(13)
    );
  }

  let ok = true;
  const reportar = (n: string, cond: boolean, d?: unknown) => {
    console.log(`[${cond ? "OK" : "FALLO"}] ${n}`, d ?? "");
    if (!cond) ok = false;
  };

  console.log("");
  reportar("El primer camino escribe el caché", resultados[0].escritos > 0, {
    escritos: resultados[0].escritos,
  });
  for (const r of resultados.slice(1)) {
    reportar(`${r.etiqueta} LEE el caché en vez de reescribirlo`, r.leidos > 0 && r.escritos === 0, {
      leidos: r.leidos,
      escritos: r.escritos,
    });
  }

  const escrituras = resultados.filter((r) => r.escritos > 0).length;
  reportar("Hay UNA sola escritura entre los cuatro caminos", escrituras === 1, { escrituras });

  const costoEscritura = (resultados[0].escritos * 3 * 2) / 1_000_000;
  const costoLectura = (resultados[1].leidos * 3 * 0.1) / 1_000_000;
  console.log(
    `\nEscritura única: $${costoEscritura.toFixed(3)} · cada lectura posterior: $${costoLectura.toFixed(3)}`
  );
  console.log(
    `Antes, cada camino escribía la suya: 4 x ~$${costoEscritura.toFixed(3)} = $${(costoEscritura * 4).toFixed(3)}`
  );

  console.log(`\n${ok ? "TODO OK" : "HAY HALLAZGOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
