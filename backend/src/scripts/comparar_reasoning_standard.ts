import fs from "fs";
import path from "path";

// ¿El "AI Reasoning Standard" que llevan los prompts es el mismo texto en
// los ocho agentes, y es el mismo que el documento de conocimiento
// 6353b4d5 (AI Reasoning Standard) que además se manda en el contexto?
//
// Importa por dos razones: si difieren, los agentes no razonan con las
// mismas reglas aunque el documento se llame igual; y si el documento de
// conocimiento repite lo que ya está en el prompt, se está pagando el
// mismo texto dos veces en cada pedido.

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const leer = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
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
const pct = (a: Set<string>, b: Set<string>) => (a.size ? Math.round(([...a].filter((x) => b.has(x)).length / a.size) * 100) : 0);

function parte2(t: string): string {
  const m = t.match(/\n\s*1\.?\s+Propósito/);
  return m ? t.slice(m.index!) : "";
}

function titulos(t: string): string[] {
  return t
    .split("\n")
    .map((l) => l.match(/^(\d+)\.?\s+([A-ZÁÉÍÓÚÑ].{2,60})$/))
    .filter((m): m is RegExpMatchArray => !!m && !/\.$/.test(m[2].trim()))
    .map((m) => `${m[1]}. ${m[2].trim()}`);
}

const prompts = fs
  .readdirSync(path.join(DIR, "prompts"))
  .filter((f) => f.endsWith(".txt"))
  .map((f) => ({ slug: f.replace(".txt", ""), p2: parte2(leer(path.join(DIR, "prompts", f))) }));

// El documento de conocimiento homónimo.
const docStd = leer(path.join(DIR, "documentos", "6353b4d5-1a42-43a5-811e-ae0e07a42b65.txt"));

console.log("SECCIONES DEL AI REASONING STANDARD, POR AGENTE\n");
for (const p of prompts) {
  console.log(`   ${p.slug}  (${p.p2.length} car.)`);
  const ts = titulos(p.p2);
  console.log(ts.length ? "      " + ts.join("\n      ") : "      (no tiene esta parte)");
  console.log("");
}

console.log("\nSOLAPAMIENTO CRUZADO (% de shingles de la fila presentes en la columna)\n");
const cols = prompts.filter((p) => p.p2.length > 0);
console.log("                          " + cols.map((c) => c.slug.slice(0, 6).padStart(8)).join("") + "     doc");
for (const a of cols) {
  const sa = shingles(a.p2);
  const fila = cols.map((b) => String(pct(sa, shingles(b.p2))).padStart(8)).join("");
  console.log(`   ${a.slug.padEnd(23)}${fila}${String(pct(sa, shingles(docStd))).padStart(8)}`);
}

console.log(`\nDOCUMENTO DE CONOCIMIENTO "AI Reasoning Standard" (${docStd.length} car.)`);
const sd = shingles(docStd);
for (const a of cols) console.log(`   ¿su contenido está en el prompt de ${a.slug.padEnd(24)}? ${pct(sd, shingles(a.p2))}%`);
