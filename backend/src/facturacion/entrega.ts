import { PoolClient } from "pg";
import { conAlcanceTenant } from "../alcanceTenant";
import { enviarCorreoTransaccional } from "../correos";
import { TIPOS_COMPROBANTE, TIPOS_IDENTIFICACION } from "./catalogos";
import { nombresArchivo } from "./claveConsecutivo";
import { DatosPdfComprobante, generarPdfComprobante, nombreMedioPago } from "./pdfComprobante";
import { logoDeLaClinica } from "./logoClinica";

// ---------------------------------------------------------------------
// La representación gráfica y la entrega al receptor.
//
// Separado de `emision.ts` a propósito: emitir y entregar son dos cosas
// con dueños distintos. Un comprobante emitido es válido aunque el correo
// rebote, y un correo que falla no puede deshacer una emisión. Si
// estuvieran juntos, un problema de Resend haría fallar una venta.
// ---------------------------------------------------------------------

function nombreTipoIdentificacion(codigo: string | null): string {
  if (!codigo) return "Identificación";
  return TIPOS_IDENTIFICACION.find((t) => t.codigo === codigo)?.nombre ?? "Identificación";
}

/**
 * Junta todo lo que el PDF necesita, de la base.
 *
 * Una consulta por tabla y no un JOIN gigante: con JOIN, un comprobante
 * de veinte líneas con tres impuestos cada una devolvería sesenta filas
 * del encabezado y habría que de-duplicarlas a mano.
 */
export async function datosParaPdf(
  db: PoolClient,
  comprobanteId: string
): Promise<DatosPdfComprobante> {
  const c = await db.query(
    `SELECT c.*, e.nombre AS emisor_nombre, e.nombre_comercial AS emisor_nombre_comercial,
            e.tipo_identificacion AS emisor_tipo_id, e.numero_identificacion AS emisor_numero_id,
            e.ubicacion_otras_senas, e.ubicacion_barrio,
            e.telefono_codigo_pais, e.telefono_numero, e.correo AS emisor_correo,
            t.zona_horaria, t.logo_url
       FROM fact_comprobantes c
       JOIN fact_emisores e ON e.id = c.emisor_id
       JOIN tenants t ON t.id = c.tenant_id
      WHERE c.id = $1`,
    [comprobanteId]
  );
  const f = c.rows[0];
  if (!f) throw new Error(`No existe el comprobante ${comprobanteId}.`);

  const lineas = await db.query(
    `SELECT l.numero_linea, l.codigo_cabys, l.cantidad, l.unidad_medida, l.detalle,
            l.precio_unitario, l.subtotal, l.impuesto_neto, l.monto_total_linea,
            COALESCE((SELECT sum(d.monto) FROM fact_linea_descuentos d WHERE d.linea_id = l.id), 0) AS descuento
       FROM fact_comprobante_lineas l
      WHERE l.comprobante_id = $1
      ORDER BY l.numero_linea`,
    [comprobanteId]
  );

  const medios = await db.query<{ codigo_medio_pago: string }>(
    `SELECT codigo_medio_pago FROM fact_comprobante_medios_pago WHERE comprobante_id = $1`,
    [comprobanteId]
  );

  const refs = await db.query<{ numero: string | null; razon: string | null }>(
    `SELECT numero, razon FROM fact_comprobante_referencias WHERE comprobante_id = $1`,
    [comprobanteId]
  );

  const logoBuffer = await logoDeLaClinica(f.logo_url);

  const senas = [f.ubicacion_barrio, f.ubicacion_otras_senas].filter(Boolean).join(", ");

  return {
    tipoComprobante: f.tipo_comprobante,
    clave: f.clave,
    consecutivo: f.consecutivo,
    fechaEmision: new Date(f.fecha_emision),
    zonaHoraria: f.zona_horaria,
    logoBuffer,

    emisorNombre: f.emisor_nombre,
    emisorNombreComercial: f.emisor_nombre_comercial,
    emisorIdentificacion: f.emisor_numero_id,
    emisorTipoIdentificacionNombre: nombreTipoIdentificacion(f.emisor_tipo_id),
    emisorDireccion: senas,
    emisorTelefono:
      f.telefono_numero && f.telefono_codigo_pais
        ? `+${f.telefono_codigo_pais} ${f.telefono_numero}`
        : f.telefono_numero,
    emisorCorreo: f.emisor_correo,

    receptorNombre: f.receptor_nombre,
    receptorIdentificacion: f.receptor_numero_identificacion,
    receptorCorreo: f.receptor_correo,

    condicionVenta: f.condicion_venta,
    mediosPago: medios.rows.map((m) => nombreMedioPago(m.codigo_medio_pago)),
    moneda: f.moneda,

    lineas: lineas.rows.map((l) => ({
      numeroLinea: l.numero_linea,
      codigoCabys: l.codigo_cabys,
      cantidad: l.cantidad,
      unidadMedida: l.unidad_medida,
      detalle: l.detalle,
      precioUnitario: l.precio_unitario,
      descuento: l.descuento,
      subtotal: l.subtotal,
      impuesto: l.impuesto_neto,
      total: l.monto_total_linea,
    })),

    totalGravado: f.total_gravado,
    totalExento: f.total_exento,
    totalExonerado: f.total_exonerado,
    totalDescuentos: f.total_descuentos,
    totalVentaNeta: f.total_venta_neta,
    totalImpuesto: f.total_impuesto,
    totalOtrosCargos: f.total_otros_cargos,
    totalComprobante: f.total_comprobante,

    estadoHacienda: estadoLegible(f.estado, f.respuesta_ind_estado),
    detalleHacienda: f.respuesta_detalle,

    referencias: refs.rows,
  };
}

/**
 * El estado, en palabras, para el PDF y el correo.
 *
 * Muestra el `indEstado` de Hacienda cuando lo hay, porque es el dato
 * verificable, y el estado interno cuando todavía no contestó. "Pendiente
 * de transmitir" dice la verdad; "emitido" a secas haría creer que
 * Hacienda ya lo validó.
 */
export function estadoLegible(estado: string, indEstado: string | null): string {
  if (indEstado) {
    const v = indEstado.toUpperCase();
    if (v === "ACEPTADO") return "Aceptado por Hacienda";
    if (v.startsWith("ACEPTADO")) return "Aceptado parcialmente por Hacienda";
    if (v === "RECHAZADO") return "Rechazado por Hacienda";
    return `En proceso en Hacienda (${indEstado})`;
  }
  switch (estado) {
    case "borrador":
      return "Borrador, sin firmar";
    case "firmado":
      return "Firmado, sin transmitir";
    case "en_cola":
      return "Pendiente de transmitir a Hacienda";
    case "enviado":
      return "Transmitido, esperando respuesta de Hacienda";
    case "error":
      return "No se pudo transmitir — requiere revisión";
    default:
      return estado;
  }
}

export interface ResultadoEntrega {
  enviado: boolean;
  motivo?: string;
  destinatario?: string;
  correoEnviadoId?: string | null;
}

/**
 * Le manda al receptor su comprobante, con el PDF y el XML adjuntos.
 *
 * NO lanza si no hay a quién mandárselo: un tiquete a un consumidor final
 * sin correo es perfectamente normal, y convertir eso en un error haría
 * que la caja mostrara un fallo donde no hay ninguno. Devuelve `enviado:
 * false` con el motivo.
 */
export async function entregarComprobante(
  tenantId: string,
  comprobanteId: string
): Promise<ResultadoEntrega> {
  const preparado = await conAlcanceTenant(tenantId, async (db) => {
    const datos = await datosParaPdf(db, comprobanteId);
    const xml = await db.query<{ xml_firmado: Buffer | null; estado: string }>(
      `SELECT xml_firmado, estado FROM fact_comprobantes WHERE id = $1`,
      [comprobanteId]
    );
    return { datos, xmlFirmado: xml.rows[0]?.xml_firmado ?? null, estado: xml.rows[0]?.estado };
  });

  if (!preparado.datos.receptorCorreo) {
    return {
      enviado: false,
      motivo:
        "El comprobante no tiene correo del receptor. Un tiquete a consumidor final puede no tenerlo: no es un error.",
    };
  }
  if (!preparado.xmlFirmado) {
    // Sin XML firmado no hay comprobante que entregar. Mandar solo el
    // PDF sería entregar la representación gráfica sin el documento con
    // validez legal, que es justo el que el receptor necesita.
    return {
      enviado: false,
      motivo: `El comprobante está en estado "${preparado.estado}" y todavía no tiene XML firmado: no hay documento legal que adjuntar.`,
    };
  }

  // El PDF se genera FUERA de transacción: son decenas de milisegundos de
  // dibujo más el QR.
  const pdf = await generarPdfComprobante(preparado.datos);

  const d = preparado.datos;
  const tipoNombre =
    TIPOS_COMPROBANTE.find((t) => t.codigo === d.tipoComprobante)?.nombre ?? "Comprobante";

  const resultado = await conAlcanceTenant(tenantId, (db) =>
    enviarCorreoTransaccional(
      db,
      tenantId,
      d.receptorCorreo!,
      "comprobante_electronico",
      {
        tipoComprobanteNombre: tipoNombre,
        consecutivo: d.consecutivo,
        clave: d.clave,
        total: Number(d.totalComprobante).toLocaleString("es-CR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        moneda: d.moneda,
        fecha: new Intl.DateTimeFormat("es-CR", {
          timeZone: d.zonaHoraria ?? "America/Costa_Rica",
          day: "2-digit",
          month: "long",
          year: "numeric",
        }).format(d.fechaEmision),
        estadoHacienda: d.estadoHacienda,
      },
      // Los nombres de archivo son los que exige la Nota 3: `clave.pdf` y
      // `clave.xml`. No son decorativos — son el formato con el que una
      // contadora espera recibirlos.
      [
        { nombreArchivo: nombresArchivo.pdf(d.clave), contenido: pdf },
        { nombreArchivo: nombresArchivo.xml(d.clave), contenido: preparado.xmlFirmado! },
      ]
    )
  );

  return {
    enviado: resultado.resultado === "enviado",
    motivo:
      resultado.resultado === "no_configurado"
        ? "Resend no está configurado: no se envió ningún correo."
        : resultado.resultado === "fallido"
          ? "El envío falló; quedó registrado en correos_enviados."
          : undefined,
    destinatario: d.receptorCorreo ?? undefined,
    correoEnviadoId: resultado.correoEnviadoId,
  };
}

/** Solo el PDF, para la descarga desde la pantalla. */
export async function pdfDeComprobante(tenantId: string, comprobanteId: string): Promise<Buffer> {
  const datos = await conAlcanceTenant(tenantId, (db) => datosParaPdf(db, comprobanteId));
  return generarPdfComprobante(datos);
}
