import fs from "fs";
import path from "path";

// Extrae la misma sección del AI Reasoning Standard en todos los agentes,
// para poder leerlas una al lado de la otra. Uso:
//   ts-node extraer_seccion_prompts.ts "Jerarquía de Fuentes" [maxCaracteres]

const DIR = path.join(__dirname, "..", "seed", "plataforma", "prompts");
const buscado = process.argv[2] ?? "Jerarquía de Fuentes";
const max = Number(process.argv[3] ?? 1100);

const leer = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".txt"))) {
  const t = leer(f);
  const lineas = t.split("\n");
  const i = lineas.findIndex((l) => new RegExp(`^\\d+(\\.\\d+)?\\.?\\s+.*${buscado}`, "i").test(l));
  console.log(`################ ${f.replace(".txt", "")} ################`);
  if (i < 0) {
    console.log("(sección ausente)\n");
    continue;
  }
  let fin = lineas.length;
  for (let j = i + 1; j < lineas.length; j++) {
    if (/^\d+\.?\s+[A-ZÁÉÍÓÚÑ]/.test(lineas[j]) && !/\.$/.test(lineas[j].trim())) {
      fin = j;
      break;
    }
  }
  const cuerpo = lineas.slice(i, fin).join("\n");
  console.log(cuerpo.length > max ? cuerpo.slice(0, max) + `\n   […${cuerpo.length - max} car. más]` : cuerpo);
  console.log("");
}
