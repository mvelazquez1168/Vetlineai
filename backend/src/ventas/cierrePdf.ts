import PDFDocument from "pdfkit";
import { PoolClient } from "pg";
import { dibujarEncabezado, dibujarPie, marcaDeLaClinica } from "../pdf/marcaPdf";
import { conciliarTarjetas } from "./comisionesTarjeta";

// ---------------------------------------------------------------------
// EL COMPROBANTE DEL CIERRE DE CAJA — prompt 08b, A2 y A4.
//
// El cierre se guardaba completo en la base y no se podía imprimir. El
// papel importa por una razón concreta: el cajero lo firma y se lo
// entrega a quien recibe la caja, y esa firma sobre un detalle de
// denominaciones es lo que hace que un faltante tenga un responsable.
//
// LO QUE SALE ACÁ Y NO EN NINGUNA PANTALLA:
//
//   * el conteo billete por billete, que es lo que el prompt pide
//     («el detalle del conteo sale en su comprobante impreso»);
//   * los vales de caja, con quién recibió la plata;
//   * el lote del datáfono contra lo que el sistema cobró, y la comisión
//     que el banco se va a quedar.
//
// Reusa `pdf/marcaPdf.ts`, el mismo encabezado de la receta y del examen
// físico: un documento de la clínica con otro encabezado se ve como de
// otro sistema.
// ---------------------------------------------------------------------

const MONEDA: Record<string, string> = { CRC: "₡", USD: "$" };

function dinero(valor: number | string | null, moneda = "CRC"): string {
  if (valor === null) return "—";
  const n = Number(valor);
  return `${MONEDA[moneda] ?? ""}${n.toLocaleString("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function comprobanteDeCierre(
  db: PoolClient,
  tenantId: string,
  sesionId: string
): Promise<Buffer> {
  // LAS COLUMNAS SON LAS REALES, no las que uno supondría: la sesión no
  // tiene número propio ni nota de cierre, y el fondo son dos columnas
  // (`fondo_crc` y `fondo_usd`) porque una caja abre con las dos
  // monedas. El «número» del encabezado es la fecha de apertura, que es
  // como la clínica identifica un cierre cuando lo busca en el archivo.
  const s = await db.query<{
    caja_nombre: string;
    abierta_en: string;
    cerrada_en: string | null;
    estado: string;
    abierta_por: string | null;
    cerrada_por: string | null;
    fondo_crc: string;
    fondo_usd: string;
  }>(
    `SELECT c.nombre AS caja_nombre, ses.abierta_en::text, ses.cerrada_en::text,
            ses.estado, pa.nombre AS abierta_por, pc.nombre AS cerrada_por,
            ses.fondo_crc::text, ses.fondo_usd::text
       FROM vta_sesiones_caja ses
       JOIN vta_cajas c ON c.id = ses.caja_id
       LEFT JOIN personas pa ON pa.id = ses.abierta_por
       LEFT JOIN personas pc ON pc.id = ses.cerrada_por
      WHERE ses.id = $1`,
    [sesionId]
  );
  if (s.rows.length === 0) throw new Error(`No existe la sesión ${sesionId}.`);
  const sesion = s.rows[0];

  const lineas = await db.query<{
    medio: string;
    moneda: string;
    esperado: string;
    declarado: string;
    diferencia: string;
    justificacion: string | null;
  }>(
    `SELECT medio, moneda, esperado::text, declarado::text, diferencia::text, justificacion
       FROM vta_arqueo_lineas WHERE sesion_id = $1 ORDER BY medio, moneda`,
    [sesionId]
  );

  const denominaciones = await db.query<{ moneda: string; valor: string; cantidad: string }>(
    `SELECT moneda, valor::text, cantidad::text FROM vta_arqueo_denominaciones
      WHERE sesion_id = $1 ORDER BY moneda, valor DESC`,
    [sesionId]
  );

  const movimientos = await db.query<{
    tipo: string;
    moneda: string;
    monto: string;
    motivo: string | null;
    categoria_gasto: string | null;
    registro: string | null;
    recibe: string | null;
  }>(
    `SELECT m.tipo, m.moneda, m.monto::text, m.motivo, m.categoria_gasto,
            pr.nombre AS registro,
            COALESCE(rp.nombre, m.recibido_por_nombre) AS recibe
       FROM vta_movimientos_efectivo m
       LEFT JOIN personas pr ON pr.id = m.persona_id
       LEFT JOIN personas rp ON rp.id = m.recibido_por
      WHERE m.sesion_id = $1
      ORDER BY m.creado_en`,
    [sesionId]
  );

  const tarjetas = await conciliarTarjetas(db, sesionId);
  const marca = await marcaDeLaClinica(db, tenantId);

  const doc = new PDFDocument({ size: "LETTER", margins: { top: 48, bottom: 56, left: 48, right: 48 } });
  const trozos: Buffer[] = [];
  doc.on("data", (t: Buffer) => trozos.push(t));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));

  dibujarEncabezado(
    doc,
    marca,
    `Cierre de caja — ${sesion.abierta_en.slice(0, 10)}`,
    `${sesion.caja_nombre} · abierta ${sesion.abierta_en.slice(0, 16).replace("T", " ")}` +
      (sesion.cerrada_en ? ` · cerrada ${sesion.cerrada_en.slice(0, 16).replace("T", " ")}` : " · SIN CERRAR")
  );

  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const izq = doc.page.margins.left;

  const titulo = (texto: string) => {
    doc.moveDown(0.8);
    doc.fillColor(marca.primario).fontSize(10).font("Helvetica-Bold").text(texto, izq);
    doc.moveDown(0.3);
  };
  const fila = (celdas: string[], anchos: number[], negrita = false) => {
    const y = doc.y;
    let x = izq;
    doc.fillColor("#111").fontSize(8.5).font(negrita ? "Helvetica-Bold" : "Helvetica");
    celdas.forEach((c, i) => {
      doc.text(c, x, y, { width: anchos[i], align: i === 0 ? "left" : "right" });
      x += anchos[i];
    });
    doc.y = y + 12;
  };

  // --- QUIÉN ABRIÓ Y QUIÉN CERRÓ -------------------------------------
  doc.fillColor("#111").fontSize(9).font("Helvetica");
  doc.text(
    `Abrió: ${sesion.abierta_por ?? "—"}    ·    Cerró: ${sesion.cerrada_por ?? "—"}    ·    ` +
      `Fondo inicial: ${dinero(sesion.fondo_crc)}` +
      (Number(sesion.fondo_usd) > 0 ? ` y ${dinero(sesion.fondo_usd, "USD")}` : ""),
    izq,
    doc.y,
    { width: anchoUtil }
  );

  // --- EL ARQUEO -----------------------------------------------------
  titulo("Arqueo por medio de pago");
  const anchosArqueo = [120, 60, 90, 90, 90, anchoUtil - 450];
  fila(["Medio", "Moneda", "Esperado", "Declarado", "Diferencia", "Justificación"], anchosArqueo, true);
  for (const l of lineas.rows) {
    fila(
      [
        l.medio,
        l.moneda,
        dinero(l.esperado, l.moneda),
        dinero(l.declarado, l.moneda),
        dinero(l.diferencia, l.moneda),
        l.justificacion ?? "",
      ],
      anchosArqueo
    );
  }
  if (lineas.rows.length === 0) {
    doc.fontSize(8.5).font("Helvetica").fillColor("#666").text("La sesión todavía no se cerró.", izq);
  }

  // --- EL CONTEO BILLETE POR BILLETE ---------------------------------
  if (denominaciones.rows.length > 0) {
    titulo("Conteo del efectivo, billete por billete");
    const anchos = [110, 90, 90, anchoUtil - 290];
    fila(["Denominación", "Cantidad", "Subtotal", ""], anchos, true);
    for (const d of denominaciones.rows) {
      const sub = Number(d.valor) * Number(d.cantidad);
      fila(
        [`${d.moneda} ${dinero(d.valor, d.moneda)}`, d.cantidad, dinero(sub, d.moneda), ""],
        anchos
      );
    }
    // El total por moneda, que es el número que el cajero firma.
    const porMoneda = new Map<string, number>();
    for (const d of denominaciones.rows) {
      porMoneda.set(
        d.moneda,
        (porMoneda.get(d.moneda) ?? 0) + Number(d.valor) * Number(d.cantidad)
      );
    }
    for (const [moneda, total] of porMoneda) {
      fila([`Total contado ${moneda}`, "", dinero(total, moneda), ""], anchos, true);
    }
  }

  // --- LOS VALES Y LOS MOVIMIENTOS -----------------------------------
  if (movimientos.rows.length > 0) {
    titulo("Vales y movimientos de efectivo");
    const anchos = [120, 80, 110, 110, anchoUtil - 420];
    fila(["Tipo", "Monto", "Quién recibió", "Quién lo registró", "Motivo"], anchos, true);
    for (const m of movimientos.rows) {
      fila(
        [
          m.tipo.replace(/_/g, " "),
          dinero(m.monto, m.moneda),
          m.recibe ?? "—",
          m.registro ?? "—",
          [m.categoria_gasto, m.motivo].filter(Boolean).join(" · "),
        ],
        anchos
      );
    }
  }

  // --- LAS TARJETAS CONTRA EL DATÁFONO -------------------------------
  if (tarjetas.filas.length > 0) {
    titulo("Tarjetas: lo cobrado contra el lote del datáfono");
    const anchos = [110, 70, 80, 80, 80, anchoUtil - 420];
    fila(["Banco y tipo", "Cobros", "Sistema", "Lote", "Diferencia", "Comisión"], anchos, true);
    for (const f of tarjetas.filas) {
      fila(
        [
          `${f.banco ?? "sin banco"} ${f.tipoTarjeta ?? ""}${f.marca ? ` ${f.marca}` : ""}`,
          `${f.sistemaCantidad}${f.loteCantidad !== null ? ` / ${f.loteCantidad}` : ""}`,
          dinero(f.sistemaMonto),
          f.loteMonto === null ? "sin cargar" : dinero(f.loteMonto),
          f.diferencia === null ? "—" : dinero(f.diferencia),
          "",
        ],
        anchos
      );
    }
    // EL TOTAL, que es el número comparable aunque el detalle no calce.
    fila(
      [
        "Total de tarjetas",
        `${tarjetas.cobros.length}`,
        dinero(tarjetas.totalSistema),
        tarjetas.totalLote === null ? "sin cargar" : dinero(tarjetas.totalLote),
        tarjetas.diferenciaDelTotal === null ? "—" : dinero(tarjetas.diferenciaDelTotal),
        "",
      ],
      anchos,
      true
    );
    if (tarjetas.cobrosSinBanco > 0) {
      doc
        .fontSize(7.5)
        .font("Helvetica")
        .fillColor(marca.tenue)
        .text(
          `${tarjetas.cobrosSinBanco} cobro(s) con tarjeta no tienen banco cargado, así que no se pueden ` +
            "comparar línea por línea contra el lote. El total sí es comparable.",
          izq,
          doc.y,
          { width: anchoUtil }
        );
      doc.y += 10;
    }
    if (tarjetas.comisionTotal > 0) {
      fila(
        ["Comisión estimada del lote", "", "", "", "", dinero(tarjetas.comisionTotal)],
        anchos,
        true
      );
      doc
        .fontSize(7.5)
        .font("Helvetica")
        .fillColor(marca.tenue)
        .text(
          "La comisión es lo que el banco retiene: el depósito llega por el neto, no por el total cobrado.",
          izq,
          doc.y,
          { width: anchoUtil }
        );
      doc.y += 10;
    }
  }

  // --- LA FIRMA ------------------------------------------------------
  // EL PAPEL EXISTE PARA ESTO. Dos líneas, porque la plata cambia de
  // manos: quien entrega la caja y quien la recibe.
  doc.moveDown(2.5);
  const yFirma = doc.y;
  doc.fillColor("#111").fontSize(8.5).font("Helvetica");
  doc.text("______________________________", izq, yFirma);
  doc.text("Entrega (cajero)", izq, yFirma + 14);
  doc.text("______________________________", izq + anchoUtil / 2, yFirma);
  doc.text("Recibe", izq + anchoUtil / 2, yFirma + 14);

  dibujarPie(
    doc,
    marca,
    `${marca.nombre} · documento interno de caja, no es un comprobante electrónico`
  );
  doc.end();
  return listo;
}
