import { pool } from "../db";

// ---------------------------------------------------------------------
// ¿La sección "AI Behaviour" del catálogo se superpone con el
// system_prompt del agente, y qué tienen los otros agentes en su lugar?
//
// Las dos cosas describen cómo razonar. Duplicación cuesta tokens;
// contradicción es peor: el agente recibe dos instrucciones incompatibles
// sobre lo mismo y no hay forma de saber cuál gana.
//
// La comparación se hace sobre texto normalizado (sin acentos, sin signos
// de interrogación sueltos, minúsculas, espacios colapsados) porque el
// system_prompt de GCIS está corrupto: perdió todos los acentos y quedaron
// como '?'. Sin normalizar, ninguna frase coincidiría nunca.
//
// Solo reporta. No modifica nada.
// ---------------------------------------------------------------------

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\?/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const frases = (s: string) =>
  s
    .split(/(?<=[.:;])\s+|\n+/)
    .map((f) => normalizar(f))
    .filter((f) => f.split(" ").length >= 6);

// Directivas: lo que manda o prohíbe. Son las que pueden contradecirse.
const DIRECTIVA = /\b(nunca|siempre|debe|debera|deberas|no debe|prohibido|jamas|obligatori)/;

async function main() {
  const agentes = (
    await pool.query(
      `SELECT nombre, system_prompt FROM agentes WHERE system_prompt IS NOT NULL ORDER BY nombre`
    )
  ).rows;

  const catalogos = (
    await pool.query(
      `SELECT a.nombre AS agente, d.nombre AS doc, d.contenido_texto AS t
         FROM documentos_conocimiento d JOIN agentes a ON a.id = d.agente_id
        WHERE d.nombre ILIKE '%Components Catalog%' AND d.estado = 'activo'`
    )
  ).rows;

  // Extrae el texto de todas las secciones "N. AI Behaviour" de un catálogo.
  const seccionesAiBehaviour = (texto: string): string => {
    const lineas = texto.split("\n");
    const partes: string[] = [];
    let dentro = false;
    for (const l of lineas) {
      if (/^\d+\.\s+AI Behaviour\s*$/.test(l)) {
        dentro = true;
        continue;
      }
      // Cualquier otro encabezado numerado cierra la sección.
      if (dentro && /^\d+\.\s+\S/.test(l)) dentro = false;
      // Un componente nuevo también la cierra.
      if (dentro && /^CC-\d+\s/.test(l)) dentro = false;
      if (dentro) partes.push(l);
    }
    return partes.join("\n");
  };

  console.log("\n=== 1. QUÉ TIENE CADA AGENTE COMO GUÍA DE RAZONAMIENTO ===\n");
  console.log("AGENTE                        PROMPT   AI BEHAVIOUR   RAZÓN/PROMPT");
  console.log("--------------------------------------------------------------------");
  const aiPorAgente = new Map<string, string>();
  for (const a of agentes) {
    const cat = catalogos.find((c: any) => c.agente === a.nombre);
    const ai = cat ? seccionesAiBehaviour(cat.t) : "";
    aiPorAgente.set(a.nombre, ai);
    const ratio = ai.length ? (ai.length / a.system_prompt.length).toFixed(1) + "x" : "—";
    console.log(
      String(a.nombre).slice(0, 28).padEnd(30) +
        String(a.system_prompt.length).padStart(7) +
        String(ai.length).padStart(15) +
        ratio.padStart(15)
    );
  }

  console.log("\n=== 2. SUPERPOSICIÓN CON EL SYSTEM_PROMPT (agentes que la tienen) ===");
  for (const a of agentes) {
    const ai = aiPorAgente.get(a.nombre) ?? "";
    if (ai.length < 1000) continue;

    const fPrompt = frases(a.system_prompt);
    const fAi = frases(ai);
    const setPrompt = new Set(fPrompt);

    // Coincidencia exacta de frase normalizada.
    const exactas = fAi.filter((f) => setPrompt.has(f));

    // Solapamiento de vocabulario de directivas: frases de los dos lados
    // que mandan sobre el mismo concepto (comparten >=4 palabras largas).
    const dirPrompt = fPrompt.filter((f) => DIRECTIVA.test(f));
    const dirAi = fAi.filter((f) => DIRECTIVA.test(f));
    const clave = (f: string) => new Set(f.split(" ").filter((w) => w.length >= 6));
    const pares: { prompt: string; ai: string; comunes: number }[] = [];
    for (const da of dirAi) {
      const ka = clave(da);
      for (const dp of dirPrompt) {
        const kp = clave(dp);
        let comunes = 0;
        for (const w of ka) if (kp.has(w)) comunes++;
        if (comunes >= 4) pares.push({ prompt: dp, ai: da, comunes });
      }
    }
    pares.sort((x, y) => y.comunes - x.comunes);

    console.log(`\n--- ${a.nombre} ---`);
    console.log(`   frases comparables: ${fPrompt.length} en el prompt, ${fAi.length} en AI Behaviour`);
    console.log(`   directivas: ${dirPrompt.length} en el prompt, ${dirAi.length} en AI Behaviour`);
    console.log(`   frases IDÉNTICAS entre los dos: ${exactas.length}`);
    for (const f of exactas.slice(0, 5)) console.log(`      · ${f.slice(0, 90)}`);
    console.log(`   pares de directivas sobre el mismo tema (>=4 palabras clave): ${pares.length}`);
    for (const par of pares.slice(0, 6)) {
      console.log(`      [${par.comunes} en común]`);
      console.log(`        prompt: ${par.prompt.slice(0, 110)}`);
      console.log(`        catálogo: ${par.ai.slice(0, 110)}`);
    }
  }

  console.log("\n=== 3. CORRUPCIÓN DE CARACTERES EN LOS PROMPTS ===\n");
  console.log("AGENTE                          '?'   ACENTOS   ESTADO");
  console.log("--------------------------------------------------------------");
  for (const a of agentes) {
    const interrog = (a.system_prompt.match(/\?/g) || []).length;
    const acentos = (a.system_prompt.match(/[áéíóúñÁÉÍÓÚÑ]/g) || []).length;
    const roto = acentos < 50 && interrog > 100;
    console.log(
      String(a.nombre).slice(0, 28).padEnd(30) +
        String(interrog).padStart(6) +
        String(acentos).padStart(10) +
        (roto ? "   CORRUPTO" : "   ok")
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
