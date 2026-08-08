import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

// ---------------------------------------------------------------------
// Único punto de extracción de texto de un archivo de la Base de
// Conocimiento — usado tanto por el endpoint de carga (platform-admin.
// routes.ts) como por el script de backfill (scripts/backfillContenidoTexto.ts).
// Despacho por extensión; cualquier tipo no soportado (imágenes, etc.)
// devuelve null en vez de lanzar, para que el llamador no necesite un
// try/catch por cada tipo distinto.
//
// Recibe el contenido ya en memoria (Buffer), no una ruta de disco: con
// multer en memoryStorage y el almacenamiento de objetos detrás de la
// abstracción (ver almacenamiento/), no hay una ruta local garantizada en
// el camino de producción.
// ---------------------------------------------------------------------
export async function extraerTexto(datos: Buffer, extension: string): Promise<string | null> {
  const ext = extension.toLowerCase();

  try {
    switch (ext) {
      case ".pdf":
        return await extraerDePdf(datos);
      case ".docx":
        return await extraerDeDocx(datos);
      case ".txt":
      case ".md":
        return datos.toString("utf-8");
      default:
        return null;
    }
  } catch (err) {
    console.error(`extraerTexto: fallo al extraer texto (${ext})`, err);
    return null;
  }
}

async function extraerDePdf(datos: Buffer): Promise<string> {
  const parser = new PDFParse({ data: datos });
  try {
    const resultado = await parser.getText();
    return resultado.text;
  } finally {
    await parser.destroy();
  }
}

async function extraerDeDocx(datos: Buffer): Promise<string> {
  const resultado = await mammoth.extractRawText({ buffer: datos });
  return resultado.value;
}
