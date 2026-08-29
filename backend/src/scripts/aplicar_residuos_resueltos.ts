import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Aplica los residuos que quedaron corruptos tras la restauración por
// diccionario, cada uno con la fuente limpia que lo resolvió.
//
// Ninguna sustitución acá es una lectura nuestra del castellano: todas
// salen de encontrar la MISMA FRASE escrita limpia en otro archivo del
// proyecto (resolver_residuos_por_frase.ts). Por eso la columna "fuente"
// no es decorativa — es la única justificación de cada cambio.
//
// Nótese que residuos de forma idéntica se resuelven distinto según la
// frase: "s??" es "sí" en "nunca la confirman por sí solos" y "sé" en
// "no lo sé con la información actual". Eso es exactamente lo que la
// regla de unicidad por palabra suelta no podía decidir, y lo que la
// búsqueda por frase sí decide.
//
// Tres verificaciones, en orden:
//   1. El token en esa posición es el esperado (si no, aborta sin tocar).
//   2. El reemplazo se degrada a los mismos '?' que reemplaza.
//   3. Prueba de ida y vuelta contra el prompt corrupto original.
// Solo escribe si las tres pasan.
// ---------------------------------------------------------------------

const PROMPT = path.join(__dirname, "..", "seed", "plataforma", "prompts", "gastroenterologia.txt");
// El prompt corrupto original, tal como estaba antes de cualquier
// restauración. Se exporta desde el host con
//   git show c8470d4:backend/src/seed/plataforma/prompts/gastroenterologia.txt
// porque dentro del contenedor no hay git ni está montado el repo.
const COMMIT_CORRUPTO = "c8470d4";
const ARCHIVO_CORRUPTO = path.join(__dirname, "..", "..", ".corrupto_original.txt");

interface Residuo {
  n: number; // número de aparición, en orden de aparición en el texto
  token: string; // token completo esperado, como control
  lectura: string; // lo que va en lugar de los '?'
  fuente: string;
}

const RESIDUOS: Residuo[] = [
  { n: 1, token: "??rea", lectura: "Á", fuente: "cardiologia/oncologia/neuro/dermatologia/endocrino: viñeta idéntica" },
  { n: 2, token: "??cidos", lectura: "á", fuente: "6353b4d5 (AI Reasoning Standard) + medicina-general-triage" },
  { n: 3, token: "???", lectura: "→", fuente: "6353b4d5, frase completa" },
  { n: 4, token: "est??", lectura: "á", fuente: "6353b4d5 + 4 prompts hermanos" },
  { n: 5, token: "???", lectura: "→", fuente: "6353b4d5, frase completa" },
  { n: 6, token: "t??pico", lectura: "í", fuente: "6353b4d5 + medicina-general-triage" },
  { n: 7, token: "s??", lectura: "í", fuente: "6353b4d5 + medicina-general-triage + oncologia" },
  { n: 8, token: "???", lectura: "—", fuente: "6353b4d5 + 5 prompts hermanos" },
  { n: 9, token: "est??", lectura: "á", fuente: "6353b4d5 + 5 prompts hermanos" },
  { n: 10, token: "s??", lectura: "é", fuente: "6353b4d5, frase completa" },
  { n: 11, token: "t??picamente", lectura: "í", fuente: "6353b4d5, frase completa" },
  { n: 12, token: "???", lectura: "—", fuente: "6353b4d5, frase completa" },
];

const degradar = (s: string): string =>
  [...s].map((c) => (c.codePointAt(0)! < 128 ? c : "?".repeat(Buffer.byteLength(c, "utf8")))).join("");

function main() {
  const crudo = fs.readFileSync(PROMPT, "utf8");
  const eraCRLF = /\r\n/.test(crudo);
  const original = crudo.replace(/\r\n/g, "\n");

  const apariciones = [...original.matchAll(/\?{2,}/g)].map((m) => ({ i: m.index!, largo: m[0].length }));
  if (apariciones.length !== RESIDUOS.length) {
    console.error(`ABORTA: el prompt tiene ${apariciones.length} residuos y la tabla trae ${RESIDUOS.length}.`);
    process.exit(1);
  }

  // Se construye de atrás para adelante para que los offsets no se corran.
  let texto = original;
  console.log("N   TOKEN            →  LECTURA   FUENTE");
  console.log("-".repeat(96));
  for (let k = RESIDUOS.length - 1; k >= 0; k--) {
    const r = RESIDUOS[k];
    const { i, largo } = apariciones[k];

    // 1. control de token
    let a = i,
      b = i + largo;
    while (a > 0 && /\S/.test(texto[a - 1])) a--;
    while (b < texto.length && /\S/.test(texto[b])) b++;
    const tokenReal = texto.slice(a, b).replace(/[,.)"]+$/, "");
    if (tokenReal !== r.token) {
      console.error(`\nABORTA en [${r.n}]: se esperaba ${JSON.stringify(r.token)} y hay ${JSON.stringify(tokenReal)}.`);
      process.exit(1);
    }
    // 2. el reemplazo degrada a lo que reemplaza
    if (degradar(r.lectura) !== "?".repeat(largo)) {
      console.error(
        `\nABORTA en [${r.n}]: ${JSON.stringify(r.lectura)} se degrada a ${JSON.stringify(degradar(r.lectura))}, no a ${largo} signos.`
      );
      process.exit(1);
    }
    texto = texto.slice(0, i) + r.lectura + texto.slice(i + largo);
  }

  for (const r of RESIDUOS) {
    console.log(`${String(r.n).padEnd(4)}${r.token.padEnd(17)}→  ${r.lectura.padEnd(9)}${r.fuente}`);
  }

  // 3. prueba de ida y vuelta
  if (!fs.existsSync(ARCHIVO_CORRUPTO)) {
    console.error(`\nABORTA: falta ${ARCHIVO_CORRUPTO}. Exportalo con:\n  git show ${COMMIT_CORRUPTO}:backend/src/seed/plataforma/prompts/gastroenterologia.txt > backend/.corrupto_original.txt`);
    process.exit(1);
  }
  const corrupto = fs.readFileSync(ARCHIVO_CORRUPTO, "utf8").replace(/\r\n/g, "\n");

  const ok = degradar(texto) === degradar(corrupto);
  console.log("\nPRUEBA DE IDA Y VUELTA");
  console.log(`   degradar(restaurado) === degradar(corrupto original en ${COMMIT_CORRUPTO})  →  ${ok ? "SÍ" : "NO"}`);
  if (!ok) {
    const x = degradar(texto),
      y = degradar(corrupto);
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if (x[i] !== y[i]) {
        console.error(`   primera diferencia en ${i}:\n      ${JSON.stringify(x.slice(i - 50, i + 50))}\n      ${JSON.stringify(y.slice(i - 50, i + 50))}`);
        break;
      }
    process.exit(1);
  }
  console.log("   [OK] lo único que cambió son los caracteres acentuados.");

  const restantes = (texto.match(/\?{2,}/g) ?? []).length;
  const acentos = [...texto].filter((c) => c.codePointAt(0)! > 127).length;
  console.log(`\n   signos '?' restantes: ${restantes}`);
  console.log(`   caracteres no-ASCII:  ${acentos}`);

  fs.writeFileSync(PROMPT, eraCRLF ? texto.replace(/\n/g, "\r\n") : texto, "utf8");
  console.log(`\nESCRITO en el sembrado (${eraCRLF ? "CRLF" : "LF"}, como estaba). La base NO se tocó.`);
}

main();
