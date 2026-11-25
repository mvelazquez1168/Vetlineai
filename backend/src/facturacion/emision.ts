import { PoolClient } from "pg";
import { conAlcanceTenant } from "../alcanceTenant";
import { ComprobanteCalculado, calcularComprobante } from "./calculo";
import {
  SITUACION_NORMAL,
  SituacionComprobante,
  armarClave,
  consumirConsecutivo,
  generarCodigoSeguridad,
} from "./claveConsecutivo";
import { obtenerLlaveFirma, obtenerSecretos } from "./credenciales";
import { deMonto } from "./decimal";
import { firmarXml } from "./firma";
import { proveedorHaciendaActivo } from "./proveedorActivo";
import {
  ErrorHaciendaSinRespuesta,
  interpretarIndEstado,
} from "./proveedorHacienda";
import { DocumentoVenta } from "./tipos";
import { exigirXmlValido } from "./validacionXsd";
import { EmisorXml, armarXml, fechaHoraXml } from "./xml";

// ---------------------------------------------------------------------
// EL FLUJO DE EMISIÓN, de punta a punta:
//
//   crear → clave y consecutivo → calcular → XML → validar → firmar
//        → encolar → enviar → consultar estado
//
// Dos reglas de forma que explican por qué está partido así:
//
// 1. **NINGUNA llamada a Hacienda dentro de una transacción abierta.**
//    Es el patrón de transacción corta que ya usa el chat
//    (`alcanceTenant.ts`): sostener la transacción durante la llamada
//    externa deja la conexión en `idle in transaction` todo ese tiempo, y
//    eso ya disparó una alerta de AWS en este proyecto. Acá cada paso que
//    escribe abre su propia transacción de milisegundos; firmar y enviar
//    ocurren afuera.
//
// 2. **La venta NUNCA se bloquea por Hacienda.** Si Hacienda no
//    responde, el comprobante queda firmado y en cola, y `emitir()`
//    devuelve igual. Quien factura ya tiene su clave, su consecutivo y su
//    XML firmado: el envío es un trámite posterior.
// ---------------------------------------------------------------------

/** Cada cuánto se reintenta, en minutos, por número de intento. */
const ESPERA_REINTENTOS_MIN = [1, 5, 15, 60, 180, 360, 720];

/**
 * Cuántos intentos antes de dejar de reintentar solo.
 *
 * No es "se descarta": el comprobante queda en `error` y aparece en la
 * pantalla para que alguien lo reenvíe a mano. Reintentar para siempre
 * esconde un problema de credenciales detrás de un log que nadie lee.
 */
const MAX_INTENTOS = ESPERA_REINTENTOS_MIN.length;

function proximoIntento(intentos: number): Date | null {
  if (intentos >= MAX_INTENTOS) return null;
  const minutos = ESPERA_REINTENTOS_MIN[Math.min(intentos, ESPERA_REINTENTOS_MIN.length - 1)];
  return new Date(Date.now() + minutos * 60_000);
}

export interface EmisorCompleto extends EmisorXml {
  id: string;
  tenantId: string;
  sucursal: string;
  terminal: string;
  ambienteActivo: "pruebas" | "produccion";
}

export interface ResultadoEmision {
  comprobanteId: string;
  clave: string;
  consecutivo: string;
  estado: string;
  /** true si la solicitud ya existía (misma clave de idempotencia). */
  yaExistia: boolean;
  /** El `indEstado` crudo de Hacienda, si ya hubo respuesta. */
  indEstado?: string;
  /** El motivo del rechazo, tal cual lo devolvió Hacienda. */
  detalle?: string;
}

/** Lee el emisor de una clínica con todo lo que hace falta para emitir. */
export async function leerEmisor(db: PoolClient, tenantId: string): Promise<EmisorCompleto> {
  const r = await db.query(
    `SELECT id, tenant_id, tipo_identificacion, numero_identificacion, nombre,
            nombre_comercial, codigo_actividad_economica, registro_fiscal_8707,
            ubicacion_provincia, ubicacion_canton, ubicacion_distrito, ubicacion_barrio,
            ubicacion_otras_senas, telefono_codigo_pais, telefono_numero, correo,
            proveedor_sistemas, sucursal, terminal, ambiente_activo
       FROM fact_emisores WHERE tenant_id = $1`,
    [tenantId]
  );
  const f = r.rows[0];
  if (!f) {
    throw new Error(
      "La clínica no tiene configurado el emisor de facturación electrónica. Hay que cargar sus datos fiscales antes de poder emitir."
    );
  }
  return {
    id: f.id,
    tenantId: f.tenant_id,
    tipoIdentificacion: f.tipo_identificacion,
    numeroIdentificacion: f.numero_identificacion,
    nombre: f.nombre,
    nombreComercial: f.nombre_comercial,
    registroFiscal8707: f.registro_fiscal_8707,
    codigoActividadEconomica: f.codigo_actividad_economica,
    ubicacionProvincia: f.ubicacion_provincia,
    ubicacionCanton: f.ubicacion_canton,
    ubicacionDistrito: f.ubicacion_distrito,
    ubicacionBarrio: f.ubicacion_barrio,
    ubicacionOtrasSenas: f.ubicacion_otras_senas,
    telefonoCodigoPais: f.telefono_codigo_pais,
    telefonoNumero: f.telefono_numero,
    correo: f.correo,
    proveedorSistemas: f.proveedor_sistemas,
    sucursal: f.sucursal,
    terminal: f.terminal,
    ambienteActivo: f.ambiente_activo,
  };
}

async function registrarEvento(
  db: PoolClient,
  comprobanteId: string,
  tipo: string,
  detalle?: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO fact_comprobante_eventos (comprobante_id, tipo_evento, detalle)
     VALUES ($1, $2, $3)`,
    [comprobanteId, tipo, detalle ? JSON.stringify(detalle) : null]
  );
}

// ---------------------------------------------------------------------
// PASO 1 — crear el comprobante. Transacción corta.
//
// Acá pasan las tres cosas que TIENEN que ser atómicas juntas: consumir
// el consecutivo, armar la clave y guardar el comprobante con sus
// líneas. Si algo falla, el consecutivo no se consume (está en la misma
// transacción) y no queda un comprobante a medias.
// ---------------------------------------------------------------------
async function crearComprobante(
  db: PoolClient,
  emisor: EmisorCompleto,
  documento: DocumentoVenta,
  calculo: ComprobanteCalculado,
  fechaEmision: Date
): Promise<{ id: string; clave: string; consecutivo: string }> {
  const sucursal = documento.sucursal ?? emisor.sucursal;
  const terminal = documento.terminal ?? emisor.terminal;
  const situacion: SituacionComprobante = documento.situacion ?? SITUACION_NORMAL;

  const { consecutivo } = await consumirConsecutivo(db, emisor.tenantId, {
    emisorId: emisor.id,
    sucursal,
    terminal,
    tipoComprobante: documento.tipoComprobante,
  });

  const clave = armarClave({
    fechaEmision,
    tipoIdentificacionEmisor: emisor.tipoIdentificacion,
    numeroIdentificacionEmisor: emisor.numeroIdentificacion,
    consecutivo,
    situacion,
    codigoSeguridad: generarCodigoSeguridad(),
  });

  const r = calculo.resumen;
  const rec = documento.receptor;

  const ins = await db.query<{ id: string }>(
    `INSERT INTO fact_comprobantes (
       tenant_id, emisor_id, tipo_comprobante, clave, consecutivo, sucursal, terminal,
       situacion, fecha_emision,
       codigo_actividad_emisor, codigo_actividad_receptor,
       receptor_tipo_identificacion, receptor_numero_identificacion, receptor_nombre,
       receptor_nombre_comercial, receptor_correo,
       receptor_telefono_codigo_pais, receptor_telefono_numero,
       receptor_ubicacion_provincia, receptor_ubicacion_canton, receptor_ubicacion_distrito,
       receptor_ubicacion_barrio, receptor_ubicacion_otras_senas, receptor_otras_senas_extranjero,
       condicion_venta, condicion_venta_detalle, plazo_credito_dias,
       moneda, tipo_cambio,
       total_serv_gravados, total_serv_exentos, total_serv_exonerado, total_serv_no_sujeto,
       total_merc_gravadas, total_merc_exentas, total_merc_exonerada, total_merc_no_sujeta,
       total_gravado, total_exento, total_exonerado, total_no_sujeto,
       total_venta, total_descuentos, total_venta_neta, total_impuesto,
       total_imp_asum_emisor_fabrica, total_iva_devuelto, total_otros_cargos, total_comprobante,
       estado, clave_idempotencia, comprobante_referencia_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11,
       $12, $13, $14, $15, $16, $17, $18,
       $19, $20, $21, $22, $23, $24,
       $25, $26, $27, $28, $29,
       $30, $31, $32, $33, $34, $35, $36, $37,
       $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49,
       'borrador', $50, $51
     ) RETURNING id`,
    [
      emisor.tenantId,
      emisor.id,
      documento.tipoComprobante,
      clave,
      consecutivo,
      sucursal,
      terminal,
      situacion,
      fechaEmision,
      documento.tipoComprobante === "10" ? null : emisor.codigoActividadEconomica,
      rec?.codigoActividad ?? null,
      rec?.identificacion?.tipo ?? null,
      rec?.identificacion?.numero ?? null,
      rec?.nombre ?? null,
      rec?.nombreComercial ?? null,
      rec?.correo ?? null,
      rec?.telefono?.codigoPais ?? null,
      rec?.telefono?.numero ?? null,
      rec?.ubicacion?.provincia ?? null,
      rec?.ubicacion?.canton ?? null,
      rec?.ubicacion?.distrito ?? null,
      rec?.ubicacion?.barrio ?? null,
      rec?.ubicacion?.otrasSenas ?? null,
      rec?.otrasSenasExtranjero ?? null,
      documento.condicionVenta,
      documento.condicionVentaDetalle ?? null,
      documento.plazoCreditoDias ?? null,
      documento.moneda ?? "CRC",
      String(documento.tipoCambio ?? 1),
      deMonto(r.totalServGravados),
      deMonto(r.totalServExentos),
      deMonto(r.totalServExonerado),
      deMonto(r.totalServNoSujeto),
      deMonto(r.totalMercGravadas),
      deMonto(r.totalMercExentas),
      deMonto(r.totalMercExonerada),
      deMonto(r.totalMercNoSujeta),
      deMonto(r.totalGravado),
      deMonto(r.totalExento),
      deMonto(r.totalExonerado),
      deMonto(r.totalNoSujeto),
      deMonto(r.totalVenta),
      deMonto(r.totalDescuentos),
      deMonto(r.totalVentaNeta),
      deMonto(r.totalImpuesto),
      deMonto(r.totalImpAsumEmisorFabrica),
      deMonto(r.totalIvaDevuelto),
      deMonto(r.totalOtrosCargos),
      deMonto(r.totalComprobante),
      documento.claveIdempotencia ?? null,
      null,
    ]
  );
  const comprobanteId = ins.rows[0].id;

  // Líneas, con sus impuestos y descuentos.
  for (let i = 0; i < calculo.lineas.length; i++) {
    const calc = calculo.lineas[i];
    const origen = documento.lineas[i];
    const linea = await db.query<{ id: string }>(
      `INSERT INTO fact_comprobante_lineas (
         comprobante_id, numero_linea, codigo_cabys, codigo_comercial_tipo, codigo_comercial,
         cantidad, unidad_medida, unidad_medida_comercial, tipo_transaccion, detalle,
         registro_medicamento, forma_farmaceutica,
         precio_unitario, monto_total, subtotal, iva_cobrado_fabrica, base_imponible,
         impuesto_asumido_emisor_fabrica, impuesto_neto, monto_total_linea
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        comprobanteId,
        calc.numeroLinea,
        origen.codigoCabys ?? null,
        origen.codigoComercial?.tipo ?? null,
        origen.codigoComercial?.codigo ?? null,
        deMonto(calc.cantidad),
        origen.unidadMedida,
        origen.unidadMedidaComercial ?? null,
        origen.tipoTransaccion ?? null,
        origen.detalle,
        origen.registroMedicamento ?? null,
        origen.formaFarmaceutica ?? null,
        deMonto(calc.precioUnitario),
        deMonto(calc.montoTotal),
        deMonto(calc.subtotal),
        origen.ivaCobradoFabrica ?? null,
        deMonto(calc.baseImponible),
        deMonto(calc.impuestoAsumidoEmisorFabrica),
        deMonto(calc.impuestoNeto),
        deMonto(calc.montoTotalLinea),
      ]
    );
    const lineaId = linea.rows[0].id;

    for (let j = 0; j < calc.impuestos.length; j++) {
      const imp = calc.impuestos[j];
      const impOrigen = origen.impuestos[j];
      const ex = impOrigen?.exoneracion;
      await db.query(
        `INSERT INTO fact_linea_impuestos (
           linea_id, codigo_impuesto, codigo_impuesto_otro, codigo_tarifa_iva, tarifa,
           factor_calculo_iva,
           esp_cantidad_unidad_medida, esp_porcentaje, esp_proporcion,
           esp_volumen_unidad_consumo, esp_impuesto_unidad, monto,
           exoneracion_tipo_documento, exoneracion_tipo_documento_otro,
           exoneracion_numero_documento, exoneracion_articulo, exoneracion_inciso,
           exoneracion_nombre_institucion, exoneracion_nombre_institucion_otros,
           exoneracion_fecha_emision, exoneracion_tarifa_exonerada, exoneracion_monto
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          lineaId,
          imp.codigo,
          imp.codigoOtro ?? null,
          imp.codigoTarifaIva ?? null,
          imp.tarifa === undefined ? null : deMonto(imp.tarifa),
          imp.factorCalculoIva === undefined ? null : deMonto(imp.factorCalculoIva),
          imp.datosEspecificos ? deMonto(imp.datosEspecificos.cantidadUnidadMedida) : null,
          imp.datosEspecificos?.porcentaje !== undefined
            ? deMonto(imp.datosEspecificos.porcentaje)
            : null,
          imp.datosEspecificos?.proporcion !== undefined
            ? deMonto(imp.datosEspecificos.proporcion)
            : null,
          imp.datosEspecificos?.volumenUnidadConsumo !== undefined
            ? deMonto(imp.datosEspecificos.volumenUnidadConsumo)
            : null,
          imp.datosEspecificos ? deMonto(imp.datosEspecificos.impuestoUnidad) : null,
          deMonto(imp.monto),
          ex?.tipoDocumento ?? null,
          ex?.tipoDocumentoOtro ?? null,
          ex?.numeroDocumento ?? null,
          ex?.articulo ?? null,
          ex?.inciso ?? null,
          ex?.nombreInstitucion ?? null,
          ex?.nombreInstitucionOtros ?? null,
          ex?.fechaEmision ?? null,
          imp.exoneracion ? deMonto(imp.exoneracion.tarifaExonerada) : null,
          imp.exoneracion ? deMonto(imp.exoneracion.monto) : null,
        ]
      );
    }

    for (const d of origen.descuentos ?? []) {
      await db.query(
        `INSERT INTO fact_linea_descuentos (linea_id, monto, codigo_descuento, codigo_descuento_otro, naturaleza)
         VALUES ($1, $2, $3, $4, $5)`,
        [lineaId, String(d.monto), d.codigoDescuento, d.codigoDescuentoOtro ?? null, d.naturaleza ?? null]
      );
    }
  }

  for (const m of documento.mediosPago ?? []) {
    await db.query(
      `INSERT INTO fact_comprobante_medios_pago (comprobante_id, codigo_medio_pago, medio_pago_otro, monto)
       VALUES ($1, $2, $3, $4)`,
      [comprobanteId, m.codigo, m.otro ?? null, m.monto === undefined ? null : String(m.monto)]
    );
  }

  for (const c of documento.otrosCargos ?? []) {
    await db.query(
      `INSERT INTO fact_comprobante_otros_cargos (
         comprobante_id, tipo_documento, tipo_documento_otros,
         tercero_tipo_identificacion, tercero_numero_identificacion, tercero_nombre,
         detalle, porcentaje, monto
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        comprobanteId,
        c.tipoDocumento,
        c.tipoDocumentoOtros ?? null,
        c.tercero?.identificacion.tipo ?? null,
        c.tercero?.identificacion.numero ?? null,
        c.tercero?.nombre ?? null,
        c.detalle,
        c.porcentaje === undefined ? null : String(c.porcentaje),
        String(c.monto),
      ]
    );
  }

  for (const ref of documento.referencias ?? []) {
    await db.query(
      `INSERT INTO fact_comprobante_referencias (
         comprobante_id, tipo_documento, tipo_documento_otro, numero, fecha_emision, codigo, codigo_otro, razon
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        comprobanteId,
        ref.tipoDocumento,
        ref.tipoDocumentoOtro ?? null,
        ref.numero ?? null,
        ref.fechaEmision,
        ref.codigo ?? null,
        ref.codigoOtro ?? null,
        ref.razon ?? null,
      ]
    );
  }

  // Si la referencia apunta a un comprobante NUESTRO, se guarda el
  // atajo para poder navegar de la nota al original sin buscar por clave.
  const claveReferenciada = (documento.referencias ?? []).find((r) => r.numero)?.numero;
  if (claveReferenciada) {
    await db.query(
      `UPDATE fact_comprobantes SET comprobante_referencia_id = (
         SELECT id FROM fact_comprobantes WHERE clave = $2 AND tenant_id = $3
       ) WHERE id = $1`,
      [comprobanteId, claveReferenciada, emisor.tenantId]
    );
  }

  await registrarEvento(db, comprobanteId, "creado", {
    tipoComprobante: documento.tipoComprobante,
    lineas: calculo.lineas.length,
    total: deMonto(r.totalComprobante),
    moneda: documento.moneda ?? "CRC",
  });

  return { id: comprobanteId, clave, consecutivo };
}

/**
 * Si la misma clave de idempotencia ya generó un comprobante, devuelve
 * ESE en vez de emitir otro.
 *
 * Se consulta ANTES de intentar el INSERT y además existe el UNIQUE en
 * la base: la consulta previa da una respuesta limpia al cliente, y el
 * UNIQUE cubre la carrera entre dos solicitudes simultáneas, que la
 * consulta previa sola no puede evitar.
 */
async function buscarPorIdempotencia(
  db: PoolClient,
  emisorId: string,
  claveIdempotencia: string
): Promise<ResultadoEmision | null> {
  const r = await db.query(
    `SELECT id, clave, consecutivo, estado, respuesta_ind_estado, respuesta_detalle
       FROM fact_comprobantes
      WHERE emisor_id = $1 AND clave_idempotencia = $2`,
    [emisorId, claveIdempotencia]
  );
  const f = r.rows[0];
  if (!f) return null;
  return {
    comprobanteId: f.id,
    clave: f.clave,
    consecutivo: f.consecutivo,
    estado: f.estado,
    yaExistia: true,
    indEstado: f.respuesta_ind_estado ?? undefined,
    detalle: f.respuesta_detalle ?? undefined,
  };
}

/**
 * Emite un comprobante a partir de un documento de venta.
 *
 * Devuelve en cuanto el comprobante está firmado y encolado o enviado:
 * **no espera la aceptación de Hacienda**. Eso puede tardar y bloquear la
 * caja por algo que no depende de la clínica.
 */
export async function emitir(
  tenantId: string,
  documento: DocumentoVenta
): Promise<ResultadoEmision> {
  const fechaEmision = documento.fechaEmision ? new Date(documento.fechaEmision) : new Date();

  // El cálculo es puro y no toca la base: se hace ANTES de abrir
  // cualquier transacción, así un documento mal armado falla sin haber
  // consumido un consecutivo.
  const calculo = calcularComprobante(documento);

  // --- Transacción 1: leer el emisor y crear el comprobante -----------
  const creado = await conAlcanceTenant(tenantId, async (db) => {
    const emisor = await leerEmisor(db, tenantId);

    if (documento.claveIdempotencia) {
      const existente = await buscarPorIdempotencia(db, emisor.id, documento.claveIdempotencia);
      if (existente) return { yaExistia: true as const, resultado: existente, emisor };
    }

    const r = await crearComprobante(db, emisor, documento, calculo, fechaEmision);
    return { yaExistia: false as const, resultado: r, emisor };
  });

  if (creado.yaExistia) return creado.resultado;

  const emisor = creado.emisor;
  const { id: comprobanteId, clave, consecutivo } = creado.resultado as {
    id: string;
    clave: string;
    consecutivo: string;
  };

  // --- Fuera de transacción: XML, validación y firma ------------------
  // Firmar implica leer y descifrar la llave y hacer criptografía: son
  // decenas de milisegundos, no microsegundos, y no hay razón para
  // sostener una transacción mientras pasa.
  const xml = armarXml({
    clave,
    consecutivo,
    tipoComprobante: documento.tipoComprobante,
    fechaEmision,
    emisor,
    documento,
    calculo,
  });

  // Un XML que no valida NO se firma ni se envía.
  await exigirXmlValido(xml, documento.tipoComprobante, { sinFirmar: true });

  const llave = await conAlcanceTenant(tenantId, (db) =>
    obtenerLlaveFirma(db, emisor.id, emisor.ambienteActivo)
  );
  const xmlFirmado = await firmarXml(xml, llave);

  // Segunda validación, ahora del documento completo y sin excepción: lo
  // que se envía es esto.
  await exigirXmlValido(xmlFirmado, documento.tipoComprobante);

  // --- Transacción 2: guardar el XML firmado y encolar ---------------
  await conAlcanceTenant(tenantId, async (db) => {
    await db.query(
      `UPDATE fact_comprobantes
          SET xml_firmado = $2, estado = 'en_cola', proximo_intento_en = now()
        WHERE id = $1`,
      [comprobanteId, Buffer.from(xmlFirmado, "utf-8")]
    );
    await registrarEvento(db, comprobanteId, "firmado", {
      bytes: Buffer.byteLength(xmlFirmado, "utf-8"),
      certificado: llave.info.sujeto,
      venceEn: llave.info.validoHasta.toISOString().slice(0, 10),
    });
  });

  // --- Enviar. Si Hacienda no contesta, queda en cola y listo ---------
  const resultado = await intentarEnviar(tenantId, comprobanteId);

  return {
    comprobanteId,
    clave,
    consecutivo,
    estado: resultado.estado,
    yaExistia: false,
    indEstado: resultado.indEstado,
    detalle: resultado.detalle,
  };
}

export interface ResultadoIntento {
  estado: string;
  indEstado?: string;
  detalle?: string;
  /** true si Hacienda no contestó y el comprobante quedó en cola. */
  enContingencia: boolean;
}

/**
 * Envía un comprobante que ya está firmado, y consulta su estado.
 *
 * Es idempotente: si el comprobante ya salió, no lo manda de nuevo —
 * consulta. Eso es lo que hace seguro que el job lo llame cuantas veces
 * quiera.
 */
export async function intentarEnviar(
  tenantId: string,
  comprobanteId: string
): Promise<ResultadoIntento> {
  const proveedor = proveedorHaciendaActivo();

  // --- Transacción: tomar el comprobante y lo que hace falta ---------
  const datos = await conAlcanceTenant(tenantId, async (db) => {
    const r = await db.query(
      `SELECT c.id, c.clave, c.consecutivo, c.tipo_comprobante, c.estado, c.intentos_envio,
              c.xml_firmado, c.fecha_emision,
              c.receptor_tipo_identificacion, c.receptor_numero_identificacion,
              e.id AS emisor_id, e.tipo_identificacion, e.numero_identificacion, e.ambiente_activo
         FROM fact_comprobantes c
         JOIN fact_emisores e ON e.id = c.emisor_id
        WHERE c.id = $1`,
      [comprobanteId]
    );
    const f = r.rows[0];
    if (!f) throw new Error(`No existe el comprobante ${comprobanteId}.`);
    if (!f.xml_firmado) {
      throw new Error(
        `El comprobante ${comprobanteId} no está firmado todavía: no hay nada que enviar.`
      );
    }
    return f;
  });

  const credenciales = await conAlcanceTenant(tenantId, (db) =>
    obtenerSecretos(db, datos.emisor_id, datos.ambiente_activo)
  );
  const credHacienda = {
    usuarioApi: credenciales.usuarioApi,
    passwordApi: credenciales.passwordApi,
    ambiente: datos.ambiente_activo as "pruebas" | "produccion",
  };

  const yaEnviado = ["enviado", "aceptado", "aceptado_parcial", "rechazado"].includes(datos.estado);

  // --- Fuera de transacción: la llamada a Hacienda -------------------
  if (!yaEnviado) {
    try {
      const envio = await proveedor.enviar(
        {
          clave: datos.clave,
          fechaEmision: fechaHoraXml(new Date(datos.fecha_emision)),
          emisor: {
            tipoIdentificacion: datos.tipo_identificacion,
            numeroIdentificacion: datos.numero_identificacion,
          },
          receptor: datos.receptor_numero_identificacion
            ? {
                tipoIdentificacion: datos.receptor_tipo_identificacion,
                numeroIdentificacion: datos.receptor_numero_identificacion,
              }
            : undefined,
          xmlFirmado: datos.xml_firmado.toString("utf-8"),
        },
        credHacienda
      );

      await conAlcanceTenant(tenantId, async (db) => {
        if (envio.recibido) {
          await db.query(
            `UPDATE fact_comprobantes
                SET estado = 'enviado', enviado_en = now(),
                    intentos_envio = intentos_envio + 1, proximo_intento_en = now()
              WHERE id = $1`,
            [comprobanteId]
          );
          await registrarEvento(db, comprobanteId, "enviado", {
            proveedor: proveedor.nombre,
            codigoHttp: envio.codigoHttp,
          });
        } else {
          // Hacienda CONTESTÓ rechazando la recepción. No es
          // contingencia: reintentarlo daría el mismo resultado.
          await db.query(
            `UPDATE fact_comprobantes
                SET estado = 'error', intentos_envio = intentos_envio + 1,
                    proximo_intento_en = NULL, respuesta_detalle = $2
              WHERE id = $1`,
            [comprobanteId, envio.detalle ?? `Hacienda devolvió ${envio.codigoHttp}.`]
          );
          await registrarEvento(db, comprobanteId, "error", {
            proveedor: proveedor.nombre,
            codigoHttp: envio.codigoHttp,
            detalle: envio.detalle,
          });
        }
      });

      if (!envio.recibido) {
        return {
          estado: "error",
          detalle: envio.detalle,
          enContingencia: false,
        };
      }
    } catch (err) {
      if (!(err instanceof ErrorHaciendaSinRespuesta)) throw err;

      // CONTINGENCIA. El comprobante queda firmado y en cola. La venta
      // ya está hecha y el cliente ya tiene su comprobante: lo único
      // pendiente es la transmisión.
      const estadoFinal = await conAlcanceTenant(tenantId, async (db) => {
        const intentos = (datos.intentos_envio as number) + 1;
        const proximo = proximoIntento(intentos);
        await db.query(
          `UPDATE fact_comprobantes
              SET estado = $3, intentos_envio = $2, proximo_intento_en = $4
            WHERE id = $1`,
          [comprobanteId, intentos, proximo ? "en_cola" : "error", proximo]
        );
        await registrarEvento(db, comprobanteId, proximo ? "contingencia" : "error", {
          proveedor: proveedor.nombre,
          intento: intentos,
          motivo: err.message,
          proximoIntento: proximo?.toISOString() ?? null,
        });
        return proximo ? "en_cola" : "error";
      });

      return { estado: estadoFinal, detalle: err.message, enContingencia: true };
    }
  }

  // --- Consultar el estado. También fuera de transacción -------------
  return consultarYRegistrar(tenantId, comprobanteId, datos.clave, credHacienda);
}

/** Consulta el estado en Hacienda y lo registra. Transacción corta al final. */
export async function consultarYRegistrar(
  tenantId: string,
  comprobanteId: string,
  clave: string,
  credenciales: { usuarioApi: string; passwordApi: string; ambiente: "pruebas" | "produccion" }
): Promise<ResultadoIntento> {
  const proveedor = proveedorHaciendaActivo();

  let estado;
  try {
    estado = await proveedor.consultarEstado(clave, credenciales);
  } catch (err) {
    if (!(err instanceof ErrorHaciendaSinRespuesta)) throw err;
    // No se pudo consultar: el comprobante sigue enviado y se vuelve a
    // consultar después. No cambia de estado.
    const proximo = await conAlcanceTenant(tenantId, async (db) => {
      const r = await db.query<{ intentos_envio: number }>(
        `SELECT intentos_envio FROM fact_comprobantes WHERE id = $1`,
        [comprobanteId]
      );
      const prox = proximoIntento(r.rows[0].intentos_envio);
      await db.query(`UPDATE fact_comprobantes SET proximo_intento_en = $2 WHERE id = $1`, [
        comprobanteId,
        prox,
      ]);
      await registrarEvento(db, comprobanteId, "reintento", {
        motivo: `No se pudo consultar el estado: ${err.message}`,
        proximoIntento: prox?.toISOString() ?? null,
      });
      return prox;
    });
    return { estado: "enviado", enContingencia: true, detalle: err.message };
  }

  if (!estado) {
    // Hacienda no conoce la clave: el envío no llegó. Vuelve a la cola
    // para enviarse de nuevo, no para consultarse.
    const estadoFinal = await conAlcanceTenant(tenantId, async (db) => {
      const r = await db.query<{ intentos_envio: number }>(
        `SELECT intentos_envio FROM fact_comprobantes WHERE id = $1`,
        [comprobanteId]
      );
      const prox = proximoIntento(r.rows[0].intentos_envio);
      await db.query(
        `UPDATE fact_comprobantes SET estado = $3, proximo_intento_en = $2 WHERE id = $1`,
        [comprobanteId, prox, prox ? "en_cola" : "error"]
      );
      await registrarEvento(db, comprobanteId, "reintento", {
        motivo: "Hacienda no reconoce la clave: el envío no llegó.",
        proximoIntento: prox?.toISOString() ?? null,
      });
      return prox ? "en_cola" : "error";
    });
    return { estado: estadoFinal, enContingencia: true };
  }

  const interpretado = interpretarIndEstado(estado.indEstado);

  const estadoFinal = await conAlcanceTenant(tenantId, async (db) => {
    const nuevoEstado =
      interpretado === "en_proceso"
        ? "enviado"
        : interpretado === "aceptado"
          ? "aceptado"
          : interpretado === "aceptado_parcial"
            ? "aceptado_parcial"
            : "rechazado";

    const proximo = interpretado === "en_proceso" ? proximoIntento(1) : null;

    await db.query(
      `UPDATE fact_comprobantes
          SET estado = $2,
              respuesta_ind_estado = $3,
              respuesta_detalle = COALESCE($4, respuesta_detalle),
              respuesta_recibida_en = now(),
              respuesta_xml = COALESCE(respuesta_xml, $5),
              proximo_intento_en = $6
        WHERE id = $1`,
      [
        comprobanteId,
        nuevoEstado,
        estado.indEstado,
        estado.detalle ?? null,
        estado.respuestaXml ? Buffer.from(estado.respuestaXml, "utf-8") : null,
        proximo,
      ]
    );
    await registrarEvento(db, comprobanteId, "respuesta_recibida", {
      indEstado: estado.indEstado,
      interpretado,
      detalle: estado.detalle,
    });
    return nuevoEstado;
  });

  return {
    estado: estadoFinal,
    indEstado: estado.indEstado,
    detalle: estado.detalle,
    enContingencia: false,
  };
}
