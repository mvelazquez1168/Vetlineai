import PDFDocument from "pdfkit";
import { MarcaDeClinica, pieDeExportacion } from "./marca/marcaClinica";
import { dibujarEncabezado } from "./pdf/marcaPdf";

// prompt_code_reporte_atenciones, Paso 3 — documento que se presenta ante
// el colegio de médicos veterinarios. No reusa el ensamblado de docx de
// los informes clínicos (esto es PDF, no Word) — reusa en cambio pdfkit,
// que ya está en el proyecto para las recetas (recetas.routes.ts), así
// que no hace falta agregar ninguna biblioteca nueva.

// LOS COLORES SALEN DE LA MARCA DE LA CLÍNICA (barrido de
// exportaciones, 2026-11-27). Estaban copiados acá —y los mismos tres,
// literalmente, en el comprobante y en la receta—, así que una clínica
// con su paleta cargada desde el 01c recibía igual el azul de Vetline en
// un documento que presenta ante el colegio.

// prompt: vincular caso↔cita — el reporte muestra exactamente 5 columnas
// (fecha de atención, hora de inicio, hora de fin, número de expediente,
// número de colegiado). medico_id/medico_nombre siguen viajando en el
// payload general (para el bloque de totales por médico) pero no forman
// parte de esta fila — colegiatura sí, es la única identificación del
// profesional que se muestra en la tabla.
interface FilaAtencion {
  id: string;
  fecha: Date;
  hora_inicio: string;
  hora_fin: string;
  numero_expediente: number | null;
  colegiatura: string | null;
}

interface FilaCasoSinCita {
  id: string;
  numero_expediente: number | null;
}

export interface DatosReporteAtencionesPdf {
  clinica: { nombre: string; nombre_fiscal: string | null; numero_identificacion: string | null; tipo_identificacion_etiqueta: string | null } | undefined;
  rango: { desde: string; hasta: string };
  generadoPor: string;
  generadoEn: Date;
  atenciones: FilaAtencion[];
  casosSinCita: FilaCasoSinCita[];
  totalAtenciones: number;
  totalesPorMedico: { medicoNombre: string; total: number }[];
}

function formatearFechaCorta(fecha: Date | string): string {
  const d = new Date(fecha);
  return d.toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function formatearHora(hora: string): string {
  // "09:00:00" -> "09:00" — pdfkit no formatea, y el segundo no aporta nada acá.
  return hora.slice(0, 5);
}

function colegiaturaOFaltante(colegiatura: string | null): string {
  return colegiatura && colegiatura.trim() ? colegiatura : "FALTA COLEGIATURA";
}

export function generarPdfReporteAtenciones(
  datos: DatosReporteAtencionesPdf,
  marca: MarcaDeClinica,
  usuario?: string
): Promise<Buffer> {
  const PDF_COLOR_PRIMARIO = marca.primario;
  const PDF_COLOR_ACENTO = marca.primario;
  const PDF_COLOR_MUTED = marca.tenue;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
    const buffers: Buffer[] = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // --- Encabezado: la marca de la clínica, con su logo ---
    dibujarEncabezado(doc, marca, "Reporte de Atenciones", pieDeExportacion(usuario));
    doc.fontSize(9).fillColor(PDF_COLOR_MUTED).font("Helvetica");
    if (datos.clinica?.nombre_fiscal) doc.text(`Nombre fiscal: ${datos.clinica.nombre_fiscal}`);
    if (datos.clinica?.numero_identificacion) {
      doc.text(
        `${datos.clinica.tipo_identificacion_etiqueta ?? "Identificación"}: ${datos.clinica.numero_identificacion}`
      );
    }
    doc.moveDown(0.6);

    doc.fontSize(10).fillColor("#000000").font("Helvetica-Bold");
    doc.text(`Rango cubierto: ${formatearFechaCorta(datos.rango.desde)} — ${formatearFechaCorta(datos.rango.hasta)}`);
    doc.font("Helvetica").fillColor(PDF_COLOR_MUTED).fontSize(9);
    doc.text(`Emitido el ${formatearFechaCorta(datos.generadoEn)} por ${datos.generadoPor}`);
    doc.moveDown(1);

    // --- Tabla de atenciones ---
    doc.fontSize(12).fillColor(PDF_COLOR_ACENTO).font("Helvetica-Bold").text("Atenciones");
    doc.moveDown(0.3);

    const colX = { fecha: 50, inicio: 130, fin: 190, expediente: 250, colegiatura: 340 };
    const anchoTabla = 500;

    const encabezadoFila = () => {
      doc.rect(50, doc.y, anchoTabla, 18).fill(PDF_COLOR_PRIMARIO);
      const y = doc.y + 4;
      doc.fontSize(8).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text("Fecha", colX.fecha, y, { width: 75 });
      doc.text("Inicio", colX.inicio, y, { width: 55 });
      doc.text("Fin", colX.fin, y, { width: 55 });
      doc.text("Expediente", colX.expediente, y, { width: 85 });
      doc.text("Colegiado", colX.colegiatura, y, { width: 200 });
      doc.y += 20;
    };

    encabezadoFila();

    if (datos.atenciones.length === 0) {
      doc.fontSize(9).fillColor(PDF_COLOR_MUTED).font("Helvetica").text("Sin atenciones en este rango.", 50, doc.y);
      doc.moveDown(1);
    } else {
      doc.font("Helvetica").fontSize(8.5);
      for (const fila of datos.atenciones) {
        if (doc.y > 700) {
          doc.addPage();
          doc.y = 50;
          encabezadoFila();
          doc.font("Helvetica").fontSize(8.5);
        }
        const y = doc.y;
        doc.fillColor("#000000");
        doc.text(formatearFechaCorta(fila.fecha), colX.fecha, y, { width: 75 });
        doc.text(formatearHora(fila.hora_inicio), colX.inicio, y, { width: 55 });
        doc.text(formatearHora(fila.hora_fin), colX.fin, y, { width: 55 });
        doc.text(fila.numero_expediente != null ? String(fila.numero_expediente) : "—", colX.expediente, y, {
          width: 85,
        });
        const colegiatura = colegiaturaOFaltante(fila.colegiatura);
        doc.fillColor(colegiatura === "FALTA COLEGIATURA" ? "#B91C1C" : "#000000");
        doc.text(colegiatura, colX.colegiatura, y, { width: 200 });
        doc.y = y + 14;
      }
    }

    // --- Totales ---
    doc.moveDown(1);
    if (doc.y > 680) {
      doc.addPage();
      doc.y = 50;
    }
    doc.fontSize(10).fillColor(PDF_COLOR_PRIMARIO).font("Helvetica-Bold").text(`Total de atenciones: ${datos.totalAtenciones}`);
    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica").fillColor("#000000");
    for (const fila of datos.totalesPorMedico) {
      doc.text(`  ${fila.medicoNombre}: ${fila.total}`);
    }

    // --- Casos sin cita asociada ---
    doc.moveDown(1.2);
    if (doc.y > 650) {
      doc.addPage();
      doc.y = 50;
    }
    doc.fontSize(12).fillColor("#B91C1C").font("Helvetica-Bold").text("Casos del rango sin cita asociada");
    doc.fontSize(8.5).fillColor(PDF_COLOR_MUTED).font("Helvetica");
    doc.text(
      "Estos casos no tienen ninguna cita vinculada — no cuentan con horario registrado, así que no aparecen en la tabla de atenciones de arriba. No se omiten del reporte."
    );
    doc.moveDown(0.4);

    if (datos.casosSinCita.length === 0) {
      doc.fontSize(9).fillColor(PDF_COLOR_MUTED).text("No hay casos sin cita en este rango.");
    } else {
      const listaExpedientes = datos.casosSinCita.map((c) => (c.numero_expediente ?? "—")).join(", ");
      doc.fontSize(8.5).fillColor("#000000").text(`N.º de expediente: ${listaExpedientes}`);
    }

    // --- Numeración de páginas ---
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor(PDF_COLOR_MUTED)
        .text(`Página ${i - rango.start + 1} de ${rango.count}`, 50, 740, { width: 500, align: "center" });
    }

    doc.end();
  });
}
