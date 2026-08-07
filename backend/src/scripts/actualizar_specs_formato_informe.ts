import { pool } from "../db";

// Prompt de renderizado del informe, Pasos 3 y 4 — regla de formato para
// las secciones de texto libre del informe, agregada IDÉNTICA a la
// Clinical Report Specification de los 8 agentes (no solo el que se
// probó). Se agrega como sección nueva al final en vez de intentar
// insertarla dentro de "7. Reglas de Generación" porque esa sección solo
// existe en 3 de los 8 documentos (GCIS, ICIS, OCIS) — los otros 5 son
// specs mucho más cortas (stubs).
const REGLA_FORMATO = `

---

Formato del Marcado en Secciones de Texto Libre

Las secciones de texto libre del informe (Historia Clínica, Razonamiento Diagnóstico, Evolución Clínica, contenido de apéndices, y cualquier otra sección sin una estructura de campos fija) se renderizan interpretando el marcado: negrita, cursiva, encabezados de nivel 2 (## Título), listas con viñeta y numeradas, y tablas en formato markdown.

Si el contenido de una de estas secciones se subdivide internamente, esa subdivisión deberá marcarse con un encabezado de nivel 2 (## Título) — nunca con negrita a modo de título.

La negrita (**texto**) queda reservada exclusivamente para destacar una palabra o frase dentro de un párrafo, nunca como sustituto de un encabezado.

Si el texto anuncia una cantidad de partes, elementos o pilares ("en base a X pilares..."), esa cantidad deberá coincidir exactamente con la cantidad que efectivamente se enumera a continuación. Ante la duda, no anunciar una cantidad específica.`;

async function main() {
  const nombres = ["GCIS", "DCIS", "ECIS", "ICIS", "NCIS", "OCIS", "RCIS", "CCIS"];
  for (const nombre of nombres) {
    const doc = await pool.query(
      `SELECT id, contenido_texto, length(contenido_texto) AS len_antes
       FROM documentos_conocimiento
       WHERE nombre ILIKE '%' || $1 || ' Clinical Report Specification%'`,
      [nombre]
    );
    if (doc.rows.length === 0) {
      console.log(`[FALTA] No se encontró la Clinical Report Specification de ${nombre}`);
      continue;
    }
    const fila = doc.rows[0];
    if (fila.contenido_texto.includes("Formato del Marcado en Secciones de Texto Libre")) {
      console.log(`[YA APLICADO] ${nombre} — se salta`);
      continue;
    }
    const nuevoContenido = fila.contenido_texto + REGLA_FORMATO;
    await pool.query(`UPDATE documentos_conocimiento SET contenido_texto = $1 WHERE id = $2`, [
      nuevoContenido,
      fila.id,
    ]);
    console.log(`[OK] ${nombre} — ${fila.len_antes} -> ${nuevoContenido.length} caracteres`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
