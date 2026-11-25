import { PoolClient } from "pg";
import { create } from "xmlbuilder2";
import { conAlcanceTenant } from "../alcanceTenant";
import { CONDICIONES_IMPUESTO, TIPOS_COMPROBANTE } from "./catalogos";
import { armarConsecutivo, consumirConsecutivo } from "./claveConsecutivo";
import { obtenerLlaveFirma, obtenerSecretos } from "./credenciales";
import { firmarXml } from "./firma";
import { proveedorHaciendaActivo } from "./proveedorActivo";
import { ErrorHaciendaSinRespuesta } from "./proveedorHacienda";
import { exigirXmlValido } from "./validacionXsd";
import { fechaHoraXml } from "./xml";

// ---------------------------------------------------------------------
// Comprobantes RECIBIDOS de proveedores, y el mensaje receptor con el
// que se aceptan o rechazan.
//
// Lo que esto alimenta más adelante: cuentas por pagar y el IVA
// acreditable. Por eso la `condicionImpuesto` (Nota 18) se guarda
// explícitamente — es el dato que define si el IVA de esa factura es
// crédito, crédito parcial, bien de capital, gasto o proporcionalidad.
//
// DOS cosas que este módulo NO hace, a propósito:
//   * no recibe facturas por correo automáticamente (fuera del prompt);
//   * no valida que el proveedor exista en ningún catálogo nuestro: el
//     XML viene de afuera y es la fuente.
// ---------------------------------------------------------------------

const NS_MENSAJE_RECEPTOR =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeReceptor";

/**
 * Lee un dato de un XML ajeno con expresión regular y no con un parser.
 *
 * El motivo no es la comodidad: el XML llega de un tercero y puede usar
 * cualquier prefijo de namespace, venir con BOM, o traer la declaración
 * partida. Un parser estricto lo rechazaría entero por un detalle de
 * forma, y entonces no se podría ni leer la clave para decir de qué
 * comprobante se trata. El XML completo se guarda textual igual, así que
 * la fuente nunca se pierde.
 */
function leerCampo(xml: string, nombre: string): string | undefined {
  const re = new RegExp(`<(?:[\\w-]+:)?${nombre}>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`);
  return re.exec(xml)?.[1]?.trim() || undefined;
}

/** El elemento raíz, para saber qué tipo de comprobante es. */
function elementoRaiz(xml: string): string | undefined {
  // Se salta la declaración, los comentarios y el BOM.
  const sinPrologo = xml.replace(/^﻿/, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  return /<(?:[\w-]+:)?([A-Za-z]\w*)[\s>]/.exec(sinPrologo)?.[1];
}

export interface ResultadoRecepcion {
  id: string;
  clave: string;
  tipoComprobante: string | null;
  emisorNombre?: string;
  total?: string;
  validacionOk: boolean;
  validacionDetalle?: string;
  yaEstaba: boolean;
}

/**
 * Carga el XML de un comprobante de proveedor, lo valida contra el XSD
 * oficial y lo guarda.
 *
 * Un XML que NO valida se guarda igual, con `validacion_ok = false` y el
 * motivo. Descartarlo sería lo peor de los dos mundos: la clínica recibió
 * ese documento de su proveedor y tiene que poder verlo para reclamarle,
 * y además el mensaje receptor de RECHAZO es justamente la vía formal
 * para devolverlo.
 */
export async function recibirComprobante(
  db: PoolClient,
  tenantId: string,
  emisorId: string,
  xml: string
): Promise<ResultadoRecepcion> {
  const clave = leerCampo(xml, "Clave");
  if (!clave || !/^[a-zA-Z0-9]{50}$/.test(clave)) {
    throw new Error(
      "El XML no tiene una clave de 50 caracteres: no parece un comprobante electrónico de Costa Rica."
    );
  }

  const raiz = elementoRaiz(xml);
  const tipo = TIPOS_COMPROBANTE.find((t) => t.elementoRaiz === raiz);

  let validacionOk = false;
  let validacionDetalle: string | undefined;
  if (!tipo) {
    validacionDetalle = `El elemento raíz "${raiz ?? "(no se pudo leer)"}" no corresponde a ningún comprobante de v4.4.`;
  } else {
    try {
      await exigirXmlValido(xml, tipo.codigo);
      validacionOk = true;
    } catch (err) {
      validacionDetalle = (err as Error).message;
    }
  }

  const r = await db.query<{ id: string; ya: boolean }>(
    `INSERT INTO fact_recibidos (
       tenant_id, emisor_id, clave, xml_recibido, emisor_nombre, emisor_identificacion,
       tipo_comprobante, consecutivo, fecha_emision, total_comprobante, total_impuesto, moneda,
       validacion_ok, validacion_detalle
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (emisor_id, clave) DO UPDATE SET
       -- Volver a cargar el mismo comprobante NO lo duplica y NO pisa el
       -- XML original: lo único que se refresca es la validación, porque
       -- el XSD con el que se valida puede haber cambiado.
       validacion_ok = EXCLUDED.validacion_ok,
       validacion_detalle = EXCLUDED.validacion_detalle
     RETURNING id, (xmax <> 0) AS ya`,
    [
      tenantId,
      emisorId,
      clave,
      Buffer.from(xml, "utf-8"),
      leerCampo(xml, "Nombre") ?? null,
      leerCampo(xml, "Numero") ?? null,
      tipo?.codigo ?? null,
      leerCampo(xml, "NumeroConsecutivo") ?? null,
      leerCampo(xml, "FechaEmision") ?? null,
      leerCampo(xml, "TotalComprobante") ?? null,
      leerCampo(xml, "TotalImpuesto") ?? null,
      leerCampo(xml, "CodigoMoneda") ?? null,
      validacionOk,
      validacionDetalle ?? null,
    ]
  );

  return {
    id: r.rows[0].id,
    clave,
    tipoComprobante: tipo?.codigo ?? null,
    emisorNombre: leerCampo(xml, "Nombre"),
    total: leerCampo(xml, "TotalComprobante"),
    validacionOk,
    validacionDetalle,
    yaEstaba: r.rows[0].ya,
  };
}

export async function listarRecibidos(db: PoolClient, emisorId: string) {
  const r = await db.query(
    `SELECT id, clave, tipo_comprobante, consecutivo, emisor_nombre, emisor_identificacion,
            fecha_emision, total_comprobante, total_impuesto, moneda,
            validacion_ok, validacion_detalle,
            mensaje_tipo, mensaje_consecutivo, mensaje_condicion_impuesto,
            mensaje_ind_estado, mensaje_enviado_en, creado_en
       FROM fact_recibidos
      WHERE emisor_id = $1
      ORDER BY fecha_emision DESC NULLS LAST, creado_en DESC`,
    [emisorId]
  );
  return r.rows.map((f) => ({
    id: f.id,
    clave: f.clave,
    tipoComprobante: f.tipo_comprobante,
    tipoComprobanteNombre:
      TIPOS_COMPROBANTE.find((t) => t.codigo === f.tipo_comprobante)?.nombre ?? f.tipo_comprobante,
    consecutivo: f.consecutivo,
    emisorNombre: f.emisor_nombre,
    emisorIdentificacion: f.emisor_identificacion,
    fechaEmision: f.fecha_emision,
    totalComprobante: f.total_comprobante,
    totalImpuesto: f.total_impuesto,
    moneda: f.moneda,
    validacionOk: f.validacion_ok,
    validacionDetalle: f.validacion_detalle,
    mensajeTipo: f.mensaje_tipo,
    mensajeConsecutivo: f.mensaje_consecutivo,
    mensajeCondicionImpuesto: f.mensaje_condicion_impuesto,
    mensajeIndEstado: f.mensaje_ind_estado,
    mensajeEnviadoEn: f.mensaje_enviado_en,
    creadoEn: f.creado_en,
  }));
}

export interface SolicitudMensajeReceptor {
  /**
   * El código del XSD `MensajeReceptor`: 1 aceptado, 2 aceptado
   * parcialmente, 3 rechazado. **Un dígito**, no dos — es el único
   * catálogo de v4.4 que no usa dos.
   */
  mensaje: "1" | "2" | "3";
  /** Nota 18. Obligatorio si el comprobante tiene impuesto. */
  condicionImpuesto?: string;
  /** Hasta 160 caracteres (XSD). */
  detalle?: string;
}

/**
 * El tipo de comprobante de la NUMERACIÓN del mensaje, que no es el
 * código del mensaje.
 *
 * Nota 3: 05 confirmación de aceptación, 06 aceptación parcial, 07
 * rechazo. El campo `Mensaje` del XML, en cambio, vale 1, 2 o 3. Son dos
 * numeraciones distintas para lo mismo y confundirlas produce un
 * consecutivo de la serie equivocada.
 */
function tipoParaConsecutivo(mensaje: "1" | "2" | "3"): string {
  return mensaje === "1" ? "05" : mensaje === "2" ? "06" : "07";
}

export interface ResultadoMensajeReceptor {
  recibidoId: string;
  consecutivo: string;
  mensaje: string;
  estado: string;
  indEstado?: string;
  detalle?: string;
}

/**
 * Emite el mensaje receptor de un comprobante de proveedor: lo acepta,
 * lo acepta parcialmente o lo rechaza.
 *
 * Mismo patrón de transacciones cortas que la emisión: armar y firmar
 * fuera de transacción, enviar fuera de transacción, y escribir el
 * resultado en una transacción de milisegundos.
 */
export async function emitirMensajeReceptor(
  tenantId: string,
  recibidoId: string,
  solicitud: SolicitudMensajeReceptor
): Promise<ResultadoMensajeReceptor> {
  if (solicitud.condicionImpuesto) {
    if (!CONDICIONES_IMPUESTO.some((c) => c.codigo === solicitud.condicionImpuesto)) {
      throw new Error(
        `La condición del impuesto "${solicitud.condicionImpuesto}" no está en la Nota 18. Los valores son ${CONDICIONES_IMPUESTO.map((c) => `${c.codigo} (${c.nombre})`).join(", ")}.`
      );
    }
  }

  // --- Transacción 1: leer el recibido y consumir el consecutivo ------
  const preparado = await conAlcanceTenant(tenantId, async (db) => {
    const r = await db.query(
      `SELECT r.*, e.id AS emisor_id, e.tipo_identificacion, e.numero_identificacion,
              e.sucursal, e.terminal, e.ambiente_activo
         FROM fact_recibidos r
         JOIN fact_emisores e ON e.id = r.emisor_id
        WHERE r.id = $1`,
      [recibidoId]
    );
    const f = r.rows[0];
    if (!f) throw new Error(`No existe el comprobante recibido ${recibidoId}.`);
    if (f.mensaje_enviado_en) {
      throw new Error(
        `A ese comprobante ya se le envió un mensaje receptor (${f.mensaje_consecutivo}). Un mensaje receptor no se reemplaza.`
      );
    }

    const tipoConsecutivo = tipoParaConsecutivo(solicitud.mensaje);
    const { consecutivo } = await consumirConsecutivo(db, tenantId, {
      emisorId: f.emisor_id,
      sucursal: f.sucursal,
      terminal: f.terminal,
      tipoComprobante: tipoConsecutivo,
    });

    await db.query(
      `UPDATE fact_recibidos
          SET mensaje_tipo = $2, mensaje_consecutivo = $3,
              mensaje_condicion_impuesto = $4, mensaje_detalle = $5
        WHERE id = $1`,
      [
        recibidoId,
        solicitud.mensaje,
        consecutivo,
        solicitud.condicionImpuesto ?? null,
        solicitud.detalle?.slice(0, 160) ?? null,
      ]
    );

    return { fila: f, consecutivo };
  });

  const f = preparado.fila;

  // --- Armar el XML del mensaje. Orden exacto del XSD ----------------
  // Clave, NumeroCedulaEmisor, FechaEmisionDoc, Mensaje, DetalleMensaje?,
  // MontoTotalImpuesto?, CodigoActividad?, CondicionImpuesto?,
  // MontoTotalImpuestoAcreditar?, MontoTotalDeGastoAplicable?,
  // TotalFactura, NumeroCedulaReceptor, NumeroConsecutivoReceptor,
  // Signature.
  const ahora = new Date();
  const raiz = create({ version: "1.0", encoding: "utf-8" }).ele(
    NS_MENSAJE_RECEPTOR,
    "MensajeReceptor"
  );
  raiz.ele("Clave").txt(f.clave);
  // La cédula del EMISOR del comprobante, o sea el proveedor.
  raiz.ele("NumeroCedulaEmisor").txt(String(f.emisor_identificacion ?? ""));
  raiz.ele("FechaEmisionDoc").txt(fechaHoraXml(ahora));
  raiz.ele("Mensaje").txt(solicitud.mensaje);
  if (solicitud.detalle) raiz.ele("DetalleMensaje").txt(solicitud.detalle.slice(0, 160));
  if (f.total_impuesto) raiz.ele("MontoTotalImpuesto").txt(String(f.total_impuesto));
  if (solicitud.condicionImpuesto) raiz.ele("CondicionImpuesto").txt(solicitud.condicionImpuesto);
  raiz.ele("TotalFactura").txt(String(f.total_comprobante ?? "0.00000"));
  // La cédula del RECEPTOR, o sea la clínica.
  raiz.ele("NumeroCedulaReceptor").txt(String(f.numero_identificacion));
  raiz.ele("NumeroConsecutivoReceptor").txt(preparado.consecutivo);

  const xml = raiz.end({ prettyPrint: false });

  // El mensaje receptor se valida contra SU esquema, igual que un
  // comprobante: Hacienda lo rechaza por las mismas razones.
  await exigirXmlValido(xml, "05", { sinFirmar: true });

  const llave = await conAlcanceTenant(tenantId, (db) =>
    obtenerLlaveFirma(db, f.emisor_id, f.ambiente_activo)
  );
  const xmlFirmado = await firmarXml(xml, llave);
  await exigirXmlValido(xmlFirmado, "05");

  await conAlcanceTenant(tenantId, (db) =>
    db.query(`UPDATE fact_recibidos SET mensaje_xml_firmado = $2 WHERE id = $1`, [
      recibidoId,
      Buffer.from(xmlFirmado, "utf-8"),
    ])
  );

  // --- Enviar, fuera de transacción ----------------------------------
  const credenciales = await conAlcanceTenant(tenantId, (db) =>
    obtenerSecretos(db, f.emisor_id, f.ambiente_activo)
  );
  const proveedor = proveedorHaciendaActivo();

  try {
    // El mensaje receptor va por el MISMO recurso `/recepcion` que un
    // comprobante (Anexo 3: "Recibe el comprobante electrónico o
    // respuesta del receptor").
    await proveedor.enviar(
      {
        clave: f.clave,
        fechaEmision: fechaHoraXml(ahora),
        emisor: {
          tipoIdentificacion: f.tipo_identificacion,
          numeroIdentificacion: f.numero_identificacion,
        },
        xmlFirmado,
      },
      {
        usuarioApi: credenciales.usuarioApi,
        passwordApi: credenciales.passwordApi,
        ambiente: f.ambiente_activo,
      }
    );

    const estado = await proveedor.consultarEstado(f.clave, {
      usuarioApi: credenciales.usuarioApi,
      passwordApi: credenciales.passwordApi,
      ambiente: f.ambiente_activo,
    });

    await conAlcanceTenant(tenantId, (db) =>
      db.query(
        `UPDATE fact_recibidos
            SET mensaje_enviado_en = now(),
                mensaje_ind_estado = $2,
                mensaje_respuesta_xml = $3
          WHERE id = $1`,
        [
          recibidoId,
          estado?.indEstado ?? null,
          estado?.respuestaXml ? Buffer.from(estado.respuestaXml, "utf-8") : null,
        ]
      )
    );

    return {
      recibidoId,
      consecutivo: preparado.consecutivo,
      mensaje: solicitud.mensaje,
      estado: "enviado",
      indEstado: estado?.indEstado,
      detalle: estado?.detalle,
    };
  } catch (err) {
    if (!(err instanceof ErrorHaciendaSinRespuesta)) throw err;
    // El mensaje queda firmado y sin enviar. A diferencia de un
    // comprobante, NO se encola: un mensaje receptor tiene plazo (ocho
    // días hábiles) y lo que corresponde es que la clínica vea que quedó
    // pendiente, no que el sistema lo reintente en silencio por días.
    return {
      recibidoId,
      consecutivo: preparado.consecutivo,
      mensaje: solicitud.mensaje,
      estado: "pendiente_de_envio",
      detalle: err.message,
    };
  }
}

/** Para que el consecutivo del mensaje se pueda recomponer en un test. */
export { armarConsecutivo };
