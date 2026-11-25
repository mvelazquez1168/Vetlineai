import fs from "fs";
import path from "path";
import { unzipSync } from "fflate";
import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------
// El catálogo CABYS: leerlo de la planilla oficial del BCCR y cargarlo.
//
// Hacienda exige el código CABYS en CADA línea de detalle de factura y
// tiquete (Nota 17 del anexo), pero NO lo publica con el resto de los
// catálogos: lo publica el Banco Central, aparte, como una planilla de
// Excel. Por eso tiene su propio módulo y su propio archivo fuente.
//
// LA LIBRERÍA: `fflate`, y solo para descomprimir. Un `.xlsx` es un zip
// de XML, así que leerlo son dos pasos: descomprimir y parsear la hoja.
// La alternativa evaluada fue `exceljs`, que hace las dos cosas pero
// trae **135 paquetes** (incluido un `uuid` ya deprecado) y viaja a
// producción para una carga que ocurre una vez al año. `fflate` es UN
// paquete sin dependencias.
//
// Lo que compensa parsear la hoja a mano es que la forma del archivo se
// VERIFICA, no se supone: el encabezado tiene que ser exactamente el
// esperado, cada código tiene que tener 13 dígitos, no puede haber
// duplicados y toda tarifa desconocida se reporta en vez de cargarse
// como nula. Si el BCCR cambia el formato, esto falla con un mensaje
// que dice qué cambió, en vez de cargar basura en silencio.
// ---------------------------------------------------------------------

/**
 * Dónde se espera la planilla.
 *
 * Vive en `backend/catalogos/cabys/` y NO en `docs/`, por el mismo
 * motivo que los XSD: es una entrada de EJECUCIÓN del cargador, y
 * `docs/` no está montado en el contenedor del backend ni entra en la
 * imagen de producción (`tsc` solo copia TypeScript). Una sola copia,
 * con su `sha256` registrado en `docs/facturacion/fuentes/sumas.sha256`.
 *
 * Fuera de `src/` a propósito, por lo mismo: desde `src/facturacion/` y
 * desde `dist/facturacion/`, `../..` da la misma raíz.
 */
const RAIZ_BACKEND = path.resolve(__dirname, "..", "..");
export const RUTA_CABYS =
  process.env.FE_CR_ARCHIVO_CABYS ??
  path.join(RAIZ_BACKEND, "catalogos", "cabys", "Catalogo_CABYS_2025.xlsx");

/**
 * El encabezado exacto de la hoja `Catálogo`, columna por columna.
 *
 * Está completo y no solo las tres que se usan: si el BCCR agrega,
 * quita o reordena una columna, las que importan pueden correrse de
 * lugar y la carga tomaría la descripción como código sin que nada
 * falle. Comparar el encabezado entero es lo que lo impide.
 */
const ENCABEZADO_ESPERADO: Record<string, string> = {
  A: "Categoría 1",
  B: "Descripción (categoría 1)",
  C: "Categoría 2",
  D: "Descripción (categoría 2)",
  E: "Categoría 3",
  F: "Descripción (categoría 3)",
  G: "Categoría 4",
  H: "Descripción (categoría 4)",
  I: "Categoría 5",
  J: "Descripción (categoría 5)",
  K: "Categoría 6",
  L: "Descripción (categoría 6)",
  M: "Categoría 7",
  N: "Descripción (categoría 7)",
  O: "Categoría 8",
  P: "Descripción (categoría 8)",
  Q: "Categoría 9",
  R: "Descripción (categoría 9)",
  S: "Impuesto",
  T: "Nota explicativa 1. Incluye",
  U: "Nota explicativa 2. Excluye",
};

/** La columna 9 es el código CABYS de 13 dígitos; la R, su descripción. */
const COL_CODIGO = "Q";
const COL_DESCRIPCION = "R";
const COL_IMPUESTO = "S";

/**
 * De la tarifa que publica el BCCR al código de tarifa de la Nota 8.1.
 *
 * La columna "Impuesto" NO es homogénea — medido sobre el archivo real
 * de 2025: trae fracciones (`0.13`), textos con porcentaje (`13%`),
 * `Exento` y `na`. Un `Number(valor)` daría `NaN` en 941 filas y las
 * cargaría sin tarifa en silencio, así que el mapa es explícito y lo
 * que no esté acá se reporta.
 *
 * `Exento` se mapea al código **10** (Tarifa Exenta) y no al 01 ni al
 * 11, que también valen 0%: el catálogo dice "exento", que es
 * exactamente lo que nombra el código 10 de la Nota 8.1.
 *
 * `na` queda SIN tarifa sugerida, a propósito. Son transferencias
 * obligatorias a instituciones públicas: el catálogo no les asigna una
 * tarifa, y ponerle una sería inventarla.
 */
const TARIFA_A_CODIGO: Record<string, string | null> = {
  "0.01": "02", // 1%
  "1%": "02",
  "0.02": "03", // 2%
  "2%": "03",
  "0.04": "04", // 4%
  "4%": "04",
  "0.13": "08", // tarifa general
  "13%": "08",
  "0.005": "09", // 0,5%
  "0.5%": "09",
  Exento: "10",
  exento: "10",
  na: null,
  NA: null,
};

export interface FilaCabys {
  codigo: string;
  descripcion: string;
  /** Lo que decía la planilla, sin interpretar. Para poder reportar. */
  impuestoCrudo: string;
  codigoTarifaIva: string | null;
}

export interface LecturaCabys {
  filas: FilaCabys[];
  /** Valores de la columna "Impuesto" que el mapa no conoce, con un ejemplo. */
  tarifasDesconocidas: Array<{ valor: string; filas: number; ejemplo: string }>;
}

/** Celdas de una fila del XML de la hoja, por letra de columna. */
function celdasDeFila(xmlFila: string, textos: string[]): Record<string, string> {
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

/** Las cinco entidades XML que aparecen en texto de celdas. */
function desescapar(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Lee la planilla oficial y devuelve las filas del catálogo.
 *
 * Lanza —en vez de devolver menos filas— si la forma del archivo no es
 * la esperada. Un catálogo fiscal cargado a medias es peor que uno no
 * cargado: con el catálogo vacío la API lo dice y nadie emite con un
 * código inventado; con un catálogo incompleto, un código válido
 * parecería no existir.
 */
export function leerCabys(ruta: string = RUTA_CABYS): LecturaCabys {
  if (!fs.existsSync(ruta)) {
    throw new Error(
      `No está la planilla del catálogo CABYS en ${ruta}. Se descarga del Banco Central — ver docs/facturacion/fuentes/LEEME.md.`
    );
  }

  const zip = unzipSync(new Uint8Array(fs.readFileSync(ruta)));
  const leerEntrada = (nombre: string): string => {
    const datos = zip[nombre];
    if (!datos) {
      throw new Error(
        `La planilla CABYS no tiene "${nombre}": no parece un .xlsx válido (entradas: ${Object.keys(zip).slice(0, 8).join(", ")}…).`
      );
    }
    return Buffer.from(datos).toString("utf-8");
  };

  // Los textos de las celdas viven en una tabla compartida y las celdas
  // la referencian por índice.
  const textos = Array.from(
    leerEntrada("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)
  ).map(([, si]) =>
    desescapar(Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(([, t]) => t).join(""))
  );

  // La hoja `Catálogo` es la primera del libro. Se comprueba leyendo el
  // nombre, no se asume: el libro trae cinco hojas y una se llama
  // `FuzzyLookup_AddIn_Undo_Sheet`.
  const libro = leerEntrada("xl/workbook.xml");
  const nombres = Array.from(libro.matchAll(/<sheet name="([^"]+)"/g)).map(([, n]) => desescapar(n));
  if (nombres[0] !== "Catálogo") {
    throw new Error(
      `La primera hoja de la planilla CABYS se llama "${nombres[0]}" y se esperaba "Catálogo". Hojas: ${nombres.join(", ")}.`
    );
  }

  const hoja = leerEntrada("xl/worksheets/sheet1.xml");
  const filasXml = Array.from(hoja.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)).map(([, f]) => f);

  // Fila 1 vacía, fila 2 encabezado, de la 3 en adelante los datos.
  const indiceEncabezado = filasXml.findIndex((f) => {
    const c = celdasDeFila(f, textos);
    return c[COL_CODIGO] === ENCABEZADO_ESPERADO[COL_CODIGO];
  });
  if (indiceEncabezado === -1) {
    throw new Error(
      `No se encontró el encabezado de la planilla CABYS (ninguna fila tiene "${ENCABEZADO_ESPERADO[COL_CODIGO]}" en la columna ${COL_CODIGO}).`
    );
  }

  const encabezado = celdasDeFila(filasXml[indiceEncabezado], textos);
  const diferencias = Object.entries(ENCABEZADO_ESPERADO)
    .filter(([col, esperado]) => (encabezado[col] ?? "") !== esperado)
    .map(([col, esperado]) => `${col}: se esperaba "${esperado}" y dice "${encabezado[col] ?? "(vacía)"}"`);
  if (diferencias.length > 0) {
    throw new Error(
      `El encabezado de la planilla CABYS cambió, así que las columnas pueden no ser las de siempre y la carga se detiene:\n  ` +
        diferencias.join("\n  ")
    );
  }

  const filas: FilaCabys[] = [];
  const vistos = new Set<string>();
  const desconocidas = new Map<string, { filas: number; ejemplo: string }>();

  for (let i = indiceEncabezado + 1; i < filasXml.length; i++) {
    const c = celdasDeFila(filasXml[i], textos);
    const codigo = (c[COL_CODIGO] ?? "").trim();
    // La planilla termina con una fila vacía.
    if (codigo === "") continue;

    if (!/^[0-9]{13}$/.test(codigo)) {
      throw new Error(
        `La fila ${i + 1} de la planilla CABYS tiene el código "${codigo}", que no son 13 dígitos. El formato del archivo cambió.`
      );
    }
    if (vistos.has(codigo)) {
      throw new Error(`El código CABYS ${codigo} aparece dos veces en la planilla (fila ${i + 1}).`);
    }
    vistos.add(codigo);

    const impuestoCrudo = (c[COL_IMPUESTO] ?? "").trim();
    const conocido = impuestoCrudo in TARIFA_A_CODIGO;
    if (!conocido) {
      const previo = desconocidas.get(impuestoCrudo);
      if (previo) previo.filas++;
      else desconocidas.set(impuestoCrudo, { filas: 1, ejemplo: codigo });
    }

    filas.push({
      codigo,
      descripcion: (c[COL_DESCRIPCION] ?? "").trim(),
      impuestoCrudo,
      codigoTarifaIva: conocido ? TARIFA_A_CODIGO[impuestoCrudo] : null,
    });
  }

  if (filas.length < 10_000) {
    // El catálogo real tiene más de veinte mil. Muchas menos significa
    // que se leyó mal, no que el BCCR lo recortó a la mitad.
    throw new Error(
      `La planilla CABYS solo dio ${filas.length} códigos y el catálogo real tiene más de veinte mil: la lectura está mal.`
    );
  }

  return {
    filas,
    tarifasDesconocidas: Array.from(desconocidas.entries()).map(([valor, d]) => ({
      valor,
      filas: d.filas,
      ejemplo: d.ejemplo,
    })),
  };
}

export interface ResultadoCargaCabys {
  leidos: number;
  insertados: number;
  actualizados: number;
  desactivados: number;
  sinTarifaSugerida: number;
  tarifasDesconocidas: LecturaCabys["tarifasDesconocidas"];
}

/**
 * Carga el catálogo en `fact_cat_cabys`. Idempotente, igual que el resto
 * de los catálogos: `INSERT ... ON CONFLICT DO UPDATE`, y lo que ya no
 * está se marca `activo = false` en vez de borrarse — un comprobante
 * viejo puede referenciar un código que el BCCR retiró.
 *
 * Inserta en lotes y no fila por fila: son más de veinte mil, y veinte
 * mil viajes de ida y vuelta a la base tardan minutos donde esto tarda
 * segundos.
 */
export async function cargarCabys(
  db: Pool | PoolClient,
  ruta: string = RUTA_CABYS
): Promise<ResultadoCargaCabys> {
  const lectura = leerCabys(ruta);

  const TAMANO_LOTE = 500;
  let insertados = 0;
  let actualizados = 0;

  for (let i = 0; i < lectura.filas.length; i += TAMANO_LOTE) {
    const lote = lectura.filas.slice(i, i + TAMANO_LOTE);
    const valores: unknown[] = [];
    const marcadores = lote.map((f, j) => {
      valores.push(f.codigo, f.descripcion, f.codigoTarifaIva);
      const b = j * 3;
      return `($${b + 1}, $${b + 2}, $${b + 3}, true)`;
    });

    const r = await db.query<{ insertado: boolean }>(
      `INSERT INTO fact_cat_cabys (codigo, descripcion, codigo_tarifa_iva_sugerido, activo)
       VALUES ${marcadores.join(", ")}
       ON CONFLICT (codigo) DO UPDATE SET
         descripcion = EXCLUDED.descripcion,
         codigo_tarifa_iva_sugerido = EXCLUDED.codigo_tarifa_iva_sugerido,
         activo = true
       RETURNING (xmax = 0) AS insertado`,
      valores
    );
    for (const fila of r.rows) {
      if (fila.insertado) insertados++;
      else actualizados++;
    }
  }

  const codigos = lectura.filas.map((f) => f.codigo);
  const desactivados = await db.query(
    `UPDATE fact_cat_cabys SET activo = false
      WHERE activo = true AND codigo <> ALL($1::text[])`,
    [codigos]
  );

  return {
    leidos: lectura.filas.length,
    insertados,
    actualizados,
    desactivados: desactivados.rowCount ?? 0,
    sinTarifaSugerida: lectura.filas.filter((f) => f.codigoTarifaIva === null).length,
    tarifasDesconocidas: lectura.tarifasDesconocidas,
  };
}
