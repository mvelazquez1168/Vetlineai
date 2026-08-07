// Mide la tasa de coincidencia real del parseo de secciones por raza
// contra el catálogo completo de razas (tabla `razas`), y corre los 3
// escenarios de verificación del Paso 5 del prompt.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_seleccion_raza.ts
import { pool } from "../db";
import { seleccionarSeccionRaza, NOMBRE_DOCUMENTO_PREDISPOSICIONES } from "../razaDocumento";

const ESPECIE_CATALOGO_A_DOCUMENTO: Record<string, string> = { canina: "Canino", felina: "Felino" };

async function main() {
  const docResult = await pool.query(
    `SELECT contenido_texto, length(contenido_texto) AS largo FROM documentos_conocimiento WHERE nombre = $1`,
    [NOMBRE_DOCUMENTO_PREDISPOSICIONES]
  );
  const contenido = docResult.rows[0].contenido_texto as string;
  console.log(`Documento completo: ${docResult.rows[0].largo} caracteres.\n`);

  const razas = await pool.query(`SELECT nombre, especie FROM razas WHERE especie IN ('canina', 'felina') ORDER BY especie, nombre`);

  let coincidencias = 0;
  const misses: { especie: string; raza: string }[] = [];
  for (const fila of razas.rows) {
    const especieDoc = ESPECIE_CATALOGO_A_DOCUMENTO[fila.especie];
    const { coincidio } = seleccionarSeccionRaza(contenido, especieDoc, fila.nombre);
    if (coincidio) coincidencias++;
    else misses.push({ especie: fila.especie, raza: fila.nombre });
  }

  console.log(`=== Tasa de coincidencia contra el catálogo completo ===`);
  console.log(`Total de razas en catálogo: ${razas.rows.length}`);
  console.log(`Coincidieron: ${coincidencias} (${((coincidencias / razas.rows.length) * 100).toFixed(1)}%)`);
  console.log(`NO coincidieron: ${misses.length}`);
  if (misses.length > 0) {
    console.log(`\nRazas del catálogo sin sección en el documento:`);
    for (const m of misses) console.log(`  - [${m.especie}] ${m.raza}`);
  }

  // ---------------------------------------------------------------------
  // Paso 5 — los 3 escenarios explícitos + medición de tamaño.
  // ---------------------------------------------------------------------
  console.log(`\n=== Paso 5: escenarios de verificación ===`);

  const golden = seleccionarSeccionRaza(contenido, "Canino", "Golden Retriever");
  const otrasRazasEnBloqueGolden = ["Labrador Retriever", "Pastor Alemán", "Boxer", "Bulldog Francés"].some((r) =>
    golden.texto.includes(`## ${r}`)
  );
  console.log(
    `[${golden.coincidio && !otrasRazasEnBloqueGolden ? "OK" : "FALLO"}] Golden Retriever: coincidió=${golden.coincidio}, ` +
      `sin otras razas en el bloque=${!otrasRazasEnBloqueGolden}, tamaño=${golden.texto.length} caracteres ` +
      `(vs. ${docResult.rows[0].largo} del documento completo).`
  );

  const mestizo = seleccionarSeccionRaza(contenido, "Canino", "Mestizo / No especificada");
  console.log(
    `[${!mestizo.coincidio ? "OK" : "FALLO"}] Mestizo: coincidió=${mestizo.coincidio} (se espera false — el catálogo lo ` +
      `nombra distinto al documento), tamaño=${mestizo.texto.length} caracteres (solo encabezado).`
  );

  const siames = seleccionarSeccionRaza(contenido, "Felino", "Siamés");
  const buscoEnGatos = siames.texto.includes("## Siamés") && !siames.texto.includes("## PERROS");
  console.log(
    `[${siames.coincidio && buscoEnGatos ? "OK" : "FALLO"}] Felino (Siamés): coincidió=${siames.coincidio}, ` +
      `tamaño=${siames.texto.length} caracteres.`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
