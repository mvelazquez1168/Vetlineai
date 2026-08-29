import fs from "fs";
import path from "path";
import crypto from "crypto";

// ---------------------------------------------------------------------
// Deja el marco de razonamiento clínico listo en el sembrado.
//
// Va como documento único con agente_id NULL — o sea, los nueve agentes lo
// reciben, incluido urología cuando tenga prompt. Es la decisión que ya
// tomamos: un documento no puede derivar, ocho copias sí, y la deriva del
// AI Reasoning Standard (mismos títulos, 14-69 % de solape) es la prueba.
//
// Ámbito clínico: el marco salió entero de la mitad de razonamiento del
// catálogo (71 % de solape) y cero de la mitad de composición, así que
// entra en el bloque que leen los cuatro caminos.
//
// NO hace falta migración, a diferencia de la 074/075/076/077. Aquellas
// tenían que ACTUALIZAR filas existentes, y seedPlataforma inserta con ON
// CONFLICT (id) DO NOTHING. Acá la fila es nueva: su id no existe en
// ninguna base, así que el INSERT del sembrado entra sin conflicto tanto
// en una base nueva como en una ya sembrada.
//
// El id es determinista (hash del nombre), no sorteado: correr esto dos
// veces produce el mismo id y no aparecen documentos duplicados.
//
//   ts-node sembrar_marco_razonamiento.ts            simulación
//   ts-node sembrar_marco_razonamiento.ts --escribir
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const JSON_DOCS = path.join(DIR, "documentos.json");
const DIR_DOCS = path.join(DIR, "documentos");
const FUENTE = path.join(DIR, "marco_razonamiento_clinico.md");
const NOMBRE = "Marco de Razonamiento Clínico — común a todas las especialidades";
const ESCRIBIR = process.argv.includes("--escribir");

function idDeterminista(semilla: string): string {
  const h = crypto.createHash("sha1").update(semilla).digest("hex");
  return [
    h.slice(0, 8), h.slice(8, 12), "4" + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

function main() {
  const contenido = fs.readFileSync(FUENTE, "utf8").replace(/\r\n/g, "\n");
  const docs: any[] = JSON.parse(fs.readFileSync(JSON_DOCS, "utf8"));
  const id = idDeterminista("marco_razonamiento_clinico");

  console.log(`Marco: ${contenido.length} caracteres, ${(contenido.match(/^## /gm) ?? []).length} componentes.`);
  console.log(`id determinista: ${id}\n`);

  if (contenido.includes("{{")) {
    console.error("ABORTA: quedó un marcador sin resolver en el marco.");
    process.exit(1);
  }

  const yaEsta = docs.find((d) => d.id === id || d.nombre === NOMBRE);
  if (yaEsta) {
    console.log("Ya está en documentos.json. Nada que hacer.");
    return;
  }

  const entrada = {
    id,
    nombre: NOMBRE,
    descripcion:
      "Marco de razonamiento común a todas las especialidades, extraído literalmente de las secciones de comportamiento del catálogo de componentes. Alcance general: lo reciben todos los agentes.",
    tipo: docs[0]?.tipo ?? "protocolo",
    agente_slug: null, // ← NULL: llega a los nueve agentes
    pais_codigo: null,
    incluir_en_contexto: true,
    ambito: "clinico" as const,
    estado: "activo",
    contenidoFile: `${id}.txt`,
  };

  console.log("ENTRADA A AGREGAR");
  console.log(`   nombre:              ${entrada.nombre}`);
  console.log(`   agente_slug:         null  → los nueve agentes`);
  console.log(`   ámbito:              ${entrada.ambito}  → bloque que leen los cuatro caminos`);
  console.log(`   incluir_en_contexto: ${entrada.incluir_en_contexto}`);
  console.log(`   tipo:                ${entrada.tipo}`);

  const otrosGenerales = docs.filter((d) => d.agente_slug === null).length;
  console.log(`\n   documentos de alcance general que ya existen: ${otrosGenerales}`);

  if (!ESCRIBIR) {
    console.log("\n(simulación — nada escrito; correr con --escribir)");
    return;
  }

  fs.writeFileSync(path.join(DIR_DOCS, `${id}.txt`), contenido, "utf8");
  docs.push(entrada);
  fs.writeFileSync(JSON_DOCS, JSON.stringify(docs, null, 2) + "\n", "utf8");
  console.log(`\nESCRITO. documentos.json: ${docs.length} entradas.`);
  console.log("Sin migración: la fila es nueva, el INSERT del sembrado entra sin conflicto.");
}

main();
