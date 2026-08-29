import fs from "fs";
import path from "path";
import { pool } from "../db";

// ---------------------------------------------------------------------
// Aplica la partición del catálogo de componentes: reemplaza el documento
// único por dos, uno en cada ámbito (ver migración 073).
//
// El contenido sale de partir_catalogo_componentes.ts, que ya verificó
// que el corte es literal y completo. Este script no vuelve a cortar: lee
// los dos archivos generados y comprueba, antes de escribir en la base,
// que sigan siendo exactamente el original — si alguien los editó a mano
// entremedio, para.
//
// El original NO se borra: pasa a estado 'archivado', que es como el resto
// del sistema retira un documento sin perderlo. Se puede volver atrás
// reactivándolo y archivando los dos nuevos.
//
// Con --revertir deshace exactamente eso.
// ---------------------------------------------------------------------

const NOMBRE_ORIGINAL = "GCIS Clinical Components Catalog v2.0 (GCIS-ARCH-001)";
const NOMBRE_A = "GCIS Clinical Components Catalog — Razonamiento clínico (GCIS-ARCH-001-A)";
const NOMBRE_B = "GCIS Clinical Components Catalog — Composición de salida (GCIS-ARCH-001-B)";

async function revertir() {
  await pool.query(`UPDATE documentos_conocimiento SET estado = 'archivado' WHERE nombre IN ($1, $2)`, [
    NOMBRE_A,
    NOMBRE_B,
  ]);
  const r = await pool.query(
    `UPDATE documentos_conocimiento SET estado = 'activo' WHERE nombre = $1 RETURNING id`,
    [NOMBRE_ORIGINAL]
  );
  console.log(`Revertido: original reactivado (${r.rowCount} fila), las dos partes archivadas.`);
  process.exit(0);
}

async function main() {
  if (process.argv[2] === "--revertir") return revertir();

  const dir = path.join(__dirname, "..", "seed", "plataforma");
  const textoA = fs.readFileSync(path.join(dir, "catalogo_gcis_razonamiento.md"), "utf8");
  const textoB = fs.readFileSync(path.join(dir, "catalogo_gcis_composicion.md"), "utf8");

  const orig = (
    await pool.query(
      `SELECT id, tipo, agente_id, archivo_ref, version, cargado_por, pais_codigo, contenido_texto
         FROM documentos_conocimiento WHERE nombre = $1`,
      [NOMBRE_ORIGINAL]
    )
  ).rows[0];
  if (!orig) throw new Error(`No se encontró el documento original: ${NOMBRE_ORIGINAL}`);

  // -----------------------------------------------------------------
  // Comprobación antes de tocar la base: las dos partes juntas tienen que
  // ser el original. Se comparan como multiconjuntos de líneas, con los
  // encabezados de componente contados dos veces (están en los dos lados
  // a propósito, para poder leer cada mitad por separado).
  // -----------------------------------------------------------------
  const cuenta = (ls: string[]) => {
    const m = new Map<string, number>();
    for (const l of ls) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const original: string[] = orig.contenido_texto.split("\n");
  const esperado = cuenta(original);
  for (const l of original) if (/^CC-\d+\s/.test(l)) esperado.set(l, (esperado.get(l) ?? 0) + 1);
  const obtenido = cuenta([...textoA.split("\n"), ...textoB.split("\n")]);

  const descuadres: string[] = [];
  for (const [linea, n] of esperado) if ((obtenido.get(linea) ?? 0) !== n) descuadres.push(linea);
  for (const [linea] of obtenido) if (!esperado.has(linea)) descuadres.push(linea);

  if (descuadres.length > 0) {
    console.error(`Las dos partes NO reconstruyen el original: ${descuadres.length} línea(s) descuadradas.`);
    descuadres.slice(0, 5).forEach((l) => console.error(`   ${JSON.stringify(l.slice(0, 70))}`));
    process.exit(1);
  }
  console.log("[OK] las dos partes reconstruyen el original exactamente. Aplicando.\n");

  const insertar = async (nombre: string, texto: string, ambito: string) => {
    const r = await pool.query(
      `INSERT INTO documentos_conocimiento
         (nombre, descripcion, tipo, agente_id, archivo_ref, version, estado, cargado_por,
          pais_codigo, contenido_texto, incluir_en_contexto, ambito)
       VALUES ($1, $2, $3, $4, $5, $6, 'activo', $7, $8, $9, true, $10)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        nombre,
        ambito === "generacion"
          ? "Mitad del catálogo de componentes que describe cómo se arma la salida (dashboard, informe, base de conocimiento). No entra en el chat."
          : "Mitad del catálogo de componentes con el razonamiento clínico. Entra en todos los caminos.",
        orig.tipo,
        orig.agente_id,
        orig.archivo_ref,
        orig.version,
        orig.cargado_por,
        orig.pais_codigo,
        texto,
        ambito,
      ]
    );
    return r.rows[0]?.id;
  };

  await pool.query(`DELETE FROM documentos_conocimiento WHERE nombre IN ($1, $2)`, [NOMBRE_A, NOMBRE_B]);
  const idA = await insertar(NOMBRE_A, textoA, "clinico");
  const idB = await insertar(NOMBRE_B, textoB, "generacion");
  await pool.query(`UPDATE documentos_conocimiento SET estado = 'archivado' WHERE id = $1`, [orig.id]);

  console.log(`   ${NOMBRE_A}`);
  console.log(`      ${textoA.length} chars, ámbito 'clinico', id ${idA}`);
  console.log(`   ${NOMBRE_B}`);
  console.log(`      ${textoB.length} chars, ámbito 'generacion', id ${idB}`);
  console.log(`\n   original archivado (id ${orig.id}) — reversible con --revertir`);

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err.message ?? err);
  process.exit(1);
});
