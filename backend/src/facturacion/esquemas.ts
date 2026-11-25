import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Único punto que sabe DÓNDE están los XSD oficiales.
//
// Viven en `backend/esquemas/fe-cr/xml-schemas/`, fuera de `src/`, y eso
// es a propósito: `tsc` no copia archivos que no sean TypeScript, así que
// un XSD dentro de `src/` existiría en desarrollo y desaparecería de la
// imagen de producción, que corre `dist/`. Desde `src/facturacion/` y
// desde `dist/facturacion/` el camino `../..` da la misma raíz.
//
// La estructura de carpetas replica la del CDN de Hacienda
// (`xml-schemas/v4.4/<tipo>/<Archivo>.xsd` y `xml-schemas/
// xmldsig-core-schema.xsd`) porque cada XSD importa la firma con
// `schemaLocation="../../xmldsig-core-schema.xsd"`, una ruta relativa que
// solo resuelve con ese anidamiento. Aplanar la carpeta rompe la
// importación.
// ---------------------------------------------------------------------

const RAIZ_BACKEND = path.resolve(__dirname, "..", "..");

export const DIR_ESQUEMAS =
  process.env.FE_CR_DIR_ESQUEMAS ?? path.join(RAIZ_BACKEND, "esquemas", "fe-cr", "xml-schemas");

/** Ruta absoluta de un XSD a partir de su ruta relativa (la del catálogo `archivo_xsd`). */
export function rutaEsquema(relativa: string): string {
  return path.join(DIR_ESQUEMAS, relativa);
}

export function leerEsquema(relativa: string): string {
  return fs.readFileSync(rutaEsquema(relativa), "utf-8");
}

/**
 * Los valores de un `xs:simpleType` con nombre, tal como los enumera el
 * XSD. Es la autoridad sobre QUÉ códigos acepta Hacienda: las listas de
 * `catalogos.ts` se comparan contra esto en
 * `scripts/verificar_catalogos_fe.ts`.
 *
 * Lee el XSD con expresiones regulares y no con un parser de XML a
 * propósito: lo único que hace falta es el bloque de un tipo con nombre y
 * sus `xs:enumeration`, los XSD de Hacienda vienen en una sola línea
 * gigante, y un parser completo acá sería una dependencia más para
 * resolver un problema que no tenemos.
 */
export function enumeracionDelEsquema(relativa: string, nombreTipo: string): string[] {
  const xsd = leerEsquema(relativa);
  const inicio = xsd.indexOf(`name="${nombreTipo}"`);
  if (inicio === -1) {
    throw new Error(`El esquema ${relativa} no define un tipo llamado "${nombreTipo}".`);
  }
  const fin = xsd.indexOf("</xs:simpleType>", inicio);
  if (fin === -1) {
    throw new Error(`El tipo "${nombreTipo}" en ${relativa} no cierra con </xs:simpleType>.`);
  }
  const bloque = xsd.slice(inicio, fin);
  const valores = Array.from(bloque.matchAll(/<xs:enumeration value="([^"]*)"/g)).map((m) => m[1]);
  if (valores.length === 0) {
    throw new Error(`El tipo "${nombreTipo}" en ${relativa} no tiene ninguna xs:enumeration.`);
  }
  return valores;
}

/**
 * Lo mismo, pero para un elemento con su tipo declarado en línea (sin
 * nombre), como `CondicionVenta` o `TipoMedioPago`. Busca el elemento por
 * nombre y toma las enumeraciones de su primer `xs:restriction`.
 */
export function enumeracionDeElemento(relativa: string, nombreElemento: string): string[] {
  const xsd = leerEsquema(relativa);
  const inicio = xsd.indexOf(`<xs:element name="${nombreElemento}"`);
  if (inicio === -1) {
    throw new Error(`El esquema ${relativa} no define un elemento llamado "${nombreElemento}".`);
  }
  const fin = xsd.indexOf("</xs:element>", inicio);
  const bloque = xsd.slice(inicio, fin === -1 ? undefined : fin);
  const valores = Array.from(bloque.matchAll(/<xs:enumeration value="([^"]*)"/g)).map((m) => m[1]);
  if (valores.length === 0) {
    throw new Error(
      `El elemento "${nombreElemento}" en ${relativa} no tiene ninguna xs:enumeration.`
    );
  }
  return valores;
}
