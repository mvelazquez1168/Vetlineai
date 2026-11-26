import { PoolClient } from "pg";
import { registrarMovimiento } from "./movimientos";

// ---------------------------------------------------------------------
// COMPRAS: la orden sugerida y la recepción.
//
// LA ORDEN SUGERIDA es la parte que hay que poder explicar. Una
// cantidad que aparece sin justificación no la aprueba nadie, así que
// cada línea guarda su explicación en palabras ("consumo de 46
// tabletas al mes, entrega en 3 días").
//
// La fórmula, y por qué cada término:
//
//     objetivo  = consumo_diario × (dias_entrega + dias_seguridad)
//                 + punto_reorden
//     a_pedir   = objetivo − existencia_actual
//
//   * `consumo_diario` sale del consumo REAL de los últimos 90 días
//     —los movimientos de salida— y no de una estimación: el dato está.
//   * `dias_entrega` es del proveedor: hay que cubrir el tiempo en que
//     el pedido está en camino, o se agota antes de que llegue.
//   * `dias_seguridad` es el colchón configurable de la clínica.
//   * `punto_reorden` se SUMA y no se usa como piso: es el nivel al que
//     se quiere volver a estar, no el mínimo tolerable.
//
// Después se redondea HACIA ARRIBA a presentaciones de compra enteras:
// no se le puede pedir media caja a un proveedor.
// ---------------------------------------------------------------------

const DIAS_DE_HISTORIA = 90;

export interface LineaSugerida {
  productoId: string;
  productoNombre: string;
  presentacionId: string;
  presentacionNombre: string;
  factor: number;
  existencia: number;
  consumoDiario: number;
  cantidadPedida: number;
  cantidadBase: number;
  costoUnitario: number;
  explicacion: string;
}

/**
 * Qué conviene pedirle a un proveedor hoy.
 *
 * No crea nada: devuelve la propuesta para que alguien la mire. La
 * orden se crea con `crearOrden`.
 */
export async function sugerirOrden(
  db: PoolClient,
  tenantId: string,
  proveedorId: string
): Promise<LineaSugerida[]> {
  const prov = await db.query<{ dias_entrega: number; nombre: string }>(
    `SELECT dias_entrega, nombre FROM inv_proveedores WHERE id = $1 AND activo`,
    [proveedorId]
  );
  if (prov.rows.length === 0) throw new Error(`No existe el proveedor ${proveedorId} o está inactivo.`);
  const diasEntrega = prov.rows[0].dias_entrega;

  const par = await db.query<{ dias_stock_seguridad: number }>(
    `SELECT dias_stock_seguridad FROM inv_parametros WHERE tenant_id = $1`,
    [tenantId]
  );
  const diasSeguridad = par.rows.length > 0 ? par.rows[0].dias_stock_seguridad : 7;

  const candidatos = await db.query<{
    producto_id: string;
    producto: string;
    unidad_base: string;
    punto_reorden: string;
    existencia: string;
    presentacion_id: string;
    presentacion: string;
    factor: string;
    ultimo_costo: string | null;
    consumo: string;
  }>(
    `SELECT p.id AS producto_id, p.nombre AS producto, p.unidad_base, p.punto_reorden,
            COALESCE((SELECT sum(l.cantidad) FROM inv_lotes l WHERE l.producto_id = p.id), 0)::text
              AS existencia,
            pp.presentacion_compra_id AS presentacion_id,
            pres.nombre AS presentacion, pres.factor, pp.ultimo_costo::text,
            COALESCE((
              SELECT sum(m.cantidad_base)
                FROM inv_movimientos m
                JOIN inv_tipos_movimiento t ON t.codigo = m.tipo
               WHERE m.producto_id = p.id
                 AND t.direccion = 'salida'
                 AND m.creado_en >= now() - ($2 || ' days')::interval
            ), 0)::text AS consumo
       FROM inv_proveedor_productos pp
       JOIN inv_productos p ON p.id = pp.producto_id
       JOIN inv_presentaciones pres ON pres.id = pp.presentacion_compra_id
      WHERE pp.proveedor_id = $1 AND p.activo AND pres.activo
      ORDER BY p.nombre`,
    [proveedorId, DIAS_DE_HISTORIA]
  );

  const lineas: LineaSugerida[] = [];
  for (const c of candidatos.rows) {
    const existencia = Number(c.existencia);
    const consumoDiario = Number(c.consumo) / DIAS_DE_HISTORIA;
    const puntoReorden = Number(c.punto_reorden);
    const factor = Number(c.factor);

    const objetivo = consumoDiario * (diasEntrega + diasSeguridad) + puntoReorden;
    const faltante = objetivo - existencia;
    if (faltante <= 0) continue;

    // Hacia arriba: no se pide media caja.
    const cantidadPedida = Math.ceil(faltante / factor);

    const consumoMensual = Math.round(consumoDiario * 30 * 10) / 10;
    lineas.push({
      productoId: c.producto_id,
      productoNombre: c.producto,
      presentacionId: c.presentacion_id,
      presentacionNombre: c.presentacion,
      factor,
      existencia,
      consumoDiario,
      cantidadPedida,
      cantidadBase: cantidadPedida * factor,
      costoUnitario: Number(c.ultimo_costo ?? 0),
      explicacion:
        `Consumo de ${consumoMensual} ${c.unidad_base} al mes, entrega en ${diasEntrega} días, ` +
        `${diasSeguridad} días de seguridad y punto de reorden ${puntoReorden}. ` +
        `Hay ${existencia}; para llegar a ${Math.round(objetivo)} faltan ${Math.ceil(faltante)}, ` +
        `que son ${cantidadPedida} × ${c.presentacion}.`,
    });
  }

  return lineas;
}

export interface LineaOrden {
  productoId: string;
  presentacionId: string;
  cantidadPedida: string | number;
  costoUnitario?: string | number;
  explicacion?: string;
}

export async function crearOrden(
  db: PoolClient,
  tenantId: string,
  datos: {
    proveedorId: string;
    bodegaId: string;
    lineas: LineaOrden[];
    estado?: "sugerida" | "aprobada";
    creadoPor?: string;
  }
): Promise<{ id: string; numero: number }> {
  if (datos.lineas.length === 0) throw new Error("Una orden sin líneas no pide nada.");

  // El número es consecutivo POR CLÍNICA, y dos órdenes creadas a la
  // vez leerían el mismo máximo y chocarían contra el UNIQUE.
  //
  // Se serializa con un LOCK DE TRANSACCIÓN y no con `FOR UPDATE`
  // sobre el `max()`: Postgres no admite `FOR UPDATE` junto a una
  // función de agregado ("FOR UPDATE is not allowed with aggregate
  // functions"), y bloquear la última fila tampoco serviría cuando la
  // clínica todavía no tiene ninguna orden. El lock se libera solo al
  // COMMIT y es por clínica, así que dos clínicas no se estorban.
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':inv_orden_compra'))`, [tenantId]);

  const ultimo = await db.query<{ numero: number }>(
    `SELECT COALESCE(max(numero), 0) AS numero FROM inv_ordenes_compra WHERE tenant_id = $1`,
    [tenantId]
  );
  const numero = Number(ultimo.rows[0].numero) + 1;

  const o = await db.query<{ id: string }>(
    `INSERT INTO inv_ordenes_compra (tenant_id, numero, proveedor_id, bodega_id, estado, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tenantId, numero, datos.proveedorId, datos.bodegaId, datos.estado ?? "sugerida", datos.creadoPor ?? null]
  );

  for (const l of datos.lineas) {
    await db.query(
      `INSERT INTO inv_orden_compra_lineas (tenant_id, orden_id, producto_id, presentacion_id,
                                            cantidad_pedida, costo_unitario, explicacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, o.rows[0].id, l.productoId, l.presentacionId, l.cantidadPedida, l.costoUnitario ?? 0, l.explicacion ?? null]
    );
  }

  return { id: o.rows[0].id, numero };
}

export interface LineaRecepcion {
  lineaId: string;
  /** Cuántas unidades DE LA PRESENTACIÓN DE COMPRA llegaron. */
  cantidadRecibida: string | number;
  lote: { numero: string; vencimiento?: string | null };
  /** El costo real de esta recepción. Una bonificación lo baja. */
  costoUnitario?: string | number;
}

export interface ResultadoRecepcion {
  estado: string;
  /** Líneas donde lo recibido no coincide con lo pedido. */
  diferencias: Array<{
    producto: string;
    pedidoBase: number;
    recibidoBase: number;
    faltanBase: number;
  }>;
}

/**
 * Recibe una orden, total o parcialmente.
 *
 * Cada línea recibida genera un movimiento de COMPRA por el punto
 * único: la recepción no toca el stock por su cuenta.
 *
 * El estado de la orden lo decide la comparación entre lo pedido y lo
 * recibido ACUMULADO, no esta recepción sola: dos recepciones parciales
 * que completan la orden la dejan `recibida`.
 */
export async function recibirOrden(
  db: PoolClient,
  tenantId: string,
  ordenId: string,
  datos: { lineas: LineaRecepcion[]; facturaProveedor?: string; personaId?: string }
): Promise<ResultadoRecepcion> {
  const o = await db.query<{ estado: string; bodega_id: string; proveedor_id: string }>(
    `SELECT estado, bodega_id, proveedor_id FROM inv_ordenes_compra WHERE id = $1`,
    [ordenId]
  );
  if (o.rows.length === 0) throw new Error(`No existe la orden ${ordenId}.`);
  if (["recibida", "cancelada"].includes(o.rows[0].estado)) {
    throw new Error(`La orden está "${o.rows[0].estado}": no admite más recepciones.`);
  }

  for (const r of datos.lineas) {
    const l = await db.query<{
      producto_id: string;
      presentacion_id: string;
      factor: string;
      cantidad_pedida: string;
      cantidad_recibida_base: string;
    }>(
      `SELECT ol.producto_id, ol.presentacion_id, pres.factor,
              ol.cantidad_pedida, ol.cantidad_recibida_base
         FROM inv_orden_compra_lineas ol
         JOIN inv_presentaciones pres ON pres.id = ol.presentacion_id
        WHERE ol.id = $1 AND ol.orden_id = $2`,
      [r.lineaId, ordenId]
    );
    if (l.rows.length === 0) throw new Error(`La línea ${r.lineaId} no es de esta orden.`);

    const cantidad = Number(String(r.cantidadRecibida).replace(",", "."));
    if (cantidad <= 0) continue;

    await registrarMovimiento(db, tenantId, {
      tipo: "compra",
      productoId: l.rows[0].producto_id,
      bodegaId: o.rows[0].bodega_id,
      presentacionId: l.rows[0].presentacion_id,
      cantidadPresentacion: cantidad,
      lote: {
        numero: r.lote.numero,
        vencimiento: r.lote.vencimiento ?? null,
        costoUnitario: r.costoUnitario,
      },
      personaId: datos.personaId,
      compraId: ordenId,
    });

    const base = cantidad * Number(l.rows[0].factor);
    await db.query(
      `UPDATE inv_orden_compra_lineas
          SET cantidad_recibida_base = cantidad_recibida_base + $2,
              costo_unitario = COALESCE($3, costo_unitario)
        WHERE id = $1`,
      [r.lineaId, base, r.costoUnitario ?? null]
    );

    // El último costo del proveedor se actualiza solo: es el dato que
    // la próxima orden sugerida va a usar para valorizar.
    if (r.costoUnitario !== undefined) {
      await db.query(
        `UPDATE inv_proveedor_productos
            SET ultimo_costo = $3, actualizado_en = now()
          WHERE proveedor_id = $1 AND producto_id = $2`,
        [o.rows[0].proveedor_id, l.rows[0].producto_id, r.costoUnitario]
      );
    }
  }

  const estado = await db.query<{
    producto: string;
    pedido_base: string;
    recibido_base: string;
  }>(
    `SELECT p.nombre AS producto,
            (ol.cantidad_pedida * pres.factor)::text AS pedido_base,
            ol.cantidad_recibida_base::text AS recibido_base
       FROM inv_orden_compra_lineas ol
       JOIN inv_presentaciones pres ON pres.id = ol.presentacion_id
       JOIN inv_productos p ON p.id = ol.producto_id
      WHERE ol.orden_id = $1`,
    [ordenId]
  );

  const diferencias = estado.rows
    .map((f) => ({
      producto: f.producto,
      pedidoBase: Number(f.pedido_base),
      recibidoBase: Number(f.recibido_base),
      faltanBase: Number(f.pedido_base) - Number(f.recibido_base),
    }))
    .filter((d) => d.faltanBase !== 0);

  const completa = diferencias.every((d) => d.faltanBase <= 0);
  const algoRecibido = estado.rows.some((f) => Number(f.recibido_base) > 0);
  const nuevoEstado = completa ? "recibida" : algoRecibido ? "recibida_parcial" : o.rows[0].estado;

  // `$2::varchar` explícito en los DOS usos: sin el cast, Postgres ve
  // el mismo parámetro una vez como valor de una columna varchar y una
  // vez comparado contra un literal de texto, y falla con "inconsistent
  // types deduced for parameter $2" (42P08). Es la misma ambigüedad que
  // ya apareció en `fijarEstadoModulo` y en los estados de agentes por
  // país.
  await db.query(
    `UPDATE inv_ordenes_compra
        SET estado = $2::varchar,
            factura_proveedor = COALESCE($3, factura_proveedor),
            recibida_en = CASE WHEN $2::varchar = 'recibida' THEN now() ELSE recibida_en END
      WHERE id = $1`,
    [ordenId, nuevoEstado, datos.facturaProveedor ?? null]
  );

  return { estado: nuevoEstado, diferencias };
}

/**
 * Devuelve producto al proveedor. Sale por el punto único, con su
 * origen, igual que cualquier otra salida.
 */
export async function devolverAProveedor(
  db: PoolClient,
  tenantId: string,
  datos: {
    productoId: string;
    bodegaId: string;
    loteId?: string;
    cantidadBase?: string | number;
    presentacionId?: string;
    cantidadPresentacion?: string | number;
    ordenId?: string;
    motivoDetalle?: string;
    personaId?: string;
  }
) {
  return registrarMovimiento(db, tenantId, {
    tipo: "devolucion_proveedor",
    productoId: datos.productoId,
    bodegaId: datos.bodegaId,
    loteId: datos.loteId,
    cantidadBase: datos.cantidadBase,
    presentacionId: datos.presentacionId,
    cantidadPresentacion: datos.cantidadPresentacion,
    compraId: datos.ordenId,
    motivo: "otro",
    motivoDetalle: datos.motivoDetalle ?? "Devolución al proveedor",
    personaId: datos.personaId,
  });
}
