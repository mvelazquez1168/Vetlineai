import fs from "fs";
import path from "path";
import { pool } from "../db";

// ---------------------------------------------------------------------
// Parte el catálogo de componentes en dos documentos, por ámbito:
//
//   RAZONAMIENTO  → bloque A del pedido: lo leen los cuatro caminos.
//   COMPOSICIÓN   → bloque B: solo dashboard, informe y receta.
//
// El corte NO es una interpretación nuestra: usa los encabezados que el
// propio documento trae. Las secciones de composición (Dashboard
// Representation, Modelo de Datos, KPIs…) describen cómo se arma la
// salida y no participan de un turno de chat. Y "Prompt Contract" —la
// sección más grande— está organizada por fases que el documento declara
// ("Durante el análisis clínico" vs "Durante la generación del
// Dashboard"), así que se corta por esas fases.
//
// Reglas duras, verificadas al final:
//   1. Ninguna línea se reescribe. Cada línea de los dos documentos tiene
//      que existir tal cual en el original.
//   2. Ninguna línea se pierde. A + B tiene que dar el original completo.
//
// Escribe dos archivos para revisar. NO toca la base ni el sembrado.
// ---------------------------------------------------------------------

const COMPOSICION = new Set([
  "Información General",
  "Modelo de Datos",
  "Datos Generados",
  "Dashboard Representation",
  "Clinical Report Representation",
  "Knowledge Base Contribution",
  "Integraciones",
  "Variables Derivadas",
  "KPIs",
  "Arquitectura",
]);

// Dentro de Prompt Contract, las fases que son de generación.
const FASE_GENERACION = /generaci[oó]n del dashboard|generaci[oó]n de reportes|base de conocimiento|report composer/i;

interface Linea {
  texto: string;
  destino: "A" | "B";
}

async function main() {
  // Parametrizado: sirve para cualquier catálogo, no solo el de GCIS.
  //   argv[2] = patrón LIKE del nombre del documento
  //   argv[3] = prefijo de los archivos de salida
  const patron = process.argv[2] ?? "GCIS Clinical Components Catalog%";
  const prefijo = process.argv[3] ?? "catalogo_gcis";
  const doc = (
    await pool.query(
      `SELECT nombre, contenido_texto AS t FROM documentos_conocimiento
        WHERE nombre LIKE $1 AND estado = 'activo'`,
      [patron]
    )
  ).rows[0];
  if (!doc) throw new Error(`No se encontró un documento activo que matchee: ${patron}`);
  const original: string[] = doc.t.split("\n");

  const salida: Linea[] = [];
  let seccion: string | null = null;
  let enPromptContract = false;
  let faseEsGeneracion = false;

  for (const linea of original) {
    // Encabezado de componente: pertenece a los dos documentos, es lo que
    // permite leer cada mitad por separado.
    if (/^CC-\d+\s/.test(linea)) {
      seccion = null;
      enPromptContract = false;
      faseEsGeneracion = false;
      salida.push({ texto: linea, destino: "A" });
      salida.push({ texto: linea, destino: "B" });
      continue;
    }

    const m = linea.match(/^\d+\.\s+(.+?)\s*$/);
    if (m) {
      seccion = m[1];
      enPromptContract = /^Prompt Contract/.test(seccion);
      faseEsGeneracion = false;
      salida.push({ texto: linea, destino: destinoDe(seccion, false) });
      continue;
    }

    // Dentro de Prompt Contract, cada fase declarada cambia el destino.
    if (enPromptContract && /^(Al |Durante |En el |Cuando )/i.test(linea.trim()) && linea.trim().length < 80) {
      faseEsGeneracion = FASE_GENERACION.test(linea);
      salida.push({ texto: linea, destino: faseEsGeneracion ? "B" : "A" });
      continue;
    }

    salida.push({ texto: linea, destino: destinoDe(seccion, enPromptContract && faseEsGeneracion) });
  }

  function destinoDe(sec: string | null, faseGen: boolean): "A" | "B" {
    if (faseGen) return "B";
    if (sec && COMPOSICION.has(sec)) return "B";
    return "A"; // encabezado del documento, preámbulos y todo lo clínico
  }

  const lineasA = salida.filter((l) => l.destino === "A").map((l) => l.texto);
  const lineasB = salida.filter((l) => l.destino === "B").map((l) => l.texto);

  // ---------------------------------------------------------------
  // Verificación 1: nada inventado.
  // ---------------------------------------------------------------
  const setOriginal = new Set(original);
  const inventadas = [...lineasA, ...lineasB].filter((l) => !setOriginal.has(l));

  // ---------------------------------------------------------------
  // Verificación 2: nada perdido. Se comparan multiconjuntos, para que
  // no pase una línea duplicada por otra.
  // ---------------------------------------------------------------
  const cuenta = (ls: string[]) => {
    const m = new Map<string, number>();
    for (const l of ls) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const cOriginal = cuenta(original);
  const cPartido = cuenta([...lineasA, ...lineasB]);
  // Los encabezados de componente están a propósito en los dos lados.
  const encabezados = original.filter((l) => /^CC-\d+\s/.test(l));
  for (const e of encabezados) cOriginal.set(e, (cOriginal.get(e) ?? 0) + 1);

  const perdidas: string[] = [];
  for (const [linea, n] of cOriginal) {
    if ((cPartido.get(linea) ?? 0) !== n) perdidas.push(linea);
  }

  const dir = path.join(__dirname, "..", "seed", "plataforma");
  const nombreA = `${doc.nombre} — Razonamiento clínico`;
  const nombreB = `${doc.nombre} — Composición de salida`;
  fs.writeFileSync(path.join(dir, `${prefijo}_razonamiento.md`), lineasA.join("\n"), "utf8");
  fs.writeFileSync(path.join(dir, `${prefijo}_composicion.md`), lineasB.join("\n"), "utf8");

  const chA = lineasA.join("\n").length;
  const chB = lineasB.join("\n").length;
  const chTot = doc.t.length;

  console.log(`\nCatálogo original: ${chTot} caracteres, ${original.length} líneas\n`);
  console.log("DOCUMENTO                                  CHARS      %   BLOQUE");
  console.log("------------------------------------------------------------------");
  console.log(`${nombreA.padEnd(43)}${String(chA).padStart(7)}${String(Math.round((chA / chTot) * 100)).padStart(6)}%   A (los cuatro)`);
  console.log(`${nombreB.padEnd(43)}${String(chB).padStart(7)}${String(Math.round((chB / chTot) * 100)).padStart(6)}%   B (solo generación)`);

  console.log("\nVERIFICACIÓN");
  console.log(`   líneas inventadas (no existen en el original): ${inventadas.length}`);
  if (inventadas.length) inventadas.slice(0, 5).forEach((l) => console.log(`      ${JSON.stringify(l)}`));
  console.log(`   líneas perdidas o descuadradas: ${perdidas.length}`);
  if (perdidas.length) perdidas.slice(0, 5).forEach((l) => console.log(`      ${JSON.stringify(l.slice(0, 70))}`));

  const ok = inventadas.length === 0 && perdidas.length === 0;
  console.log(`\n   ${ok ? "[OK] el corte es literal y completo: nada reescrito, nada perdido." : "[FALLO] revisar antes de usar"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR", err.message ?? err);
  process.exit(1);
});
