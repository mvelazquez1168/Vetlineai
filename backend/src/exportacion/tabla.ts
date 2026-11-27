import { fechaHoyEnZona } from "../fecha";
import PDFDocument from "pdfkit";
import { strToU8, zipSync } from "fflate";
import { dibujarEncabezado } from "../pdf/marcaPdf";
import { MarcaDeClinica, pieDeExportacion } from "../marca/marcaClinica";

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

/**
 * LA PLANILLA, con la marca de la clínica.
 *
 * El .xlsx se escribe a mano (ver el encabezado del archivo). Agregarle
 * el logo son cuatro piezas más dentro del zip —la imagen, el dibujo,
 * su relación y la de la hoja— y la declaración en `[Content_Types]`.
 * Vale la pena: la planilla que la clínica le manda a su contador o a
 * su banco es un documento de la clínica, no una tabla anónima.
 *
 * LA REGLA DE SIEMPRE ANTE LA FALTA DE LOGO: sale el nombre, el archivo
 * se genera igual, y nunca se pone el logo de Vetline en su lugar.
 */
export function aExcel(tabla: TablaExportable, opciones: OpcionesExportacion = {}): Buffer {
  const { marca, usuario } = opciones;
  const filasXml: string[] = [];
  let fila = 1;

  const celdaTexto = (col: number, valor: string, estilo?: number) =>
    `<c r="${letraColumna(col)}${fila}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}>` +
    `<is><t>${escaparXml(valor)}</t></is></c>`;
  const celdaNumero = (col: number, valor: number, estilo?: number) =>
    `<c r="${letraColumna(col)}${fila}"${estilo ? ` s="${estilo}"` : ""}><v>${valor}</v></c>`;

  // EL ENCABEZADO. Cuando hay logo, las tres primeras filas se dejan
  // altas para que la imagen no tape el texto: el dibujo flota sobre la
  // hoja y no empuja nada.
  const conLogo = !!(marca?.logo && marca.logoTipo && marca.logoMedidas);
  if (conLogo) {
    for (let i = 0; i < 3; i++) {
      filasXml.push(`<row r="${fila}" ht="18" customHeight="1"/>`);
      fila++;
    }
  }

  // El nombre de la clínica SIEMPRE, con logo o sin él: es lo que
  // identifica el documento si la imagen no se puede leer o el archivo
  // se imprime en blanco y negro.
  if (marca) {
    filasXml.push(`<row r="${fila}">${celdaTexto(0, marca.nombre, 2)}</row>`);
    fila++;
  }

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
  // La fecha y el autor, que la §4.6 de la guía pide en toda
  // exportación: una planilla sin eso no se puede volver a mirar.
  filasXml.push(`<row r="${fila}">${celdaTexto(0, pieDeExportacion(usuario))}</row>`);
  fila++;
  fila++; // una fila en blanco

  const filaEncabezados = fila;
  filasXml.push(
    `<row r="${fila}">${tabla.columnas.map((c, i) => celdaTexto(i, c.titulo, 1)).join("")}</row>`
  );
  fila++;

  for (const f of tabla.filas) {
    const celdas = tabla.columnas.map((c, i) => {
      const tipo = c.tipo ?? "texto";
      const texto = textoDeCelda(f[c.clave], tipo);
      if (esNumerica(tipo) && texto !== "" && Number.isFinite(Number(texto))) {
        // LOS MONTOS CON FORMATO DE MONEDA (§4.6). Siguen siendo
        // números —se pueden sumar—, pero se leen como plata.
        return celdaNumero(i, Number(texto), tipo === "dinero" ? 3 : undefined);
      }
      return celdaTexto(i, texto);
    });
    filasXml.push(`<row r="${fila}">${celdas.join("")}</row>`);
    fila++;
  }

  const ultimaColumna = letraColumna(Math.max(0, tabla.columnas.length - 1));
  const ultimaFila = fila - 1;
  const colorMarca = (marca?.primario ?? "#1B2A4A").replace("#", "").toUpperCase();

  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        (conLogo
          ? `<Default Extension="${marca!.logoTipo === "png" ? "png" : "jpeg"}" ContentType="image/${marca!.logoTipo}"/>` +
            `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
          : "") +
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
    // Cuatro estilos: normal, negrita (encabezados), el nombre de la
    // clínica en SU color, y moneda. Más que eso sería maquetar una
    // planilla, y lo que se exporta son datos para filtrar.
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₡&quot;#,##0.00"/></numFmts>` +
        `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="14"/><color rgb="FF${colorMarca}"/><name val="Calibri"/></font></fonts>` +
        `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
        `<borders count="1"><border/></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
        `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
        `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
        `</styleSheet>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheetData>${filasXml.join("")}</sheetData>` +
        // EL FILTRO AUTOMÁTICO sobre la tabla, no sobre el encabezado:
        // empieza en la fila de los títulos de columna.
        (tabla.filas.length > 0
          ? `<autoFilter ref="A${filaEncabezados}:${ultimaColumna}${ultimaFila}"/>`
          : "") +
        // EL ENCABEZADO DE IMPRESIÓN con el nombre de la clínica y el
        // título. El logo EN el encabezado de impresión necesitaría un
        // `legacyDrawingHF` con VML —un formato que Excel acepta solo en
        // una forma muy precisa y que mal armado hace que el archivo no
        // abra—; el logo va en la hoja, que es lo primero que se
        // imprime.
        (marca
          ? `<headerFooter><oddHeader>&amp;L&amp;&quot;-,Bold&quot;${escaparXml(
              marca.nombre
            )}&amp;C${escaparXml(tabla.titulo)}&amp;RPagina &amp;P de &amp;N</oddHeader></headerFooter>`
          : "") +
        (conLogo ? `<drawing r:id="rId1"/>` : "") +
        `</worksheet>`
    ),
  };

  if (conLogo) {
    const extension = marca!.logoTipo === "png" ? "png" : "jpeg";
    // EMU: 9 525 por píxel a 96 ppp. El alto se fija en ~1,4 cm y el
    // ancho se DERIVA de la proporción real del archivo: es lo que
    // impide que un logo 4:1 salga estirado, el defecto que ya costó
    // una corrección en el .docx del informe.
    const altoPx = 52;
    const anchoPx = Math.round((marca!.logoMedidas!.ancho / marca!.logoMedidas!.alto) * altoPx);
    const EMU = 9525;
    archivos[`xl/media/logo.${extension}`] = new Uint8Array(marca!.logo!);
    archivos["xl/drawings/drawing1.xml"] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
        `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<xdr:oneCellAnchor>` +
        `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>19050</xdr:colOff>` +
        `<xdr:row>0</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${anchoPx * EMU}" cy="${altoPx * EMU}"/>` +
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logo"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="rId1"/>` +
        `<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${anchoPx * EMU}" cy="${altoPx * EMU}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
        `<xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`
    );
    archivos["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.${extension}"/>` +
        `</Relationships>`
    );
    archivos["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>` +
        `</Relationships>`
    );
  }

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
/**
 * Lo que convierte una tabla en un documento DE LA CLÍNICA.
 *
 * Vale para los dos formatos: el mismo logo, el mismo nombre y el mismo
 * autor en el PDF y en el Excel. Un solo tipo para que no haya un
 * encabezado de PDF y otro de planilla que un día digan distinto.
 */
export interface OpcionesExportacion {
  /** La marca de la clínica, de `marca/marcaClinica.ts`. */
  marca?: MarcaDeClinica;
  /** Quién lo generó. Va impreso: un reporte sin autor no se puede auditar. */
  usuario?: string;
}

/** @deprecated Usá `OpcionesExportacion`: vale para los dos formatos. */
export type OpcionesPdf = OpcionesExportacion;

export function aPdf(tabla: TablaExportable, opciones: OpcionesExportacion = {}): Promise<Buffer> {
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

    // CON MARCA, el encabezado es el compartido del anexo 07-03: así el
    // Excel y el PDF de cualquier módulo salen con el logo y el color de
    // la clínica, y no hay un segundo encabezado que mantener.
    if (opciones.marca) {
      dibujarEncabezado(doc, opciones.marca, tabla.titulo, tabla.subtitulo);
    } else {
      doc.font("Helvetica-Bold").fontSize(14).text(tabla.titulo, { align: "left" });
      doc.font("Helvetica").fontSize(9).fillColor("#555555");
      if (tabla.subtitulo) doc.text(tabla.subtitulo);
    }
    doc.font("Helvetica").fontSize(9).fillColor("#555555");
    doc.text(
      `${tabla.filas.length} fila(s) · generado el ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC` +
        (opciones.usuario ? ` · por ${opciones.usuario}` : "")
    );
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
export function nombreDeArchivo(
  base: string,
  extension: string,
  zonaHoraria?: string | null
): string {
  // La fecha del nombre es la del día de la clínica: un cierre exportado
  // a las 18:30 en Costa Rica se llamaba con la fecha de mañana y no
  // coincidía con el contenido.
  const fecha = fechaHoyEnZona(zonaHoraria);
  const limpio = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${limpio}-${fecha}.${extension}`;
}
