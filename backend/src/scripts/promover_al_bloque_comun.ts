import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Promueve al bloque común las afirmaciones que hoy tiene un solo agente.
//
// Las diez salen de triaje y de reproducción, y el criterio no fue la
// frecuencia: fueron las que convierten un principio en algo verificable.
// La intersección las habría descartado a las diez.
//
// Reproducción aporta ocho. El encuadre correcto no es que sea el agente
// desviado que hay que alinear: es el que llegó más lejos, y esto trae a
// los otros siete hacia donde él ya estaba.
//
// Se COPIAN verbatim del prompt de origen. Lo único escrito por nosotros
// son las etiquetas que agrupan («Datos faltantes.»), que son encabezados
// y no reglas. El script aborta si una frase no existe literalmente en su
// origen — que es lo que pasó tres veces al reparar neuro, porque las
// había retipeado creyendo copiarlas.
//
//   ts-node promover_al_bloque_comun.ts            simulación
//   ts-node promover_al_bloque_comun.ts --escribir
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const PROMPTS = path.join(DIR, "prompts");
const BLOQUE = path.join(DIR, "reglas_comunes_agentes.md");
const ESCRIBIR = process.argv.includes("--escribir");

interface Promocion {
  etiqueta: string;
  origen: string;
  frases: string[];
  porque: string;
  nota?: string;
}

const PROMOCIONES: Promocion[] = [
  {
    etiqueta: "Datos faltantes",
    origen: "reproduccion.txt",
    frases: [
      "Un dato faltante no es un espacio en blanco: es un hallazgo.",
      "Distinguí tres casos y nombralos distinto: no solicitado, solicitado y pendiente, y no aplicable a la fase.",
      "Ante datos faltantes, priorizá: decí cuál es el que más cambia la conducta, no listes diez pedidos de igual peso.",
    ],
    porque: "Convierte «falta información» en tres estados distintos y en una decisión clínica de prioridad. Los otros siete solo tienen «información faltante» como categoría única.",
  },
  {
    etiqueta: "Valores numéricos",
    origen: "reproduccion.txt",
    frases: [
      "Los números clínicos tienen la apariencia de precisión y son lo que un colega apurado copia sin verificar.",
      "Podés razonar sobre la dirección de un valor —alto, en ascenso, en meseta— sin afirmar el número que lo separa.",
    ],
    porque: "Da el motivo y la salida: por qué un número inventado es peor que una omisión, y qué se puede decir sin inventarlo.",
  },
  {
    etiqueta: "Fuentes que se contradicen",
    origen: "reproduccion.txt",
    frases: ["Mostrá ambas, decí cuál es más confiable y por qué, y señalá qué estudio resolvería la discrepancia."],
    porque: "Los otros siete dicen «se presentan con su discrepancia documentada», que describe una actitud. Esta dice qué hacer.",
  },
  {
    etiqueta: "Confianza verificable",
    origen: "medicina-general-triage.txt",
    frases: ["Si no puede señalarse qué evidencia concreta sostiene un nivel de confianza determinado, ese nivel de confianza está mal asignado."],
    porque: "Convierte «la confianza no la decide sola la IA» en una prueba que se puede aplicar a una respuesta concreta.",
  },
  {
    etiqueta: "Secuencia de razonamiento",
    origen: "medicina-general-triage.txt",
    frases: ["Cada etapa ajusta la probabilidad de las hipótesis activas; ninguna etapa se salta ni se invierte el orden."],
    porque: "Los otros dicen que no se salta el orden; solo triaje dice qué hace cada etapa mientras tanto.",
  },
  {
    etiqueta: "La prueba final",
    origen: "reproduccion.txt",
    frases: [
      "Antes de emitir, preguntate: ¿un colega que actúe sobre esta respuesta sabría exactamente qué es dato, qué es inferencia, qué falta, y cuánto tiempo tiene?",
      "Si la respuesta a cualquiera de esas cuatro es no, la salida no está lista.",
    ],
    porque: "Es un criterio de admisión sobre la salida entera, no sobre una afirmación.",
    nota:
      "La segunda frase NO estaba en las diez aprobadas: la agrego porque sin ella la pregunta es decorativa, " +
      "que es el mismo argumento que usamos para reponer la consecuencia de las cuatro preguntas en neuro. " +
      "Y la primera dice «y cuánto tiempo tiene», que viene del principio temporal propio de reproducción — " +
      "va verbatim porque adaptarla sería reescribirla, pero conviene saber que ese inciso entra con ella.",
  },
  {
    etiqueta: "Estimaciones erradas",
    origen: "reproduccion.txt",
    frases: ["No ocultes una estimación previa que resultó errada."],
    porque: "Sin esto, la trazabilidad cubre lo que se afirmó y no lo que se afirmó y salió mal.",
  },
];

function main() {
  const bloqueActual = fs.readFileSync(BLOQUE, "utf8").replace(/\r\n/g, "\n").trimEnd();

  console.log("VERIFICACIÓN DE ORIGEN — cada frase tiene que existir literal en su prompt\n");
  console.log("etiqueta                      origen              frases  ¿literales?  ¿ya en el bloque?");
  console.log("-".repeat(94));

  let aborta = false;
  const nuevas: Promocion[] = [];
  for (const p of PROMOCIONES) {
    const origen = fs.readFileSync(path.join(PROMPTS, p.origen), "utf8").replace(/\r\n/g, "\n");
    const literales = p.frases.filter((f) => origen.includes(f)).length;
    const yaEsta = p.frases.every((f) => bloqueActual.includes(f));
    console.log(
      `${p.etiqueta.padEnd(30)}${p.origen.replace(".txt", "").padEnd(20)}${String(p.frases.length).padStart(6)}` +
      `${(literales === p.frases.length ? "  sí" : `  ${literales}/${p.frases.length} ←`).padEnd(13)}${yaEsta ? "sí" : "no"}`
    );
    if (literales !== p.frases.length) {
      for (const f of p.frases) if (!origen.includes(f)) console.log(`      NO literal en ${p.origen}: ${JSON.stringify(f.slice(0, 70))}`);
      aborta = true;
    }
    if (!yaEsta) nuevas.push(p);
  }

  if (aborta) { console.log("\n[ABORTA] alguna frase no es una copia. No se escribe nada."); process.exit(1); }
  if (!nuevas.length) { console.log("\nNada que promover: el bloque ya las tiene."); return; }

  const total = nuevas.reduce((n, p) => n + p.frases.length, 0);
  console.log(`\nA PROMOVER: ${total} frases en ${nuevas.length} grupos\n`);
  for (const p of nuevas) {
    console.log(`  ${p.etiqueta}  (${p.origen.replace(".txt", "")})`);
    console.log(`     ${p.porque}`);
    if (p.nota) console.log(`     ATENCIÓN: ${p.nota}`);
    console.log("");
  }

  const adicion = nuevas.map((p) => `${p.etiqueta}. ${p.frases.join(" ")}`).join("\n\n");
  const nuevo = bloqueActual + "\n\n" + adicion;

  console.log(`bloque común: ${bloqueActual.length} → ${nuevo.length} caracteres`);

  if (!ESCRIBIR) { console.log("\n(simulación — nada escrito; correr con --escribir)"); return; }
  fs.writeFileSync(BLOQUE, nuevo + "\n", "utf8");
  console.log("\nESCRITO en reglas_comunes_agentes.md.");
  console.log("Falta propagarlo a los ocho prompts (aplicar_reglas_comunes) y a la base (migración).");
}

main();
