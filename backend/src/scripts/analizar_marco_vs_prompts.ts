import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Compara el marco de razonamiento compartido contra los ocho prompts.
//
// Tres preguntas, en este orden:
//   A. ¿Cómo está compuesto cada prompt y dónde está la diferencia de
//      tamaño entre ellos?
//   B. ¿Cuánto del marco YA vive en cada prompt? (duplicación)
//   C. ¿Qué reglas del marco tienen una contraparte en el prompt que diga
//      algo distinto? (candidatas a contradicción, para leer a mano)
//
// La duplicación se mide por shingles de 8 palabras normalizadas (sin
// acentos, sin puntuación, minúsculas). Un shingle compartido no prueba
// copia literal, pero ocho palabras seguidas iguales no pasan por azar en
// texto técnico: sirve para localizar dónde mirar.
//
// Solo REPORTA.
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const PROMPTS = path.join(DIR, "prompts");
const MARCO = path.join(DIR, "marco_razonamiento_clinico.md");

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const shingles = (s: string, n = 8): Set<string> => {
  const p = norm(s).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= p.length; i++) out.add(p.slice(i, i + n).join(" "));
  return out;
};

interface Seccion {
  titulo: string;
  cuerpo: string;
}

// Los ocho prompts son dos documentos pegados: "Project Instructions" y
// "AI Reasoning Standard". El segundo arranca donde reaparece la sección
// "1. Propósito".
function partir(texto: string): { parte1: string; parte2: string } {
  const m = texto.match(/\n\s*1\.?\s+Propósito/);
  if (!m) return { parte1: texto, parte2: "" };
  return { parte1: texto.slice(0, m.index!), parte2: texto.slice(m.index!) };
}

function secciones(texto: string): Seccion[] {
  const lineas = texto.split("\n");
  const out: Seccion[] = [];
  let actual: Seccion | null = null;
  for (const l of lineas) {
    const m = l.match(/^(\d+)\.?\s+([A-ZÁÉÍÓÚÑ].{2,70})$/);
    if (m && !/\.$/.test(m[2].trim())) {
      if (actual) out.push(actual);
      actual = { titulo: `${m[1]}. ${m[2].trim()}`, cuerpo: "" };
    } else if (actual) actual.cuerpo += l + "\n";
  }
  if (actual) out.push(actual);
  return out;
}

function main() {
  const marco = fs.readFileSync(MARCO, "utf8").replace(/\r\n/g, "\n");
  const archivos = fs.readdirSync(PROMPTS).filter((f) => f.endsWith(".txt"));
  const prompts = archivos.map((f) => ({
    slug: f.replace(".txt", ""),
    texto: fs.readFileSync(path.join(PROMPTS, f), "utf8").replace(/\r\n/g, "\n"),
  }));

  // ------------------------------------------------ A. composición
  console.log("A. COMPOSICIÓN DE CADA PROMPT\n");
  console.log("agente                       total   Project Instr.   AI Reasoning Std.");
  console.log("-".repeat(76));
  const partes = new Map<string, { parte1: string; parte2: string }>();
  for (const p of prompts) {
    const q = partir(p.texto);
    partes.set(p.slug, q);
    console.log(
      `${p.slug.padEnd(27)}${String(p.texto.length).padStart(6)}${String(q.parte1.length).padStart(15)}${String(q.parte2.length).padStart(20)}`
    );
  }

  // Comparación del AI Reasoning Standard entre agentes: ¿es el mismo?
  console.log("\n   ¿El AI Reasoning Standard es el mismo texto en los ocho?");
  const base = partes.get("gastroenterologia")!.parte2;
  const shBase = shingles(base);
  for (const p of prompts) {
    const otro = partes.get(p.slug)!.parte2;
    const sh = shingles(otro);
    const comunes = [...sh].filter((x) => shBase.has(x)).length;
    const pct = sh.size ? Math.round((comunes / sh.size) * 100) : 0;
    const propios = [...sh].filter((x) => !shBase.has(x)).length;
    console.log(
      `      ${p.slug.padEnd(27)}${String(otro.length).padStart(6)} car.   ${String(pct).padStart(3)}% compartido con gastro   ${String(propios).padStart(4)} shingles propios`
    );
  }

  // Diferencia de secciones de la Parte 1 respecto de gastro
  console.log("\n   Secciones de Project Instructions, por agente (tamaño en caracteres):");
  const titulosVistos = new Set<string>();
  const porAgente = new Map<string, Map<string, number>>();
  for (const p of prompts) {
    const m = new Map<string, number>();
    for (const s of secciones(partes.get(p.slug)!.parte1)) {
      m.set(s.titulo.replace(/^\d+\.\s*/, ""), s.cuerpo.length);
      titulosVistos.add(s.titulo.replace(/^\d+\.\s*/, ""));
    }
    porAgente.set(p.slug, m);
  }
  const titulos = [...titulosVistos].sort();
  const cab = prompts.map((p) => p.slug.slice(0, 7).padStart(8)).join("");
  console.log(`      ${"sección".padEnd(42)}${cab}`);
  for (const t of titulos) {
    const fila = prompts.map((p) => String(porAgente.get(p.slug)!.get(t) ?? 0).padStart(8)).join("");
    console.log(`      ${t.slice(0, 40).padEnd(42)}${fila}`);
  }

  // ------------------------------------------------ B. duplicación
  console.log("\n\nB. CUÁNTO DEL MARCO YA VIVE EN CADA PROMPT\n");
  const bloques = marco
    .split(/\n## /)
    .slice(1)
    .map((b) => ({ titulo: "CC-" + (b.match(/^CC-(\d+)/)?.[1] ?? "?") + " " + b.split("\n")[0].replace(/^CC-\d+\s*—\s*/, ""), texto: b }));

  console.log(`   El marco tiene ${bloques.length} componentes, ${marco.length} caracteres.\n`);
  console.log("   agente                     shingles del marco presentes en el prompt");
  console.log("   " + "-".repeat(68));
  for (const p of prompts) {
    const sh = shingles(p.texto);
    const shM = shingles(marco);
    const comunes = [...shM].filter((x) => sh.has(x)).length;
    console.log(`   ${p.slug.padEnd(27)}${String(comunes).padStart(5)} de ${shM.size}  (${Math.round((comunes / shM.size) * 100)}%)`);
  }

  console.log("\n   Por componente (contra el conjunto de los ocho prompts):");
  const shTodos = new Set<string>();
  for (const p of prompts) for (const x of shingles(p.texto)) shTodos.add(x);
  for (const b of bloques) {
    const sh = shingles(b.texto);
    const comunes = [...sh].filter((x) => shTodos.has(x)).length;
    const pct = sh.size ? Math.round((comunes / sh.size) * 100) : 0;
    const marca = pct >= 50 ? "  <-- ya está en los prompts" : pct >= 15 ? "  <-- solapamiento parcial" : "";
    console.log(`      ${b.titulo.slice(0, 46).padEnd(48)}${String(pct).padStart(3)}%${marca}`);
  }

  // ------------------------------------------------ C. candidatas a conflicto
  console.log("\n\nC. REGLAS DEL MARCO CON CONTRAPARTE EN LOS PROMPTS (leer a mano)\n");
  const reglas = [...marco.matchAll(/^-?\s*(?:Nunca deberá:?|Deberá:?)?\s*-?\s*(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((r) => r.length > 35 && !r.startsWith("#") && !r.startsWith(">"));
  const temas = [
    { clave: "caso cerrado / reapertura", re: /cerrad|reabrir|reapertura/i },
    { clave: "histopatología como evidencia máxima", re: /histopat/i },
    { clave: "jerarquía de evidencia", re: /jerarqu|mayor peso|nivel de evidencia/i },
    { clave: "escalas y scores", re: /escala|score|puntuaci/i },
    { clave: "raza / predisposición", re: /raza|racial|predisposic/i },
    { clave: "incertidumbre", re: /incertidumbre|no lo s|desconoc/i },
    { clave: "diagnóstico definitivo", re: /diagn[oó]stico definitivo|confirmad/i },
  ];
  for (const t of temas) {
    const enMarco = reglas.filter((r) => t.re.test(r));
    console.log(`   ${t.clave}`);
    console.log(`      marco: ${enMarco.length} regla(s)`);
    for (const p of prompts) {
      const lineas = p.texto.split("\n").filter((l) => t.re.test(l) && l.trim().length > 30);
      if (lineas.length) console.log(`      ${p.slug.padEnd(26)}${lineas.length} línea(s)`);
    }
    console.log("");
  }
}

main();
