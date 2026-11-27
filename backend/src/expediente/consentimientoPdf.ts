import { fechaHoyEnZona, zonaDeLaClinica } from "../fecha";
import PDFDocument from "pdfkit";
import { PoolClient } from "pg";
import { marcaDeLaClinica } from "../marca/marcaClinica";
import { dibujarEncabezado, dibujarPie } from "../pdf/marcaPdf";
import { emitirNotificacion } from "../notificaciones";
import { puedeEnviar } from "../crm/consentimientos";
import { verificarIntegridad } from "./consentimientos";

// ---------------------------------------------------------------------
// EL PDF DEL CONSENTIMIENTO FIRMADO, y su envío al cliente.
//
// Lo que tiene que poder hacer el cliente con esto: guardarlo, leerlo
// dentro de un año y, si hace falta, mostrárselo a alguien. Por eso el
// documento lleva **las cuatro cosas** que lo hacen un respaldo y no un
// recibo:
//
//   1. el texto EXACTO que se firmó —no la plantilla de hoy, que pudo
//      cambiar: el texto está congelado en la fila desde que se firmó—;
//   2. la firma, con el nombre y la identificación de quien firmó y en
//      qué calidad (propietario o autorizado por él);
//   3. la fecha y la hora del SERVIDOR, el testigo del personal, el
//      dispositivo y la IP;
//   4. **la huella SHA-256**, impresa. Es lo que permite comparar el
//      papel con el registro y ver si alguno de los dos cambió.
//
// Se genera al vuelo y no se guarda: el documento es reproducible desde
// la fila, y guardar una copia sería un segundo original que puede
// divergir del primero.
// ---------------------------------------------------------------------

export interface ConsentimientoParaPdf {
  id: string;
  titulo: string;
  texto: string;
  firma_png: string | null;
  firmante_nombre: string;
  firmante_identificacion: string | null;
  firmante_relacion: string | null;
  firmante_autorizado_por: string | null;
  firmado_en: string | Date;
  firmado_a_distancia: boolean;
  firma_dispositivo: string | null;
  firma_ip: string | null;
  firma_valida: boolean;
  firma_invalida_motivo: string | null;
  huella: string | null;
  testigo?: string | null;
  paciente?: string | null;
  especie?: string | null;
}

export async function consentimientoEnPdf(
  db: PoolClient,
  tenantId: string,
  c: ConsentimientoParaPdf
): Promise<Buffer> {
  const marca = await marcaDeLaClinica(db, tenantId);
  const integridad = verificarIntegridad(c);

  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const trozos: Buffer[] = [];
    doc.on("data", (t: Buffer) => trozos.push(t));
    doc.on("end", () => resolver(Buffer.concat(trozos)));
    doc.on("error", rechazar);

    const izq = doc.page.margins.left;
    const ancho = doc.page.width - izq - doc.page.margins.right;

    dibujarEncabezado(
      doc,
      marca,
      c.titulo,
      c.paciente ? `${c.paciente}${c.especie ? ` · ${c.especie}` : ""}` : undefined
    );

    // EL AVISO VA PRIMERO cuando el consentimiento no tiene firma
    // válida: quien abre el PDF tiene que enterarse antes de leerlo, no
    // al final.
    if (!c.firma_valida) {
      doc.rect(izq, doc.y, ancho, 44).fillAndStroke("#FEF3C7", "#B45309");
      doc
        .fillColor("#7C2D12")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("SIN FIRMA VÁLIDA", izq + 10, doc.y - 36, { width: ancho - 20 })
        .font("Helvetica")
        .text(c.firma_invalida_motivo ?? "Este consentimiento no tiene una firma verificable.", {
          width: ancho - 20,
        });
      doc.y += 18;
      doc.x = izq;
      doc.fillColor("#000000");
    } else if (integridad.verificable && !integridad.intacto) {
      doc.rect(izq, doc.y, ancho, 36).fillAndStroke("#FEE2E2", "#B91C1C");
      doc
        .fillColor("#7F1D1D")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(
          "EL REGISTRO NO COINCIDE CON SU HUELLA: el texto o la firma cambiaron después de firmarse.",
          izq + 10,
          doc.y - 28,
          { width: ancho - 20 }
        );
      doc.y += 14;
      doc.x = izq;
      doc.fillColor("#000000").font("Helvetica");
    }

    // --- El texto exacto -------------------------------------------
    doc.moveDown(0.5);
    doc.fontSize(10.5).fillColor("#000000").font("Helvetica");
    for (const parrafo of c.texto.split(/\n{2,}/)) {
      doc.text(parrafo.trim(), { width: ancho, align: "justify" });
      doc.moveDown(0.6);
    }

    // --- La firma ---------------------------------------------------
    doc.moveDown(1);
    const yFirma = doc.y;
    if (c.firma_png && c.firma_valida) {
      try {
        const base64 = c.firma_png.slice(c.firma_png.indexOf(",") + 1);
        doc.image(Buffer.from(base64, "base64"), izq, yFirma, { fit: [220, 80] });
      } catch {
        // Una firma que pdfkit no entiende no puede tumbar el
        // documento: el resto de la evidencia sigue valiendo.
      }
    }
    doc
      .moveTo(izq, yFirma + 84)
      .lineTo(izq + 240, yFirma + 84)
      .strokeColor("#888888")
      .lineWidth(0.8)
      .stroke();

    doc.fontSize(9).fillColor("#000000").font("Helvetica-Bold");
    doc.text(c.firmante_nombre, izq, yFirma + 90, { width: 240 });
    doc.font("Helvetica").fillColor(marca.tenue);
    if (c.firmante_identificacion) doc.text(`Identificación: ${c.firmante_identificacion}`);
    doc.text(
      c.firmante_relacion === "autorizado"
        ? `Autorizado por ${c.firmante_autorizado_por ?? "el propietario"}`
        : "Propietario del paciente"
    );

    // --- La evidencia ----------------------------------------------
    doc.y = Math.max(doc.y, yFirma + 90);
    doc.x = izq + 270;
    const fecha = new Date(c.firmado_en);
    doc.fontSize(8).fillColor(marca.tenue);
    doc.text(`Firmado el ${fecha.toISOString().slice(0, 16).replace("T", " ")} UTC`, {
      width: ancho - 270,
    });
    if (c.testigo) doc.text(`Testigo por la clínica: ${c.testigo}`, { width: ancho - 270 });
    if (c.firmado_a_distancia) doc.text("Firmado a distancia", { width: ancho - 270 });
    if (c.firma_dispositivo) {
      doc.text(`Dispositivo: ${c.firma_dispositivo.slice(0, 90)}`, { width: ancho - 270 });
    }
    if (c.firma_ip) doc.text(`IP: ${c.firma_ip}`, { width: ancho - 270 });

    // --- La huella ---------------------------------------------------
    if (c.huella) {
      doc.x = izq;
      doc.moveDown(2);
      doc
        .fontSize(7.5)
        .fillColor(marca.tenue)
        .text(
          "Huella del documento (SHA-256 del texto y la firma). Sirve para comprobar que este papel " +
            "es el registro que está en el expediente:",
          { width: ancho }
        )
        .font("Courier")
        .text(c.huella, { width: ancho })
        .font("Helvetica");
    }

    dibujarPie(doc, marca, `${marca.nombre} · consentimiento ${c.id.slice(0, 8)}`);
    doc.end();
  });
}

/**
 * Le manda el consentimiento firmado al cliente.
 *
 * PASA POR `puedeEnviar()` (03) con finalidad **salud**: un
 * consentimiento clínico no es una promoción, pero igual se respeta el
 * canal y el consentimiento de contacto del cliente. Si no se le puede
 * escribir, no se le escribe y se dice por qué —el documento queda en
 * el expediente y se le puede entregar impreso—.
 */
export async function enviarConsentimientoAlCliente(
  db: PoolClient,
  tenantId: string,
  datos: {
    consentimientoId: string;
    pacienteId: string;
    propietarioId: string | null;
    titulo: string;
    pacienteNombre: string;
  }
): Promise<{ enviado: boolean; motivo?: string }> {
  if (!datos.propietarioId) {
    return { enviado: false, motivo: "El paciente no tiene un cliente asociado." };
  }

  const veredicto = await puedeEnviar(db, {
    tenantId,
    propietarioId: datos.propietarioId,
    pacienteId: datos.pacienteId,
    finalidad: "salud",
    tipo: "consentimiento_firmado",
  });
  if (!veredicto.puede) {
    return { enviado: false, motivo: veredicto.explicacion ?? veredicto.motivo };
  }

  await emitirNotificacion(db, {
    tenantId,
    tipo: "consentimiento_firmado",
    destinatarioTipo: "propietario",
    destinatarioId: datos.propietarioId,
    pacienteId: datos.pacienteId,
    asunto: `${datos.titulo} — ${datos.pacienteNombre}`,
    contenido:
      `Adjuntamos el ${datos.titulo.toLowerCase()} que firmaste para ${datos.pacienteNombre}. ` +
      "Guardalo: incluye el texto completo, tu firma y la huella del documento.",
    datosCorreo: {
      nombrePaciente: datos.pacienteNombre,
      titulo: datos.titulo,
      fecha: fechaHoyEnZona(await zonaDeLaClinica(db, tenantId)),
    },
  });

  return { enviado: true };
}
