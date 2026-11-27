import fs from "fs";
import path from "path";
import { Pool, PoolClient } from "pg";

/** El pool o un cliente: el cargador corre en los dos contextos. */
type EjecutorSql = Pool | PoolClient;

// ---------------------------------------------------------------------
// EL CARGADOR DEL MANUAL — prompt 16a.
//
// Lee `docs/ayuda/*.md` y lo deja en `ayuda_paginas`, partido por
// secciones. El agente responde con eso.
//
// LA FUENTE SIGUE SIENDO `docs/ayuda/`, donde la guía rectora dice que
// vive el manual y donde cada entrega lo actualiza. Acá no se escribe
// ayuda: se carga la que ya está escrita. Una segunda copia dentro de
// `backend/` sería el defecto que este repo ya tuvo tres veces.
//
// SE PARTE POR SECCIONES (`##`) y no por página entera porque las
// páginas tienen 150 líneas y la pregunta es «¿cómo registro una
// vacuna?»: lo que hay que encontrar y citar es el «Paso a paso» de esa
// página, no la página.
//
// LOS METADATOS son un comentario HTML al principio del archivo:
//
//   <!-- ayuda ruta=/ventas?tab=cobro permisos=caja.cobrar,caja.anular -->
//
// Es opcional. Una página sin eso se indexa igual; lo que pierde es el
// enlace a la pantalla y el aviso de «tu rol no hace esto».
// ---------------------------------------------------------------------

export interface SeccionDeAyuda {
  archivo: string;
  titulo: string;
  seccion: string | null;
  contenido: string;
  ruta: string | null;
  permisos: string[];
  orden: number;
}

/** Dónde están los .md. El contenedor los tiene montados de solo lectura. */
export function directorioDeAyuda(): string {
  return process.env.AYUDA_DIR ?? "/app/docs-ayuda";
}

function leerMetadatos(texto: string): { ruta: string | null; permisos: string[] } {
  const m = texto.match(/<!--\s*ayuda\s+([^>]*?)-->/i);
  if (!m) return { ruta: null, permisos: [] };
  const crudo = m[1];
  const ruta = crudo.match(/ruta=([^\s]+)/)?.[1] ?? null;
  const permisos = (crudo.match(/permisos=([^\s]+)/)?.[1] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return { ruta, permisos };
}

/**
 * Parte un archivo de manual en sus secciones.
 *
 * El encabezado —lo que va antes del primer `##`— se guarda con
 * `seccion = null`: es «para qué sirve» en una sola pieza, y muchas
 * preguntas se contestan con eso.
 */
export function partirEnSecciones(archivo: string, texto: string): SeccionDeAyuda[] {
  const { ruta, permisos } = leerMetadatos(texto);
  const sinMetadatos = texto.replace(/<!--\s*ayuda[^>]*-->\s*/i, "");

  const titulo = sinMetadatos.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? archivo;
  const cuerpo = sinMetadatos.replace(/^#\s+.+$/m, "").trim();

  const partes = cuerpo.split(/^##\s+/m);
  const secciones: SeccionDeAyuda[] = [];

  const encabezado = partes[0]?.trim();
  if (encabezado) {
    secciones.push({ archivo, titulo, seccion: null, contenido: encabezado, ruta, permisos, orden: 0 });
  }

  partes.slice(1).forEach((p, i) => {
    const salto = p.indexOf("\n");
    const nombre = (salto === -1 ? p : p.slice(0, salto)).trim();
    const contenido = (salto === -1 ? "" : p.slice(salto + 1)).trim();
    if (!contenido) return;
    secciones.push({
      archivo,
      titulo,
      seccion: nombre,
      contenido,
      ruta,
      permisos,
      orden: i + 1,
    });
  });

  return secciones;
}

/**
 * Carga el manual entero.
 *
 * Es re-corrible: borra lo que ya no está en el disco y actualiza lo
 * demás. Si una página se borra de `docs/ayuda/`, desaparece de la
 * ayuda: lo contrario dejaría al agente citando una pantalla que ya no
 * existe.
 */
export async function cargarAyuda(
  db: EjecutorSql,
  directorio = directorioDeAyuda()
): Promise<{ archivos: number; secciones: number; borradas: number }> {
  const archivos = fs
    .readdirSync(directorio)
    .filter((f) => f.endsWith(".md"))
    // El índice no se indexa: es una tabla de enlaces, no una respuesta.
    .filter((f) => f !== "README.md");

  let secciones = 0;
  for (const archivo of archivos) {
    const texto = fs.readFileSync(path.join(directorio, archivo), "utf8");
    for (const s of partirEnSecciones(archivo, texto)) {
      await db.query(
        `INSERT INTO ayuda_paginas
           (archivo, titulo, seccion, contenido, ruta, permisos, orden, actualizado_en)
         VALUES ($1,$2,$3,$4,$5,$6::varchar[],$7, now())
         ON CONFLICT (archivo, COALESCE(seccion, '')) DO UPDATE
           SET titulo = EXCLUDED.titulo, contenido = EXCLUDED.contenido,
               ruta = EXCLUDED.ruta, permisos = EXCLUDED.permisos,
               orden = EXCLUDED.orden, actualizado_en = now()`,
        [archivo, s.titulo, s.seccion, s.contenido, s.ruta, s.permisos, s.orden]
      );
      secciones += 1;
    }
  }

  const borradas = await db.query(
    `DELETE FROM ayuda_paginas WHERE archivo <> ALL($1::varchar[])`,
    [archivos]
  );

  return { archivos: archivos.length, secciones, borradas: borradas.rowCount ?? 0 };
}
