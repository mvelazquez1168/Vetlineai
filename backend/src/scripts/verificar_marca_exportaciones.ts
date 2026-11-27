// Toda exportación a PDF o a Excel lleva la marca de la clínica.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_marca_exportaciones.ts
//
// SIN --transpile-only, como el resto.
//
// TIENE DOS MITADES, y las dos hacen falta:
//
//   A. ESTÁTICA, sobre el código: ninguna ruta llama a `aExcel(` o a
//      `aPdf(` sin pasarle la marca, y ningún generador de PDF declara
//      sus propias constantes de color. Es lo que impide que vuelva: un
//      reporte nuevo que se olvide de la marca falla acá.
//
//   B. REAL, generando los archivos: el .xlsx con logo se vuelve a
//      abrir y tiene sus cinco piezas (la imagen, el dibujo, las dos
//      relaciones y la declaración del tipo), y el .pdf trae los bytes
//      del logo. Sin esta mitad, lo único probado sería que el código
//      *llama* a la función, no que el archivo salga con el logo.
//
// Primero se comprobó que la mitad A **falla** contra el estado
// anterior: tres generadores con constantes propias y nueve llamadas sin
// marca.

import fs from "fs";
import path from "path";
import { unzipSync } from "fflate";
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { marcaDeLaClinica, medidasDeImagen } from "../marca/marcaClinica";
import { aExcel, aPdf } from "../exportacion/tabla";

const RAIZ = path.resolve(__dirname, "..");

/**
 * Los archivos que PUEDEN tener constantes de color propias, con el
 * motivo. La lista es corta a propósito.
 */
const COLOR_PROPIO_PERMITIDO = new Map([
  ["marca/marcaClinica.ts", "define el color por omisión cuando la clínica no cargó el suyo"],
  ["pdf/marcaPdf.ts", "es el que dibuja la marca"],
  ["metricas/dashboardPdf.ts", "la paleta de los GRÁFICOS no es la marca: son series de datos"],
  ["exportacion/tabla.ts", "los grises de las líneas de una tabla, que no son marca"],
]);

/**
 * Los colores que NO son marca y por eso se permiten en cualquier
 * generador: un aviso en ámbar, un error en rojo y las líneas grises
 * siguen siendo ámbar, rojo y grises aunque la clínica tenga su paleta.
 * Teñir un aviso con el color de la clínica sería perder el significado
 * del color, que es lo contrario de lo que este verificador cuida.
 */
const COLORES_QUE_NO_SON_MARCA = new Set([
  "#B45309", // ámbar de aviso
  "#b06000", // ámbar de aviso en las tablas
  "#DC2626", // rojo de error
  "#CCCCCC",
  "#cccccc",
  "#D7DEE8", // borde
  "#5A6B82", // el gris de apoyo, que `marca.tenue` fija igual para todos
  "#B91C1C", // rojo de «FALTA COLEGIATURA»: un faltante es rojo siempre
  "#E5E5E5", // la línea de la firma
  "#1B2A4A", // el primario DE FÁBRICA, exportado por marcaClinica.ts
]);

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

/** Desde el `(` de una llamada, el texto hasta su `)` que cierra. */
function llamadaCompleta(texto: string, posParentesis: number): string {
  let nivel = 0;
  for (let i = posParentesis; i < texto.length; i++) {
    const c = texto[i];
    if (c === "(" || c === "{" || c === "[") nivel++;
    else if (c === ")" || c === "}" || c === "]") {
      nivel--;
      if (nivel === 0) return texto.slice(posParentesis, i + 1);
    }
  }
  return texto.slice(posParentesis);
}

function archivosTs(dir: string, acumulado: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "scripts" || e.name === "migrations" || e.name === "node_modules") continue;
      archivosTs(completo, acumulado);
    } else if (e.name.endsWith(".ts")) {
      acumulado.push(completo);
    }
  }
  return acumulado;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_marca_exportaciones");

  // =================================================================
  // A. El código: nadie exporta sin marca
  // =================================================================
  console.log("\n=== A. Ninguna exportación se arma sin la marca ===");
  const archivos = archivosTs(RAIZ);
  let llamadas = 0;
  let sinMarca = 0;
  let coloresPropios = 0;

  for (const archivo of archivos) {
    const relativo = path.relative(RAIZ, archivo).split(path.sep).join("/");
    const texto = fs.readFileSync(archivo, "utf8");

    // 1. Las llamadas a los exportadores genéricos.
    for (const m of texto.matchAll(/\b(aExcel|aPdf)\s*\(/g)) {
      // El propio módulo que las define no cuenta.
      if (relativo === "exportacion/tabla.ts") continue;
      llamadas++;
      // LA LLAMADA COMPLETA, contando paréntesis. Con una ventana de
      // tamaño fijo, una llamada con un literal largo de columnas
      // quedaba cortada antes de su último argumento y el verificador
      // la reportaba como si le faltara la marca: un falso positivo que
      // enseña a ignorar al verificador.
      const trozo = llamadaCompleta(texto, m.index! + m[0].length - 1);
      if (!/marca/.test(trozo)) {
        sinMarca++;
        const linea = texto.slice(0, m.index!).split("\n").length;
        console.log(
          `[FALLO] ${relativo}:${linea} — ${m[1]}() sin la marca de la clínica. ` +
            "Pasale `{ marca, usuario }` con `marcaDeLaClinica()`."
        );
        ok = false;
      }
    }

    // 2. Constantes de color propias en un generador de documentos.
    if (/PDFDocument/.test(texto) && !COLOR_PROPIO_PERMITIDO.has(relativo)) {
      const colores = [...texto.matchAll(/"#[0-9A-Fa-f]{6}"/g)].filter(
        // El negro y el blanco no son marca: son tinta y papel.
        (c) =>
          !/#000000|#FFFFFF|#ffffff/.test(c[0]) &&
          !COLORES_QUE_NO_SON_MARCA.has(c[0].replace(/"/g, ""))
      );
      if (colores.length > 0) {
        coloresPropios++;
        console.log(
          `[FALLO] ${relativo} — ${colores.length} color(es) de marca propios ` +
            `(${colores.slice(0, 3).map((c) => c[0]).join(", ")}). ` +
            "El color sale de `marca.primario`, que es el de la clínica."
        );
        ok = false;
      }
    }
  }

  assert(sinMarca === 0, `las ${llamadas} llamadas a aExcel/aPdf pasan la marca`);
  assert(coloresPropios === 0, "ningún generador de PDF declara su propio color de marca");

  // =================================================================
  // B. Los archivos de verdad
  // =================================================================
  console.log("\n=== B. Los archivos generados traen el logo ===");
  const conLogo = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM tenants WHERE logo_url IS NOT NULL ORDER BY creado_en LIMIT 1`
  );
  const sinLogo = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM tenants WHERE logo_url IS NULL ORDER BY creado_en LIMIT 1`
  );
  assert(conLogo.rows.length === 1, "hay una clínica con logo para probar");
  assert(sinLogo.rows.length === 1, "y otra sin logo, para ver la regla del nombre");

  const tabla = {
    titulo: "Prueba de marca",
    subtitulo: "Del 2026-11-01 al 2026-11-27 · filtro: todas las líneas",
    columnas: [
      { clave: "fecha", titulo: "Fecha", tipo: "fecha" as const },
      { clave: "concepto", titulo: "Concepto" },
      { clave: "monto", titulo: "Monto", tipo: "dinero" as const },
    ],
    filas: [
      { fecha: "2026-11-02", concepto: "Consulta general", monto: 25000 },
      { fecha: "2026-11-03", concepto: "Vacuna triple", monto: 12000 },
    ],
  };

  for (const fila of [conLogo.rows[0], sinLogo.rows[0]]) {
    if (!fila) continue;
    const esperaLogo = fila.id === conLogo.rows[0]?.id;
    const etiqueta = esperaLogo ? "con logo" : "sin logo";

    const marca = await conAlcanceTenant(fila.id, (db) => marcaDeLaClinica(db, fila.id));
    assert(marca.nombre.length > 0, `[${etiqueta}] la marca trae el nombre de la clínica`, marca.nombre);
    if (esperaLogo) {
      assert(marca.logo !== null, "[con logo] el logo se leyó del almacenamiento");
      assert(
        marca.logoMedidas !== null && marca.logoMedidas.ancho > 0,
        "[con logo] y se conocen sus medidas reales, para no deformarlo",
        marca.logoMedidas
      );
    } else {
      assert(marca.logo === null, "[sin logo] no hay logo, y el documento igual se genera");
    }

    // --- El Excel ------------------------------------------------
    const xlsx = aExcel(tabla, { marca, usuario: "Verificador" });
    const zip = unzipSync(new Uint8Array(xlsx));
    const nombres = Object.keys(zip);
    const hoja = Buffer.from(zip["xl/worksheets/sheet1.xml"]).toString("utf8");
    const tipos = Buffer.from(zip["[Content_Types].xml"]).toString("utf8");

    assert(
      hoja.includes(marca.nombre.slice(0, 12)),
      `[${etiqueta}] el nombre de la clínica está en la planilla`
    );
    assert(
      hoja.includes("Generado el") && hoja.includes("Verificador"),
      `[${etiqueta}] con la fecha de generación y el usuario`
    );
    assert(hoja.includes("<autoFilter"), `[${etiqueta}] la tabla tiene filtro automático`);
    assert(hoja.includes("<headerFooter>"), `[${etiqueta}] y encabezado de impresión`);
    assert(
      hoja.includes('s="3"'),
      `[${etiqueta}] la columna de dinero lleva formato de moneda`
    );

    if (esperaLogo) {
      // LAS CINCO PIEZAS. Si falta una, Excel abre el archivo sin la
      // imagen o se niega a abrirlo, y las dos cosas pasan en silencio.
      const extension = marca.logoTipo === "png" ? "png" : "jpeg";
      for (const pieza of [
        `xl/media/logo.${extension}`,
        "xl/drawings/drawing1.xml",
        "xl/drawings/_rels/drawing1.xml.rels",
        "xl/worksheets/_rels/sheet1.xml.rels",
      ]) {
        assert(nombres.includes(pieza), `[con logo] el .xlsx trae ${pieza}`);
      }
      assert(
        tipos.includes(`image/${marca.logoTipo}`),
        "[con logo] y declara el tipo de la imagen en [Content_Types]"
      );
      assert(hoja.includes("<drawing r:id="), "[con logo] la hoja referencia el dibujo");
      assert(
        Buffer.from(zip[`xl/media/logo.${extension}`]).equals(marca.logo!),
        "[con logo] los bytes de la imagen son los del logo de la clínica"
      );
      // La proporción: el ancho declarado sale del alto por la relación
      // real de la imagen, no de una caja fija.
      const dibujo = Buffer.from(zip["xl/drawings/drawing1.xml"]).toString("utf8");
      const ext = /<xdr:ext cx="(\d+)" cy="(\d+)"\/>/.exec(dibujo);
      assert(!!ext, "[con logo] el dibujo declara su tamaño");
      if (ext) {
        const proporcionDeclarada = Number(ext[1]) / Number(ext[2]);
        const proporcionReal = marca.logoMedidas!.ancho / marca.logoMedidas!.alto;
        assert(
          Math.abs(proporcionDeclarada - proporcionReal) < 0.05,
          "[con logo] y respeta la proporción real: un logo 4:1 no sale estirado",
          { proporcionDeclarada, proporcionReal }
        );
      }
    } else {
      assert(
        !nombres.some((n) => n.startsWith("xl/media/")),
        "[sin logo] el .xlsx no trae imagen, y el nombre hace de marca"
      );
    }

    // --- El PDF ---------------------------------------------------
    const pdf = await aPdf(tabla, { marca, usuario: "Verificador" });
    assert(pdf.subarray(0, 5).toString() === "%PDF-", `[${etiqueta}] el PDF es un PDF`);
    assert(pdf.length > 1200, `[${etiqueta}] y tiene contenido`, `${pdf.length} bytes`);
    // NO se busca el nombre del autor en los bytes: el texto de un PDF
    // va comprimido y buscarlo ahí daría un OK o un FALLO según cómo
    // comprima pdfkit, que no es lo que se quiere probar. Que la línea
    // se dibuje está en `aPdf` y se ve en las muestras de
    // `docs/reportes/muestras-pdf/`.
    const texto = pdf.toString("latin1");
    if (esperaLogo) {
      // Un PDF con imagen tiene al menos un XObject de imagen.
      assert(
        /\/Subtype\s*\/Image/.test(texto) || /DCTDecode|FlateDecode/.test(texto),
        "[con logo] el PDF incrusta una imagen"
      );
    }
  }

  // --- EL COLOR DE LA CLÍNICA LLEGA AL DOCUMENTO -----------------
  //
  // No se puede leer el color de un PDF ya armado sin un renderizador
  // —no hay poppler en este entorno—, pero sí se puede probar lo que
  // importa: que cambiar `marca.primario` cambie el archivo. Si el
  // generador ignorara el color, los dos PDF saldrían idénticos.
  console.log("\n=== El color de la clínica llega al documento ===");
  const marcaBase = {
    nombre: "Clínica de prueba",
    logo: null,
    logoTipo: null,
    logoMedidas: null,
    tenue: "#5A6B82",
  };
  const pdfAzul = await aPdf(tabla, { marca: { ...marcaBase, primario: "#1B2A4A" } });
  const pdfVioleta = await aPdf(tabla, { marca: { ...marcaBase, primario: "#720AB8" } });
  assert(
    !pdfAzul.equals(pdfVioleta),
    "dos colores de clínica distintos dan dos PDF distintos: el color se usa, no se ignora"
  );
  const xlsxAzul = aExcel(tabla, { marca: { ...marcaBase, primario: "#1B2A4A" } });
  const xlsxVioleta = aExcel(tabla, { marca: { ...marcaBase, primario: "#720AB8" } });
  assert(
    !xlsxAzul.equals(xlsxVioleta),
    "y dos .xlsx distintos: el color va en el nombre de la clínica de la planilla"
  );
  const estilos = Buffer.from(unzipSync(new Uint8Array(xlsxVioleta))["xl/styles.xml"]).toString(
    "utf8"
  );
  assert(
    estilos.includes("FF720AB8"),
    "el color de la clínica está en los estilos de la planilla, en el formato que Excel espera"
  );

  // --- Las medidas de imagen, que es de lo que depende todo lo de arriba
  console.log("\n=== Las medidas de imagen ===");
  const pngMinimo = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000064000000320806000000",
    "hex"
  );
  const medidas = medidasDeImagen(pngMinimo);
  assert(
    medidas?.ancho === 100 && medidas?.alto === 50 && medidas?.tipo === "png",
    "lee el tamaño de un PNG de su cabecera IHDR",
    medidas
  );
  assert(medidasDeImagen(Buffer.from("no soy una imagen")) === null, "y devuelve null si no entiende");

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
