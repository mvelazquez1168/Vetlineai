import { fechaHoyEnZona, zonaDeLaClinica } from "../fecha";
import PDFDocument from "pdfkit";
import { PoolClient } from "pg";
import { dibujarEncabezado, dibujarPie, marcaDeLaClinica } from "../pdf/marcaPdf";
import { resumenDelExamen } from "./examen";

// ---------------------------------------------------------------------
// EL EXAMEN FÍSICO EN PDF — anexo 07-03, A1.
//
// «En la vista del expediente y en el PDF, la revisión se resume así:
// primero los hallazgos anormales; después "resto sin alteraciones";
// y los no evaluados aparte.» El orden no se arma acá: lo devuelve
// `resumenDelExamen`, el mismo que usa la pantalla. Si cada uno lo
// ordenara, un día dirían cosas distintas sobre el mismo examen.
//
// Para qué sirve este papel: el dueño que lo pide, el colega al que se
// deriva el paciente, y el expediente impreso que alguna clínica
// todavía archiva.
// ---------------------------------------------------------------------

export interface ExamenEnPdf {
  buffer: Buffer;
  nombreArchivo: string;
}

function sanitizar(nombre: string): string {
  return nombre.replace(/[\\/:*?"<>|]/g, "").trim() || "examen";
}

export async function examenEnPdf(
  db: PoolClient,
  tenantId: string,
  atencionId: string
): Promise<ExamenEnPdf> {
  const a = await db.query<{
    fecha: string;
    paciente: string;
    especie: string | null;
    raza: string | null;
    expediente: number;
    propietario: string;
    medico: string | null;
    peso: string | null;
    temperatura: string | null;
    frecuencia_cardiaca: number | null;
    frecuencia_respiratoria: number | null;
    condicion_corporal: number | null;
    mucosas: string | null;
    hidratacion: string | null;
    motivo_consulta: string | null;
    evaluacion: string | null;
    estado: string;
  }>(
    `SELECT COALESCE(at.cerrada_en, at.creado_en)::date::text AS fecha,
            p.nombre AS paciente, p.especie, r.nombre AS raza, p.numero_expediente AS expediente,
            pr.nombre AS propietario, m.nombre AS medico,
            at.peso, at.temperatura, at.frecuencia_cardiaca, at.frecuencia_respiratoria,
            at.condicion_corporal, at.mucosas, at.hidratacion,
            at.motivo_consulta, at.evaluacion, at.estado
       FROM atenciones at
       JOIN pacientes p ON p.id = at.paciente_id
       JOIN propietarios pr ON pr.id = p.propietario_id
       LEFT JOIN razas r ON r.id = p.raza_id
       LEFT JOIN personas m ON m.id = at.medico_id
      WHERE at.id = $1 AND at.tenant_id = $2`,
    [atencionId, tenantId]
  );
  if (a.rows.length === 0) throw new Error("Esa atención no existe.");
  const f = a.rows[0];

  const examen = await resumenDelExamen(db, atencionId);
  const marca = await marcaDeLaClinica(db, tenantId);
  const hoy = fechaHoyEnZona(await zonaDeLaClinica(db, tenantId));

  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const trozos: Buffer[] = [];
  doc.on("data", (t: Buffer) => trozos.push(t));
  const terminado = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  dibujarEncabezado(
    doc,
    marca,
    "Examen físico",
    `${f.paciente} · expediente N.º ${f.expediente} · ${f.fecha}`
  );

  // --- El paciente ---------------------------------------------------
  const datos = [
    ["Paciente", `${f.paciente}${f.especie ? ` · ${f.especie}` : ""}${f.raza ? ` · ${f.raza}` : ""}`],
    ["Propietario", f.propietario],
    ["Médico", f.medico ?? "—"],
    ["Motivo", f.motivo_consulta ?? "—"],
  ];
  doc.fontSize(10);
  for (const [etiqueta, valor] of datos) {
    doc.font("Helvetica-Bold").fillColor(marca.tenue).text(`${etiqueta}: `, { continued: true });
    doc.font("Helvetica").fillColor("#000000").text(valor);
  }

  // --- Los signos ----------------------------------------------------
  const signos = [
    f.peso !== null ? `Peso ${f.peso} kg` : null,
    f.temperatura !== null ? `Temperatura ${f.temperatura} °C` : null,
    f.frecuencia_cardiaca !== null ? `FC ${f.frecuencia_cardiaca} lpm` : null,
    f.frecuencia_respiratoria !== null ? `FR ${f.frecuencia_respiratoria} rpm` : null,
    f.condicion_corporal !== null ? `Condición corporal ${f.condicion_corporal}/9` : null,
    f.mucosas ? `Mucosas ${f.mucosas}` : null,
    f.hidratacion ? `Hidratación ${f.hidratacion}` : null,
  ].filter(Boolean) as string[];

  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fillColor(marca.primario).fontSize(11).text("Signos");
  doc.font("Helvetica").fillColor("#000000").fontSize(10);
  // Los signos que NO se tomaron no se listan con un guion: una lista
  // de siete «—» ocupa el lugar de los tres que sí se midieron.
  doc.text(signos.length > 0 ? signos.join("  ·  ") : "No se registraron signos.");

  // --- El examen, en el orden de lectura del A1 -----------------------
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fillColor(marca.primario).fontSize(11).text("Revisión por sistemas");
  doc.fontSize(10);

  if (examen.sinExaminar) {
    doc.font("Helvetica").fillColor("#000000").text("No se registró el examen por sistemas.");
  } else {
    // PRIMERO LO ANORMAL, que es lo que hay que leer.
    for (const anormal of examen.anormales) {
      doc.font("Helvetica-Bold").fillColor("#000000").text(`${anormal.sistema}: `, { continued: true });
      doc
        .font("Helvetica")
        .text(anormal.hallazgo ?? "anormal, sin detallar");
    }
    if (examen.normales.length > 0) {
      doc.moveDown(0.3);
      doc
        .font("Helvetica")
        .fillColor("#000000")
        .text(
          examen.anormales.length > 0
            ? `Resto sin alteraciones: ${examen.normales.join(", ")}.`
            : `Sin alteraciones en ${examen.normales.join(", ")}.`
        );
    }
    if (examen.noEvaluados.length > 0) {
      doc.moveDown(0.3);
      doc
        .font("Helvetica")
        .fillColor(marca.tenue)
        .text(`Sin evaluar: ${examen.noEvaluados.join(", ")}.`);
    }
  }

  // --- La evaluación --------------------------------------------------
  if (f.evaluacion) {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fillColor(marca.primario).fontSize(11).text("Evaluación");
    doc.font("Helvetica").fillColor("#000000").fontSize(10).text(f.evaluacion);
  }

  // UN EXAMEN DE UNA ATENCIÓN EN BORRADOR LLEVA SU AVISO. Sin esto, un
  // papel impreso a mitad de la consulta se lee como el examen final.
  if (f.estado !== "cerrada") {
    doc.moveDown(0.8);
    doc
      .font("Helvetica-Bold")
      .fillColor("#B45309")
      .fontSize(9)
      .text("Atención en curso: este examen todavía no está firmado y puede cambiar.");
  }

  dibujarPie(
    doc,
    marca,
    `${marca.nombre} · impreso el ${hoy}`
  );

  doc.end();
  await terminado;

  return {
    buffer: Buffer.concat(trozos),
    nombreArchivo: `examen-${sanitizar(f.paciente)}-${f.fecha}.pdf`,
  };
}
