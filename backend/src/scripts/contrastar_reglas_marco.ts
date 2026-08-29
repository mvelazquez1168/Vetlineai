import fs from "fs";
import path from "path";

// Contraste puntual: reglas que el marco afirma, contra lo que los
// prompts dicen del mismo tema. No busca texto igual (ya se sabe que no
// hay duplicación literal): busca los lugares donde los dos hablan del
// mismo asunto, para poder leerlos juntos y decidir si dicen lo mismo.

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const P = path.join(DIR, "prompts");
const leer = (f: string) => fs.readFileSync(path.join(P, f), "utf8").replace(/\r\n/g, "\n");
const agentes = fs.readdirSync(P).filter((f) => f.endsWith(".txt")).map((f) => ({ slug: f.replace(".txt", ""), t: leer(f) }));

// --- 1. reglas duras compartidas: quién tiene cada una ---
const REGLAS_COMUNES = [
  { nombre: "no diagnosticar por raza frecuente", re: /solo porque es frecuente en la raza/i },
  { nombre: "no indicar dosis específicas", re: /Nunca indicar dosis específicas/i },
  { nombre: "no tratar dos casos de la BC como idénticos", re: /dos casos de la Base de Conocimiento como idénticos/i },
  { nombre: "no ocultar el rol del riesgo racial", re: /Nunca ocultar el rol que jug/i },
  { nombre: "no fusionar confianza con pronóstico", re: /Nunca fusionar/i },
  { nombre: "no dar por definitivo lo que requiere confirmación", re: /requiere confirmaci[óo]n/i },
];
console.log("REGLAS DURAS: QUIÉN TIENE CADA UNA\n");
console.log("regla".padEnd(52) + agentes.map((a) => a.slug.slice(0, 6).padStart(8)).join(""));
console.log("-".repeat(52 + agentes.length * 8));
for (const r of REGLAS_COMUNES) {
  console.log(r.nombre.padEnd(52) + agentes.map((a) => (r.re.test(a.t) ? "sí" : "—").padStart(8)).join(""));
}

// --- 2. temas donde el marco podría chocar con el prompt ---
const TEMAS = [
  { tema: "CC-003: nunca reabrir un caso cerrado sin indicación", re: /cerrad[oa]|reabr|reapertura/i },
  { tema: "CC-106: calcular únicamente escalas validadas", re: /escala|score|COASTeR|estadio|puntuaci/i },
  { tema: "CC-105: nunca recomendar marcas comerciales", re: /marca comercial|marcas comerciales|dieta/i },
  { tema: "CC-231: histopatología como evidencia de mayor peso", re: /histopatolog/i },
  { tema: "CC-005: nunca eliminar problemas históricos", re: /problemas? activos?|problema hist/i },
  { tema: "CC-002: nunca asumir la raza si no fue indicada", re: /asumir la raza|raza no (fue )?indicada/i },
];
console.log("\n\nDÓNDE HABLA CADA PROMPT DE LOS MISMOS TEMAS\n");
for (const t of TEMAS) {
  console.log(`### ${t.tema}`);
  for (const a of agentes) {
    const hits = a.t
      .split("\n")
      .filter((l) => t.re.test(l) && l.trim().length > 25)
      .map((l) => l.trim());
    if (!hits.length) continue;
    console.log(`   ${a.slug}:`);
    for (const h of hits.slice(0, 3)) console.log(`      ${h.slice(0, 160)}`);
    if (hits.length > 3) console.log(`      (+${hits.length - 3} línea(s) más)`);
  }
  console.log("");
}
