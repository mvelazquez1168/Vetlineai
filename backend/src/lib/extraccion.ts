import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

// ---------------------------------------------------------------------
// Único punto de extracción de texto de un archivo de la Base de
// Conocimiento — usado tanto por el endpoint de carga (platform-admin.
// routes.ts) como por el script de backfill (scripts/backfillContenidoTexto.ts).
// Despacho por extensión; cualquier tipo no soportado (imágenes, etc.)
// devuelve null en vez de lanzar, para que el llamador no necesite un
// try/catch por cada tipo distinto.
// ---------------------------------------------------------------------
export async function extraerTexto(rutaArchivo: string): Promise<string | null> {
  const ext = path.extname(rutaArchivo).toLowerCase();

  try {
    switch (ext) {
      case ".pdf":
        return await extraerDePdf(rutaArchivo);
      case ".docx":
        return await extraerDeDocx(rutaArchivo);
      case ".txt":
      case ".md":
        return await fs.promises.readFile(rutaArchivo, "utf-8");
      default:
        return null;
    }
  } catch (err) {
    console.error(`extraerTexto: fallo al extraer texto de ${rutaArchivo}`, err);
    return null;
  }
}

async function extraerDePdf(rutaArchivo: string): Promise<string> {
  const buffer = await fs.promises.readFile(rutaArchivo);
  const parser = new PDFParse({ data: buffer });
  try {
    const resultado = await parser.getText();
    return resultado.text;
  } finally {
    await parser.destroy();
  }
}

async function extraerDeDocx(rutaArchivo: string): Promise<string> {
  const resultado = await mammoth.extractRawText({ path: rutaArchivo });
  return resultado.value;
}
