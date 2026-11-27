import PDFDocument from "pdfkit";
import { PoolClient } from "pg";
import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "../almacenamiento";

// ---------------------------------------------------------------------
// LA MARCA DE LA CLÍNICA EN UN PDF — anexo 07-03.
//
// Hasta acá, cada PDF armaba su encabezado por su cuenta: la receta, el
// reporte de atenciones y el comprobante electrónico tienen tres
// encabezados distintos y **las mismas tres constantes de color
// copiadas literalmente en los tres archivos**. Ninguno lee el color de
// marca de la clínica: los tres imprimen el azul de Vetline aunque la
// clínica tenga su paleta cargada desde el 01c.
//
// Este módulo es el punto único para el documento nuevo (el examen del
// A1). Los tres existentes NO se migran acá en esta entrega —cambiar el
// encabezado de un comprobante fiscal sin mirarlo en papel no es algo
// que se haga de paso—, y queda anotado en el informe como residuo.
//
// UNA SOLA POLÍTICA ANTE LA FALTA DE LOGO, que hoy son tres: la receta
// devuelve 422 y no se emite, el comprobante pone el nombre en texto, y
// el PDF de la receta de la atención imprime sin logo. Acá: **se
// imprime el nombre y el documento sale**. El criterio es el que ya
// argumentó `recetaPdf.ts`: no poner la marca por encima del paciente.
// ---------------------------------------------------------------------

export interface MarcaDeClinica {
  nombre: string;
  logo: Buffer | null;
  /** El color de la clínica, en hex. */
  primario: string;
  /** Un gris de apoyo que combina con cualquier primario. */
  tenue: string;
}

const TENUE = "#5A6B82";
const PRIMARIO_POR_DEFECTO = "#1B2A4A";

/**
 * Lee la marca de la clínica lista para pdfkit.
 *
 * Distinta de `apariencia()`, que devuelve la URL del logo para el
 * navegador: pdfkit necesita los BYTES. Por eso esto lee el objeto del
 * almacenamiento en vez de devolver un enlace.
 */
export async function marcaDeLaClinica(db: PoolClient, tenantId: string): Promise<MarcaDeClinica> {
  const r = await db.query<{ nombre: string; logo_url: string | null; primario: string | null }>(
    `SELECT t.nombre, t.logo_url, a.primario
       FROM tenants t
       LEFT JOIN clinica_apariencia a ON a.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId]
  );
  const fila = r.rows[0];
  const nombre = fila?.nombre ?? "Clínica";
  const primario = fila?.primario ?? PRIMARIO_POR_DEFECTO;

  let logo: Buffer | null = null;
  if (fila?.logo_url) {
    try {
      logo = await almacenamientoPublico.leer(claveLogoDesdeValorGuardado(fila.logo_url));
    } catch (err) {
      // Se registra y se sigue: un documento sin logo es legible; un
      // documento que no se genera, no.
      console.error(
        `[pdf] No se pudo leer el logo de la clínica (${fila.logo_url}); el documento sale con el nombre en texto.`,
        err
      );
    }
  }

  return { nombre, logo, primario, tenue: TENUE };
}

/**
 * Dibuja el encabezado y deja el cursor debajo.
 *
 * Devuelve la Y en la que puede seguir escribiendo el que llama, para
 * que no tenga que adivinar cuánto ocupó el logo.
 */
export function dibujarEncabezado(
  doc: typeof PDFDocument.prototype,
  marca: MarcaDeClinica,
  titulo: string,
  subtitulo?: string
): number {
  const izquierda = doc.page.margins.left;
  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const arriba = doc.y;

  if (marca.logo) {
    try {
      // `fit` y no `width`: un logo 4:1 metido en una caja 3:1 sale
      // estirado, y eso ya costó una corrección en el .docx del
      // informe. `fit` respeta la proporción siempre.
      doc.image(marca.logo, izquierda, arriba, { fit: [140, 46] });
    } catch {
      // Un archivo que pdfkit no entiende (un SVG, un PNG roto) no
      // puede tumbar el documento.
    }
  }

  // El nombre va SIEMPRE, con logo o sin él: es lo que identifica a la
  // clínica si el logo no se pudo leer o es ilegible en blanco y negro.
  doc
    .fillColor(marca.primario)
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(marca.nombre, izquierda + (marca.logo ? 155 : 0), arriba + 4, {
      width: anchoUtil - (marca.logo ? 155 : 0),
    });

  doc
    .fillColor("#000000")
    .fontSize(16)
    .font("Helvetica-Bold")
    .text(titulo, izquierda + (marca.logo ? 155 : 0), doc.y + 2, {
      width: anchoUtil - (marca.logo ? 155 : 0),
    });

  if (subtitulo) {
    doc
      .fillColor(marca.tenue)
      .fontSize(9)
      .font("Helvetica")
      .text(subtitulo, { width: anchoUtil - (marca.logo ? 155 : 0) });
  }

  const y = Math.max(doc.y, arriba + (marca.logo ? 52 : 0)) + 10;
  doc
    .moveTo(izquierda, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(marca.primario)
    .lineWidth(1.5)
    .stroke();

  doc.y = y + 14;
  doc.x = izquierda;
  doc.fillColor("#000000").font("Helvetica").fontSize(10);
  return doc.y;
}

/** El pie, con la fecha de impresión y quién lo imprimió. */
export function dibujarPie(
  doc: typeof PDFDocument.prototype,
  marca: MarcaDeClinica,
  texto: string
): void {
  const y = doc.page.height - doc.page.margins.bottom + 6;
  doc
    .fillColor(marca.tenue)
    .fontSize(7.5)
    .font("Helvetica")
    .text(texto, doc.page.margins.left, y, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: "center",
    });
}
