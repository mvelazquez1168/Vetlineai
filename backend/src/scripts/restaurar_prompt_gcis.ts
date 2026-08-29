import fs from "fs";
import path from "path";
import { pool } from "../db";

// ---------------------------------------------------------------------
// Restaura el system_prompt de gastroenterología copiando de fuentes
// limpias. Cero inferencia: no se adivina un solo carácter.
//
// La corrupción convirtió cada byte no-ASCII en un '?' literal — "í" (2
// bytes) quedó "??", "—" (3 bytes) quedó "???". Es una pérdida: '??' no
// dice qué letra era. Por eso se copia, no se deduce.
//
// El prompt resultó ser un collage de cuatro tramos, no "cabeza corrupta
// + cola limpia":
//
//   1. Project Instructions v3.1        corrupto → se restaura del .txt
//   2. bloque de respuestas del chat    limpio   → se conserva tal cual
//   3. resto de Project Instructions    corrupto → se restaura del .txt
//   4. AI Reasoning Standard            corrupto → se restaura del
//                                                   documento homónimo de
//                                                   documentos_conocimiento
//   5. Regla de contexto del caso       limpio   → se conserva tal cual
//
// Los bloques limpios fueron INSERTADOS después, en medio del texto
// dañado. La alineación los detecta sola: avanza por cada fuente
// degradada y, cuando el prompt se aparta, busca dónde vuelve a
// engancharse; lo del medio es un injerto y no se toca.
//
// Regla dura: lo único que puede cambiar son los caracteres acentuados.
// Se demuestra tramo por tramo — los restaurados, degradándolos y
// comparándolos con el corrupto; los conservados, exigiendo que sean
// idénticos byte a byte.
//
// Uso:
//   ... restaurar_prompt_gcis.ts <original.txt>             (revisar)
//   ... restaurar_prompt_gcis.ts <original.txt> --escribir  (aplicar al sembrado)
// ---------------------------------------------------------------------

const PROMPT = path.join(__dirname, "..", "seed", "plataforma", "prompts", "gastroenterologia.txt");

const degradar = (s: string) =>
  [...s].map((c) => (c.codePointAt(0)! < 128 ? c : "?".repeat(Buffer.byteLength(c, "utf8")))).join("");

const norm = (s: string) => s.replace(/\r\n/g, "\n");

interface Tramo {
  tipo: "restaurado" | "conservado" | "SIN FUENTE";
  fuente: string;
  desde: number;
  hasta: number;
  limpio: string;
  corrupto: string;
}

// Recorre el prompt corrupto consumiendo las fuentes en orden. Lo que no
// cubre ninguna fuente se conserva tal cual y se marca.
function alinear(fuentes: { nombre: string; texto: string }[], corrupto: string): Tramo[] {
  const tramos: Tramo[] = [];
  let ic = 0;

  for (const fuente of fuentes) {
    const deg = degradar(fuente.texto);
    // ¿Dónde empieza esta fuente dentro de lo que queda del prompt?
    const inicio = corrupto.indexOf(deg.slice(0, 120), ic);
    if (inicio < 0) {
      throw new Error(`La fuente "${fuente.nombre}" no se encuentra en el prompt a partir de ${ic}.`);
    }
    if (inicio > ic) {
      tramos.push({
        tipo: "conservado",
        fuente: "—",
        desde: ic,
        hasta: inicio,
        limpio: corrupto.slice(ic, inicio),
        corrupto: corrupto.slice(ic, inicio),
      });
      ic = inicio;
    }

    // Consume la fuente, saltando los injertos que puedan partirla.
    let io = 0;
    while (io < deg.length) {
      let n = 0;
      while (io + n < deg.length && ic + n < corrupto.length && deg[io + n] === corrupto[ic + n]) n++;
      if (n > 0) {
        const finOriginal = posEnOriginal(fuente.texto, io, n);
        tramos.push({
          tipo: "restaurado",
          fuente: fuente.nombre,
          desde: ic,
          hasta: ic + n,
          limpio: fuente.texto.slice(posEnOriginal(fuente.texto, 0, io), finOriginal),
          corrupto: corrupto.slice(ic, ic + n),
        });
        io += n;
        ic += n;
        if (io >= deg.length) break;
      }
      const ancla = deg.slice(io, io + 120);
      const j = corrupto.indexOf(ancla, ic);
      if (j < 0) break; // la fuente se terminó de aplicar
      tramos.push({
        tipo: "conservado",
        fuente: "—",
        desde: ic,
        hasta: j,
        limpio: corrupto.slice(ic, j),
        corrupto: corrupto.slice(ic, j),
      });
      ic = j;
    }
  }

  if (ic < corrupto.length) {
    const resto = corrupto.slice(ic);
    tramos.push({
      tipo: /\?{2,}/.test(resto) ? "SIN FUENTE" : "conservado",
      fuente: "—",
      desde: ic,
      hasta: corrupto.length,
      limpio: resto,
      corrupto: resto,
    });
  }
  return tramos;
}

function posEnOriginal(original: string, desdeDeg: number, largoDeg: number): number {
  let usado = 0;
  let i = 0;
  // avanzar hasta desdeDeg
  while (i < original.length && usado < desdeDeg) {
    const c = original.codePointAt(i)!;
    usado += c < 128 ? 1 : Buffer.byteLength(String.fromCodePoint(c), "utf8");
    i += String.fromCodePoint(c).length;
  }
  if (largoDeg === 0) return i;
  let usado2 = 0;
  while (i < original.length && usado2 < largoDeg) {
    const c = original.codePointAt(i)!;
    const ancho = c < 128 ? 1 : Buffer.byteLength(String.fromCodePoint(c), "utf8");
    if (usado2 + ancho > largoDeg) break;
    usado2 += ancho;
    i += String.fromCodePoint(c).length;
  }
  return i;
}

async function main() {
  const rutaOriginal = process.argv[2];
  const escribir = process.argv.includes("--escribir");
  // Permite aplicar solo lo que tiene fuente limpia verificada, dejando
  // los tramos sin fuente exactamente como están (siguen corruptos).
  const parcial = process.argv.includes("--parcial");
  if (!rutaOriginal) throw new Error("Falta la ruta al documento original v3.1.");

  const crlf = fs.readFileSync(PROMPT, "utf8").includes("\r\n");
  const corrupto = norm(fs.readFileSync(PROMPT, "utf8"));

  const razonamiento = (
    await pool.query(
      `SELECT contenido_texto AS t FROM documentos_conocimiento
        WHERE nombre LIKE '%AI Reasoning Standard%' AND estado = 'activo' LIMIT 1`
    )
  ).rows[0];

  const fuentes = [
    { nombre: "Project Instructions v3.1 (archivo)", texto: norm(fs.readFileSync(rutaOriginal, "utf8")) },
    { nombre: "GCIS AI Reasoning Standard (base)", texto: norm(razonamiento.t) },
  ];

  const tramos = alinear(fuentes, corrupto);
  const restaurado = tramos.map((t) => t.limpio).join("");

  console.log("\nTRAMOS DEL PROMPT (posiciones sobre texto normalizado a LF)");
  console.log("--------------------------------------------------------------------------");
  for (const t of tramos) {
    const etiqueta =
      t.tipo === "restaurado"
        ? `restaurado ← ${t.fuente}`
        : t.tipo === "conservado"
          ? "insertado después — se conserva intacto"
          : "!!! SIN FUENTE LIMPIA — sigue corrupto";
    console.log(
      `${String(t.desde).padStart(6)} → ${String(t.hasta).padStart(6)}  ${String(t.hasta - t.desde).padStart(6)} chars  ${etiqueta}`
    );
    console.log(`         ${JSON.stringify(t.corrupto.slice(0, 62).replace(/\n/g, "\\n"))}`);
  }

  // ---------------------------------------------------------------
  // Prueba tramo por tramo.
  // ---------------------------------------------------------------
  console.log("\nPRUEBA POR TRAMO");
  console.log("--------------------------------------------------------------------------");
  let ok = true;
  for (const t of tramos) {
    let bien: boolean;
    let detalle: string;
    if (t.tipo === "restaurado") {
      bien = degradar(t.limpio) === t.corrupto;
      detalle = "degradar(restaurado) === corrupto";
    } else {
      bien = t.limpio === t.corrupto;
      detalle = "idéntico al original, sin tocar";
    }
    if (!bien) ok = false;
    console.log(`   [${bien ? "OK" : "FALLO"}] ${String(t.desde).padStart(6)}-${String(t.hasta).padStart(6)}  ${detalle}`);
  }

  const global = degradar(restaurado.replace(/[áéíóúñÁÉÍÓÚÑ¿—""…]/g, (c) => c)) ;
  void global;

  const sinFuente = tramos.filter((t) => t.tipo === "SIN FUENTE");
  const acentos = (s: string) => (s.match(/[áéíóúñÁÉÍÓÚÑ]/g) || []).length;
  const interrog = (s: string) => (s.match(/\?/g) || []).length;

  console.log("\nRESULTADO");
  console.log("--------------------------------------------------------------------------");
  console.log(`   longitud:   ${corrupto.length} → ${restaurado.length}`);
  console.log(`   acentos:    ${acentos(corrupto)} → ${acentos(restaurado)}`);
  console.log(`   signos '?': ${interrog(corrupto)} → ${interrog(restaurado)}`);
  console.log(`   tramos sin fuente limpia: ${sinFuente.length}`);

  if (!ok) {
    console.log("\n   NO se escribe: hay tramos que no pasaron su prueba.");
    process.exit(1);
  }
  if (sinFuente.length > 0 && !parcial) {
    const faltan = sinFuente.reduce((a, t) => a + (t.hasta - t.desde), 0);
    console.log(`\n   NO se escribe: ${faltan} caracteres siguen sin fuente limpia.`);
    console.log("   Con --parcial se aplica solo lo verificado y esos tramos quedan como están.");
    process.exit(1);
  }
  console.log(
    `\n   [OK] cada tramo restaurado reproduce el corrupto al degradarlo, y cada\n` +
      `        tramo conservado quedó idéntico. Lo único que cambió son los acentos.`
  );

  if (escribir) {
    fs.writeFileSync(PROMPT, crlf ? restaurado.replace(/\n/g, "\r\n") : restaurado, "utf8");
    console.log(`\n   ESCRITO en el sembrado (${crlf ? "CRLF" : "LF"}, como estaba).`);
    console.log("   La base NO se tocó — el despliegue lo hacés vos.");
  } else {
    console.log("\n   (no se escribió nada — agregar --escribir para aplicarlo al sembrado)");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err.message ?? err);
  process.exit(1);
});
