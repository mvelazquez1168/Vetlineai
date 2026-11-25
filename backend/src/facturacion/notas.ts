import { conAlcanceTenant } from "../alcanceTenant";
import { ResultadoEmision, emitir } from "./emision";
import { DocumentoVenta, LineaDocumento } from "./tipos";

// ---------------------------------------------------------------------
// Notas de crédito y de débito: la ÚNICA forma de corregir un
// comprobante ya enviado.
//
// La regla que esto implementa, y que la base también impone con un
// trigger (migración 091): un comprobante enviado no se edita ni se
// borra. Si el monto estaba mal, o la venta se anuló, o el receptor era
// otro, se emite una nota que apunta al original.
//
// Nota de CRÉDITO: baja el monto (anulación, devolución, descuento
// posterior). Nota de DÉBITO: lo sube (un cargo que faltaba).
// ---------------------------------------------------------------------

export type TipoNota = "credito" | "debito";

export interface SolicitudNota {
  tipo: TipoNota;
  /**
   * Nota 9 — el código de referencia. Es obligatorio elegirlo y NO tiene
   * default: "01 Anula documento de referencia" y "02 Corrige monto" son
   * cosas distintas en la declaración de IVA del receptor, y adivinar
   * cuál quiso quien factura sería inventarle un efecto contable.
   */
  codigoReferencia: string;
  /** Hasta 180 caracteres (XSD). El motivo, en palabras. */
  razon: string;
  /**
   * Las líneas de la nota.
   *
   * Si no se pasan, la nota es TOTAL: copia las líneas del original tal
   * cual. Si se pasan, es parcial y van exactamente esas — no se
   * "ajustan" las del original, porque qué significa ajustar depende del
   * caso y acá no se puede saber.
   */
  lineas?: LineaDocumento[];
  claveIdempotencia?: string;
}

/** Qué se necesita del comprobante original para poder referenciarlo. */
interface OriginalParaNota {
  id: string;
  clave: string;
  tipoComprobante: string;
  version: string;
  fechaEmision: string;
  estado: string;
  condicionVenta: string;
  moneda: string;
  tipoCambio: string;
  receptor: DocumentoVenta["receptor"];
  lineas: LineaDocumento[];
  mediosPago: DocumentoVenta["mediosPago"];
}

/**
 * Nota 10 — el tipo de documento de referencia, según qué se corrige.
 * Se deriva del tipo del original en vez de pedirlo: el dato ya está, y
 * pedirlo abriría la puerta a que una nota diga que corrige un tiquete
 * cuando corrige una factura.
 */
function tipoDocReferencia(tipoOriginal: string): string {
  switch (tipoOriginal) {
    case "01":
      return "01"; // Factura electrónica
    case "02":
      return "02"; // Nota de débito electrónica
    case "03":
      return "03"; // Nota de crédito electrónica
    case "04":
      return "04"; // Tiquete electrónico
    case "08":
      return "15"; // Sustituye una Factura electrónica de Compra
    case "09":
      return "19"; // Factura Electrónica de Exportación
    case "10":
      return "20"; // Recibo Electrónico de Pago
    default:
      return "99"; // Otros
  }
}

async function leerOriginal(tenantId: string, comprobanteId: string): Promise<OriginalParaNota> {
  return conAlcanceTenant(tenantId, async (db) => {
    const c = await db.query(
      `SELECT id, clave, tipo_comprobante, version, fecha_emision, estado, condicion_venta,
              moneda, tipo_cambio,
              receptor_tipo_identificacion, receptor_numero_identificacion, receptor_nombre,
              receptor_nombre_comercial, receptor_correo,
              receptor_ubicacion_provincia, receptor_ubicacion_canton, receptor_ubicacion_distrito,
              receptor_ubicacion_barrio, receptor_ubicacion_otras_senas
         FROM fact_comprobantes WHERE id = $1`,
      [comprobanteId]
    );
    const f = c.rows[0];
    if (!f) throw new Error(`No existe el comprobante ${comprobanteId}.`);

    const l = await db.query(
      `SELECT l.numero_linea, l.codigo_cabys, l.cantidad, l.unidad_medida, l.detalle,
              l.precio_unitario, l.tipo_transaccion
         FROM fact_comprobante_lineas l
        WHERE l.comprobante_id = $1
        ORDER BY l.numero_linea`,
      [comprobanteId]
    );

    // Los impuestos de cada línea, para poder copiarlos en una nota
    // total. Se leen aparte y no con un JOIN para no multiplicar filas.
    const imp = await db.query(
      `SELECT l.numero_linea, i.codigo_impuesto, i.codigo_tarifa_iva
         FROM fact_linea_impuestos i
         JOIN fact_comprobante_lineas l ON l.id = i.linea_id
        WHERE l.comprobante_id = $1
        ORDER BY l.numero_linea`,
      [comprobanteId]
    );

    const mp = await db.query(
      `SELECT codigo_medio_pago, medio_pago_otro, monto
         FROM fact_comprobante_medios_pago WHERE comprobante_id = $1`,
      [comprobanteId]
    );

    const lineas: LineaDocumento[] = l.rows.map((fl) => ({
      codigoCabys: fl.codigo_cabys ?? undefined,
      cantidad: fl.cantidad,
      unidadMedida: fl.unidad_medida,
      detalle: fl.detalle,
      precioUnitario: fl.precio_unitario,
      tipoTransaccion: fl.tipo_transaccion ?? undefined,
      impuestos: imp.rows
        .filter((fi) => fi.numero_linea === fl.numero_linea)
        .map((fi) => ({
          codigo: fi.codigo_impuesto,
          codigoTarifaIva: fi.codigo_tarifa_iva ?? undefined,
        })),
    }));

    return {
      id: f.id,
      clave: f.clave,
      tipoComprobante: f.tipo_comprobante,
      version: f.version,
      fechaEmision: new Date(f.fecha_emision).toISOString(),
      estado: f.estado,
      condicionVenta: f.condicion_venta,
      moneda: f.moneda,
      tipoCambio: f.tipo_cambio,
      receptor: f.receptor_nombre
        ? {
            nombre: f.receptor_nombre,
            identificacion: f.receptor_numero_identificacion
              ? {
                  tipo: f.receptor_tipo_identificacion,
                  numero: f.receptor_numero_identificacion,
                }
              : undefined,
            nombreComercial: f.receptor_nombre_comercial ?? undefined,
            correo: f.receptor_correo ?? undefined,
            ubicacion: f.receptor_ubicacion_provincia
              ? {
                  provincia: f.receptor_ubicacion_provincia,
                  canton: f.receptor_ubicacion_canton,
                  distrito: f.receptor_ubicacion_distrito,
                  barrio: f.receptor_ubicacion_barrio ?? undefined,
                  otrasSenas: f.receptor_ubicacion_otras_senas,
                }
              : undefined,
          }
        : undefined,
      lineas,
      mediosPago: mp.rows.map((fm) => ({
        codigo: fm.codigo_medio_pago,
        otro: fm.medio_pago_otro ?? undefined,
        monto: fm.monto ?? undefined,
      })),
    };
  });
}

/**
 * Emite una nota de crédito o de débito contra un comprobante propio.
 *
 * Exige que el original esté ENVIADO. Una nota contra un borrador no
 * tiene sentido: ese comprobante todavía no existe para Hacienda y se
 * puede corregir o borrar directamente.
 */
export async function emitirNota(
  tenantId: string,
  comprobanteOriginalId: string,
  solicitud: SolicitudNota
): Promise<ResultadoEmision> {
  const original = await leerOriginal(tenantId, comprobanteOriginalId);

  if (!["enviado", "aceptado", "aceptado_parcial", "rechazado"].includes(original.estado)) {
    throw new Error(
      `El comprobante ${original.clave} está en estado "${original.estado}": todavía no salió para Hacienda, así que no hace falta una nota. Se puede corregir o borrar directamente.`
    );
  }
  if (original.estado === "rechazado") {
    // Hacienda no lo tiene: no hay nada que corregir con una nota. La
    // corrección de un rechazado es un comprobante NUEVO.
    throw new Error(
      `El comprobante ${original.clave} fue RECHAZADO por Hacienda, así que no existe para corregir. Lo que corresponde es emitir un comprobante nuevo, no una nota.`
    );
  }

  // La versión del original manda. Una nota que ajusta un comprobante de
  // 4.3 tiene que generarse en 4.3 (Anexo 1, control histórico de 4.4), y
  // este motor solo sabe 4.4: mejor decirlo que emitir algo que Hacienda
  // va a rechazar por versión.
  if (original.version !== "4.4") {
    throw new Error(
      `El comprobante ${original.clave} se emitió en la versión ${original.version} y una nota que lo ajuste tiene que generarse en esa misma versión. Este motor solo emite v4.4.`
    );
  }

  const documento: DocumentoVenta = {
    tipoComprobante: solicitud.tipo === "credito" ? "03" : "02",
    receptor: original.receptor,
    condicionVenta: original.condicionVenta,
    moneda: original.moneda,
    tipoCambio: original.tipoCambio,
    lineas: solicitud.lineas ?? original.lineas,
    mediosPago: original.mediosPago,
    referencias: [
      {
        tipoDocumento: tipoDocReferencia(original.tipoComprobante),
        numero: original.clave,
        fechaEmision: original.fechaEmision,
        codigo: solicitud.codigoReferencia,
        razon: solicitud.razon.slice(0, 180),
      },
    ],
    claveIdempotencia: solicitud.claveIdempotencia,
  };

  return emitir(tenantId, documento);
}
