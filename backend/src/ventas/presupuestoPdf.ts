import PDFDocument from "pdfkit";
import { PoolClient } from "pg";
import { dibujarEncabezado, dibujarPie, marcaDeLaClinica } from "../pdf/marcaPdf";
import { verPresupuesto } from "./presupuestos";

// ---------------------------------------------------------------------
// EL PRESUPUESTO EN PAPEL — prompt 08b, A1.
//
// Es el documento que el dueño se lleva para decidir, así que tiene que
// decir tres cosas sin que nadie las explique:
//
//   * hasta cuándo vale (si no lo dice, el cliente vuelve en marzo con
//     el precio de noviembre y la discusión no tiene salida);
//   * que NO es una factura, porque si no alguien lo va a archivar como
//     comprobante y lo va a reclamar en la declaración;
//   * qué incluye cada línea, que es para lo que existe la nota por
//     línea («incluye la anestesia y el control a los ocho días»).
//
// Mismo encabezado que la receta, el examen y el cierre de caja:
// `pdf/marcaPdf.ts`.
// ---------------------------------------------------------------------

function colones(valor: number | string): string {
  return `₡${Number(valor).toLocaleString("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function presupuestoEnPdf(
  db: PoolClient,
  tenantId: string,
  presupuestoId: string
): Promise<{ pdf: Buffer; numero: number }> {
  const p = await verPresupuesto(db, presupuestoId);
  if (!p) throw new Error("Ese presupuesto no existe.");
  const marca = await marcaDeLaClinica(db, tenantId);

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
  });
  const trozos: Buffer[] = [];
  doc.on("data", (t: Buffer) => trozos.push(t));
  const listo = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(trozos)))
  );

  dibujarEncabezado(
    doc,
    marca,
    `Presupuesto N.º ${p.numero}`,
    [
      p.cliente_nombre ? `Para ${p.cliente_nombre}` : null,
      p.paciente_nombre ? `Paciente: ${p.paciente_nombre}` : null,
      p.vence_el ? `Vigente hasta el ${p.vence_el}` : null,
    ]
      .filter(Boolean)
      .join(" · ")
  );

  const izq = doc.page.margins.left;
  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // --- LAS LÍNEAS ----------------------------------------------------
  const anchos = [anchoUtil - 280, 60, 100, 120];
  const fila = (celdas: string[], negrita = false) => {
    const y = doc.y;
    let x = izq;
    doc.fillColor("#111").fontSize(9).font(negrita ? "Helvetica-Bold" : "Helvetica");
    celdas.forEach((c, i) => {
      doc.text(c, x, y, { width: anchos[i], align: i === 0 ? "left" : "right" });
      x += anchos[i];
    });
    doc.y = Math.max(doc.y, y + 14);
  };

  doc.moveDown(0.5);
  fila(["Concepto", "Cant.", "Precio", "Subtotal"], true);
  doc
    .moveTo(izq, doc.y)
    .lineTo(izq + anchoUtil, doc.y)
    .strokeColor("#DDD")
    .stroke();
  doc.y += 4;

  for (const l of p.lineas) {
    const sub = Number(l.cantidad) * Number(l.precio_unitario) - Number(l.descuento);
    fila([l.descripcion, Number(l.cantidad).toString(), colones(l.precio_unitario), colones(sub)]);
    if (Number(l.descuento) > 0) {
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(marca.tenue)
        .text(`Incluye un descuento de ${colones(l.descuento)}`, izq + 10, doc.y);
      doc.y += 11;
    }
    if (l.nota) {
      doc.fontSize(8).font("Helvetica-Oblique").fillColor(marca.tenue).text(l.nota, izq + 10, doc.y, {
        width: anchoUtil - 20,
      });
      doc.y += 4;
    }
  }

  doc
    .moveTo(izq, doc.y + 2)
    .lineTo(izq + anchoUtil, doc.y + 2)
    .strokeColor("#DDD")
    .stroke();
  doc.y += 8;
  fila(["Total", "", "", colones(p.total)], true);

  if (p.anticipado > 0) {
    fila(["Anticipo ya recibido", "", "", `- ${colones(p.anticipado)}`]);
    fila(["Queda por pagar", "", "", colones(p.total - p.anticipado)], true);
  }

  if (p.observaciones) {
    doc.moveDown(0.8);
    doc.fillColor(marca.primario).fontSize(10).font("Helvetica-Bold").text("Observaciones", izq);
    doc.moveDown(0.2);
    doc.fillColor("#111").fontSize(9).font("Helvetica").text(p.observaciones, izq, doc.y, {
      width: anchoUtil,
    });
  }

  // --- LO QUE ESTE PAPEL NO ES ---------------------------------------
  doc.moveDown(1.2);
  doc
    .fillColor(marca.tenue)
    .fontSize(8.5)
    .font("Helvetica")
    .text(
      `Este documento es una cotización y no un comprobante electrónico: no sirve como factura ` +
        `para la declaración de impuestos. ` +
        (p.vence_el
          ? `Los precios valen hasta el ${p.vence_el}; después de esa fecha pueden cambiar.`
          : "") +
        ` La factura se emite al momento de pagar.`,
      izq,
      doc.y,
      { width: anchoUtil }
    );

  dibujarPie(doc, marca, `${marca.nombre} · Presupuesto N.º ${p.numero}`);
  doc.end();
  return { pdf: await listo, numero: p.numero };
}
