import { PoolClient } from "pg";
import { emitirNota } from "../facturacion/notas";
import { registrarMovimiento } from "../inventario/movimientos";

// ---------------------------------------------------------------------
// APROBACIONES: anular un cobro, anular un comprobante, devolver
// producto, pasarse del crédito o del descuento, y cerrar con
// diferencia.
//
// UNA tabla y un solo flujo para las seis. Las seis tienen los mismos
// campos —quién pide, qué, por qué, quién resuelve, cuándo— y seis
// tablas iguales serían seis pantallas de aprobación que divergen.
//
// **Nada se aplica al pedirlo.** El cajero solicita; un administrador
// resuelve; recién ahí pasa algo. Aplicar primero y revertir si no se
// aprueba dejaría una nota de crédito emitida por una anulación que
// después se rechaza, y una nota de crédito no se deshace.
//
// La anulación de un comprobante SIEMPRE es una nota de crédito por el
// facturador: un comprobante aceptado por Hacienda no se borra (regla
// 1 de la migración 091).
// ---------------------------------------------------------------------

export type TipoAprobacion =
  | "anular_cobro"
  | "anular_comprobante"
  | "devolucion"
  | "exceso_credito"
  | "descuento"
  | "diferencia_arqueo";

export interface SolicitudAprobacion {
  tipo: TipoAprobacion;
  referenciaId?: string;
  monto?: number;
  motivo: string;
  solicitadaPor?: string;
}

export async function solicitarAprobacion(
  db: PoolClient,
  tenantId: string,
  s: SolicitudAprobacion
): Promise<{ id: string }> {
  if (!s.motivo?.trim()) {
    throw new Error("Una solicitud de aprobación lleva motivo: sin eso nadie puede resolverla.");
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO vta_aprobaciones (tenant_id, tipo, referencia_id, monto, motivo, solicitada_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tenantId, s.tipo, s.referenciaId ?? null, s.monto ?? null, s.motivo.trim(), s.solicitadaPor ?? null]
  );
  return { id: r.rows[0].id };
}

export interface ResultadoResolucion {
  aplicada: boolean;
  /** Lo que haya producido la aplicación: una nota, un movimiento… */
  detalle?: Record<string, unknown>;
}

/**
 * Resuelve una solicitud. Si se aprueba, **acá se aplica el efecto**:
 * no hay un segundo paso que alguien pueda olvidar.
 */
export async function resolverAprobacion(
  db: PoolClient,
  tenantId: string,
  aprobacionId: string,
  datos: { aprobar: boolean; resueltaPor: string; nota?: string }
): Promise<ResultadoResolucion> {
  const a = await db.query<{
    tipo: TipoAprobacion;
    estado: string;
    referencia_id: string | null;
    motivo: string;
    solicitada_por: string | null;
  }>(
    `SELECT tipo, estado, referencia_id, motivo, solicitada_por
       FROM vta_aprobaciones WHERE id = $1 FOR UPDATE`,
    [aprobacionId]
  );
  if (a.rows.length === 0) throw new Error(`No existe la solicitud ${aprobacionId}.`);
  if (a.rows[0].estado !== "pendiente") {
    throw new Error(`Esa solicitud ya está "${a.rows[0].estado}".`);
  }

  // Quien pide no aprueba. Es el control entero: sin esto, "pedir
  // autorización" sería apretar dos botones.
  if (a.rows[0].solicitada_por && a.rows[0].solicitada_por === datos.resueltaPor) {
    throw new Error(
      "No se puede aprobar la propia solicitud. Tiene que resolverla otra persona con permiso de administrador."
    );
  }

  await db.query(
    `UPDATE vta_aprobaciones
        SET estado = $2, resuelta_por = $3, resuelta_en = now(), nota_resolucion = $4
      WHERE id = $1`,
    [aprobacionId, datos.aprobar ? "aprobada" : "rechazada", datos.resueltaPor, datos.nota ?? null]
  );

  if (!datos.aprobar) return { aplicada: false };

  const ref = a.rows[0].referencia_id;
  switch (a.rows[0].tipo) {
    case "anular_cobro":
      return { aplicada: true, detalle: await anularCobro(db, tenantId, ref!, a.rows[0].motivo) };
    case "anular_comprobante":
      return {
        aplicada: true,
        detalle: await anularComprobante(tenantId, ref!, a.rows[0].motivo),
      };
    case "devolucion":
      return { aplicada: true, detalle: await devolverCargo(db, tenantId, ref!, a.rows[0].motivo) };
    default:
      // `exceso_credito`, `descuento` y `diferencia_arqueo` no tienen
      // efecto propio: son el permiso que quien pidió vuelve a usar.
      return { aplicada: true };
  }
}

/**
 * Anula un cobro: lo marca anulado y, si tenía comprobante, emite la
 * nota de crédito.
 *
 * El dinero NO se devuelve solo: eso lo hace el cajero por el medio
 * que corresponda y queda en el arqueo. Un sistema que "devuelve" por
 * su cuenta estaría inventando un movimiento de efectivo que nadie
 * hizo.
 */
async function anularCobro(
  db: PoolClient,
  tenantId: string,
  cobroId: string,
  motivo: string
): Promise<Record<string, unknown>> {
  const c = await db.query<{ estado: string; comprobante_id: string | null; cuenta_id: string | null }>(
    `SELECT estado, comprobante_id, cuenta_id FROM vta_cobros WHERE id = $1`,
    [cobroId]
  );
  if (c.rows.length === 0) throw new Error(`No existe el cobro ${cobroId}.`);
  if (c.rows[0].estado === "anulado") throw new Error("Ese cobro ya está anulado.");

  await db.query(
    `UPDATE vta_cobros SET estado = 'anulado', anulado_en = now() WHERE id = $1`,
    [cobroId]
  );
  // La cuenta vuelve a estar abierta: queda saldo por cobrar.
  if (c.rows[0].cuenta_id) {
    await db.query(
      `UPDATE vta_cuentas SET estado = 'abierta', cerrada_en = NULL
        WHERE id = $1 AND estado = 'cobrada'`,
      [c.rows[0].cuenta_id]
    );
  }

  if (!c.rows[0].comprobante_id) return { cobroAnulado: cobroId, nota: null };

  const nota = await emitirNota(tenantId, c.rows[0].comprobante_id, {
    tipo: "credito",
    // Nota 9, código 01: anula el documento de referencia.
    codigoReferencia: "01",
    razon: `Anulación del cobro: ${motivo}`.slice(0, 180),
  });
  return { cobroAnulado: cobroId, nota: nota.consecutivo, notaEstado: nota.estado };
}

/** Anula solo el comprobante, sin tocar el cobro. */
async function anularComprobante(
  tenantId: string,
  comprobanteId: string,
  motivo: string
): Promise<Record<string, unknown>> {
  const nota = await emitirNota(tenantId, comprobanteId, {
    tipo: "credito",
    codigoReferencia: "01",
    razon: motivo.slice(0, 180),
  });
  return { nota: nota.consecutivo, notaEstado: nota.estado };
}

/**
 * Devuelve el producto de un cargo: vuelve a su lote por el punto
 * único de movimientos.
 *
 * Vuelve **al lote del que salió**, no a uno nuevo: es el mismo
 * producto físico, con su mismo vencimiento y su mismo costo.
 */
async function devolverCargo(
  db: PoolClient,
  tenantId: string,
  cargoId: string,
  motivo: string
): Promise<Record<string, unknown>> {
  const c = await db.query<{
    movimiento_id: string | null;
    presentacion_id: string | null;
    cantidad: string;
    anulado_en: Date | null;
    descripcion: string;
  }>(
    `SELECT movimiento_id, presentacion_id, cantidad, anulado_en, descripcion
       FROM vta_cargos WHERE id = $1`,
    [cargoId]
  );
  if (c.rows.length === 0) throw new Error(`No existe el cargo ${cargoId}.`);
  if (c.rows[0].anulado_en) throw new Error("Ese cargo ya fue devuelto.");

  await db.query(`UPDATE vta_cargos SET anulado_en = now() WHERE id = $1`, [cargoId]);

  if (!c.rows[0].movimiento_id) {
    // Un servicio o un cargo manual no descargó inventario: no hay nada
    // que devolver al estante.
    return { cargoAnulado: cargoId, movimiento: null };
  }

  const m = await db.query<{
    producto_id: string;
    bodega_id: string;
    lote_id: string | null;
    numero: string | null;
    cantidad_base: string;
  }>(
    `SELECT m.producto_id, m.bodega_id, m.lote_id, l.numero, m.cantidad_base
       FROM inv_movimientos m LEFT JOIN inv_lotes l ON l.id = m.lote_id
      WHERE m.id = $1`,
    [c.rows[0].movimiento_id]
  );
  if (m.rows.length === 0 || !m.rows[0].numero) {
    throw new Error("No se pudo encontrar el lote del que salió el producto.");
  }

  const devuelto = await registrarMovimiento(db, tenantId, {
    tipo: "devolucion_cliente",
    productoId: m.rows[0].producto_id,
    bodegaId: m.rows[0].bodega_id,
    cantidadBase: m.rows[0].cantidad_base,
    lote: { numero: m.rows[0].numero },
    motivoDetalle: `Devolución de "${c.rows[0].descripcion}": ${motivo}`.slice(0, 200),
  });

  return { cargoAnulado: cargoId, movimiento: devuelto[0]?.id, lote: m.rows[0].numero };
}

export async function aprobacionesPendientes(db: PoolClient) {
  const r = await db.query(
    `SELECT a.*, ps.nombre AS solicitada_por_nombre, pr.nombre AS resuelta_por_nombre
       FROM vta_aprobaciones a
       LEFT JOIN personas ps ON ps.id = a.solicitada_por
       LEFT JOIN personas pr ON pr.id = a.resuelta_por
      ORDER BY (a.estado = 'pendiente') DESC, a.solicitada_en DESC
      LIMIT 200`
  );
  return r.rows;
}
