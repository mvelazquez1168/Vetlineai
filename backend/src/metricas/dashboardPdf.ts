import PDFDocument from "pdfkit";
import { MarcaDeClinica, dibujarEncabezado, dibujarPie } from "../pdf/marcaPdf";
import { DashboardClinica } from "./dashboards";
import { definicion } from "./diccionario";

// ---------------------------------------------------------------------
// §8 — EL PDF DEL DASHBOARD, con los gráficos adentro.
//
// Las barras se dibujan a mano con pdfkit. No hace falta una librería
// de gráficos del lado del servidor para esto: un gráfico de barras es
// un rectángulo por fila, y traer una dependencia que renderice SVG a
// PNG para dibujar seis rectángulos sería una pieza nueva en la cadena
// de suministro a cambio de cuarenta líneas.
//
// Lo que el PDF SÍ tiene que traer, y trae: logo, título, los filtros,
// el período, la fecha y quién lo generó. Un reporte que circula por
// correo sin eso es un número sin contexto, y el mes que viene nadie
// sabe de qué período era.
// ---------------------------------------------------------------------

const PALETA = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#4b5563",
];

function dinero(n: number): string {
  return `₡${Math.round(n).toLocaleString("es-CR")}`;
}

function valorDeTarjeta(clave: string, valor: number | null): string {
  if (valor === null) return "sin dato";
  try {
    const d = definicion(clave as never);
    if (d.formato === "dinero") return dinero(valor);
    if (d.formato === "porcentaje") return `${valor} %`;
    return String(valor);
  } catch {
    return String(valor);
  }
}

function etiquetaDeTarjeta(clave: string): string {
  try {
    return definicion(clave as never).nombre;
  } catch {
    return clave;
  }
}

export function dashboardAPdf(
  d: DashboardClinica,
  marca: MarcaDeClinica,
  contexto: { usuario: string; filtros?: string }
): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 40 });
    const trozos: Buffer[] = [];
    doc.on("data", (c: Buffer) => trozos.push(c));
    doc.on("end", () => resolver(Buffer.concat(trozos)));
    doc.on("error", rechazar);

    const izq = doc.page.margins.left;
    const ancho = doc.page.width - izq - doc.page.margins.right;

    const subtitulo =
      `Del ${d.periodo.desde} al ${d.periodo.hasta} · comparado con ${d.comparado.desde} a ${d.comparado.hasta}` +
      (contexto.filtros ? ` · ${contexto.filtros}` : "");
    dibujarEncabezado(doc, marca, "Dashboard de la clínica", subtitulo);

    // --- Las tarjetas, en una rejilla de cuatro ---------------------
    const porFila = 4;
    const anchoT = (ancho - (porFila - 1) * 8) / porFila;
    let x = izq;
    let y = doc.y;
    d.tarjetas.forEach((t, i) => {
      if (i > 0 && i % porFila === 0) {
        x = izq;
        y += 62;
      }
      doc.roundedRect(x, y, anchoT, 54, 4).strokeColor("#dddddd").lineWidth(0.8).stroke();
      doc
        .fillColor(marca.tenue)
        .font("Helvetica")
        .fontSize(7.5)
        .text(etiquetaDeTarjeta(t.clave).toUpperCase(), x + 7, y + 7, { width: anchoT - 14 });
      doc
        .fillColor("#000000")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(valorDeTarjeta(t.clave, t.valor), x + 7, y + 19, { width: anchoT - 14 });
      const pie =
        t.variacion !== null
          ? `${t.variacion > 0 ? "+" : ""}${t.variacion} % vs. anterior`
          : (t.detalle ?? "");
      doc
        .fillColor(marca.tenue)
        .font("Helvetica")
        .fontSize(7)
        .text(pie, x + 7, y + 38, { width: anchoT - 14 });
      x += anchoT + 8;
    });
    doc.y = y + 70;
    doc.x = izq;

    // --- Ingresos por línea de negocio, en barras -------------------
    if (d.porLinea.length > 0) {
      doc
        .fillColor("#000000")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("Ingresos por línea de negocio", izq, doc.y);
      doc.moveDown(0.3);
      const maximo = Math.max(...d.porLinea.map((l) => l.ingresos), 1);
      const anchoBarra = ancho - 190;
      d.porLinea.slice(0, 8).forEach((l, i) => {
        const yb = doc.y;
        doc
          .fillColor("#000000")
          .font("Helvetica")
          .fontSize(8.5)
          .text(l.linea, izq, yb + 2, { width: 100 });
        const largo = Math.max(1, (l.ingresos / maximo) * anchoBarra);
        doc
          .rect(izq + 104, yb, largo, 11)
          .fillColor(PALETA[i % PALETA.length])
          .fill();
        doc
          .fillColor("#000000")
          .font("Helvetica")
          .fontSize(8.5)
          .text(dinero(l.ingresos), izq + 104 + anchoBarra + 6, yb + 2, {
            width: 80,
            align: "right",
          });
        doc.y = yb + 15;
      });
      if (d.verCostos && d.sinCosto > 0) {
        doc
          .fillColor("#b06000")
          .fontSize(8)
          .text(
            `${d.sinCosto} ítem(s) vendidos sin costo cargado: su margen no se puede calcular y no se cuenta como 100 %.`,
            izq,
            doc.y + 2,
            { width: ancho }
          );
      }
      doc.moveDown(0.8);
    }

    // --- La tendencia, como línea ----------------------------------
    if (d.tendencia.length > 1) {
      doc
        .fillColor("#000000")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("Tendencia de ingresos", izq, doc.y);
      doc.moveDown(0.3);
      const alto = 70;
      const y0 = doc.y;
      const maximo = Math.max(...d.tendencia.map((t) => t.valor), 1);
      const paso = ancho / Math.max(1, d.tendencia.length - 1);
      doc.strokeColor(marca.primario).lineWidth(1.2);
      d.tendencia.forEach((t, i) => {
        const px = izq + i * paso;
        const py = y0 + alto - (t.valor / maximo) * alto;
        if (i === 0) doc.moveTo(px, py);
        else doc.lineTo(px, py);
      });
      doc.stroke();
      doc
        .moveTo(izq, y0 + alto)
        .lineTo(izq + ancho, y0 + alto)
        .strokeColor("#dddddd")
        .lineWidth(0.5)
        .stroke();
      doc
        .fillColor(marca.tenue)
        .fontSize(7.5)
        .text(d.tendencia[0].fecha, izq, y0 + alto + 3)
        .text(d.tendencia[d.tendencia.length - 1].fecha, izq, y0 + alto + 3, {
          width: ancho,
          align: "right",
        });
      doc.y = y0 + alto + 20;
      doc.x = izq;
    }

    // --- Los tops, en tabla simple ---------------------------------
    const tabla = (
      titulo: string,
      filas: Array<{ item: string; ingresos: number; margen?: number; sin_costo?: boolean }>
    ) => {
      if (filas.length === 0) return;
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc
        .fillColor("#000000")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(titulo, izq, doc.y);
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(8.5);
      for (const f of filas.slice(0, 10)) {
        const yf = doc.y;
        doc.fillColor("#000000").text(f.item, izq, yf, { width: ancho - 200 });
        doc.text(dinero(f.ingresos), izq + ancho - 200, yf, { width: 90, align: "right" });
        if (d.verCostos) {
          doc.text(
            f.sin_costo ? "sin costo" : dinero(f.margen ?? 0),
            izq + ancho - 100,
            yf,
            { width: 100, align: "right" }
          );
        }
        doc.y = Math.max(doc.y, yf + 12);
      }
      doc.moveDown(0.6);
    };

    tabla("Top por ingresos", d.topPorIngresos);
    if (d.topPorMargen) tabla("Top por margen", d.topPorMargen);

    dibujarPie(doc, marca, contexto.usuario);
    doc.end();
  });
}
