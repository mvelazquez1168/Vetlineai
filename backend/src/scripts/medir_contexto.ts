import { pool } from "../db";
import { requerirAnthropic } from "../anthropic";
import { obtenerDocumentosParaContexto } from "../routes/casos.routes";
import { construirBloqueContextoCaso } from "../contextoCaso";
import { construirBloqueRazaDocumento } from "../razaDocumento";
import { construirMensajesParaModelo } from "../archivosDelCaso";

// ---------------------------------------------------------------------
// Desglose real del contexto que se le manda al agente, en tokens.
//
// No estima por caracteres: cada bloque se mide con
// /v1/messages/count_tokens del mismo modelo que usa el chat, que es el
// único número que coincide con lo que después se factura.
//
// Uso:
//   npx ts-node --transpile-only src/scripts/medir_contexto.ts [casoId]
//
// Sin casoId toma el caso con más mensajes de un agente que tenga
// system_prompt (los que hacen llamadas reales).
// ---------------------------------------------------------------------

const MODELO = "claude-sonnet-4-6";

async function contar(system: any[], messages: any[]): Promise<number> {
  const r = await requerirAnthropic().messages.countTokens({
    model: MODELO,
    system: system as any,
    messages: messages.length > 0 ? (messages as any) : [{ role: "user", content: "." }],
  });
  return r.input_tokens;
}

async function main() {
  const casoIdArg = process.argv[2];
  const casoResult = await pool.query(
    casoIdArg
      ? `SELECT c.id, c.agente_id, c.tenant_id, a.nombre AS agente, a.system_prompt
           FROM casos c JOIN agentes a ON a.id = c.agente_id WHERE c.id = $1`
      : `SELECT c.id, c.agente_id, c.tenant_id, a.nombre AS agente, a.system_prompt
           FROM casos c
           JOIN agentes a ON a.id = c.agente_id
          WHERE a.system_prompt IS NOT NULL
          ORDER BY (SELECT COUNT(*) FROM mensajes m WHERE m.caso_id = c.id) DESC
          LIMIT 1`,
    casoIdArg ? [casoIdArg] : []
  );
  if (casoResult.rows.length === 0) throw new Error("No se encontró un caso para medir.");
  const caso = casoResult.rows[0];

  // Mismas llamadas que hace el chat real (workspace.routes.ts).
  const cliente = await pool.connect();
  let documentos: any[];
  let bloqueContextoCaso: string;
  let bloqueRaza: string;
  let historial: Awaited<ReturnType<typeof construirMensajesParaModelo>>;
  try {
    documentos = (await obtenerDocumentosParaContexto(cliente, caso.agente_id, caso.tenant_id)).todos;
    bloqueContextoCaso = await construirBloqueContextoCaso(cliente, caso.id);
    bloqueRaza = (await construirBloqueRazaDocumento(cliente, caso.id, caso.tenant_id)) ?? "";
    historial = await construirMensajesParaModelo(cliente, caso.id);
  } finally {
    cliente.release();
  }

  const conTexto = documentos.filter((d: any) => d.contenido_texto);
  const sinTexto = documentos.filter((d: any) => !d.contenido_texto);
  const bloqueDocumentos =
    "Documentos de referencia (contenido completo) para este caso:\n\n" +
    conTexto.map((d: any) => `### ${d.nombre} (${d.tipo})\n${d.contenido_texto}`).join("\n\n---\n\n");

  const vacio: any[] = [];
  // Se mide por diferencia contra un pedido mínimo: así cada número ya
  // incluye el costo de estructura que la API cobra por ese bloque, en vez
  // de medir el texto suelto y que la suma no cierre contra el total.
  const base = await contar([{ type: "text", text: "." }], vacio);

  const medir = async (texto: string) =>
    texto ? (await contar([{ type: "text", text: texto }], vacio)) - base : 0;

  const tokensPrompt = await medir(caso.system_prompt);
  const tokensDocumentos = await medir(bloqueDocumentos);
  const tokensContextoCaso = await medir(bloqueContextoCaso);
  const tokensRaza = await medir(bloqueRaza);
  // count_tokens rechaza bloques con source de tipo file ("File sources
  // are not supported in the token counting endpoint"), así que el
  // historial se mide solo por su texto y los adjuntos se informan
  // aparte: su costo real solo se ve en usage.input_tokens de una llamada
  // de verdad. No se estima acá para no mezclar un número medido con uno
  // inventado en la misma tabla.
  let adjuntosEnHistorial = 0;
  const historialSoloTexto = historial.mensajes.map((m) => {
    if (typeof m.content === "string") return m;
    const bloques = m.content.filter((b: any) => {
      if (b.type === "text") return true;
      adjuntosEnHistorial++;
      return false;
    });
    return { ...m, content: bloques.length > 0 ? bloques : "." };
  });
  const tokensHistorial = (await contar([{ type: "text", text: "." }], historialSoloTexto as any)) - base;

  // Por documento, para saber qué recortar.
  const porDocumento: { nombre: string; tokens: number }[] = [];
  for (const d of conTexto) {
    porDocumento.push({
      nombre: d.nombre,
      tokens: await medir(`### ${d.nombre} (${d.tipo})\n${d.contenido_texto}`),
    });
  }
  porDocumento.sort((a, b) => b.tokens - a.tokens);

  const total = tokensPrompt + tokensDocumentos + tokensContextoCaso + tokensRaza + tokensHistorial;

  console.log(`\nCaso ${caso.id} — agente ${caso.agente}\n`);
  console.log("COMPONENTE                                     TOKENS      %");
  console.log("-------------------------------------------------------------");
  const linea = (n: string, t: number) =>
    console.log(
      n.padEnd(45) + String(t).padStart(8) + (total ? ((t / total) * 100).toFixed(1) : "0").padStart(7) + "%"
    );
  linea("System prompt del agente", tokensPrompt);
  linea(`Documentos de conocimiento (${conTexto.length})`, tokensDocumentos);
  linea("Contexto del caso (paciente, atenciones)", tokensContextoCaso);
  linea("Predisposiciones raciales (selectivo)", tokensRaza);
  linea("Historial del caso (solo texto)", tokensHistorial);
  console.log("-------------------------------------------------------------");
  linea("TOTAL", total);

  if (adjuntosEnHistorial > 0) {
    console.log(
      `\nADEMÁS: ${adjuntosEnHistorial} adjunto(s) viajan en el historial y NO están en el total ` +
        `de arriba — count_tokens no los acepta. Un PDF de páginas escaneadas puede pesar miles de ` +
        `tokens cada uno; el número real sale de usage.input_tokens de una llamada real.`
    );
  }

  console.log(`\nCACHEADO (prompt + documentos): ${tokensPrompt + tokensDocumentos} tokens`);
  console.log(`NO CACHEADO (resto, se recalcula por llamada): ${total - tokensPrompt - tokensDocumentos}`);

  console.log("\nDESGLOSE POR DOCUMENTO");
  console.log("-------------------------------------------------------------");
  for (const d of porDocumento) {
    console.log(String(d.tokens).padStart(8) + "  " + d.nombre.slice(0, 62));
  }
  if (sinTexto.length > 0) {
    console.log(`\n(${sinTexto.length} documento(s) sin contenido_texto: solo se nombran, no pesan)`);
  }

  // Lo que está excluido hoy por incluir_en_contexto=false, para saber
  // cuánto se está ahorrando ya y cuánto costaría volver a incluirlo.
  const excluidos = await pool.query(
    `SELECT nombre, COALESCE(length(contenido_texto),0) AS chars
       FROM documentos_conocimiento
      WHERE estado = 'activo' AND incluir_en_contexto = false
        AND (agente_id IS NULL OR agente_id = $1)
      ORDER BY chars DESC`,
    [caso.agente_id]
  );
  if (excluidos.rows.length > 0) {
    console.log("\nEXCLUIDOS HOY POR incluir_en_contexto = false (aplican a este agente)");
    console.log("-------------------------------------------------------------");
    for (const d of excluidos.rows) {
      const t = await medir(`### ${d.nombre}\n${"x".repeat(0)}`);
      console.log(String(d.chars).padStart(8) + " chars  " + String(d.nombre).slice(0, 55));
      void t;
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
