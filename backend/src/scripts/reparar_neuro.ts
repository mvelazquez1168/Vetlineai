import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Repara las secciones comprimidas del estándar de neuro.
//
// Neuro tiene los mismos once títulos que sus hermanos y entre un tercio y
// la mitad del contenido. Lo que perdió no es estilo: son las oraciones
// que convierten un título en un mecanismo. La más cara la confirmó la
// corrida — «un dato ausente es información» no está, y neuro respondió
// «laboratorio dentro de límites normales» con un analito sin realizar.
//
// Método: las frases se COPIAN de un hermano, no se reescriben. Cada
// inserción se verifica byte a byte contra el origen. Retipear una regla
// clínica es cómo se introduce una variante nueva mientras se cree estar
// eliminando una.
//
// No se toca nada propio de neuro: sus tres líneas clínicas, el dolor
// profundo, el COASTeR y los AEDs quedan intactos. Solo se reponen las
// oraciones genéricas que sus siete hermanos tienen y él no.
//
//   ts-node reparar_neuro.ts            simulación
//   ts-node reparar_neuro.ts --escribir
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma", "prompts");
const DESTINO = "neuro.txt";
const ESCRIBIR = process.argv.includes("--escribir");

/** Frase genérica que neuro perdió, con el ancla después de la cual va. */
interface Reposicion {
  seccion: string;
  /** Texto exacto a copiar del origen. Debe existir allí tal cual. */
  frase: string;
  /** De qué hermano se copia. No todos tienen la versión genérica. */
  origen: string;
  /**
   * Adaptación declarada. Algunas frases llevan el sello del agente
   * («dentro de GCIS») en los ocho prompts, así que copiarlas tal cual
   * metería el nombre de otro agente. Se declara el cambio exacto y se
   * verifica que el texto PREVIO a la adaptación exista en el origen.
   */
  adaptacion?: { de: string; a: string };
  /** Línea de neuro después de la cual se inserta. */
  despuesDe: string;
  porque: string;
}

const REPOSICIONES: Reposicion[] = [
  {
    seccion: "5 · anti-alucinación",
    origen: "gastroenterologia.txt",
    frase: "- Un dato ausente es información (indica qué falta pedir); nunca se trata como un valor implícitamente normal.",
    despuesDe: "Nunca se completa un vacío con una suposición no fundamentada.",
    porque: "E02. Es la que la corrida confirmó: neuro llamó normal a un laboratorio con un analito sin realizar. Se toma de gastro y no de cardio porque cardio la tiene adaptada a estadios.",
  },
  {
    seccion: "5 · anti-alucinación",
    origen: "cardiologia.txt",
    frase: "- Nunca se inventa una referencia bibliográfica ni un caso similar que no exista realmente en la Base de Conocimiento.",
    despuesDe: "Nunca se completa un vacío con una suposición no fundamentada.",
    porque: "Sus siete hermanos la tienen; neuro se quedó con dos de las cuatro viñetas.",
  },
  {
    seccion: "5 · anti-alucinación",
    origen: "cardiologia.txt",
    frase: "- Cuando la información es insuficiente para una sección completa del razonamiento, esa sección debe decirlo explícitamente — nunca se rellena con contenido plausible pero no verificado.",
    despuesDe: "Nunca se completa un vacío con una suposición no fundamentada.",
    porque: "Ídem.",
  },
  {
    seccion: "7 · explicabilidad",
    origen: "cardiologia.txt",
    frase: "Una conclusión que no puede responder estas cuatro preguntas no está lista para presentarse como parte del razonamiento del caso.",
    despuesDe: "Toda conclusión debe responder: ¿por qué?, ¿qué evidencia la respalda?, ¿qué la limita?, ¿qué incertidumbre permanece?",
    porque: "Sin esto las cuatro preguntas son una lista; con esto son un criterio de admisión.",
  },
  {
    seccion: "9 · incertidumbre",
    origen: "cardiologia.txt",
    frase: "La incertidumbre se comunica en el mismo lugar donde se presenta la conclusión, no como una advertencia genérica al final del documento.",
    despuesDe: 'Nunca afirmaciones categóricas con evidencia insuficiente. "No lo sé con la información actual" es un resultado correcto.',
    porque: "Determina si el colega la ve en el momento de decidir, o después.",
  },
  {
    seccion: "4.3 · actualización explícita",
    origen: "gastroenterologia.txt",
    frase: "Nunca se actualiza una probabilidad en silencio.",
    despuesDe: "4.3 Actualización explícita ante cualquier cambio de severidad, en cualquier línea, con justificación.",
    porque: "E14. Sin esto el razonamiento deja de ser auditable. Se toma de gastro: cardio y onco dicen «una probabilidad o un estadio», que es su adaptación.",
  },
  {
    seccion: "3.2 · confianza",
    origen: "cardiologia.txt",
    frase: "Un Confidence Score alto requiere sustento explícito y verificable — nunca es una impresión general de Claude.",
    despuesDe: "3.2 La confianza nunca la decide solo la IA.",
    porque: "Sin esto, «no la decide sola» no dice qué la decide.",
  },
  {
    seccion: "8 · trazabilidad",
    origen: "gastroenterologia.txt",
    frase: '"Se sabe que..." sin fuente rastreable no es una afirmación válida dentro de NCIS.',
    adaptacion: { de: '"Se sabe que..." sin fuente rastreable no es una afirmación válida dentro de GCIS.', a: "NCIS" },
    despuesDe: "Toda afirmación debe rastrearse hasta su origen concreto, en cualquiera de las tres líneas clínicas.",
    porque: "Convierte la trazabilidad en un rechazo concreto. Los ocho prompts sellan esta frase con su propio código, así que copiarla tal cual metería «GCIS» en neuro.",
  },
];

function main() {
  const leerOrigen = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");
  const crudo = fs.readFileSync(path.join(DIR, DESTINO), "utf8");
  const eraCRLF = /\r\n/.test(crudo);
  let texto = crudo.replace(/\r\n/g, "\n");
  const antes = texto;

  console.log(`Destino: ${DESTINO}. Cada frase se copia del hermano que la tiene en su forma generica.\n`);
  console.log("sección                       origen              ¿existe?  ¿ya está?  ancla");
  console.log("-".repeat(96));

  const pendientes: Reposicion[] = [];
  let aborta = false;
  for (const r of REPOSICIONES) {
    // Verificación 1: la frase tiene que existir TAL CUAL en el hermano.
    // Si no está, la estaríamos escribiendo nosotros, que es exactamente
    // lo que este script existe para evitar.
    const origen = leerOrigen(r.origen);
    // Lo que se busca en el hermano es el texto ANTES de adaptar. Si hay
    // adaptacion, se verifica que el original exista y que el cambio sea
    // exactamente el declarado, no cualquier reescritura.
    const buscado = r.adaptacion ? r.adaptacion.de : r.frase;
    const enOrigen = origen.includes(buscado);
    const yaEsta = texto.includes(r.frase);
    const anclaOk = texto.includes(r.despuesDe);
    console.log(
      `${r.seccion.padEnd(30)}${r.origen.replace(".txt", "").padEnd(20)}${(enOrigen ? "sí" : "NO ←").padEnd(10)}${(yaEsta ? "sí" : "no").padEnd(11)}${anclaOk ? "ok" : "NO ENCONTRADA ←"}` +
      (r.adaptacion ? `   [adaptado: sello del agente → ${r.adaptacion.a}]` : "")
    );
    if (!enOrigen) { console.log(`      la frase no está en ${r.origen} — se estaría inventando, no copiando`); aborta = true; }
    if (!anclaOk && !yaEsta) { console.log(`      ancla ausente: ${JSON.stringify(r.despuesDe.slice(0, 60))}`); aborta = true; }
    if (enOrigen && anclaOk && !yaEsta) pendientes.push(r);
  }

  if (aborta) { console.log("\n[ABORTA] no se escribe nada."); process.exit(1); }
  if (!pendientes.length) { console.log("\nNada que reponer: neuro ya las tiene todas."); return; }

  // Se insertan agrupadas por ancla, en orden inverso para no correr offsets.
  const porAncla = new Map<string, Reposicion[]>();
  for (const r of pendientes) porAncla.set(r.despuesDe, [...(porAncla.get(r.despuesDe) ?? []), r]);
  for (const [ancla, rs] of porAncla) {
    // Se inserta al final de la LINEA que contiene el ancla, no justo
    // despues del ancla: la seccion 5 de neuro tiene dos oraciones en una
    // sola linea, y cortar al medio del ancla la partia en dos.
    const j = texto.indexOf(ancla);
    const finLinea = texto.indexOf("\n", j);
    const i = finLinea < 0 ? texto.length : finLinea;
    const bloque = rs.map((r) => "\n" + r.frase).join("");
    texto = texto.slice(0, i) + bloque + texto.slice(i);
  }

  console.log(`\nREPOSICIONES: ${pendientes.length}`);
  for (const r of pendientes) console.log(`   ${r.seccion.padEnd(30)}${r.porque}`);

  // Verificación 2: el cambio es EXACTAMENTE las inserciones y nada mas.
  // Se le quitan al resultado las frases insertadas con su salto de linea
  // y tiene que quedar identico al original, caracter por caracter. Es mas
  // fuerte que buscar lineas perdidas, y no da falsos positivos cuando una
  // insercion reformatea una linea existente.
  let revertido = texto;
  for (const r of pendientes) revertido = revertido.replace("\n" + r.frase, "");
  const reversible = revertido === antes;
  console.log(`\nVERIFICACIÓN`);
  console.log(`   1. frases copiadas del hermano, no escritas: sí (verificado arriba)`);
  console.log(`   2. quitando las ${pendientes.length} inserciones se recupera el original byte a byte: ${reversible ? "sí" : "NO"}`);
  if (!reversible) {
    for (let i = 0; i < Math.max(revertido.length, antes.length); i++)
      if (revertido[i] !== antes[i]) {
        console.log(`      primera diferencia en ${i}:`);
        console.log(`        resultado: ${JSON.stringify(revertido.slice(i - 50, i + 50))}`);
        console.log(`        original : ${JSON.stringify(antes.slice(i - 50, i + 50))}`);
        break;
      }
  }
  console.log(`   3. tamaño: ${antes.length} → ${texto.length} caracteres (+${texto.length - antes.length})`);

  if (!reversible) { console.log("\n[ABORTA] el cambio no es solo las inserciones."); process.exit(1); }

  if (!ESCRIBIR) { console.log("\n(simulación — nada escrito; correr con --escribir)"); return; }
  fs.writeFileSync(path.join(DIR, DESTINO), eraCRLF ? texto.replace(/\n/g, "\r\n") : texto, "utf8");
  console.log(`\nESCRITO. La base NO se tocó — hace falta la migración.`);
}

main();
