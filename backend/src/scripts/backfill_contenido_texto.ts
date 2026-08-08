// Script de backfill: para las filas de documentos_conocimiento que ya
// tienen un archivo en disco (archivo_ref) pero nunca les extrajo el texto
// a contenido_texto (ver diagnóstico — POST /platform-admin/documentos no
// lo escribía hasta que se agregó la extracción en ese endpoint), extrae
// el texto con el mismo módulo que usa el endpoint (../lib/extraccion) y
// lo persiste.
//
// Por defecto corre en modo dry-run (no escribe nada en la base) — pasar
// --aplicar para ejecutar los UPDATE de verdad.
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { extraerTexto } from "../lib/extraccion";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uploadsDir = path.join(__dirname, "../../uploads");
const aplicar = process.argv.includes("--aplicar");

type Estado = "actualizado" | "sin_archivo" | "sin_texto" | "error";

interface Resultado {
  nombre: string;
  archivoRef: string;
  estado: Estado;
  caracteres: number;
  detalle?: string;
}

async function procesar(): Promise<Resultado[]> {
  const { rows } = await pool.query(
    `SELECT id, nombre, archivo_ref FROM documentos_conocimiento
     WHERE contenido_texto IS NULL AND archivo_ref IS NOT NULL
     ORDER BY fecha_carga`
  );

  console.log(`${rows.length} documento(s) con contenido_texto NULL y archivo_ref no nulo.`);
  console.log(aplicar ? "Modo: APLICAR (va a escribir en la base)." : "Modo: DRY-RUN (no escribe nada).");
  console.log("");

  const resultados: Resultado[] = [];

  for (const row of rows) {
    const rutaAbsoluta = path.join(uploadsDir, row.archivo_ref);

    if (!fs.existsSync(rutaAbsoluta)) {
      console.log(`[sin archivo] ${row.nombre} — ${row.archivo_ref} no existe en disco.`);
      resultados.push({ nombre: row.nombre, archivoRef: row.archivo_ref, estado: "sin_archivo", caracteres: 0 });
      continue;
    }

    let texto: string | null;
    try {
      const buffer = await fs.promises.readFile(rutaAbsoluta);
      texto = await extraerTexto(buffer, path.extname(rutaAbsoluta));
    } catch (err) {
      const mensaje = (err as Error).message;
      console.log(`[error] ${row.nombre} — ${mensaje}`);
      resultados.push({
        nombre: row.nombre,
        archivoRef: row.archivo_ref,
        estado: "error",
        caracteres: 0,
        detalle: mensaje,
      });
      continue;
    }

    const textoLimpio = texto?.trim() ?? "";
    if (!textoLimpio) {
      console.log(`[sin texto] ${row.nombre} — la extracción no devolvió contenido (tipo no soportado o archivo sin texto).`);
      resultados.push({ nombre: row.nombre, archivoRef: row.archivo_ref, estado: "sin_texto", caracteres: 0 });
      continue;
    }

    if (aplicar) {
      await pool.query(`UPDATE documentos_conocimiento SET contenido_texto = $1 WHERE id = $2`, [
        texto,
        row.id,
      ]);
    }

    console.log(
      `[${aplicar ? "actualizado" : "se actualizaría"}] ${row.nombre} — ${textoLimpio.length} caracteres`
    );
    resultados.push({
      nombre: row.nombre,
      archivoRef: row.archivo_ref,
      estado: "actualizado",
      caracteres: textoLimpio.length,
    });
  }

  return resultados;
}

function imprimirResumen(resultados: Resultado[]) {
  console.log("");
  console.log("=== Resumen ===");
  for (const r of resultados) {
    const etiqueta =
      r.estado === "actualizado"
        ? `${r.caracteres} caracteres`
        : r.estado === "sin_archivo"
          ? "SIN ARCHIVO EN DISCO"
          : r.estado === "sin_texto"
            ? "SIN TEXTO EXTRAÍDO"
            : `ERROR: ${r.detalle}`;
    console.log(`- ${r.nombre}: ${etiqueta}`);
  }

  const actualizados = resultados.filter((r) => r.estado === "actualizado").length;
  console.log("");
  console.log(
    `${actualizados}/${resultados.length} documento(s) ${aplicar ? "actualizados" : "se actualizarían"}.`
  );
  if (!aplicar) {
    console.log("Corré de nuevo con --aplicar para escribir los cambios.");
  }
}

(async () => {
  try {
    const resultados = await procesar();
    imprimirResumen(resultados);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
