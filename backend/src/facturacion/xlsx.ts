import fs from "fs";
import { unzipSync } from "fflate";

// ---------------------------------------------------------------------
// Lo mínimo para leer un `.xlsx` sin arrastrar una librería de Excel.
//
// Vive acá y no dentro de `cabys.ts` porque hay DOS catálogos oficiales
// que llegan como planilla —el CABYS del Banco Central y la
// codificación de ubicación de Hacienda— y el lector es el mismo. Que
// el segundo copiara el primero sería exactamente el defecto que este
// proyecto ya persiguió en otras tres tablas: dos copias del mismo
// código que hoy coinciden y mañana no, sin que nada falle.
//
// LA LIBRERÍA: `fflate`, y solo para descomprimir. Un `.xlsx` es un zip
// de XML. La alternativa evaluada en su momento fue `exceljs`, que trae
// 135 paquetes y viaja a producción para una carga que ocurre una vez
// al año; `fflate` es UN paquete sin dependencias.
//
// Lo que NO hace, a propósito: no interpreta formatos de celda, ni
// fórmulas, ni fechas. Los dos catálogos son texto y números enteros.
// Si alguna vez hace falta una fecha, se agrega acá con su prueba, no
// en el llamador.
// ---------------------------------------------------------------------

/** Las cinco entidades XML que aparecen en texto de celdas. */
export function desescapar(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export interface LibroXlsx {
  /** Nombres de las hojas, en el orden del libro. */
  nombresDeHoja: string[];
  /** La tabla de textos compartidos que las celdas referencian por índice. */
  textos: string[];
  /** El XML crudo de una hoja, por posición (0 = la primera del libro). */
  xmlDeHoja(indice: number): string;
}

/**
 * Abre la planilla y deja listo lo que hace falta para recorrerla.
 *
 * Lanza —en vez de devolver algo a medias— si el archivo no está o no
 * es un `.xlsx`: un catálogo fiscal cargado a medias es peor que uno no
 * cargado. Con el catálogo vacío la API lo dice y nadie emite con un
 * código inventado; con uno incompleto, un código válido parecería no
 * existir.
 */
export function abrirLibro(ruta: string, queEs: string): LibroXlsx {
  if (!fs.existsSync(ruta)) {
    throw new Error(
      `No está la planilla de ${queEs} en ${ruta} — ver docs/facturacion/fuentes/LEEME.md.`
    );
  }

  const zip = unzipSync(new Uint8Array(fs.readFileSync(ruta)));
  const leerEntrada = (nombre: string, obligatoria = true): string => {
    const datos = zip[nombre];
    if (!datos) {
      if (!obligatoria) return "";
      throw new Error(
        `La planilla de ${queEs} no tiene "${nombre}": no parece un .xlsx válido ` +
          `(entradas: ${Object.keys(zip).slice(0, 8).join(", ")}…).`
      );
    }
    return Buffer.from(datos).toString("utf-8");
  };

  // `sharedStrings.xml` puede no existir si la planilla no tiene ni una
  // celda de texto. No es el caso de ninguno de los dos catálogos, pero
  // tratarlo como obligatorio daría un error que confunde.
  const textos = Array.from(
    leerEntrada("xl/sharedStrings.xml", false).matchAll(/<si>([\s\S]*?)<\/si>/g)
  ).map(([, si]) =>
    desescapar(
      Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
        .map(([, t]) => t)
        .join("")
    )
  );

  const libro = leerEntrada("xl/workbook.xml");
  const nombresDeHoja = Array.from(libro.matchAll(/<sheet name="([^"]+)"/g)).map(([, n]) =>
    desescapar(n)
  );

  return {
    nombresDeHoja,
    textos,
    xmlDeHoja: (indice: number) => leerEntrada(`xl/worksheets/sheet${indice + 1}.xml`),
  };
}

/** El XML de cada `<row>` de una hoja, en orden. */
export function filasDeHoja(xmlHoja: string): string[] {
  return Array.from(xmlHoja.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)).map(([, f]) => f);
}

/**
 * Celdas de una fila, indexadas por letra de columna.
 *
 * Las celdas vacías NO aparecen en el XML, así que el resultado tiene
 * huecos: hay que leerlo con `?? ""` y no asumir que la columna existe.
 */
export function celdasDeFila(xmlFila: string, textos: string[]): Record<string, string> {
  const celdas: Record<string, string> = {};
  const re =
    /<c r="([A-Z]+)\d+"(?:[^>]*?t="(\w+)")?[^>]*>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)?<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlFila)) !== null) {
    const [, columna, tipo, valor, enLinea] = m;
    let contenido: string | undefined;
    if (enLinea !== undefined) contenido = enLinea;
    else if (tipo === "s" && valor !== undefined) contenido = textos[Number(valor)];
    else contenido = valor;
    if (contenido !== undefined) celdas[columna] = desescapar(contenido);
  }
  return celdas;
}
