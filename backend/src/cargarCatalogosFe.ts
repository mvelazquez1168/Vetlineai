import { pool } from "./db";
import { cargarCatalogosFacturacion } from "./facturacion/cargarCatalogos";

// ---------------------------------------------------------------------
// Comando de operación: carga los catálogos oficiales de comprobantes
// electrónicos de Costa Rica v4.4 en las tablas `fact_cat_*`.
//
//   npm run cargar-catalogos-fe
//
// En producción, con la imagen compilada:
//   node dist/cargarCatalogosFe.js
//
// Es idempotente: se vuelve a correr cada vez que Hacienda actualiza un
// catálogo. Mismo criterio que `habilitarModulo.ts` sobre por qué es un
// comando y no una migración — una migración queda aplicada para siempre
// y no se puede repetir.
//
// Usa el pool admin: los catálogos no tienen `tenant_id` y no hay sesión
// de usuario; el rol de la aplicación no debería poder escribirlos.
// ---------------------------------------------------------------------

async function main() {
  console.log("Cargando catálogos de facturación electrónica (Costa Rica v4.4)…\n");

  const { resultados, cabysVacio } = await cargarCatalogosFacturacion(pool);

  const ancho = Math.max(...resultados.map((r) => r.tabla.length));
  for (const r of resultados) {
    const partes = [`${r.insertados} nuevo(s)`, `${r.actualizados} actualizado(s)`];
    if (r.desactivados > 0) partes.push(`${r.desactivados} DESACTIVADO(S)`);
    console.log(`  ${r.tabla.padEnd(ancho)}  ${partes.join(", ")}`);
  }

  const total = resultados.reduce((a, r) => a + r.insertados + r.actualizados, 0);
  console.log(`\n${total} código(s) en ${resultados.length} catálogo(s).`);

  if (cabysVacio) {
    // Esto no es un error del script: es un dato que falta y que hay que
    // ver. Sin CABYS no se puede emitir una factura ni un tiquete,
    // porque el código es obligatorio en cada línea de detalle.
    console.warn(
      [
        "",
        "ATENCIÓN: `fact_cat_cabys` está VACÍA.",
        "El catálogo de bienes y servicios (CABYS) no viene en los anexos de Hacienda:",
        "se publica aparte como archivo de datos y no se pudo descargar.",
        "Ver 'Lo que NO se encontró' en docs/facturacion/fuentes/LEEME.md.",
        "Hacienda exige el código CABYS en CADA línea de factura y tiquete.",
      ].join("\n")
    );
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error("Error al cargar los catálogos:", err);
  await pool.end();
  process.exit(1);
});
