import fs from "fs";
import path from "path";

// Tamaño de cada sección del AI Reasoning Standard por agente. Es lo que
// permite distinguir "lo dice distinto" de "lo dice en una línea y perdió
// el contenido": dos agentes pueden tener el mismo título de sección y
// uno traer 900 caracteres de mecanismo y el otro 80.

const P = path.join(__dirname, "..", "seed", "plataforma", "prompts");
const leer = (f: string) => fs.readFileSync(path.join(P, f), "utf8").replace(/\r\n/g, "\n");
const MARCA_COMUN = "## Reglas comunes a todos los agentes";

const SECCIONES = [
  { comp: "tipos de afirmación", re: /Tipos de Afirmaci|INCERTIDUMBRE\b/i },
  { comp: "modelo de confianza", re: /Modelo de Confianza/i },
  { comp: "razonamiento bayesiano", re: /Razonamiento Bayesiano/i },
  { comp: "anti-alucinación", re: /Anti-Alucinaci|DATOS FALTANTES/i },
  { comp: "jerarquía de fuentes", re: /Jerarqu[ií]a de Fuentes|CONTRADICCIONES/i },
  { comp: "explicabilidad", re: /Explicabilidad|LA PRUEBA FINAL/i },
  { comp: "trazabilidad", re: /Trazabilidad/i },
  { comp: "incertidumbre", re: /Comunicaci[óo]n de la Incertidumbre/i },
  { comp: "reglas duras", re: /Reglas que Nunca se Rompen|L[IÍ]MITES DE LA INTERACCI/i },
  { comp: "umbrales numéricos", re: /UMBRALES NUM[EÉ]RICOS/i },
  { comp: "calibración", re: /CALIBRACI[OÓ]N/i },
  { comp: "urgencia temporal", re: /URGENCIA|EL TIEMPO/i },
  { comp: "derivación", re: /Derivaci[óo]n|Motor de Derivaci/i },
];

const archivos = fs.readdirSync(P).filter((f) => f.endsWith(".txt"));
const agentes = archivos.map((f) => {
  let t = leer(f);
  const i = t.indexOf(MARCA_COMUN);
  if (i >= 0) t = t.slice(0, i); // el bloque común se excluye: es idéntico por construcción
  return { slug: f.replace(".txt", ""), t };
});

function tamañoSeccion(texto: string, re: RegExp): number {
  const lineas = texto.split("\n");
  const i = lineas.findIndex((l) => re.test(l) && /^\d|^[A-ZÁÉÍÓÚÑ0-9]/.test(l.trim()) && l.trim().length < 90);
  if (i < 0) return 0;
  let fin = lineas.length;
  for (let j = i + 1; j < lineas.length; j++) {
    if (/^\d+\.?\s+[A-ZÁÉÍÓÚÑ]/.test(lineas[j]) && !/\.$/.test(lineas[j].trim())) {
      fin = j;
      break;
    }
  }
  return lineas.slice(i, fin).join("\n").length;
}

console.log("TAMAÑO DE CADA COMPONENTE DEL RAZONAMIENTO, POR AGENTE (caracteres)");
console.log("(el bloque de reglas comunes se excluye: es idéntico por construcción)\n");
console.log("componente".padEnd(26) + agentes.map((a) => a.slug.slice(0, 6).padStart(8)).join(""));
console.log("-".repeat(26 + agentes.length * 8));
for (const s of SECCIONES) {
  const fila = agentes.map((a) => {
    const n = tamañoSeccion(a.t, s.re);
    return (n === 0 ? "—" : String(n)).padStart(8);
  });
  console.log(s.comp.padEnd(26) + fila.join(""));
}
console.log("\n— = el agente no tiene esa sección");
