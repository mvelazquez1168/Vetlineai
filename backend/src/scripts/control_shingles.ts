import fs from "fs";
import path from "path";

// Control de la máquina de medición antes de creerle ningún número:
// el marco se extrajo LITERALMENTE del catálogo GCIS, así que contra el
// catálogo tiene que dar prácticamente 100%. Si da bajo, el medidor está
// roto y cualquier "0% contra los prompts" no significa nada.

const DIR = path.join(__dirname, "..", "seed", "plataforma");

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

const leer = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const pct = (a: Set<string>, b: Set<string>) => (a.size ? Math.round(([...a].filter((x) => b.has(x)).length / a.size) * 100) : 0);

const marco = leer(path.join(DIR, "marco_razonamiento_clinico.md"));
const catRaz = leer(path.join(DIR, "catalogo_gcis_razonamiento.md"));
const catComp = leer(path.join(DIR, "catalogo_gcis_composicion.md"));
const gastro = leer(path.join(DIR, "prompts", "gastroenterologia.txt"));
const cardio = leer(path.join(DIR, "prompts", "cardiologia.txt"));

const shM = shingles(marco);
console.log(`normalización de muestra: ${JSON.stringify(norm("Claude deberá: Nunca deberá inventar. ¿Qué información falta?"))}`);
console.log(`shingles del marco: ${shM.size}\n`);
console.log(`marco  →  catálogo GCIS razonamiento : ${pct(shM, shingles(catRaz))}%   (control: debería ser altísimo)`);
console.log(`marco  →  catálogo GCIS composición  : ${pct(shM, shingles(catComp))}%`);
console.log(`marco  →  prompt gastroenterología   : ${pct(shM, shingles(gastro))}%`);
console.log(`marco  →  prompt cardiología         : ${pct(shM, shingles(cardio))}%`);
console.log(`\ncontrol trivial, gastro → gastro     : ${pct(shingles(gastro), shingles(gastro))}%   (tiene que ser 100)`);
