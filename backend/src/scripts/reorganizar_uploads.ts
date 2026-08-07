// Script de un solo uso: reorganiza los archivos ya subidos antes de que
// existieran las subcarpetas casos/ conocimiento/ logos/ (ver index.ts y
// los routers correspondientes). Mueve el archivo físico si existe y
// reescribe la ruta guardada en la DB para que apunte a la nueva
// ubicación — no se ejecuta en el arranque normal del server, es un
// paso manual de la migración de seguridad de /uploads.
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uploadsDir = path.join(__dirname, "../../uploads");

function moverSiExiste(nombreArchivo: string, subcarpeta: string): boolean {
  const origen = path.join(uploadsDir, nombreArchivo);
  const destino = path.join(uploadsDir, subcarpeta, nombreArchivo);
  if (!fs.existsSync(origen)) {
    console.log(`  (sin archivo físico, solo se actualiza la ruta en DB) ${nombreArchivo}`);
    return false;
  }
  fs.renameSync(origen, destino);
  return true;
}

async function reorganizarDocumentosConocimiento() {
  const { rows } = await pool.query(`SELECT id, archivo_ref FROM documentos_conocimiento`);
  console.log(`documentos_conocimiento: ${rows.length} filas`);
  for (const row of rows) {
    if (row.archivo_ref.startsWith("conocimiento/")) continue; // ya migrado
    moverSiExiste(row.archivo_ref, "conocimiento");
    await pool.query(`UPDATE documentos_conocimiento SET archivo_ref = $1 WHERE id = $2`, [
      `conocimiento/${row.archivo_ref}`,
      row.id,
    ]);
  }
}

async function reorganizarArchivos() {
  const { rows } = await pool.query(`SELECT id, url FROM archivos`);
  console.log(`archivos: ${rows.length} filas`);
  for (const row of rows) {
    if (row.url.startsWith("/uploads/casos/")) continue; // ya migrado
    const nombreArchivo = row.url.replace(/^\/uploads\//, "");
    moverSiExiste(nombreArchivo, "casos");
    await pool.query(`UPDATE archivos SET url = $1 WHERE id = $2`, [
      `/uploads/casos/${nombreArchivo}`,
      row.id,
    ]);
  }
}

async function reorganizarLogos() {
  const { rows } = await pool.query(`SELECT id, logo_url FROM tenants WHERE logo_url IS NOT NULL`);
  console.log(`tenants con logo: ${rows.length} filas`);
  for (const row of rows) {
    if (row.logo_url.startsWith("/uploads/logos/")) continue; // ya migrado
    const nombreArchivo = row.logo_url.replace(/^\/uploads\//, "");
    moverSiExiste(nombreArchivo, "logos");
    await pool.query(`UPDATE tenants SET logo_url = $1 WHERE id = $2`, [
      `/uploads/logos/${nombreArchivo}`,
      row.id,
    ]);
  }
}

(async () => {
  try {
    await reorganizarDocumentosConocimiento();
    await reorganizarArchivos();
    await reorganizarLogos();
    console.log("Reorganización completa.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
