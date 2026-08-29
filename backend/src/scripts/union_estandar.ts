import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Unión de las nueve versiones del estándar de razonamiento, afirmación
// por afirmación, con en cuántos agentes aparece cada una.
//
// El criterio de "común" NO es la intersección. Las reglas más valiosas
// que encontramos —umbrales numéricos, taxonomía de faltantes, "ni
// promedies"— estaban en un solo agente. La intersección las habría
// tirado. Por eso esto no decide: ordena por frecuencia para que la
// decisión sea de a una.
//
// Método. Las secciones se alinean primero por título canónico (los ocho
// comparten los mismos once), y recién dentro de cada sección se agrupan
// las afirmaciones por solape de palabras de contenido. Alinear primero
// evita fusionar dos reglas distintas que comparten vocabulario.
//
// Reproducción no comparte la estructura, así que su mapeo de secciones
// va declarado a mano y a la vista, no adivinado.
//
// LÍMITE CONOCIDO: el agrupamiento es léxico. Dos redacciones muy
// distintas de la misma regla quedan separadas y aparecen como dos
// afirmaciones de un agente cada una. Por eso el grupo de "aparece en 1"
// hay que leerlo, no contarlo — y es exactamente el que se pide revisar.
//
// El bloque común se EXCLUYE: es byte-idéntico por construcción y llenaría
// el grupo de "está en los ocho" sin aportar información.
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma", "prompts");
const MARCA_COMUN = "## Reglas comunes a todos los agentes clínicos de Vetline Ai";
const UMBRAL = 0.62;

const SECCIONES_CANONICAS = [
  "propósito", "tipos de afirmación", "modelo de confianza", "razonamiento bayesiano",
  "anti-alucinación", "jerarquía de fuentes", "explicabilidad", "trazabilidad",
  "comunicación de la incertidumbre", "reglas que nunca se rompen", "architecture decisions",
  "razonamiento de derivación",
];

/** Reproducción usa otra estructura. El mapeo va declarado, no inferido. */
const MAPEO_REPRODUCCION: Record<string, string> = {
  "propósito": "propósito",
  "la regla de los umbrales numéricos": "anti-alucinación",
  "incertidumbre": "comunicación de la incertidumbre",
  "datos faltantes": "anti-alucinación",
  "contradicciones": "jerarquía de fuentes",
  "alcance": "reglas que nunca se rompen",
  "urgencia": "reglas que nunca se rompen",
  "calibración y aprendizaje": "trazabilidad",
  "límites de la interacción": "reglas que nunca se rompen",
  "la prueba final": "explicabilidad",
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const VACIAS = new Set(("de la el los las un una y o que en con por para se su sus del al es son ser como no ni " +
  "cuando donde cada todo toda todos todas este esta esto ese esa lo le les mas mas si aunque pero sino tambien " +
  "claude debera deber debe puede pueden nunca siempre").split(" "));

const contenido = (s: string) => norm(s).split(" ").filter((w) => w.length > 3 && !VACIAS.has(w));

// Contención, no Jaccard. Las versiones por especialidad EXTIENDEN la
// regla genérica con una cola propia ("...con el pronóstico de la
// enfermedad" vs "...con el estado de control clínico a largo plazo"), y
// Jaccard las castiga por la diferencia de largo: la misma regla quedaba
// partida en dos grupos de dos. La contención pregunta otra cosa —
// ¿cuánto de la versión corta está en la larga?— que es justo lo que
// distingue "la misma regla adaptada" de "otra regla".
function similitud(a: string[], b: string[]) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const min = Math.min(A.size, B.size);
  return min ? inter / min : 0;
}

/** Marca de posible contradiccion: misma regla, polaridad distinta. */
const POLARIDAD = /\b(nunca|jam[aá]s|no\s+se|siempre|debe|deber[aá])\b/gi;
function polaridades(t: string): string {
  return [...(t.toLowerCase().match(POLARIDAD) ?? [])].sort().join("|");
}

interface Afirmacion { agente: string; seccion: string; texto: string; toks: string[] }

function seccionCanonica(titulo: string, agente: string): string | null {
  const t = norm(titulo);
  if (agente === "reproduccion") {
    for (const [k, v] of Object.entries(MAPEO_REPRODUCCION)) if (t.includes(norm(k))) return v;
    return null;
  }
  for (const c of SECCIONES_CANONICAS) if (t.includes(norm(c))) return c;
  if (/derivacion/.test(t)) return "razonamiento de derivación";
  return null;
}

function extraer(): Afirmacion[] {
  const out: Afirmacion[] = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".txt"))) {
    const agente = f.replace(".txt", "");
    let t = fs.readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");
    const iC = t.indexOf(MARCA_COMUN);
    if (iC >= 0) t = t.slice(0, iC); // fuera el bloque común
    // El estándar arranca en la segunda aparición de "1. Propósito" (o en
    // "RCIS AI REASONING STANDARD" para reproducción).
    const m = t.match(/\n\s*1[.\s]+(Propósito|PROPÓSITO)/);
    if (m) t = t.slice(m.index!);

    let seccion: string | null = null;
    for (const linea of t.split("\n")) {
      const mt = linea.match(/^(\d+(?:\.\d+)?)[.\s]+([A-ZÁÉÍÓÚÑ][^\n]{2,70})$/);
      if (mt && !/\.$/.test(mt[2].trim())) { seccion = seccionCanonica(mt[2], agente); continue; }
      if (!seccion) continue;
      // Una afirmación = una viñeta, o una oración de un párrafo.
      const partes = linea.replace(/^[-*\s]+/, "").split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ¿"])/);
      for (const p of partes) {
        const texto = p.trim();
        const toks = contenido(texto);
        if (toks.length >= 4) out.push({ agente, seccion, texto, toks });
      }
    }
  }
  return out;
}

function main() {
  const afirms = extraer();
  const agentes = [...new Set(afirms.map((a) => a.agente))].sort();
  console.log(`${afirms.length} afirmaciones extraídas de ${agentes.length} agentes (bloque común excluido)\n`);

  // Agrupamiento dentro de cada sección canónica.
  interface Grupo { seccion: string; rep: string; agentes: Set<string>; textos: Afirmacion[] }
  const grupos: Grupo[] = [];
  for (const sec of [...new Set(afirms.map((a) => a.seccion))]) {
    for (const a of afirms.filter((x) => x.seccion === sec)) {
      const g = grupos.find(
        (x) => x.seccion === sec && !x.agentes.has(a.agente) && similitud(contenido(x.rep), a.toks) >= UMBRAL
      ) ?? grupos.find((x) => x.seccion === sec && similitud(contenido(x.rep), a.toks) >= UMBRAL);
      if (g) { g.agentes.add(a.agente); g.textos.push(a); }
      else grupos.push({ seccion: sec, rep: a.texto, agentes: new Set([a.agente]), textos: [a] });
    }
  }

  // Contradicciones potenciales: dentro de un grupo (misma regla), dos
  // agentes con polaridad distinta. No lo decide el script — lo marca para
  // leer, que es lo unico honesto con un agrupamiento lexico.
  const sospechosos = grupos.filter((g) => {
    if (g.agentes.size < 2) return false;
    const ps = new Set(g.textos.map((t) => polaridades(t.texto)));
    return ps.size > 1 && [...ps].some((x) => x === "");
  });

  const porSeccion = new Map<string, Grupo[]>();
  for (const g of grupos) porSeccion.set(g.seccion, [...(porSeccion.get(g.seccion) ?? []), g]);

  // ------------------------------------------------- resumen por sección
  console.log("SECCIÓN                            afirmaciones   en 8-9   en 2-7   en 1 solo");
  console.log("-".repeat(84));
  for (const sec of SECCIONES_CANONICAS) {
    const gs = porSeccion.get(sec) ?? [];
    if (!gs.length) continue;
    const n = (f: (k: number) => boolean) => gs.filter((g) => f(g.agentes.size)).length;
    console.log(
      `${sec.padEnd(35)}${String(gs.length).padStart(12)}${String(n((k) => k >= 8)).padStart(9)}` +
      `${String(n((k) => k >= 2 && k <= 7)).padStart(9)}${String(n((k) => k === 1)).padStart(11)}`
    );
  }

  // ------------------------------------------------- comunes
  console.log("\n\n=== APARECE EN 8 O 9 AGENTES — común, sin discusión ===\n");
  for (const g of grupos.filter((x) => x.agentes.size >= 8).sort((a, b) => b.agentes.size - a.agentes.size))
    console.log(`  [${g.agentes.size}] ${g.seccion.padEnd(30)}${g.rep.slice(0, 100)}`);

  // ------------------------------------------------- parciales
  console.log("\n\n=== APARECE EN 2 A 7 — revisar ===\n");
  for (const g of grupos.filter((x) => x.agentes.size >= 2 && x.agentes.size <= 7).sort((a, b) => b.agentes.size - a.agentes.size)) {
    console.log(`  [${g.agentes.size}] ${g.seccion}  ·  falta en: ${agentes.filter((a) => !g.agentes.has(a)).join(", ")}`);
    console.log(`      ${g.rep.slice(0, 130)}`);
  }

  // ------------------------------------------------- únicas
  console.log(`\n\n=== POSIBLES CONTRADICCIONES — misma regla, polaridad distinta (${sospechosos.length}) ===\n`);
  if (!sospechosos.length) console.log("  ninguna detectada por polaridad. Las contradicciones de contenido hay que leerlas.");
  for (const g of sospechosos.slice(0, 12)) {
    console.log(`  ${g.seccion}`);
    for (const t of g.textos.slice(0, 3)) console.log(`     ${t.agente.padEnd(24)}${t.texto.slice(0, 100)}`);
    console.log("");
  }

  console.log("\n\n=== APARECE EN UN SOLO AGENTE — decidir una por una ===\n");
  const unicas = grupos.filter((x) => x.agentes.size === 1);
  for (const a of agentes) {
    const suyas = unicas.filter((g) => g.agentes.has(a));
    if (!suyas.length) continue;
    console.log(`  ${a.toUpperCase()}  (${suyas.length})`);
    for (const g of suyas) console.log(`     ${g.seccion.padEnd(30)}${g.rep.slice(0, 110)}`);
    console.log("");
  }
}

main();
