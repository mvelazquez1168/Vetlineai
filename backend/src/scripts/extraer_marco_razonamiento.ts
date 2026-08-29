import fs from "fs";
import path from "path";
import { pool } from "../db";

// ---------------------------------------------------------------------
// Extrae el marco de razonamiento compartido a partir de las secciones
// "AI Behaviour" del catálogo de GCIS: el 84% que sirve para cualquier
// especialidad, con las tres líneas que nombran gastro convertidas en un
// hueco que cada agente completa.
//
// La extracción es literal: no reescribe ni resume ninguna línea. Lo
// único que cambia son las tres sustituciones declaradas abajo, y el
// script las verifica una por una — si el texto del catálogo cambiara y
// alguna dejara de coincidir, falla en vez de producir un documento con
// una línea sin sustituir.
//
// Al final comprueba que CADA línea de contenido del documento generado
// exista tal cual en el catálogo original (salvo las sustituidas). Es la
// prueba de que no se inventó nada.
//
// NO toca la base ni el sembrado: escribe un archivo para revisar.
// ---------------------------------------------------------------------

// Marco puro: nada de lo que dicen depende de la especialidad.
const GENERICO = [
  "CC-001", "CC-002", "CC-003", "CC-004", "CC-005", "CC-102",
  "CC-104", "CC-106", "CC-107", "CC-202", "CC-204", "CC-220",
  "CC-231", "CC-240",
];

// Genéricos con una sola línea que nombra gastro.
const AJUSTABLES = ["CC-105", "CC-201", "CC-203"];

// Las tres sustituciones, declaradas explícitamente. `de` tiene que
// coincidir carácter por carácter con el catálogo; si no, el script para.
const SUSTITUCIONES: { componente: string; de: string; a: string }[] = [
  {
    componente: "CC-201",
    de: "- Identificar patrones hematológicos compatibles con enfermedades gastrointestinales.",
    a: "- Identificar patrones hematológicos compatibles con enfermedades de {{ESPECIALIDAD}}.",
  },
  {
    componente: "CC-203",
    de: "- Relacionar las alteraciones con la fisiopatología gastrointestinal.",
    a: "- Relacionar las alteraciones con la fisiopatología de {{ESPECIALIDAD}}.",
  },
  {
    componente: "CC-105",
    de: "- Relacionar la evolución nutricional con laboratorios (ej. albúmina, proteínas totales, cobalamina) y signos clínicos.",
    a: "- Relacionar la evolución nutricional con laboratorios (ej. albúmina, proteínas totales, y los marcadores propios de {{ESPECIALIDAD}}) y signos clínicos.",
  },
];

const CABECERA = `# Marco de Razonamiento Clínico — común a todas las especialidades

Este documento reúne el marco de razonamiento que hoy vive disperso en las
secciones "AI Behaviour" del catálogo de componentes de GCIS. Se extrajo
literalmente: ninguna línea fue reescrita ni resumida.

Aplica igual a cualquier especialidad. Donde el texto original nombraba
gastroenterología y el resto de la línea era genérico, el nombre se
reemplazó por el hueco {{ESPECIALIDAD}}, que cada agente completa con el
suyo — "gastroenterología", "cardiología", "dermatología", etc.

Lo propio de cada especialidad (qué se busca, con qué estudios) NO está
acá: vive en los documentos clínicos de cada agente.

---
`;

async function main() {
  const catalogo = (
    await pool.query(
      `SELECT contenido_texto AS t FROM documentos_conocimiento
        WHERE nombre LIKE 'GCIS Clinical Components Catalog%' AND estado = 'activo'`
    )
  ).rows[0].t as string;

  const lineas = catalogo.split("\n");
  let comp: string | null = null;
  let nombre = "";
  let dentro = false;
  const secciones: { id: string; nombre: string; lineas: string[] }[] = [];
  let actual: (typeof secciones)[number] | null = null;

  for (const x of lineas) {
    const c = x.match(/^(CC-\d+)\s*[–—-]?\s*(.*)$/);
    if (c && x.length < 90) {
      comp = c[1];
      nombre = (c[2] || "").trim();
      dentro = false;
    }
    if (/^\d+\.\s+AI Behaviour\s*$/.test(x)) {
      dentro = true;
      actual = { id: comp ?? "?", nombre, lineas: [] };
      secciones.push(actual);
      continue;
    }
    if (dentro && (/^\d+\.\s+\S/.test(x) || /^CC-\d+\s/.test(x))) dentro = false;
    if (dentro && actual && x.trim()) actual.lineas.push(x.trim());
  }

  const incluidas = secciones.filter((s) => GENERICO.includes(s.id) || AJUSTABLES.includes(s.id));

  // Verificación de las sustituciones ANTES de escribir nada.
  for (const s of SUSTITUCIONES) {
    const enCatalogo = incluidas.some((sec) => sec.id === s.componente && sec.lineas.includes(s.de));
    if (!enCatalogo) {
      throw new Error(
        `La línea a sustituir en ${s.componente} ya no coincide con el catálogo:\n  "${s.de}"\n` +
          `El catálogo cambió — revisar antes de regenerar.`
      );
    }
  }

  const sustituir = (id: string, linea: string) => {
    for (const s of SUSTITUCIONES) if (s.componente === id && linea === s.de) return s.a;
    return linea;
  };

  // El catálogo trae dos secciones bajo CC-102 con contenido distinto: la
  // segunda es evolución de signos, que en el propio catálogo se referencia
  // como CC-103 (Clinical Signs Registry). NO se renumera acá — se deja
  // marcado, pendiente de decisión.
  let vistoCC102 = 0;
  const cuerpo: string[] = [];
  const lineasGeneradas: { linea: string; sustituida: boolean }[] = [];

  for (const s of incluidas) {
    let titulo = `## ${s.id} — ${s.nombre.replace(/^—\s*/, "")}`;
    if (s.id === "CC-102") {
      vistoCC102++;
      if (vistoCC102 === 2) {
        titulo +=
          "\n\n> Ojo: en el catálogo original esta sección también figura como CC-102, pero su\n" +
          "> contenido es evolución de signos clínicos — lo que el mismo catálogo referencia\n" +
          "> como CC-103 (Clinical Signs Registry). Sin renumerar, pendiente de decisión.";
      }
    }
    if (AJUSTABLES.includes(s.id)) {
      titulo += "\n\n> Completar {{ESPECIALIDAD}} con la especialidad del agente.";
    }
    cuerpo.push(titulo, "");
    for (const l of s.lineas) {
      const nueva = sustituir(s.id, l);
      cuerpo.push(nueva);
      lineasGeneradas.push({ linea: nueva, sustituida: nueva !== l });
    }
    cuerpo.push("");
  }

  const documento = CABECERA + "\n" + cuerpo.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  const destino = path.join(__dirname, "..", "seed", "plataforma", "marco_razonamiento_clinico.md");
  fs.writeFileSync(destino, documento, "utf8");

  // ---------------------------------------------------------------
  // Prueba: toda línea de contenido tiene que existir tal cual en el
  // catálogo, salvo las tres sustituidas.
  // ---------------------------------------------------------------
  const setCatalogo = new Set(lineas.map((l) => l.trim()));
  const inventadas = lineasGeneradas.filter((g) => !g.sustituida && !setCatalogo.has(g.linea));

  console.log(`\nDocumento generado: ${destino}`);
  console.log(`   componentes incluidos: ${incluidas.length} de ${secciones.length}`);
  console.log(`   caracteres: ${documento.length}`);
  console.log(`\nVERIFICACIÓN`);
  console.log(`   líneas de contenido: ${lineasGeneradas.length}`);
  console.log(`   sustituidas (las tres declaradas): ${lineasGeneradas.filter((g) => g.sustituida).length}`);
  console.log(`   líneas que NO existen literal en el catálogo: ${inventadas.length}`);
  if (inventadas.length > 0) {
    console.log("   FALLO — se inventó contenido:");
    inventadas.slice(0, 10).forEach((g) => console.log(`      ${JSON.stringify(g.linea)}`));
    process.exit(1);
  }
  console.log(`   [OK] ninguna línea inventada: el marco es extracción literal.`);

  const excluidas = secciones.filter((s) => !GENERICO.includes(s.id) && !AJUSTABLES.includes(s.id));
  console.log(`\n   quedaron fuera (propios de gastro): ${excluidas.map((s) => s.id).join(", ")}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err.message ?? err);
  process.exit(1);
});
