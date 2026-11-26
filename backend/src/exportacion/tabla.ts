import PDFDocument from "pdfkit";
import { strToU8, zipSync } from "fflate";

// ---------------------------------------------------------------------
// EXPORTACIÓN DE UNA TABLA A EXCEL Y A PDF.
//
// Vivía en `inventario/` porque ahí nació (el kardex). Se mudó a su
// propio módulo cuando los reportes de CAJA necesitaron exactamente lo
// mismo: dejarlo donde estaba habría hecho que ventas importara de
// inventario para exportar una tabla de cobros, y el próximo módulo
// habría copiado el archivo.
//
// Una sola definición de "tabla exportable" —columnas con su tipo y
// filas— y dos escritores. El motivo de que sea genérico y no "exportar
// el kardex" es que las otras tablas del módulo (existencias
// valorizadas, alertas, reportes de caja) son la misma forma, y tres
// exportadores escritos por separado son tres formatos de fecha
// distintos en el mismo sistema.
//
// SE GENERA EN EL BACKEND, nunca en la pantalla. No es una preferencia
// de arquitectura: el archivo tiene que salir con los MISMOS filtros y
// el MISMO alcance de tenant que la consulta que lo llenó. Un CSV armado
// en el navegador exporta lo que la pantalla tenga cargado —la primera
// página, y nada más— y nadie lo nota hasta que alguien cuenta las
// filas.
//
// EL .xlsx SE ESCRIBE A MANO, con `fflate`, que ya está en el proyecto
// porque el lector de planillas lo usa. Un .xlsx es un zip con cuatro
// XML; traer una librería de escritura para eso sería una dependencia
// nueva en la cadena de suministro a cambio de treinta líneas. El PDF
// usa `pdfkit`, que ya genera el reporte de atenciones y el comprobante.
// ---------------------------------------------------------------------

export type TipoColumna = "texto" | "numero" | "dinero" | "fecha";

export interface ColumnaExportable {
  clave: string;
  titulo: string;
  tipo?: TipoColumna;
}

export interface TablaExportable {
  titulo: string;
  /** Qué filtros estaban aplicados. Va impreso: un archivo sin eso no se puede volver a mirar. */
  subtitulo?: string;
  columnas: ColumnaExportable[];
  filas: Array<Record<string, unknown>>;
  /** Advertencia a imprimir, p. ej. si se alcanzó el tope de filas. */
  aviso?: string;
}

function textoDeCelda(valor: unknown, tipo: TipoColumna): string {
  if (valor === null || valor === undefined || valor === "") return "";
  if (tipo === "fecha") {
    const d = valor instanceof Date ? valor : new Date(String(valor));
    if (Number.isNaN(d.getTime())) return String(valor);
    // Fecha y hora en formato ISO corto: es lo que Excel entiende sin
    // pelearse con la configuración regional de cada máquina.
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
  if (tipo === "numero" || tipo === "dinero") {
    const n = Number(valor);
    return Number.isFinite(n) ? String(n) : String(valor);
  }
  return String(valor);
}

function esNumerica(tipo: TipoColumna): boolean {
  return tipo === "numero" || tipo === "dinero";
}

// ---------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Los caracteres de control rompen el XML y Excel se niega a abrir
    // el archivo sin decir por qué. Se van.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function letraColumna(i: number): string {
  let n = i;
  let letras = "";
  do {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letras;
}

export function aExcel(tabla: TablaExportable): Buffer {
  const filasXml: string[] = [];
  let fila = 1;

  const celdaTexto = (col: number, valor: string, estilo?: number) =>
    `<c r="${letraColumna(col)}${fila}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}>` +
    `<is><t>${escaparXml(valor)}</t></is></c>`;
  const celdaNumero = (col: number, valor: number) =>
    `<c r="${letraColumna(col)}${fila}"><v>${valor}</v></c>`;

  // Título y filtros arriba, como en cualquier reporte impreso.
  filasXml.push(`<row r="${fila}">${celdaTexto(0, tabla.titulo, 1)}</row>`);
  fila++;
  if (tabla.subtitulo) {
    filasXml.push(`<row r="${fila}">${celdaTexto(0, tabla.subtitulo)}</row>`);
    fila++;
  }
  if (tabla.aviso) {
    filasXml.push(`<row r="${fila}">${celdaTexto(0, tabla.aviso)}</row>`);
    fila++;
  }
  fila++; // una fila en blanco

  filasXml.push(
    `<row r="${fila}">${tabla.columnas.map((c, i) => celdaTexto(i, c.titulo, 1)).join("")}</row>`
  );
  fila++;

  for (const f of tabla.filas) {
    const celdas = tabla.columnas.map((c, i) => {
      const tipo = c.tipo ?? "texto";
      const texto = textoDeCelda(f[c.clave], tipo);
      if (esNumerica(tipo) && texto !== "" && Number.isFinite(Number(texto))) {
        return celdaNumero(i, Number(texto));
      }
      return celdaTexto(i, texto);
    });
    filasXml.push(`<row r="${fila}">${celdas.join("")}</row>`);
    fila++;
  }

  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`
    ),
    // Dos estilos: el normal y uno en negrita para el título y los
    // encabezados. Más que eso sería maquetar una planilla, y lo que se
    // exporta son datos para filtrar.
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
        `<borders count="1"><border/></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
        `</styleSheet>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetData>${filasXml.join("")}</sheetData></worksheet>`
    ),
  };

  return Buffer.from(zipSync(archivos));
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------

/**
 * PDF horizontal con el encabezado repetido en cada página.
 *
 * Horizontal porque un kardex tiene nueve columnas y en vertical no
 * entra ninguna legible. El encabezado se repite porque una tabla de
 * cuatro páginas sin encabezado obliga a volver a la primera para saber
 * qué columna es cuál.
 */
export function aPdf(tabla: TablaExportable): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36 });
    const trozos: Buffer[] = [];
    doc.on("data", (c: Buffer) => trozos.push(c));
    doc.on("end", () => resolver(Buffer.concat(trozos)));
    doc.on("error", rechazar);

    const izquierda = doc.page.margins.left;
    const ancho = doc.page.width - izquierda - doc.page.margins.right;

    // El ancho de cada columna se reparte por el tipo: las de texto
    // libre necesitan el doble que una fecha o un número.
    const pesos = tabla.columnas.map((c) => ((c.tipo ?? "texto") === "texto" ? 2 : 1.2));
    const sumaPesos = pesos.reduce((a, p) => a + p, 0);
    const anchos = pesos.map((p) => (p / sumaPesos) * ancho);

    const encabezado = () => {
      doc.font("Helvetica-Bold").fontSize(9);
      let x = izquierda;
      const y = doc.y;
      tabla.columnas.forEach((c, i) => {
        doc.text(c.titulo, x, y, {
          width: anchos[i] - 4,
          align: esNumerica(c.tipo ?? "texto") ? "right" : "left",
        });
        x += anchos[i];
      });
      doc.y = y + 14;
      doc
        .moveTo(izquierda, doc.y - 4)
        .lineTo(izquierda + ancho, doc.y - 4)
        .strokeColor("#cccccc")
        .lineWidth(0.5)
        .stroke();
      doc.font("Helvetica").fontSize(8.5);
    };

    doc.font("Helvetica-Bold").fontSize(14).text(tabla.titulo, { align: "left" });
    doc.font("Helvetica").fontSize(9).fillColor("#555555");
    if (tabla.subtitulo) doc.text(tabla.subtitulo);
    doc.text(`${tabla.filas.length} fila(s) · generado el ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
    if (tabla.aviso) doc.fillColor("#b06000").text(tabla.aviso);
    doc.fillColor("#000000").moveDown(0.6);

    encabezado();

    for (const f of tabla.filas) {
      const textos = tabla.columnas.map((c) => textoDeCelda(f[c.clave], c.tipo ?? "texto"));
      const alto = Math.max(
        ...textos.map((t, i) =>
          doc.heightOfString(t || " ", { width: anchos[i] - 4, align: "left" })
        )
      );
      if (doc.y + alto > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        encabezado();
      }
      let x = izquierda;
      const y = doc.y;
      textos.forEach((t, i) => {
        doc.text(t, x, y, {
          width: anchos[i] - 4,
          align: esNumerica(tabla.columnas[i].tipo ?? "texto") ? "right" : "left",
        });
        x += anchos[i];
      });
      doc.y = y + alto + 3;
    }

    doc.end();
  });
}

/** Nombre de archivo sin acentos ni espacios, con la fecha adentro. */
export function nombreDeArchivo(base: string, extension: string): string {
  const fecha = new Date().toISOString().slice(0, 10);
  const limpio = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${limpio}-${fecha}.${extension}`;
}
