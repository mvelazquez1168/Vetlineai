import { pool } from "../db";
import { requerirAnthropic } from "../anthropic";
import { obtenerDocumentosParaContexto, construirBloqueDocumentos } from "../routes/casos.routes";
import {
  DASHBOARD_TOOL,
  HERRAMIENTAS_AGENTE,
  INFORME_TOOL,
  VALIDAR_RECETA_TOOL,
} from "../herramientasAgente";

// ---------------------------------------------------------------------
// ¿Pueden los cuatro caminos (chat, dashboard, informe, receta) compartir
// una sola entrada de caché?
//
// El caché es un match de PREFIJO y el orden de render es
// tools → system → messages. Para compartir, todo lo que va antes del
// breakpoint —y el bloque del breakpoint— tiene que ser idéntico byte a
// byte. Eso son dos condiciones:
//   1. El texto del bloque cacheado (system prompt + documentos).
//   2. El array `tools`, que se renderiza ANTES del system.
//
// Este script mide las dos por separado, con el objeto real de cada
// camino (no una copia transcripta que podría haber derivado).
// ---------------------------------------------------------------------

const MODELO = "claude-sonnet-4-6";

async function tokens(opciones: { system?: any[]; tools?: any[] }): Promise<number> {
  const r = await requerirAnthropic().messages.countTokens({
    model: MODELO,
    system: opciones.system as any,
    tools: opciones.tools as any,
    messages: [{ role: "user", content: "." }],
  });
  return r.input_tokens;
}

async function main() {
  const casoId = process.argv[2];
  const casoResult = await pool.query(
    `SELECT c.id, c.agente_id, c.tenant_id, a.nombre AS agente, a.system_prompt
       FROM casos c JOIN agentes a ON a.id = c.agente_id
      WHERE ${casoId ? "c.id = $1" : "a.system_prompt IS NOT NULL"}
      LIMIT 1`,
    casoId ? [casoId] : []
  );
  const caso = casoResult.rows[0];
  if (!caso) throw new Error("No hay caso para analizar.");

  const cliente = await pool.connect();
  let documentos: any[];
  try {
    documentos = (await obtenerDocumentosParaContexto(cliente, caso.agente_id, caso.tenant_id)).todos;
  } finally {
    cliente.release();
  }

  // ---------------------------------------------------------------
  // 1. El texto cacheado: ¿lo arma igual el chat que los otros tres?
  //
  // El chat lo construye en línea dentro del handler; dashboard, informe
  // y receta usan construirBloqueDocumentos(). Se reproducen las dos
  // formas y se comparan carácter por carácter — si difieren aunque sea
  // en un espacio, nunca van a compartir caché por más que igualemos las
  // herramientas.
  // ---------------------------------------------------------------
  const conTexto = documentos.filter((d: any) => d.contenido_texto);
  const sinTexto = documentos.filter((d: any) => !d.contenido_texto);
  const bloqueEnLinea =
    documentos.length === 0
      ? "No hay documentos de referencia adicionales cargados para este agente/país."
      : [
          conTexto.length > 0
            ? "Documentos de referencia (contenido completo) para este caso:\n\n" +
              conTexto.map((d: any) => `### ${d.nombre} (${d.tipo})\n${d.contenido_texto}`).join("\n\n---\n\n")
            : null,
          sinTexto.length > 0
            ? "Documentos de referencia mencionados pero sin contenido de texto cargado " +
              "todavía (solo metadata):\n" +
              sinTexto.map((d: any) => `- ${d.nombre} (${d.tipo}): ${d.archivo_ref}`).join("\n")
            : null,
        ]
          .filter((b): b is string => b !== null)
          .join("\n\n");

  const bloqueCompartido = construirBloqueDocumentos(documentos as any);
  const systemChat = `${caso.system_prompt}\n\n---\n\n${bloqueEnLinea}`;
  const systemOtros = `${caso.system_prompt}\n\n---\n\n${bloqueCompartido}`;

  console.log(`\nCaso ${caso.id} — agente ${caso.agente}\n`);
  console.log("1. TEXTO DEL BLOQUE CACHEADO");
  console.log("-------------------------------------------------------------");
  const iguales = systemChat === systemOtros;
  console.log(`   chat vs dashboard/informe/receta: ${iguales ? "IDÉNTICO" : "DISTINTO"}`);
  console.log(`   longitud: ${systemChat.length} vs ${systemOtros.length} caracteres`);
  if (!iguales) {
    const i = [...systemChat].findIndex((c, idx) => c !== systemOtros[idx]);
    console.log(`   primer carácter distinto en la posición ${i}:`);
    console.log(`     chat : ${JSON.stringify(systemChat.slice(Math.max(0, i - 40), i + 40))}`);
    console.log(`     otros: ${JSON.stringify(systemOtros.slice(Math.max(0, i - 40), i + 40))}`);
  }

  // ---------------------------------------------------------------
  // 2. Las herramientas: cuánto pesa cada una y cuánto costaría que los
  //    cuatro manden el mismo array (la única forma de compartir prefijo).
  // ---------------------------------------------------------------
  const soloSystem = await tokens({ system: [{ type: "text", text: "." }] });
  const costoTool = async (tool: any) =>
    (await tokens({ system: [{ type: "text", text: "." }], tools: [tool] })) - soloSystem;

  const dash = await costoTool(DASHBOARD_TOOL);
  const inf = await costoTool(INFORME_TOOL);
  const rec = await costoTool(VALIDAR_RECETA_TOOL);
  // La unión real que mandan los cuatro caminos, no una reconstruida acá.
  const union =
    (await tokens({ system: [{ type: "text", text: "." }], tools: HERRAMIENTAS_AGENTE })) - soloSystem;

  console.log("\n2. HERRAMIENTAS (se renderizan ANTES del system)");
  console.log("-------------------------------------------------------------");
  console.log(`   generar_dashboard          ${String(dash).padStart(7)} tokens`);
  console.log(`   generar_informe            ${String(inf).padStart(7)} tokens`);
  console.log(`   validar_receta             ${String(rec).padStart(7)} tokens`);
  console.log(`   UNIÓN DE LAS TRES          ${String(union).padStart(7)} tokens`);

  const bloque = (await tokens({ system: [{ type: "text", text: systemChat }] })) -
    (await tokens({ system: [{ type: "text", text: "." }] }));

  // Precios de Sonnet 4.6: $3/MTok entrada; escritura 5m = 1,25x,
  // escritura 1h = 2x, lectura = 0,1x.
  const usd = (t: number, mult: number) => ((t * 3 * mult) / 1_000_000).toFixed(3);

  console.log("\n3. COSTO POR ESCRITURA DEL BLOQUE CACHEADO");
  console.log("-------------------------------------------------------------");
  console.log(`   bloque actual (sin tools)          ${bloque} tokens`);
  console.log(`     escritura 5 min (1,25x)          $${usd(bloque, 1.25)}`);
  console.log(`     escritura 1 hora (2x)            $${usd(bloque, 2)}`);
  console.log(`     lectura (0,1x)                   $${usd(bloque, 0.1)}`);
  console.log(`   bloque + unión de tools            ${bloque + union} tokens`);
  console.log(`     escritura 1 hora (2x)            $${usd(bloque + union, 2)}`);
  console.log(`     lectura (0,1x)                   $${usd(bloque + union, 0.1)}`);

  console.log("\n4. ESCENARIOS (un análisis + un dashboard sobre el mismo caso)");
  console.log("-------------------------------------------------------------");
  const hoyChat = Number(usd(bloque, 2));
  const hoyDash = Number(usd(bloque, 1.25));
  console.log(`   HOY: chat escribe a 1h ($${hoyChat}) + dashboard escribe`);
  console.log(`        el suyo a 5min ($${hoyDash})            = $${(hoyChat + hoyDash).toFixed(3)}`);
  const unifEscritura = Number(usd(bloque + union, 2));
  const unifLectura = Number(usd(bloque + union, 0.1));
  console.log(`   UNIFICADO: una escritura ($${unifEscritura}) + una lectura`);
  console.log(`        ($${unifLectura})                        = $${(unifEscritura + unifLectura).toFixed(3)}`);
  console.log(
    `   AHORRO por par de llamadas: $${(hoyChat + hoyDash - unifEscritura - unifLectura).toFixed(3)}`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
