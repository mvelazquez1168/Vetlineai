import fs from "fs";
import path from "path";
import { pool } from "../db";

// ---------------------------------------------------------------------
// Completa la restauración del prompt de gastroenterología usando textos
// limpios como DICCIONARIO, no como reemplazo.
//
// La diferencia importa: el texto del prompt se queda tal cual —su
// formato, su orden, sus comas— y del documento limpio se toma
// únicamente cómo se escribe cada palabra. Por eso sirve un documento que
// dice lo mismo en otro formato: nunca se copia una línea de ahí.
//
// Cómo funciona: se degrada cada palabra de las fuentes limpias con el
// mismo mecanismo de la corrupción ("Definición" → "Definici??n") y se
// arma un mapa forma-degradada → palabra con acentos. Después se recorre
// el prompt y cada palabra que tenga '?' se busca en el mapa.
//
// Regla de unicidad: si una forma degradada corresponde a MÁS DE UNA
// palabra distinta entre todas las fuentes, no se toca — no hay forma de
// saber cuál era y adivinar sería exactamente lo que evitamos.
//
// La garantía final no es el diccionario, es la prueba: al degradar el
// resultado tiene que reproducir el archivo corrupto carácter por
// carácter. Si una palabra se hubiera cambiado por otra, no daría.
// ---------------------------------------------------------------------

const PROMPT = path.join(__dirname, "..", "seed", "plataforma", "prompts", "gastroenterologia.txt");
// El corrupto de referencia: la versión en la base, que es la que hay que
// reproducir al degradar. El archivo del sembrado ya tiene la restauración
// parcial aplicada.
const degradar = (s: string) =>
  [...s].map((c) => (c.codePointAt(0)! < 128 ? c : "?".repeat(Buffer.byteLength(c, "utf8")))).join("");

const norm = (s: string) => s.replace(/\r\n/g, "\n");

// Una "palabra" incluye los '?' porque son letras perdidas.
// Incluye ¿ y ¡ a propósito: en el texto corrupto "¿Qué" quedó como
// "??Qu??" —un solo token— así que en las fuentes limpias tiene que
// tokenizarse igual o nunca coincidirían.
const RE_PALABRA = /[A-Za-zÁÉÍÓÚÑáéíóúñÜü¿¡?]+/g;

// Un signo de interrogación suelto al final de una palabra ("respalda?")
// es un signo legítimo, no una letra perdida: la corrupción siempre dejó
// rachas de 2 o 3. Solo se considera dañado lo que tenga una racha.
const ESTA_DANADA = (p: string) => /\?{2,}/.test(p);

async function main() {
  const escribir = process.argv.includes("--escribir");

  const prompt = norm(fs.readFileSync(PROMPT, "utf8"));

  // -----------------------------------------------------------------
  // Fuentes del diccionario: todo texto limpio en español del proyecto.
  // Cuantas más fuentes, más cobertura — y la regla de unicidad protege
  // de que una fuente ajena meta una palabra equivocada.
  // -----------------------------------------------------------------
  const fuentes: { nombre: string; texto: string }[] = [];

  const docs = await pool.query(
    `SELECT nombre, contenido_texto FROM documentos_conocimiento
      WHERE contenido_texto IS NOT NULL AND estado = 'activo'`
  );
  for (const d of docs.rows) fuentes.push({ nombre: `doc: ${d.nombre}`, texto: norm(d.contenido_texto) });

  const prompts = await pool.query(
    `SELECT nombre, system_prompt FROM agentes WHERE system_prompt IS NOT NULL AND nombre <> 'Gastroenterología'`
  );
  for (const a of prompts.rows) fuentes.push({ nombre: `prompt: ${a.nombre}`, texto: norm(a.system_prompt) });

  // -----------------------------------------------------------------
  // Mapa forma degradada → palabras limpias distintas.
  // -----------------------------------------------------------------
  const mapa = new Map<string, Set<string>>();
  for (const f of fuentes) {
    for (const m of f.texto.matchAll(RE_PALABRA)) {
      const palabra = m[0];
      if (palabra.includes("?")) continue; // la fuente también está sucia acá
      const deg = degradar(palabra);
      if (deg === palabra) continue; // sin acentos: no aporta nada
      if (!mapa.has(deg)) mapa.set(deg, new Set());
      mapa.get(deg)!.add(palabra);
    }
  }

  // -----------------------------------------------------------------
  // Segundo diccionario, para lo que no es una palabra: guiones largos,
  // puntos suspensivos, comillas tipográficas. No tienen letras, así que
  // el mapa de palabras no los alcanza — se los identifica por su
  // contexto inmediato (un carácter a cada lado), con la misma regla de
  // unicidad: si el mismo contexto aparece con dos caracteres distintos
  // entre todas las fuentes, no se toca.
  // -----------------------------------------------------------------
  const mapaContexto = new Map<string, Set<string>>();
  for (const f of fuentes) {
    for (let i = 0; i < f.texto.length; i++) {
      const c = f.texto[i];
      if (c.codePointAt(0)! < 128) continue;
      if (/[A-Za-zÁÉÍÓÚÑáéíóúñÜü¿¡]/.test(c)) continue; // eso lo cubre el mapa de palabras
      // Ventana de 4 caracteres a cada lado, no 1: con un solo carácter
      // el contexto " ??? " es ambiguo entre nueve símbolos distintos
      // (guión largo, guión corto, flecha, viñetas, ≥…). Con 4 el
      // vecindario exacto identifica el símbolo en 20 de 24 casos, y
      // sigue siendo evidencia de las fuentes, no una suposición.
      const clave = f.texto.slice(Math.max(0, i - 4), i) + degradar(c) + f.texto.slice(i + 1, i + 5);
      if (!mapaContexto.has(clave)) mapaContexto.set(clave, new Set());
      mapaContexto.get(clave)!.add(c);
    }
  }
  const ctxUnicos = [...mapaContexto.values()].filter((s) => s.size === 1).length;
  console.log(`   contextos de símbolos (— … " ") conocidos: ${mapaContexto.size}, únicos: ${ctxUnicos}`);

  const unicas = [...mapa.entries()].filter(([, s]) => s.size === 1).length;
  const ambiguas = [...mapa.entries()].filter(([, s]) => s.size > 1);

  console.log(`\nDICCIONARIO`);
  console.log(`   fuentes limpias: ${fuentes.length}`);
  console.log(`   formas degradadas conocidas: ${mapa.size}`);
  console.log(`   con una sola lectura posible (usables): ${unicas}`);
  console.log(`   ambiguas (NO se usan): ${ambiguas.length}`);
  for (const [deg, set] of ambiguas.slice(0, 6)) {
    console.log(`      ${deg} → ${[...set].join(" / ")}`);
  }

  // -----------------------------------------------------------------
  // Sustitución palabra por palabra.
  // -----------------------------------------------------------------
  let resueltas = 0;
  const noResueltas = new Map<string, number>();

  // Primera pasada: los símbolos sueltos, por contexto. Va antes que las
  // palabras porque un "???" entre espacios no es una palabra y el otro
  // mapa nunca lo alcanzaría.
  let simbolos = 0;
  const conSimbolos = prompt.replace(/\?{2,}/g, (racha, offset: number) => {
    // Solo rachas que NO están pegadas a letras: esas son palabras y las
    // resuelve el mapa de palabras, con más contexto que este.
    const antes = prompt[offset - 1] ?? "";
    const despues = prompt[offset + racha.length] ?? "";
    if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(antes) || /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(despues)) return racha;
    const clave =
      prompt.slice(Math.max(0, offset - 4), offset) + racha + prompt.slice(offset + racha.length, offset + racha.length + 4);
    const candidatas = mapaContexto.get(clave);
    if (!candidatas || candidatas.size !== 1) return racha;
    const c = [...candidatas][0];
    if (degradar(c) !== racha) return racha;
    simbolos++;
    return c;
  });

  const restaurado = conSimbolos.replace(RE_PALABRA, (palabra) => {
    if (!ESTA_DANADA(palabra)) return palabra;
    // Un '?' final suelto es un signo de interrogación legítimo que quedó
    // pegado al token: se busca la palabra sin él y se lo devuelve después.
    const cola = /[^?]\?$/.test(palabra) ? "?" : "";
    const nucleo = cola ? palabra.slice(0, -1) : palabra;
    const candidatas = mapa.get(palabra) ?? mapa.get(nucleo);
    if (!candidatas || candidatas.size !== 1) {
      noResueltas.set(palabra, (noResueltas.get(palabra) ?? 0) + 1);
      return palabra;
    }
    const elegida = [...candidatas][0] + (mapa.get(palabra) ? "" : cola);
    // Cinturón adicional: la elegida tiene que degradar exactamente a lo
    // que había. Si no, algo está mal en el mapa y no se toca.
    if (degradar(elegida) !== palabra) {
      noResueltas.set(palabra, (noResueltas.get(palabra) ?? 0) + 1);
      return palabra;
    }
    resueltas++;
    return elegida;
  });

  // -----------------------------------------------------------------
  // LA PRUEBA. El ancla NO es el archivo de entrada —que ya tiene la
  // restauración parcial aplicada, con acentos reales— sino el prompt
  // corrupto tal como estaba antes de tocar nada. Degradar el resultado
  // final tiene que reproducirlo carácter por carácter: eso demuestra
  // que, sumando las dos etapas, lo único que cambió son los acentos.
  // -----------------------------------------------------------------
  const rutaCorrupto = process.argv[2];
  if (!rutaCorrupto || rutaCorrupto.startsWith("--")) {
    throw new Error("Falta la ruta al prompt corrupto original (el ancla de la prueba).");
  }
  const corruptoOriginal = norm(fs.readFileSync(rutaCorrupto, "utf8"));
  // Se degradan LOS DOS lados. El corrupto original ya trae tramos limpios
  // (los bloques que se insertaron después), así que compararlo crudo
  // contra el degradado daría distinto por esos tramos, no por un error.
  // Degradando ambos: un acento del original y un acento restaurado
  // colapsan los dos a '??', y cualquier cambio en el texto ASCII —una
  // palabra, una coma, el orden— rompe la igualdad.
  const pruebaReal = degradar(restaurado) === degradar(corruptoOriginal);

  console.log(`\nSUSTITUCIÓN`);
  console.log(`   palabras restauradas: ${resueltas}`);
  console.log(`   signos '?': ${(prompt.match(/\?/g) || []).length} → ${(restaurado.match(/\?/g) || []).length}`);
  console.log(`   acentos:    ${(prompt.match(/[áéíóúñÁÉÍÓÚÑ]/g) || []).length} → ${(restaurado.match(/[áéíóúñÁÉÍÓÚÑ]/g) || []).length}`);

  console.log(`\nPRUEBA DE IDA Y VUELTA`);
  console.log(`   ancla: el prompt corrupto original (${corruptoOriginal.length} chars)`);
  console.log(`   ¿degradar(restaurado) === degradar(corrupto original)?  ${pruebaReal ? "SÍ" : "NO"}`);
  if (!pruebaReal) {
    let i = 0;
    const d = degradar(restaurado);
    const dc = degradar(corruptoOriginal);
    while (i < d.length && d[i] === dc[i]) i++;
    console.log(`   primera diferencia en ${i}:`);
    console.log(`      degradado: ${JSON.stringify(d.slice(Math.max(0, i - 60), i + 60))}`);
    console.log(`      corrupto : ${JSON.stringify(degradar(corruptoOriginal).slice(Math.max(0, i - 60), i + 60))}`);
    process.exit(1);
  }
  console.log(`   [OK] lo único que cambió son los caracteres acentuados.`);

  if (noResueltas.size > 0) {
    const total = [...noResueltas.values()].reduce((a, b) => a + b, 0);
    console.log(`\nTRAMOS QUE QUEDAN CORRUPTOS: ${noResueltas.size} palabras distintas, ${total} apariciones`);
    console.log("   (sin lectura única en ninguna fuente limpia — no se tocaron)");
    for (const [p, n] of [...noResueltas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      const cand = mapa.get(p);
      console.log(`   ${String(n).padStart(3)}x  ${p.padEnd(28)} ${cand ? "ambigua: " + [...cand].join(" / ") : "sin candidata"}`);
    }
  } else {
    console.log(`\n   No queda ninguna palabra corrupta.`);
  }

  if (escribir) {
    const crlf = fs.readFileSync(PROMPT, "utf8").includes("\r\n");
    fs.writeFileSync(PROMPT, crlf ? restaurado.replace(/\n/g, "\r\n") : restaurado, "utf8");
    console.log(`\n   ESCRITO en el sembrado. La base NO se tocó.`);
  } else {
    console.log(`\n   (no se escribió nada — agregar --escribir)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err.message ?? err);
  process.exit(1);
});
