import { PoolClient } from "pg";
import { registrarMovimiento } from "../inventario/movimientos";

// ---------------------------------------------------------------------
// CUENTAS Y CARGOS.
//
// `agregarCargo` es **el punto único de entrada de cargos**, con la
// referencia a su origen. Hoy lo usan la venta de mostrador y el cargo
// manual; mañana la atención (prompt 07) lo va a usar igual, sin tocar
// nada de caja. Por eso el origen es un campo y no tres funciones
// parecidas.
//
// EL CARGO DESCUENTA INVENTARIO EN EL MOMENTO, no al cobrar. Es lo
// correcto: el producto sale del estante cuando se lo lleva el cliente,
// y una cuenta de hospitalización que acumula cargos tres días no puede
// tener el stock "reservado en el aire" todo ese tiempo. El movimiento
// queda ligado al cargo (`movimiento_id`) para que una devolución sepa
// qué revertir.
//
// EL TOTAL DE LA CUENTA no se guarda: se calcula de sus cargos. Un
// total guardado sería el mismo dato en dos lugares, y el día que
// divergieran ganaría el equivocado.
// ---------------------------------------------------------------------

export interface SolicitudCargo {
  cuentaId: string;
  origen: "mostrador" | "manual" | "atencion" | "encargo";
  origenId?: string;
  presentacionId?: string;
  servicioId?: string;
  descripcion?: string;
  pacienteId?: string;
  cantidad: number;
  precioUnitario?: number;
  descuento?: number;
  descuentoCodigo?: string;
  descuentoNaturaleza?: string;
  descuentoAutorizadoPor?: string;
  personaId?: string;
  /** De dónde sale el stock. Por defecto, la bodega de la caja. */
  bodegaId?: string;
  /** Para un cargo que NO debe descontar inventario (un servicio). */
  sinDescargo?: boolean;
  /** Para un cargo manual: lo fiscal, que el catálogo no puede aportar. */
  codigoCabys?: string;
  codigoTarifaIva?: string;
  unidadMedida?: string;
  lineaNegocio?: string;
}

export interface CargoAgregado {
  id: string;
  descripcion: string;
  total: number;
  movimientoId?: string;
}

export async function abrirCuenta(
  db: PoolClient,
  tenantId: string,
  datos: { propietarioId?: string; sesionId?: string }
): Promise<{ id: string; numero: number }> {
  // Consecutivo por clínica, serializado con un lock de transacción —
  // mismo motivo que en las órdenes de compra: `FOR UPDATE` no se puede
  // usar con un agregado y bloquear la última fila no sirve con cero.
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':vta_cuenta'))`, [tenantId]);
  const ultimo = await db.query<{ numero: number }>(
    `SELECT COALESCE(max(numero), 0) AS numero FROM vta_cuentas WHERE tenant_id = $1`,
    [tenantId]
  );
  const numero = Number(ultimo.rows[0].numero) + 1;

  let nombre: string | null = null;
  if (datos.propietarioId) {
    const p = await db.query<{ nombre: string }>(`SELECT nombre FROM propietarios WHERE id = $1`, [
      datos.propietarioId,
    ]);
    nombre = p.rows[0]?.nombre ?? null;
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO vta_cuentas (tenant_id, numero, propietario_id, cliente_nombre, sesion_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [tenantId, numero, datos.propietarioId ?? null, nombre, datos.sesionId ?? null]
  );
  return { id: r.rows[0].id, numero };
}

/** Qué se está cobrando, resuelto desde el catálogo. */
async function resolverQueSeCobra(
  db: PoolClient,
  s: SolicitudCargo
): Promise<{
  descripcion: string;
  precio: number;
  cabys: string | null;
  tarifa: string | null;
  unidad: string | null;
  linea: string | null;
  productoId: string | null;
}> {
  if (s.presentacionId) {
    const r = await db.query<{
      nombre: string;
      precio_venta: string | null;
      unidad_medida: string;
      producto_id: string;
      producto: string;
      codigo_cabys: string | null;
      codigo_tarifa_iva: string | null;
      linea_negocio: string;
    }>(
      `SELECT pr.nombre, pr.precio_venta, pr.unidad_medida, pr.producto_id,
              p.nombre AS producto, p.codigo_cabys, p.codigo_tarifa_iva, p.linea_negocio
         FROM inv_presentaciones pr
         JOIN inv_productos p ON p.id = pr.producto_id
        WHERE pr.id = $1 AND pr.activo`,
      [s.presentacionId]
    );
    if (r.rows.length === 0) throw new Error("Esa presentación no existe o está inactiva.");
    const f = r.rows[0];
    return {
      descripcion: s.descripcion ?? `${f.producto} — ${f.nombre}`,
      precio: s.precioUnitario ?? Number(f.precio_venta ?? 0),
      cabys: f.codigo_cabys,
      tarifa: f.codigo_tarifa_iva,
      unidad: f.unidad_medida,
      linea: f.linea_negocio,
      productoId: f.producto_id,
    };
  }

  if (s.servicioId) {
    const r = await db.query<{
      nombre: string;
      precio: string;
      codigo_cabys: string | null;
      codigo_tarifa_iva: string | null;
      linea_negocio: string;
    }>(
      `SELECT nombre, precio, codigo_cabys, codigo_tarifa_iva, linea_negocio
         FROM inv_servicios WHERE id = $1 AND activo`,
      [s.servicioId]
    );
    if (r.rows.length === 0) throw new Error("Ese servicio no existe o está inactivo.");
    const f = r.rows[0];
    return {
      descripcion: s.descripcion ?? f.nombre,
      precio: s.precioUnitario ?? Number(f.precio),
      cabys: f.codigo_cabys,
      tarifa: f.codigo_tarifa_iva,
      unidad: "Sp",
      linea: f.linea_negocio,
      productoId: null,
    };
  }

  if (!s.descripcion?.trim()) {
    throw new Error("Un cargo manual necesita una descripción: es lo que va a salir en la factura.");
  }
  if (s.precioUnitario === undefined) {
    throw new Error("Un cargo manual necesita su precio.");
  }
  return {
    descripcion: s.descripcion.trim(),
    precio: s.precioUnitario,
    cabys: s.codigoCabys ?? null,
    tarifa: s.codigoTarifaIva ?? null,
    unidad: s.unidadMedida ?? "Unid",
    linea: s.lineaNegocio ?? null,
    productoId: null,
  };
}

/**
 * EL PUNTO ÚNICO de entrada de cargos.
 *
 * Valida el descuento contra la política, descarga inventario cuando
 * corresponde y deja el cargo ligado a su movimiento.
 */
export async function agregarCargo(
  db: PoolClient,
  tenantId: string,
  s: SolicitudCargo
): Promise<CargoAgregado> {
  const cuenta = await db.query<{ estado: string; sesion_id: string | null }>(
    `SELECT estado, sesion_id FROM vta_cuentas WHERE id = $1`,
    [s.cuentaId]
  );
  if (cuenta.rows.length === 0) throw new Error(`No existe la cuenta ${s.cuentaId}.`);
  if (cuenta.rows[0].estado !== "abierta") {
    throw new Error(`La cuenta está "${cuenta.rows[0].estado}": no admite cargos nuevos.`);
  }

  const que = await resolverQueSeCobra(db, s);

  // EL CABYS SE EXIGE ACÁ, no al facturar. Hacienda lo pide en cada
  // línea de factura y tiquete (Nota 17), y todo cargo termina en un
  // comprobante. Descubrirlo al cobrar significaría el cliente
  // esperando en el mostrador mientras alguien busca el código; acá se
  // descubre cuando se arma la cuenta, que es cuando se puede
  // arreglar.
  if (!que.cabys) {
    throw new Error(
      `"${que.descripcion}" no tiene código CABYS, y Hacienda lo exige en cada línea del ` +
        `comprobante. ` +
        (s.presentacionId || s.servicioId
          ? "Hay que cargárselo al producto o servicio en el catálogo."
          : "Un cargo manual tiene que traerlo.")
    );
  }

  const bruto = que.precio * s.cantidad;
  const descuento = s.descuento ?? 0;

  if (descuento < 0) throw new Error("Un descuento no puede ser negativo.");
  if (descuento > bruto) throw new Error("El descuento no puede superar el valor de la línea.");

  // La política: hasta el máximo se aplica directo; por encima, hace
  // falta que un administrador lo autorice.
  if (descuento > 0) {
    const par = await db.query<{ descuento_maximo_pct: string }>(
      `SELECT descuento_maximo_pct FROM vta_parametros WHERE tenant_id = $1`,
      [tenantId]
    );
    const maximo = par.rows.length > 0 ? Number(par.rows[0].descuento_maximo_pct) : 10;
    const pct = bruto > 0 ? (descuento / bruto) * 100 : 0;
    if (pct > maximo && !s.descuentoAutorizadoPor) {
      throw new Error(
        `El descuento es del ${pct.toFixed(1)}% y el máximo sin autorización es ${maximo}%. ` +
          `Hace falta que lo autorice un administrador.`
      );
    }
    if (!s.descuentoCodigo) {
      throw new Error(
        "Un descuento lleva su naturaleza (Nota 20 del Anexo 4.4): sin eso el comprobante se rechaza."
      );
    }
  }

  let movimientoId: string | undefined;
  // Se descarga inventario solo si hay presentación y no se pidió lo
  // contrario. Un servicio no descarga por sí mismo: lo hace su receta
  // de insumos, y eso es del prompt 07.
  if (que.productoId && s.presentacionId && !s.sinDescargo) {
    let bodegaId = s.bodegaId;
    if (!bodegaId && cuenta.rows[0].sesion_id) {
      const b = await db.query<{ bodega_id: string }>(
        `SELECT c.bodega_id FROM vta_sesiones_caja s
           JOIN vta_cajas c ON c.id = s.caja_id WHERE s.id = $1`,
        [cuenta.rows[0].sesion_id]
      );
      bodegaId = b.rows[0]?.bodega_id;
    }
    if (!bodegaId) {
      const b = await db.query<{ id: string }>(
        `SELECT id FROM inv_bodegas WHERE es_default AND activo LIMIT 1`
      );
      bodegaId = b.rows[0]?.id;
    }
    if (!bodegaId) throw new Error("No hay bodega de la que descontar: la caja necesita una.");

    const movimientos = await registrarMovimiento(db, tenantId, {
      tipo: "venta",
      productoId: que.productoId,
      bodegaId,
      presentacionId: s.presentacionId,
      cantidadPresentacion: s.cantidad,
      pacienteId: s.pacienteId,
      personaId: s.personaId,
    });
    movimientoId = movimientos[0]?.id;
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO vta_cargos (tenant_id, cuenta_id, origen, origen_id, presentacion_id,
                             servicio_id, descripcion, paciente_id, cantidad, precio_unitario,
                             descuento, descuento_codigo, descuento_naturaleza,
                             descuento_autorizado_por, codigo_cabys, codigo_tarifa_iva,
                             unidad_medida, linea_negocio, movimiento_id, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING id`,
    [
      tenantId, s.cuentaId, s.origen, s.origenId ?? null, s.presentacionId ?? null,
      s.servicioId ?? null, que.descripcion, s.pacienteId ?? null, s.cantidad, que.precio,
      descuento, s.descuentoCodigo ?? null, s.descuentoNaturaleza ?? null,
      s.descuentoAutorizadoPor ?? null, que.cabys, que.tarifa, que.unidad, que.linea,
      movimientoId ?? null, s.personaId ?? null,
    ]
  );

  return { id: r.rows[0].id, descripcion: que.descripcion, total: bruto - descuento, movimientoId };
}

export interface TotalCuenta {
  neto: number;
  descuentos: number;
  impuesto: number;
  total: number;
  cobrado: number;
  saldo: number;
}

/**
 * El total de una cuenta, calculado de sus cargos.
 *
 * Es una **estimación de referencia para la pantalla**: el total que
 * manda es el que calcula el motor del facturador al emitir, con las
 * reglas del Anexo. Acá se usa la tarifa de cada línea para que el
 * cajero vea un número correcto mientras arma la cuenta.
 */
export async function totalDeCuenta(db: PoolClient, cuentaId: string): Promise<TotalCuenta> {
  const r = await db.query<{
    neto: string;
    descuentos: string;
    impuesto: string;
  }>(
    `SELECT COALESCE(sum(c.cantidad * c.precio_unitario - c.descuento), 0)::text AS neto,
            COALESCE(sum(c.descuento), 0)::text AS descuentos,
            COALESCE(sum((c.cantidad * c.precio_unitario - c.descuento)
                         * COALESCE(t.tarifa, 0) / 100), 0)::text AS impuesto
       FROM vta_cargos c
       LEFT JOIN fact_cat_tarifa_iva t ON t.codigo = c.codigo_tarifa_iva
      WHERE c.cuenta_id = $1 AND c.anulado_en IS NULL`,
    [cuentaId]
  );
  const cob = await db.query<{ total: string }>(
    `SELECT COALESCE(sum(total), 0)::text AS total FROM vta_cobros
      WHERE cuenta_id = $1 AND estado = 'aplicado'`,
    [cuentaId]
  );

  const neto = Number(r.rows[0].neto);
  const impuesto = Math.round(Number(r.rows[0].impuesto) * 100) / 100;
  const total = Math.round((neto + impuesto) * 100) / 100;
  const cobrado = Number(cob.rows[0].total);

  return {
    neto,
    descuentos: Number(r.rows[0].descuentos),
    impuesto,
    total,
    cobrado,
    saldo: Math.round((total - cobrado) * 100) / 100,
  };
}

/**
 * Los cargos de una cuenta convertidos en líneas del documento de
 * venta del facturador.
 *
 * La conversión vive acá y no en la ruta: es la traducción entre el
 * vocabulario de caja (cargo) y el del facturador (línea), y tiene que
 * ser una sola.
 */
export async function lineasParaFacturar(db: PoolClient, cuentaId: string) {
  const r = await db.query<{
    descripcion: string;
    cantidad: string;
    precio_unitario: string;
    descuento: string;
    descuento_codigo: string | null;
    descuento_naturaleza: string | null;
    codigo_cabys: string | null;
    codigo_tarifa_iva: string | null;
    unidad_medida: string | null;
  }>(
    `SELECT descripcion, cantidad, precio_unitario, descuento, descuento_codigo,
            descuento_naturaleza, codigo_cabys, codigo_tarifa_iva, unidad_medida
       FROM vta_cargos WHERE cuenta_id = $1 AND anulado_en IS NULL
      ORDER BY creado_en`,
    [cuentaId]
  );

  return r.rows.map((c) => ({
    codigoCabys: c.codigo_cabys ?? undefined,
    cantidad: c.cantidad,
    unidadMedida: c.unidad_medida ?? "Unid",
    detalle: c.descripcion,
    precioUnitario: c.precio_unitario,
    descuentos:
      Number(c.descuento) > 0
        ? [
            {
              monto: c.descuento,
              codigoDescuento: c.descuento_codigo ?? "99",
              naturaleza: c.descuento_naturaleza ?? undefined,
            },
          ]
        : undefined,
    // Sin tarifa declarada se usa la general: una línea sin impuesto
    // declarado hace que Hacienda rechace el comprobante, y "no declaré
    // nada" no es lo mismo que "no cobré IVA".
    impuestos: [{ codigo: "01", codigoTarifaIva: c.codigo_tarifa_iva ?? "08" }],
  }));
}
