import PDFDocument from "pdfkit";
import { MarcaDeClinica, PRIMARIO_DE_FABRICA } from "../marca/marcaClinica";
import QRCode from "qrcode";
import { TIPOS_COMPROBANTE, CONDICIONES_VENTA, MEDIOS_PAGO } from "./catalogos";

// ---------------------------------------------------------------------
// La representación gráfica del comprobante.
//
// Motor: **pdfkit**, el mismo que ya genera las recetas
// (`routes/recetas.routes.ts`) y el reporte de atenciones
// (`reporteAtencionesPdf.ts`). El prompt pide reusarlo salvo que no
// sirva, y sirve: lo único que no tenía era el código QR, y eso lo
// resuelve `qrcode`, que genera un PNG que pdfkit inserta como cualquier
// imagen. Traer un segundo motor de PDF por un cuadrado sería agregar
// una dependencia grande para nada.
//
// Lo que la norma dice sobre la representación gráfica (Nota 1 del
// Anexo): el tipo de documento, la clave y la numeración consecutiva
// "deben" aparecer. Eso es lo que define qué va destacado arriba.
// ---------------------------------------------------------------------

// Los colores por omisión, para la clínica que no cargó su paleta. El
// color real sale de `datos.marca` (barrido de exportaciones): estas
// cuatro constantes estaban copiadas acá, en la receta y en el reporte
// de atenciones, y ninguna leía el color de la clínica. La
// representación gráfica de un comprobante es un documento que el
// cliente recibe: lleva la marca de quien le vendió.
//
// EL BORDE Y EL GRIS NO SON MARCA: son líneas y tinta de apoyo, y no
// cambian con la clínica.
const COLOR_POR_OMISION = PRIMARIO_DE_FABRICA;
const COLOR_MUTED = "#5A6B82";
const COLOR_BORDE = "#D7DEE8";

/**
 * A dónde apunta el QR: la consulta pública de un comprobante por su
 * clave, en el portal de Hacienda.
 *
 * El Anexo dice que la clave "se tiene que utilizar para la consulta del
 * código QR" pero NO publica la URL del consultor. Así que el QR lleva
 * **la clave sola**, que es el dato que cualquier lector —incluido el
 * propio ATV— necesita para buscar el comprobante. Meterle una URL
 * inventada lo volvería un enlace roto el día que esa URL cambie, y la
 * clave no caduca.
 */
function contenidoQr(clave: string): string {
  return clave;
}

export interface LineaPdf {
  numeroLinea: number;
  codigoCabys: string | null;
  cantidad: string;
  unidadMedida: string;
  detalle: string;
  precioUnitario: string;
  descuento: string;
  subtotal: string;
  impuesto: string;
  total: string;
}

export interface DatosPdfComprobante {
  tipoComprobante: string;
  clave: string;
  consecutivo: string;
  fechaEmision: Date;
  zonaHoraria?: string;

  /** El logo de la clínica, si lo tiene. Sin logo, va el nombre en texto. */
  logoBuffer?: Buffer;
  /** La marca de la clínica emisora: su color. */
  marca?: MarcaDeClinica;

  emisorNombre: string;
  emisorNombreComercial?: string | null;
  emisorIdentificacion: string;
  emisorTipoIdentificacionNombre: string;
  emisorDireccion: string;
  emisorTelefono?: string | null;
  emisorCorreo: string;

  receptorNombre?: string | null;
  receptorIdentificacion?: string | null;
  receptorCorreo?: string | null;
  /** Ya resuelta a nombres (provincia, cantón, distrito), no códigos. */
  receptorDireccion?: string | null;
  receptorTelefono?: string | null;

  condicionVenta: string;
  mediosPago: string[];
  moneda: string;

  lineas: LineaPdf[];

  totalGravado: string;
  totalExento: string;
  totalExonerado: string;
  totalDescuentos: string;
  totalVentaNeta: string;
  totalImpuesto: string;
  totalOtrosCargos: string;
  totalComprobante: string;

  /** Qué dijo Hacienda. Se muestra tal cual, sin maquillar. */
  estadoHacienda: string;
  detalleHacienda?: string | null;

  /** Texto libre del emisor. Es el mismo que viaja en Otros/OtroTexto. */
  observaciones?: string | null;

  /** Para una nota: a qué comprobante corrige. */
  referencias?: Array<{ numero: string | null; razon: string | null }>;
}

function nombreTipo(codigo: string): string {
  return TIPOS_COMPROBANTE.find((t) => t.codigo === codigo)?.nombre ?? `Comprobante ${codigo}`;
}

function nombreCondicionVenta(codigo: string): string {
  return CONDICIONES_VENTA.find((c) => c.codigo === codigo)?.nombre ?? codigo;
}

export function nombreMedioPago(codigo: string): string {
  return MEDIOS_PAGO.find((m) => m.codigo === codigo)?.nombre ?? codigo;
}

/** Los montos salen de la base con 5 decimales; en papel van con 2. */
function formatearMonto(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** La cantidad va con hasta 3 decimales y sin ceros de relleno: "2,5" y no "2,50000". */
function formatearCantidad(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return n.toLocaleString("es-CR", { maximumFractionDigits: 3 });
}

export async function generarPdfComprobante(datos: DatosPdfComprobante): Promise<Buffer> {
  // El color de la clínica, o el de fábrica si no cargó el suyo.
  const COLOR_PRIMARIO = datos.marca?.primario ?? COLOR_POR_OMISION;
  const COLOR_ACENTO = datos.marca?.primario ?? COLOR_POR_OMISION;

  // El QR se genera ANTES de abrir el documento: es asíncrono y pdfkit
  // trabaja de forma sincrónica sobre un stream, así que un await en
  // medio del dibujo dejaría el PDF a medias si fallara.
  const qrPng = await QRCode.toBuffer(contenidoQr(datos.clave), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "LETTER", bufferPages: true });
    const partes: Buffer[] = [];
    doc.on("data", (c) => partes.push(c));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    const fmtFecha = new Intl.DateTimeFormat("es-CR", {
      timeZone: datos.zonaHoraria ?? "America/Costa_Rica",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(datos.fechaEmision);

    const izquierda = 40;
    const anchoUtil = 532;

    // -----------------------------------------------------------------
    // Encabezado: marca de la clínica a la izquierda, identidad del
    // comprobante a la derecha.
    // -----------------------------------------------------------------
    if (datos.logoBuffer) {
      // `fit` y no `width`: un logo apaisado y uno cuadrado tienen que
      // caber en la misma caja sin deformarse. Ya pasó en el .docx del
      // informe que una caja fija distorsionó un logo real.
      doc.image(datos.logoBuffer, izquierda, 40, { fit: [150, 60] });
    } else {
      doc.fontSize(14).fillColor(COLOR_PRIMARIO).text(datos.emisorNombre, izquierda, 45, {
        width: 240,
      });
    }

    doc
      .fontSize(16)
      .fillColor(COLOR_PRIMARIO)
      .text(nombreTipo(datos.tipoComprobante), izquierda + 250, 42, {
        width: anchoUtil - 250,
        align: "right",
      });
    doc
      .fontSize(9)
      .fillColor(COLOR_MUTED)
      .text(`N.º ${datos.consecutivo}`, izquierda + 250, 64, {
        width: anchoUtil - 250,
        align: "right",
      })
      .text(fmtFecha, izquierda + 250, 77, { width: anchoUtil - 250, align: "right" });

    // La clave, completa y en monoespaciado: son 50 dígitos y alguien
    // los va a tener que leer o copiar.
    doc
      .fontSize(7)
      .fillColor(COLOR_MUTED)
      .font("Courier")
      .text(datos.clave, izquierda + 180, 92, { width: anchoUtil - 180, align: "right" })
      .font("Helvetica");

    doc.moveTo(izquierda, 112).lineTo(izquierda + anchoUtil, 112).strokeColor(COLOR_BORDE).stroke();

    // -----------------------------------------------------------------
    // Emisor y receptor, en dos columnas.
    // -----------------------------------------------------------------
    let y = 122;
    const anchoCol = 256;

    doc.fontSize(8).fillColor(COLOR_ACENTO).text("EMISOR", izquierda, y);
    doc.fontSize(8).fillColor(COLOR_ACENTO).text("RECEPTOR", izquierda + anchoCol + 20, y);
    y += 12;

    const bloqueEmisor = [
      datos.emisorNombre,
      datos.emisorNombreComercial ? `(${datos.emisorNombreComercial})` : null,
      `${datos.emisorTipoIdentificacionNombre}: ${datos.emisorIdentificacion}`,
      datos.emisorDireccion,
      datos.emisorTelefono ? `Tel. ${datos.emisorTelefono}` : null,
      datos.emisorCorreo,
    ].filter((x): x is string => !!x);

    const bloqueReceptor = datos.receptorNombre
      ? [
          datos.receptorNombre,
          datos.receptorIdentificacion ? `Identificación: ${datos.receptorIdentificacion}` : null,
          datos.receptorDireccion,
          datos.receptorTelefono ? `Tel. ${datos.receptorTelefono}` : null,
          datos.receptorCorreo,
        ].filter((x): x is string => !!x)
      : // Un tiquete puede no identificar al receptor, y decirlo es mejor
        // que dejar la columna en blanco como si faltara un dato.
        ["Consumidor final"];

    doc.fontSize(9).fillColor("#000000");
    const yInicio = y;
    for (const linea of bloqueEmisor) {
      doc.text(linea, izquierda, y, { width: anchoCol });
      y = doc.y;
    }
    const yFinEmisor = y;
    y = yInicio;
    for (const linea of bloqueReceptor) {
      doc.text(linea, izquierda + anchoCol + 20, y, { width: anchoCol });
      y = doc.y;
    }
    y = Math.max(yFinEmisor, y) + 10;

    doc
      .fontSize(9)
      .fillColor(COLOR_MUTED)
      .text(
        `Condición de venta: ${nombreCondicionVenta(datos.condicionVenta)}` +
          (datos.mediosPago.length > 0 ? `    Medio de pago: ${datos.mediosPago.join(", ")}` : "") +
          `    Moneda: ${datos.moneda}`,
        izquierda,
        y,
        { width: anchoUtil }
      );
    y = doc.y + 10;

    // -----------------------------------------------------------------
    // Detalle. Mismo criterio de tabla que el PDF de la receta: anchos
    // fijos, encabezado repetido al cambiar de página, y la altura de la
    // fila calculada sobre TODAS las columnas (no solo la más larga),
    // porque cualquiera puede hacer wrap.
    // -----------------------------------------------------------------
    const col = {
      n: izquierda,
      detalle: izquierda + 24,
      cant: izquierda + 250,
      precio: izquierda + 300,
      desc: izquierda + 368,
      imp: izquierda + 420,
      total: izquierda + 465,
    };
    const ancho = { n: 20, detalle: 222, cant: 46, precio: 64, desc: 48, imp: 41, total: 67 };

    const encabezadoTabla = () => {
      doc.rect(izquierda, y, anchoUtil, 18).fill(COLOR_PRIMARIO);
      const yt = y + 5;
      doc.fontSize(7.5).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text("#", col.n + 3, yt, { width: ancho.n });
      doc.text("Detalle", col.detalle, yt, { width: ancho.detalle });
      doc.text("Cant.", col.cant, yt, { width: ancho.cant, align: "right" });
      doc.text("Precio", col.precio, yt, { width: ancho.precio, align: "right" });
      doc.text("Desc.", col.desc, yt, { width: ancho.desc, align: "right" });
      doc.text("Imp.", col.imp, yt, { width: ancho.imp, align: "right" });
      doc.text("Total", col.total, yt, { width: ancho.total, align: "right" });
      y += 20;
      doc.font("Helvetica");
    };

    encabezadoTabla();

    for (const l of datos.lineas) {
      if (y > 660) {
        doc.addPage();
        y = 40;
        encabezadoTabla();
      }
      const yFila = y;
      doc.fontSize(7.5).fillColor("#000000");
      doc.text(String(l.numeroLinea), col.n + 3, yFila, { width: ancho.n });
      // El CABYS va bajo el detalle y en gris: es obligatorio en el XML y
      // útil para una contadora, pero no es lo que el cliente lee.
      doc.text(l.detalle, col.detalle, yFila, { width: ancho.detalle });
      const yTrasDetalle = doc.y;
      if (l.codigoCabys) {
        doc
          .fontSize(6.5)
          .fillColor(COLOR_MUTED)
          .text(`CABYS ${l.codigoCabys}`, col.detalle, yTrasDetalle, { width: ancho.detalle });
      }
      const yFinDetalle = doc.y;

      doc.fontSize(7.5).fillColor("#000000");
      doc.text(`${formatearCantidad(l.cantidad)} ${l.unidadMedida}`, col.cant, yFila, {
        width: ancho.cant,
        align: "right",
      });
      doc.text(formatearMonto(l.precioUnitario), col.precio, yFila, {
        width: ancho.precio,
        align: "right",
      });
      doc.text(formatearMonto(l.descuento), col.desc, yFila, {
        width: ancho.desc,
        align: "right",
      });
      doc.text(formatearMonto(l.impuesto), col.imp, yFila, { width: ancho.imp, align: "right" });
      doc.text(formatearMonto(l.total), col.total, yFila, { width: ancho.total, align: "right" });

      const alturaFila = Math.max(
        yFinDetalle - yFila,
        doc.heightOfString(`${formatearCantidad(l.cantidad)} ${l.unidadMedida}`, {
          width: ancho.cant,
        }),
        doc.heightOfString(formatearMonto(l.precioUnitario), { width: ancho.precio }),
        12
      );
      y = yFila + alturaFila + 4;
      doc
        .moveTo(izquierda, y - 2)
        .lineTo(izquierda + anchoUtil, y - 2)
        .strokeColor(COLOR_BORDE)
        .lineWidth(0.5)
        .stroke();
    }

    // -----------------------------------------------------------------
    // Observaciones. Debajo del detalle y antes de los totales, que es
    // donde las busca quien lee una factura. Es el mismo texto que va
    // en Otros/OtroTexto del XML: uno solo, en dos soportes.
    // -----------------------------------------------------------------
    if (datos.observaciones && datos.observaciones.trim() !== "") {
      if (y > 620) {
        doc.addPage();
        y = 50;
      }
      y += 6;
      doc.fontSize(8).fillColor(COLOR_MUTED).text("OBSERVACIONES", izquierda, y);
      y = doc.y + 2;
      doc
        .fontSize(9)
        .fillColor("#000000")
        .text(datos.observaciones.trim(), izquierda, y, { width: anchoUtil });
      y = doc.y + 8;
    }

    // -----------------------------------------------------------------
    // Totales a la derecha, QR y estado a la izquierda.
    // -----------------------------------------------------------------
    if (y > 580) {
      doc.addPage();
      y = 40;
    }
    y += 8;
    const yBloque = y;

    const totales: Array<[string, string, boolean]> = [
      ["Gravado", datos.totalGravado, false],
      ["Exento", datos.totalExento, false],
      ["Exonerado", datos.totalExonerado, false],
      ["Descuentos", datos.totalDescuentos, false],
      ["Venta neta", datos.totalVentaNeta, false],
      ["Impuesto", datos.totalImpuesto, false],
      ["Otros cargos", datos.totalOtrosCargos, false],
      ["TOTAL", datos.totalComprobante, true],
    ];
    for (const [etiqueta, valor, destacado] of totales) {
      // Las líneas en cero no se imprimen, salvo el TOTAL: una factura
      // sin exonerados no tiene por qué mostrar "Exonerado 0,00".
      if (!destacado && Number(valor) === 0) continue;
      doc
        .fontSize(destacado ? 11 : 8.5)
        .font(destacado ? "Helvetica-Bold" : "Helvetica")
        .fillColor(destacado ? COLOR_PRIMARIO : COLOR_MUTED)
        .text(etiqueta, izquierda + 300, y, { width: 110, align: "right" })
        .fillColor(destacado ? COLOR_PRIMARIO : "#000000")
        .text(`${datos.moneda} ${formatearMonto(valor)}`, izquierda + 414, y, {
          width: 118,
          align: "right",
        });
      y += destacado ? 16 : 12;
    }
    doc.font("Helvetica");

    // El QR, con la clave debajo.
    doc.image(qrPng, izquierda, yBloque, { fit: [86, 86] });
    doc
      .fontSize(6.5)
      .fillColor(COLOR_MUTED)
      .text("Consultá este comprobante en Hacienda con su clave numérica.", izquierda + 94, yBloque, {
        width: 190,
      });
    doc
      .fontSize(8)
      .fillColor(COLOR_PRIMARIO)
      .text(`Estado en Hacienda: ${datos.estadoHacienda}`, izquierda + 94, yBloque + 22, {
        width: 190,
      });
    if (datos.detalleHacienda) {
      doc
        .fontSize(7)
        .fillColor(COLOR_MUTED)
        .text(datos.detalleHacienda, izquierda + 94, yBloque + 36, { width: 190 });
    }

    y = Math.max(y, yBloque + 92) + 6;

    if (datos.referencias && datos.referencias.length > 0) {
      doc.fontSize(8).fillColor(COLOR_ACENTO).text("REFERENCIA", izquierda, y);
      y = doc.y + 2;
      for (const ref of datos.referencias) {
        doc
          .fontSize(7.5)
          .fillColor("#000000")
          .text(
            `${ref.numero ?? "(sin número)"}${ref.razon ? ` — ${ref.razon}` : ""}`,
            izquierda,
            y,
            { width: anchoUtil }
          );
        y = doc.y + 2;
      }
    }

    // -----------------------------------------------------------------
    // Pie: numeración de páginas. Igual que en el informe .docx, se
    // escribe al final recorriendo las páginas ya creadas — es la única
    // forma de saber cuántas son.
    // -----------------------------------------------------------------
    const rango = doc.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(rango.start + i);
      doc
        .fontSize(7)
        .fillColor(COLOR_MUTED)
        .text(
          `${datos.emisorNombre} · ${nombreTipo(datos.tipoComprobante)} ${datos.consecutivo} · Página ${i + 1} de ${rango.count}`,
          izquierda,
          742,
          { width: anchoUtil, align: "center" }
        );
    }

    doc.end();
  });
}
