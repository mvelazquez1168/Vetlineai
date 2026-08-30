import fs from "fs";
import path from "path";

// ¿El marco aporta reglas que NO estén ya en los prompts?
//
// Si todo lo que dice el marco ya está en los ocho prompts, no hay forma
// de atribuirle un cambio de comportamiento: cualquier mejora vendría del
// prompt. El experimento de "prompt vs documento" necesita reglas que solo
// existan en el documento.

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const MARCO = path.join(DIR, "marco_razonamiento_clinico.md");
const PROMPTS = path.join(DIR, "prompts");

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const VACIAS = new Set("de la el los las un una y o que en con por para se su sus del al es son ser como no ni cuando cada todo toda este esta lo le les mas si pero nunca siempre debera deber debe puede".split(" "));
const toks = (s: string) => norm(s).split(" ").filter((w) => w.length > 3 && !VACIAS.has(w));

function main() {
  const marco = fs.readFileSync(MARCO, "utf8").replace(/\r\n/g, "\n");
  const prompts = fs
    .readdirSync(PROMPTS)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => ({ slug: f.replace(".txt", ""), t: fs.readFileSync(path.join(PROMPTS, f), "utf8").replace(/\r\n/g, "\n") }));

  // Cada viñeta o línea de regla del marco.
  const reglas = marco
    .split("\n")
    .map((l) => l.replace(/^[-\s]+/, "").trim())
    .filter((l) => toks(l).length >= 4 && !l.startsWith("#") && !l.startsWith(">"));

  console.log(`${reglas.length} reglas en el marco · ${prompts.length} prompts\n`);
  console.log("REGLAS DEL MARCO QUE NO ESTÁN EN NINGÚN PROMPT");
  console.log("(solape máximo con cualquier prompt, por contención de palabras de contenido)\n");

  const solas: { regla: string; max: number }[] = [];
  for (const r of reglas) {
    const tr = toks(r);
    let max = 0;
    for (const p of prompts) {
      // Se compara contra cada oración del prompt, no contra el prompt
      // entero: un prompt largo contiene casi cualquier palabra suelta.
      for (const o of p.t.split(/(?<=\.)\s+|\n/)) {
        const to = toks(o);
        if (to.length < 3) continue;
        const inter = tr.filter((x) => to.includes(x)).length;
        const s = inter / Math.min(tr.length, to.length);
        if (s > max) max = s;
      }
    }
    if (max < 0.5) solas.push({ regla: r, max });
  }

  for (const s of solas.slice(0, 40)) console.log(`  [${s.max.toFixed(2)}]  ${s.regla.slice(0, 108)}`);
  console.log(`\n${solas.length} de ${reglas.length} reglas del marco no tienen equivalente en ningún prompt.`);
  console.log("Esas son las únicas con las que se puede medir si un documento manda tanto como un prompt.");
}

main();
