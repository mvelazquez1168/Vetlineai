import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Antes de sacar el AI Reasoning Standard de los prompts: ¿qué dice cada
// copia que el documento NO diga?
//
// El 92% de solape de gastro es tranquilizador para gastro y no dice nada
// de los otros. Lo que importa acá no es el porcentaje sino el residuo:
// una sola regla que viva únicamente en una copia se perdería en silencio.
//
// Método: se parte cada copia en afirmaciones (viñetas y oraciones), y
// para cada una se busca la mejor coincidencia en el documento por
// contención de tokens. Por debajo del umbral, la afirmación se reporta
// como AUSENTE del documento — para leerla a mano y decidir si hay que
// rescatarla.
//
// El umbral es deliberadamente bajo (0.6): preferimos revisar de más a
// que se escape una regla. Solo REPORTA.
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const P = path.join(DIR, "prompts");
const DOC = path.join(DIR, "documentos", "6353b4d5-1a42-43a5-811e-ae0e07a42b65.txt");
const UMBRAL = 0.6;

const leer = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const tokens = (s: string): string[] =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

// Fracción de los tokens de `a` presentes en `b`.
const contencion = (a: string[], b: Set<string>): number =>
  a.length ? a.filter((t) => b.has(t)).length / a.length : 0;

function afirmaciones(texto: string): string[] {
  return texto
    .split("\n")
    .flatMap((l) => l.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ¿])/))
    .map((s) => s.replace(/^[-*\d.\s]+/, "").trim())
    .filter((s) => tokens(s).length >= 6);
}

function parte2(t: string): string {
  const m = t.match(/\n\s*1\.?\s+Propósito/);
  return m ? t.slice(m.index!) : "";
}

function main() {
  const doc = leer(DOC);
  // Ventanas del documento: cada afirmación del doc, más el doc entero.
  const afirmDoc = afirmaciones(doc).map((s) => ({ texto: s, set: new Set(tokens(s)) }));

  const archivos = fs.readdirSync(P).filter((f) => f.endsWith(".txt"));
  console.log(`DOCUMENTO "GCIS AI Reasoning Standard": ${doc.length} car., ${afirmDoc.length} afirmaciones\n`);
  console.log("Qué dice cada copia que el documento NO diga (umbral de similitud 0,6)\n");

  const rescate = new Map<string, string[]>();

  for (const f of archivos) {
    const slug = f.replace(".txt", "");
    const copia = parte2(leer(path.join(P, f)));
    if (!copia) {
      console.log(`################ ${slug} ################`);
      console.log("   NO tiene copia del estándar. Hoy no lo recibe por ningún lado:");
      console.log("   el documento está asignado solo a gastroenterología.\n");
      continue;
    }
    const afirms = afirmaciones(copia);
    const ausentes: { texto: string; mejor: number }[] = [];
    for (const a of afirms) {
      const ta = tokens(a);
      let mejor = 0;
      for (const d of afirmDoc) {
        const c = contencion(ta, d.set);
        if (c > mejor) mejor = c;
        if (mejor >= UMBRAL) break;
      }
      if (mejor < UMBRAL) ausentes.push({ texto: a, mejor });
    }
    console.log(`################ ${slug} ################`);
    console.log(`   copia: ${copia.length} car., ${afirms.length} afirmaciones`);
    console.log(`   ausentes del documento: ${ausentes.length} (${Math.round((ausentes.length / afirms.length) * 100)}%)\n`);
    for (const a of ausentes) {
      console.log(`      [${a.mejor.toFixed(2)}] ${a.texto.slice(0, 150)}`);
    }
    console.log("");
    rescate.set(slug, ausentes.map((a) => a.texto));
  }

  // ¿Qué afirmaciones ausentes se repiten en varias copias? Esas son del
  // estándar y faltan en el documento. Las que aparecen en una sola son
  // propias de esa especialidad.
  console.log("\n" + "=".repeat(78));
  console.log("AUSENTES QUE APARECEN EN VARIAS COPIAS (candidatas a rescatar al documento)\n");
  const cuenta = new Map<string, { n: number; agentes: string[]; ejemplo: string }>();
  for (const [slug, lista] of rescate) {
    for (const t of lista) {
      const clave = tokens(t).slice(0, 8).join(" ");
      const e = cuenta.get(clave) ?? { n: 0, agentes: [], ejemplo: t };
      e.n++;
      e.agentes.push(slug);
      cuenta.set(clave, e);
    }
  }
  const compartidas = [...cuenta.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n);
  for (const e of compartidas) {
    console.log(`   ${e.n} agentes (${e.agentes.join(", ")})`);
    console.log(`      ${e.ejemplo.slice(0, 160)}\n`);
  }
  console.log(`   total: ${compartidas.length} afirmación(es) compartidas ausentes del documento`);
}

main();
