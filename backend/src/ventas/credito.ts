import { PoolClient } from "pg";
import { registrarInteraccion } from "../crm/interacciones";
import { emitir } from "../facturacion/emision";

// ---------------------------------------------------------------------
// CRÉDITO, ABONOS Y ANTICIPOS.
//
// LO FISCAL, con su fuente y su fecha de consulta (2026-11-26):
//
// **ABONO a una venta a crédito → Recibo Electrónico de Pago (REP).**
// El Reglamento de Comprobantes Electrónicos lo define así (definición
// 23): *"Es el comprobante electrónico autorizado por la Administración
// Tributaria, que respalda el pago parcial por la venta de bienes y la
// prestación de servicios a crédito con pago diferido conforme lo
// dictan los artículos 3 inciso 8 y 27 de la Ley del Impuesto sobre el
// Valor Agregado"*.
//
// Y el Anexo 4.4, en el campo `CondicionVenta`, es explícito sobre qué
// códigos admite ese comprobante: *"Los códigos 09 y 11 de la nota 5,
// sobre pagos de servicios prestados al Estado y Ventas a Crédito en
// IVA a 90 días, se utilizarán únicamente en Recibos Electrónicos de
// Pago. Estos serán los únicos códigos permitidos en dicho Comprobante
// Electrónico."*
//
// De ahí sale el par que usa este módulo:
//   * la FACTURA a crédito va con condición **10** ("Venta a crédito en
//     IVA hasta 90 días, artículo 27 LIVA");
//   * el ABONO va en un REP con condición **11** ("Pago de venta a
//     crédito en IVA hasta 90 días").
// Y el REP exige al menos una referencia a la factura que cancela.
//
// **ANTICIPOS: las fuentes oficiales NO dicen nada.** Se buscaron
// "anticipo", "adelanto" y "pago anticipado" en los siete documentos
// descargados (Anexos 4.4 y su actualización, Reglamento, resolución
// DGT-R-000-2024, Generalidades, Código de moneda y Guía IdP): cero
// menciones. El REP está acotado por su definición a pagos de ventas
// **ya hechas** a crédito, así que no cubre un anticipo.
//
// Por eso se implementa **la opción conservadora**: el anticipo NO
// emite comprobante al recibirse. Es un saldo a favor del cliente —un
// movimiento de tesorería, no un hecho fiscal— y el comprobante sale
// con la venta final, donde el anticipo entra como medio de pago. Así
// no se factura dos veces ni se factura antes de que exista la
// operación.
//
// **Queda marcado para el contador.** El artículo 3 de la LIVA habla de
// "lo que ocurra primero" entre facturación y prestación, y eso podría
// obligar a facturar al recibir el anticipo. Es una interpretación de
// derecho tributario que no está en las fuentes que este repo tiene, y
// no se resuelve adivinando. `vta_anticipos.comprobante_id` existe
// justamente para el día que el contador diga que sí: sería cablear,
// no rediseñar.
// ---------------------------------------------------------------------

/** Condición de venta de la FACTURA a crédito, dentro de los 90 días. */
export const CONDICION_VENTA_CREDITO_90 = "10";
/** Condición de venta del REP que paga esa factura. */
export const CONDICION_VENTA_PAGO_CREDITO_90 = "11";
/** Tipo de comprobante del REP. */
export const TIPO_REP = "10";
/** Nota 10: el REP referencia una factura electrónica. */
export const TIPO_DOC_REFERENCIA_FACTURA = "01";
/** Nota 9: "Pago a comprobante electrónico". */
export const CODIGO_REFERENCIA_PAGO = "17";

/**
 * QUIÉN DEBE. En una venta a crédito el deudor es el RECEPTOR de la
 * factura, no el dueño de la mascota: si la factura salió a nombre de
 * la empresa, la cuenta por cobrar es de la empresa. Cobrarle al dueño
 * sería cobrarle a quien no debe.
 *
 * Por eso todo este módulo dejó de hablar de `propietarioId` y habla de
 * un deudor que es un cliente O un perfil de facturación. El `tipo` no
 * es decoración: decide en qué columna se busca, y un id de perfil
 * leído como propietario no encontraría nada y daría crédito cero sin
 * fallar.
 */
export interface Deudor {
  tipo: "cliente" | "perfil";
  id: string;
}

/** Atajo para lo que antes era un `propietarioId` suelto. */
export function deudorCliente(propietarioId: string): Deudor {
  return { tipo: "cliente", id: propietarioId };
}

/** La columna de cada tabla según el tipo de deudor. */
function columnaDeudor(d: Deudor): "propietario_id" | "perfil_id" {
  return d.tipo === "cliente" ? "propietario_id" : "perfil_id";
}

/** En `fact_comprobantes`, el receptor apunta a una de estas dos. */
function columnaReceptor(d: Deudor): "receptor_propietario_id" | "receptor_perfil_id" {
  return d.tipo === "cliente" ? "receptor_propietario_id" : "receptor_perfil_id";
}

export interface EstadoCredito {
  habilitado: boolean;
  limite: number;
  plazoDias: number;
  usado: number;
  disponible: number;
}

/**
 * Cuánto crédito le queda a un cliente.
 *
 * `usado` es la suma de lo facturado a crédito **menos** lo abonado. No
 * se guarda un saldo: se calcula, por el mismo motivo que el total de
 * la cuenta. Un saldo guardado y un saldo calculado que difieren es
 * exactamente el defecto que no rompe nada visible.
 */
export async function estadoDeCredito(
  db: PoolClient,
  deudor: Deudor
): Promise<EstadoCredito> {
  const columna = columnaDeudor(deudor);
  const c = await db.query<{ habilitado: boolean; limite: string; plazo_dias: number }>(
    `SELECT habilitado, limite, plazo_dias FROM vta_credito_cliente WHERE ${columna} = $1`,
    [deudor.id]
  );
  const config = c.rows[0] ?? { habilitado: false, limite: "0", plazo_dias: 30 };

  const facturado = await db.query<{ total: string }>(
    `SELECT COALESCE(sum(f.total_comprobante), 0)::text AS total
       FROM fact_comprobantes f
      WHERE f.${columnaReceptor(deudor)} = $1
        AND f.tipo_comprobante = '01'
        AND f.condicion_venta IN ('02', '10')
        AND f.estado IN ('aceptado', 'aceptado_parcial', 'enviado', 'en_cola')`,
    [deudor.id]
  );
  const abonado = await db.query<{ total: string }>(
    `SELECT COALESCE(sum(monto), 0)::text AS total FROM vta_abonos WHERE ${columna} = $1`,
    [deudor.id]
  );

  const usado =
    Math.round((Number(facturado.rows[0].total) - Number(abonado.rows[0].total)) * 100) / 100;
  const limite = Number(config.limite);

  return {
    habilitado: config.habilitado,
    limite,
    plazoDias: config.plazo_dias,
    usado,
    disponible: Math.round((limite - usado) * 100) / 100,
  };
}

/**
 * ¿Puede este cliente llevarse esta venta a crédito?
 *
 * Devuelve el motivo cuando no, para que la pantalla lo muestre en vez
 * de un "no se puede" sin explicación.
 */
export async function puedeComprarACredito(
  db: PoolClient,
  deudor: Deudor,
  monto: number
): Promise<{ puede: boolean; motivo?: string; estado: EstadoCredito }> {
  const quien = deudor.tipo === "cliente" ? "Este cliente" : "Este perfil de facturación";
  const estado = await estadoDeCredito(db, deudor);
  if (!estado.habilitado) {
    return { puede: false, motivo: `${quien} no tiene crédito habilitado.`, estado };
  }
  if (monto > estado.disponible) {
    return {
      puede: false,
      motivo:
        `La venta es de ${monto} y le quedan ${estado.disponible} de un límite de ` +
        `${estado.limite}. Hace falta que lo autorice un administrador.`,
      estado,
    };
  }
  return { puede: true, estado };
}

export interface AplicacionAbono {
  comprobanteId: string;
  monto: number;
}

export interface ResultadoAbono {
  abonoId: string;
  repId?: string;
  repConsecutivo?: string;
  repEstado?: string;
  aplicado: number;
}

/**
 * Registra un abono y emite el REP que lo respalda.
 *
 * Un abono puede repartirse entre VARIAS facturas, y cada una entra
 * como una referencia del REP: es lo que permite decir después cuánto
 * de esa factura quedó pagado.
 */
export async function registrarAbono(
  db: PoolClient,
  tenantId: string,
  datos: {
    /** Quién paga: el deudor de la factura, que puede ser un perfil. */
    deudor: Deudor;
    sesionId?: string;
    aplicaciones: AplicacionAbono[];
    /**
     * Cómo se recibió el abono. El XSD del REP exige al menos un
     * `MedioPago` (la validación contra el esquema oficial lo
     * rechaza sin él), y además es el dato que el arqueo necesita:
     * un abono en efectivo y uno por transferencia no se cuentan
     * igual. Por defecto, efectivo.
     */
    medios?: Array<{ codigo: string; monto: number; referencia?: string }>;
    personaId?: string;
  }
): Promise<ResultadoAbono> {
  if (datos.aplicaciones.length === 0) {
    throw new Error("Un abono tiene que decir a qué factura o facturas se aplica.");
  }

  const total = Math.round(datos.aplicaciones.reduce((a, x) => a + x.monto, 0) * 100) / 100;
  if (!(total > 0)) throw new Error("El abono tiene que ser mayor que cero.");

  // Las facturas que se pagan, con lo que ya tenían abonado.
  const referencias: Array<{ clave: string; fecha: string }> = [];
  for (const ap of datos.aplicaciones) {
    const f = await db.query<{
      clave: string | null;
      fecha_emision: Date;
      total_comprobante: string;
      condicion_venta: string;
      tipo_comprobante: string;
      abonado: string;
    }>(
      `SELECT f.clave, f.fecha_emision, f.total_comprobante, f.condicion_venta, f.tipo_comprobante,
              COALESCE((SELECT sum(aa.monto) FROM vta_abono_aplicaciones aa
                         WHERE aa.comprobante_id = f.id), 0)::text AS abonado
         FROM fact_comprobantes f WHERE f.id = $1`,
      [ap.comprobanteId]
    );
    if (f.rows.length === 0) throw new Error(`No existe el comprobante ${ap.comprobanteId}.`);
    const fila = f.rows[0];

    if (!fila.clave) {
      throw new Error("No se puede abonar a un comprobante que todavía es borrador.");
    }
    if (!["02", "10"].includes(fila.condicion_venta)) {
      throw new Error(
        `El comprobante ${fila.clave} no es una venta a crédito (condición ${fila.condicion_venta}): no hay nada que abonar.`
      );
    }
    const pendiente =
      Math.round((Number(fila.total_comprobante) - Number(fila.abonado)) * 100) / 100;
    if (ap.monto > pendiente + 0.01) {
      throw new Error(
        `A la factura ${fila.clave} le quedan ${pendiente} por pagar y se le quieren aplicar ${ap.monto}.`
      );
    }
    referencias.push({ clave: fila.clave, fecha: fila.fecha_emision.toISOString() });
  }

  const a = await db.query<{ id: string }>(
    `INSERT INTO vta_abonos (tenant_id, ${columnaDeudor(datos.deudor)}, sesion_id, monto,
                             recibido_por)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [tenantId, datos.deudor.id, datos.sesionId ?? null, total, datos.personaId ?? null]
  );
  const abonoId = a.rows[0].id;

  if (datos.deudor.tipo === "cliente") {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "abono",
      propietarioId: datos.deudor.id,
      origenTabla: "vta_abonos",
      origenId: abonoId,
      personaId: datos.personaId ?? null,
      resumen: `${total.toFixed(2)} a ${datos.aplicaciones.length} factura(s)`,
    });
  }

  for (const ap of datos.aplicaciones) {
    await db.query(
      `INSERT INTO vta_abono_aplicaciones (tenant_id, abono_id, comprobante_id, monto)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, abonoId, ap.comprobanteId, ap.monto]
    );
  }

  // --- El REP ---------------------------------------------------------
  //
  // El receptor del REP es el DEUDOR: si la factura a crédito salió a
  // nombre de la empresa, el recibo del pago también. Emitirlo a nombre
  // del dueño dejaría un recibo que no respalda esa cuenta por cobrar.
  const cliente = await db.query<{
    nombre: string;
    numero_identificacion: string | null;
    codigo: string | null;
    email: string | null;
  }>(
    datos.deudor.tipo === "cliente"
      ? `SELECT p.nombre, p.numero_identificacion, ti.codigo, p.email
           FROM propietarios p
           LEFT JOIN tipos_identificacion ti ON ti.id = p.tipo_identificacion_id
          WHERE p.id = $1`
      : `SELECT nombre, numero_identificacion, tipo_identificacion AS codigo, correo AS email
           FROM fact_perfiles_facturacion WHERE id = $1`,
    [datos.deudor.id]
  );
  const c = cliente.rows[0];
  if (!c?.numero_identificacion || !c.codigo) {
    throw new Error(
      "Para emitir el Recibo Electrónico de Pago hace falta la identificación de quien paga: el REP la exige igual que una factura."
    );
  }

  const medios =
    datos.medios && datos.medios.length > 0
      ? datos.medios
      : [{ codigo: "01", monto: total }];
  const sumaMedios = Math.round(medios.reduce((a, m) => a + m.monto, 0) * 100) / 100;
  if (Math.abs(sumaMedios - total) > 0.01) {
    throw new Error(
      `Los medios del abono suman ${sumaMedios} y el abono es de ${total}. Con dos o más medios, Hacienda valida que coincidan.`
    );
  }

  const emitido = await emitir(tenantId, {
    tipoComprobante: TIPO_REP,
    // El Anexo 4.4 admite SOLO 09 y 11 en el REP.
    condicionVenta: CONDICION_VENTA_PAGO_CREDITO_90,
    receptor: {
      nombre: c.nombre,
      identificacion: { tipo: c.codigo, numero: c.numero_identificacion },
      correo: c.email ?? undefined,
    },
    ...(datos.deudor.tipo === "cliente"
      ? { receptorPropietarioId: datos.deudor.id }
      : { receptorPerfilId: datos.deudor.id }),
    lineas: [
      {
        cantidad: 1,
        unidadMedida: "Sp",
        detalle: `Abono a ${referencias.length} factura(s) a crédito`,
        precioUnitario: total,
        impuestos: [{ codigo: "01", codigoTarifaIva: "01" }],
      },
    ],
    mediosPago:
      medios.length === 1
        ? [{ codigo: medios[0].codigo }]
        : medios.map((m) => ({ codigo: m.codigo, monto: m.monto })),
    referencias: referencias.map((r) => ({
      tipoDocumento: TIPO_DOC_REFERENCIA_FACTURA,
      numero: r.clave,
      fechaEmision: r.fecha,
      codigo: CODIGO_REFERENCIA_PAGO,
      razon: "Pago parcial de venta a crédito",
    })),
    claveIdempotencia: `abono:${abonoId}`,
  });

  await db.query(`UPDATE vta_abonos SET rep_id = $2 WHERE id = $1`, [abonoId, emitido.comprobanteId]);

  // LOS MEDIOS SE GUARDAN, no solo viajan en el XML del REP: el arqueo
  // de la caja tiene que poder sumar el efectivo que entró por un
  // abono, y no puede leerlo de un comprobante firmado.
  for (const m of medios) {
    await db.query(
      `INSERT INTO vta_abono_medios (tenant_id, abono_id, medio, moneda, monto, referencia)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, abonoId, m.codigo, "CRC", m.monto, m.referencia ?? null]
    );
  }

  return {
    abonoId,
    repId: emitido.comprobanteId,
    repConsecutivo: emitido.consecutivo,
    repEstado: emitido.estado,
    aplicado: total,
  };
}

/**
 * Registra un anticipo. **NO emite comprobante** — ver la nota larga
 * del encabezado de este archivo.
 */
export async function registrarAnticipo(
  db: PoolClient,
  tenantId: string,
  datos: {
    /** De quién es el saldo a favor. Normalmente el cliente. */
    deudor: Deudor;
    sesionId?: string;
    motivo: string;
    monto: number;
    encargoId?: string;
    personaId?: string;
    /** Medio de pago de Hacienda (Nota 6). Por defecto efectivo. */
    medio?: string;
    moneda?: string;
  }
): Promise<{ id: string }> {
  if (!(datos.monto > 0)) throw new Error("El anticipo tiene que ser mayor que cero.");
  if (!datos.motivo?.trim()) {
    throw new Error("Un anticipo lleva su motivo: para qué cirugía o qué encargo es.");
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO vta_anticipos (tenant_id, ${columnaDeudor(datos.deudor)}, sesion_id, motivo,
                                monto, encargo_id, recibido_por, medio, moneda)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      tenantId, datos.deudor.id, datos.sesionId ?? null, datos.motivo.trim(), datos.monto,
      datos.encargoId ?? null, datos.personaId ?? null, datos.medio ?? "01",
      datos.moneda ?? "CRC",
    ]
  );
  // CRM: el anticipo es del cliente, no de un perfil de facturacion;
  // si el deudor es un perfil no hay linea de tiempo donde ponerlo y
  // `registrarInteraccion` devuelve null sin romper nada.
  if (datos.deudor.tipo === "cliente") {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "anticipo",
      propietarioId: datos.deudor.id,
      origenTabla: "vta_anticipos",
      origenId: r.rows[0].id,
      personaId: datos.personaId ?? null,
      resumen: datos.motivo.trim().slice(0, 120),
    });
  }

  return { id: r.rows[0].id };
}

/** Cuánto saldo a favor le queda al cliente. */
export async function saldoAFavor(db: PoolClient, deudor: Deudor): Promise<number> {
  const r = await db.query<{ total: string }>(
    `SELECT COALESCE(sum(monto - aplicado), 0)::text AS total FROM vta_anticipos
      WHERE ${columnaDeudor(deudor)} = $1 AND estado = 'disponible'`,
    [deudor.id]
  );
  return Number(r.rows[0].total);
}

/**
 * Aplica saldo a favor a una cuenta. Toma los anticipos más viejos
 * primero —el cliente espera que se gaste lo que entregó antes— y
 * devuelve cuánto se pudo aplicar.
 */
export async function aplicarAnticipos(
  db: PoolClient,
  deudor: Deudor,
  monto: number
): Promise<number> {
  const disponibles = await db.query<{ id: string; resta: string }>(
    `SELECT id, (monto - aplicado)::text AS resta FROM vta_anticipos
      WHERE ${columnaDeudor(deudor)} = $1 AND estado = 'disponible' AND monto > aplicado
      ORDER BY creado_en
      FOR UPDATE`,
    [deudor.id]
  );

  let porAplicar = monto;
  let aplicadoTotal = 0;
  for (const a of disponibles.rows) {
    if (porAplicar <= 0) break;
    const toma = Math.min(Number(a.resta), porAplicar);
    await db.query(
      `UPDATE vta_anticipos
          SET aplicado = aplicado + $2,
              estado = CASE WHEN aplicado + $2 >= monto THEN 'aplicado' ELSE estado END
        WHERE id = $1`,
      [a.id, toma]
    );
    porAplicar -= toma;
    aplicadoTotal += toma;
  }
  return Math.round(aplicadoTotal * 100) / 100;
}

/**
 * La cuenta corriente del cliente: facturas pendientes con su
 * antigüedad, abonos y saldo a favor.
 */
export async function cuentaCorriente(db: PoolClient, deudor: Deudor) {
  const facturas = await db.query(
    `SELECT f.id, f.clave, f.consecutivo, f.fecha_emision, f.total_comprobante,
            f.condicion_venta, f.plazo_credito_dias,
            COALESCE((SELECT sum(aa.monto) FROM vta_abono_aplicaciones aa
                       WHERE aa.comprobante_id = f.id), 0)::text AS abonado,
            (f.fecha_emision + (COALESCE(f.plazo_credito_dias, 0) || ' days')::interval)::date
              AS vence_el,
            GREATEST(0, CURRENT_DATE
              - (f.fecha_emision + (COALESCE(f.plazo_credito_dias, 0) || ' days')::interval)::date)
              AS dias_vencida,
            (CURRENT_DATE - f.fecha_emision::date) AS antiguedad_dias
       FROM fact_comprobantes f
      WHERE f.${columnaReceptor(deudor)} = $1
        AND f.tipo_comprobante = '01'
        AND f.condicion_venta IN ('02','10')
        AND f.estado IN ('aceptado','aceptado_parcial','enviado','en_cola')
      ORDER BY f.fecha_emision`,
    [deudor.id]
  );

  const abonos = await db.query(
    `SELECT a.id, a.monto, a.creado_en, c.consecutivo AS rep_consecutivo, c.estado AS rep_estado
       FROM vta_abonos a
       LEFT JOIN fact_comprobantes c ON c.id = a.rep_id
      WHERE a.${columnaDeudor(deudor)} = $1 ORDER BY a.creado_en DESC`,
    [deudor.id]
  );

  const anticipos = await db.query(
    `SELECT id, motivo, monto, aplicado, estado, creado_en FROM vta_anticipos
      WHERE ${columnaDeudor(deudor)} = $1 ORDER BY creado_en DESC`,
    [deudor.id]
  );

  return {
    facturas: facturas.rows.map((f) => ({
      ...f,
      pendiente: Math.round((Number(f.total_comprobante) - Number(f.abonado)) * 100) / 100,
    })),
    abonos: abonos.rows,
    anticipos: anticipos.rows,
    credito: await estadoDeCredito(db, deudor),
    saldoAFavor: await saldoAFavor(db, deudor),
  };
}
