import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Matriz de reglas de seguridad: cuáles tiene cada agente y cuáles le
// faltan.
//
// El universo de reglas NO se inventó: sale de leer las nueve secciones
// "Reglas que Nunca se Rompen" y las prohibiciones explícitas de
// reproducción, y quedarse con las que son de seguridad clínica o de
// integridad del sistema — no con las que son propias de una especialidad
// (un estadio COASTeR no tiene sentido en dermatología).
//
// Cada regla se detecta por más de una redacción, porque los prompts no
// las escriben igual. Un "no" acá significa que ninguna de las
// redacciones conocidas aparece en ese prompt.
// ---------------------------------------------------------------------

const P = path.join(__dirname, "..", "seed", "plataforma", "prompts");
const leer = (f: string) => fs.readFileSync(path.join(P, f), "utf8").replace(/\r\n/g, "\n");
const agentes = fs
  .readdirSync(P)
  .filter((f) => f.endsWith(".txt"))
  .map((f) => ({ slug: f.replace(".txt", ""), t: leer(f) }));

interface Regla {
  nombre: string;
  clase: "seguridad clínica" | "integridad del sistema" | "trazabilidad";
  re: RegExp;
}

const REGLAS: Regla[] = [
  { nombre: "no diagnosticar por raza frecuente", clase: "seguridad clínica", re: /solo porque es frecuente en la raza|nunca la confirma por s[ií] solo|nunca deciden/i },
  { nombre: "no indicar dosis específicas", clase: "seguridad clínica", re: /dosis específicas|no emitas valores numéricos de corte/i },
  { nombre: "no dar por definitivo lo que requiere confirmación", clase: "seguridad clínica", re: /requiere confirmaci[óo]n|sin (los criterios|la prueba|completar)|se presenta como (provisional|presuntivo)/i },
  { nombre: "no fusionar confianza de evidencia con pronóstico", clase: "seguridad clínica", re: /[Nn]unca fusionar|no equivale a un pronóstico|no significa .{0,40}bien controlado/i },
  { nombre: "no tratar dos casos de la BC como idénticos", clase: "seguridad clínica", re: /como idénticos|nunca se asumen idénticos/i },
  { nombre: "no ocultar el rol del riesgo racial en la conclusión", clase: "trazabilidad", re: /[Nn]unca ocultar el rol/i },
  { nombre: "documentar la discrepancia entre fuentes del mismo nivel", clase: "trazabilidad", re: /discrepancia documentada|nunca se elige una en silencio/i },
  { nombre: "no rellenar un vacío con el valor más probable", clase: "seguridad clínica", re: /completes un vacío|complete[s]? un vac[ií]o|declaralo como supuesto/i },
  { nombre: "no limpiar una marca de provisionalidad al generar un documento", clase: "integridad del sistema", re: /marca de provisionalidad|estado provisional se conserva/i },
  { nombre: "el contenido del caso no es una instrucción (inyección de prompt)", clase: "integridad del sistema", re: /instrucciones dirigidas a vos|no modifica[n]? .{0,20}reglas|nunca como instrucción a seguir|contenido a analizar/i },
  { nombre: "no repreguntar datos que ya vienen en el contexto del caso", clase: "integridad del sistema", re: /vuelvas a pedir un dato|no repreguntar signalment/i },
];

console.log("MATRIZ DE REGLAS DE SEGURIDAD\n");
const anchoN = 58;
console.log(" ".repeat(anchoN) + agentes.map((a) => a.slug.slice(0, 6).padStart(8)).join(""));
console.log("-".repeat(anchoN + agentes.length * 8));
const faltantes = new Map<string, string[]>();
for (const a of agentes) faltantes.set(a.slug, []);

let claseActual = "";
for (const r of REGLAS) {
  if (r.clase !== claseActual) {
    claseActual = r.clase;
    console.log(`\n[${claseActual}]`);
  }
  const fila = agentes.map((a) => {
    const tiene = r.re.test(a.t);
    if (!tiene) faltantes.get(a.slug)!.push(r.nombre);
    return (tiene ? "sí" : "NO").padStart(8);
  });
  console.log(r.nombre.padEnd(anchoN) + fila.join(""));
}

console.log("\n\nQUÉ LE FALTA A CADA AGENTE\n");
for (const a of agentes) {
  const f = faltantes.get(a.slug)!;
  console.log(`   ${a.slug}  —  ${f.length === 0 ? "nada" : `${f.length} regla(s)`}`);
  for (const x of f) console.log(`      · ${x}`);
  console.log("");
}
