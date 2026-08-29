import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Resuelve los residuos corruptos del prompt buscando la FRASE COMPLETA
// en las fuentes limpias del proyecto. Es el mismo método que resolvió
// "Niveles I–III", generalizado: en vez de buscar palabra suelta (que era
// ambigua: s?? puede ser "sí" o "sé"), busca el vecindario entero.
//
// Cómo funciona. La corrupción convirtió cada byte no-ASCII en un '?'.
// Ese mecanismo se puede reproducir: degradar() aplica exactamente la
// misma transformación. Entonces, para cada residuo se toma una ventana
// de texto alrededor, se la degrada, y se busca esa ventana degradada
// dentro de las fuentes también degradadas. Si una fuente contiene la
// misma frase, la ventana degradada matchea, y el carácter real se lee
// de la fuente limpia en la posición equivalente.
//
// No es adivinar: es encontrar la misma oración escrita en otro lado.
//
// Reglas duras:
//   - Ventana grande primero (60 caracteres a cada lado). Se achica solo
//     si no hubo match, y nunca por debajo de 15: con menos, la frase
//     deja de ser identificatoria.
//   - Si dos fuentes distintas dan lecturas distintas para el mismo
//     residuo, NO se resuelve. Se reporta el conflicto.
//   - Solo REPORTA. No escribe nada. La decisión es del usuario.
// ---------------------------------------------------------------------

const RAIZ = path.join(__dirname, "..", "seed", "plataforma");
const PROMPT = path.join(RAIZ, "prompts", "gastroenterologia.txt");

const degradar = (s: string): string =>
  [...s].map((c) => (c.codePointAt(0)! < 128 ? c : "?".repeat(Buffer.byteLength(c, "utf8")))).join("");

function fuentes(): { nombre: string; texto: string }[] {
  const out: { nombre: string; texto: string }[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(txt|md)$/.test(e.name) && p !== PROMPT)
        out.push({ nombre: path.basename(p), texto: fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n") });
    }
  };
  walk(RAIZ);
  return out;
}

interface Hallazgo {
  fuente: string;
  lectura: string; // el texto real que la fuente tiene donde el prompt tiene '?'
  ventana: number;
}

// Busca la ventana degradada en una fuente y devuelve lo que la fuente
// tiene en la posición del residuo.
function buscarEn(
  f: { nombre: string; texto: string },
  ventanaDeg: string,
  offsetResiduo: number,
  largoResiduo: number,
  w: number
): Hallazgo[] {
  const deg = degradar(f.texto);
  // Mapa posición-degradada → posición-real (un carácter real puede
  // ocupar 2 o 3 posiciones degradadas). Se recorre por code point, igual
  // que degradar(), para que los dos índices no se desalineen.
  const mapa: number[] = [];
  let real = 0;
  for (const c of f.texto) {
    const n = c.codePointAt(0)! < 128 ? 1 : Buffer.byteLength(c, "utf8");
    for (let k = 0; k < n; k++) mapa.push(real);
    real += c.length;
  }
  mapa.push(f.texto.length);
  const res: Hallazgo[] = [];
  let desde = 0;
  for (;;) {
    const j = deg.indexOf(ventanaDeg, desde);
    if (j < 0) break;
    desde = j + 1;
    const inicioReal = mapa[j + offsetResiduo];
    const finReal = mapa[j + offsetResiduo + largoResiduo] ?? f.texto.length;
    const lectura = f.texto.slice(inicioReal, finReal);
    // Guarda estructural: la lectura tiene que degradarse EXACTAMENTE a
    // los mismos '?' que trae el prompt. Si no, el índice está corrido y
    // la lectura es basura — se descarta en vez de reportarse.
    if (degradar(lectura) !== "?".repeat(largoResiduo)) continue;
    res.push({ fuente: f.nombre, lectura, ventana: w });
  }
  return res;
}

function main() {
  const prompt = fs.readFileSync(PROMPT, "utf8").replace(/\r\n/g, "\n");
  const fs_ = fuentes();
  console.log(`Fuentes limpias escaneadas: ${fs_.length}\n`);

  const residuos: { i: number; largo: number }[] = [];
  for (const m of prompt.matchAll(/\?{2,}/g)) residuos.push({ i: m.index!, largo: m[0].length });

  let resueltos = 0;
  const pendientes: string[] = [];

  for (let n = 0; n < residuos.length; n++) {
    const { i, largo } = residuos[n];
    let a = i,
      b = i + largo;
    while (a > 0 && /\S/.test(prompt[a - 1])) a--;
    while (b < prompt.length && /\S/.test(prompt[b])) b++;
    const token = prompt.slice(a, b);

    let hallazgos: Hallazgo[] = [];
    let ventanaUsada = 0;
    for (const w of [60, 40, 25, 15]) {
      const ini = Math.max(0, i - w);
      const ventana = prompt.slice(ini, Math.min(prompt.length, i + largo + w));
      const ventanaDeg = degradar(ventana);
      // El desplazamiento tiene que medirse en el espacio DEGRADADO, no en
      // el real: cada carácter acentuado ya restaurado dentro de la ventana
      // ocupa 2 o 3 posiciones al degradarse, así que `i - ini` se queda
      // corto y la lectura sale corrida.
      const off = degradar(prompt.slice(ini, i)).length;
      const acum: Hallazgo[] = [];
      for (const f of fs_) acum.push(...buscarEn(f, ventanaDeg, off, largo, w));
      if (acum.length > 0) {
        hallazgos = acum;
        ventanaUsada = w;
        break;
      }
    }

    const lecturas = [...new Set(hallazgos.map((h) => h.lectura))];
    const etiqueta = `[${n + 1}] ${token}`;
    if (lecturas.length === 1) {
      resueltos++;
      const fuentesDistintas = [...new Set(hallazgos.map((h) => h.fuente))];
      console.log(`${etiqueta.padEnd(22)} RESUELTO  → ${JSON.stringify(lecturas[0])}`);
      console.log(
        `${" ".repeat(22)} ventana ±${ventanaUsada} car., ${hallazgos.length} coincidencia(s) en ${fuentesDistintas.length} fuente(s): ${fuentesDistintas.slice(0, 3).join(", ")}`
      );
    } else if (lecturas.length > 1) {
      console.log(`${etiqueta.padEnd(22)} CONFLICTO → las fuentes discrepan: ${lecturas.map((l) => JSON.stringify(l)).join(" vs ")}`);
      pendientes.push(etiqueta);
    } else {
      console.log(`${etiqueta.padEnd(22)} SIN EVIDENCIA — la frase no existe en ninguna fuente limpia`);
      pendientes.push(etiqueta);
    }
  }

  console.log(`\nRESUELTOS CON EVIDENCIA: ${resueltos} de ${residuos.length}`);
  if (pendientes.length) console.log(`QUEDAN A CRITERIO DEL USUARIO: ${pendientes.join(", ")}`);
  console.log("\n(este script no escribe nada)");
}

main();
