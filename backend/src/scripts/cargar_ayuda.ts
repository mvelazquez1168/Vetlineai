// Carga el manual de usuario (`docs/ayuda/`) en la base, para el agente
// de ayuda del prompt 16a.
//
//   docker compose exec backend npx ts-node src/scripts/cargar_ayuda.ts
//
// SE CORRE EN CADA DESPLIEGUE, después de las migraciones: el manual
// cambia con cada entrega y el agente responde con lo que esté cargado.
//
// En producción el servidor no necesita los archivos —solo este script,
// desde el repo—: lo que el agente lee es la base.

import { pool } from "../db";
import { cargarAyuda, directorioDeAyuda } from "../ayuda/cargador";

async function main() {
  const directorio = process.argv[2] ?? directorioDeAyuda();
  console.log(`Cargando el manual desde ${directorio}…`);
  const r = await cargarAyuda(pool, directorio);
  console.log(
    `${r.archivos} página(s), ${r.secciones} sección(es) cargadas. ` +
      `${r.borradas} sección(es) que ya no están en el disco se borraron.`
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
});
