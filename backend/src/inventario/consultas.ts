import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// Las LECTURAS del inventario: existencias, kardex, trazabilidad y
// alertas.
//
// Están juntas y separadas de los módulos que escriben porque todas
// responden a la misma pregunta desde ángulos distintos —"qué hay, de
// dónde salió, a dónde fue"— y porque la forma de mostrar una
// existencia ("3 cajas y 7 tabletas") tiene que ser UNA, no una por
// pantalla.
// ---------------------------------------------------------------------

export interface ExistenciaPresentada {
  cantidadBase: number;
  unidadBase: string;
  /** "3 cajas y 7 tabletas (67 tabletas)" */
  texto: string;
}

/**
 * La existencia en la presentación natural MÁS la unidad base.
 *
 * La "presentación natural" es la de mayor factor que sirva para
 * vender: la caja antes que la tableta. Mostrar solo "67 tabletas"
 * obliga a dividir mentalmente cada vez que alguien quiere saber
 * cuántas cajas hay en el estante.
 *
 * El resto NO se redondea ni se esconde: 67 tabletas son 3 cajas y 7
 * tabletas, no "3,35 cajas" ni "3 cajas".
 */
export function presentarExistencia(
  cantidadBase: number,
  unidadBase: string,
  presentacionMayor?: { nombre: string; factor: number } | null
): ExistenciaPresentada {
  const base = `${formatearCantidad(cantidadBase)} ${unidadBase}`;
  if (!presentacionMayor || presentacionMayor.factor <= 1) {
    return { cantidadBase, unidadBase, texto: base };
  }

  const signo = cantidadBase < 0 ? -1 : 1;
  const abs = Math.abs(cantidadBase);
  const enteras = Math.floor(abs / presentacionMayor.factor);
  const resto = abs - enteras * presentacionMayor.factor;

  if (enteras === 0) return { cantidadBase, unidadBase, texto: base };

  const partes = [`${signo * enteras} ${presentacionMayor.nombre}`];
  if (resto > 0) partes.push(`${formatearCantidad(resto)} ${unidadBase}`);
  return { cantidadBase, unidadBase, texto: `${partes.join(" y ")} (${base})` };
}

/** Sin decimales cuando es entero; con los que haga falta cuando no. */
function formatearCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

export interface ExistenciaProducto {
  productoId: string;
  nombre: string;
  unidadBase: string;
  bodegaId: string;
  bodegaNombre: string;
  cantidad: number;
  presentacion: ExistenciaPresentada;
}

/** Existencia por bodega de un producto, ya presentada. */
export async function existenciasDeProducto(
  db: PoolClient,
  productoId: string
): Promise<ExistenciaProducto[]> {
  const p = await db.query<{ nombre: string; unidad_base: string }>(
    `SELECT nombre, unidad_base FROM inv_productos WHERE id = $1`,
    [productoId]
  );
  if (p.rows.length === 0) throw new Error(`No existe el producto ${productoId}.`);

  const mayor = await db.query<{ nombre: string; factor: string }>(
    `SELECT nombre, factor FROM inv_presentaciones
      WHERE producto_id = $1 AND activo AND para_venta AND factor > 1
      ORDER BY factor DESC LIMIT 1`,
    [productoId]
  );
  const presentacionMayor =
    mayor.rows.length > 0
      ? { nombre: mayor.rows[0].nombre, factor: Number(mayor.rows[0].factor) }
      : null;

  const r = await db.query<{ bodega_id: string; bodega: string; cantidad: string }>(
    `SELECT b.id AS bodega_id, b.nombre AS bodega, COALESCE(sum(l.cantidad), 0)::text AS cantidad
       FROM inv_bodegas b
       LEFT JOIN inv_lotes l ON l.bodega_id = b.id AND l.producto_id = $1
      WHERE b.activo
      GROUP BY b.id, b.nombre
      ORDER BY b.nombre`,
    [productoId]
  );

  return r.rows.map((f) => ({
    productoId,
    nombre: p.rows[0].nombre,
    unidadBase: p.rows[0].unidad_base,
    bodegaId: f.bodega_id,
    bodegaNombre: f.bodega,
    cantidad: Number(f.cantidad),
    presentacion: presentarExistencia(
      Number(f.cantidad),
      p.rows[0].unidad_base,
      presentacionMayor
    ),
  }));
}

/**
 * El consumo del período, desglosado POR ORIGEN, con drill-down a los
 * pacientes.
 *
 * Es la sección 4.5 de la guía rectora, literal: los movimientos
 * ligados a paciente se listan con su paciente y su atención; los que
 * NO tienen paciente **aparecen como su propio grupo con su origen**
 * ("Venta de mostrador", "Consumo interno", "Merma"), nunca escondidos
 * ni repartidos entre los demás.
 *
 * Que un movimiento no tenga paciente es normal, no un dato faltante.
 */
export interface ConsumoPorOrigen {
  tipo: string;
  tipoNombre: string;
  cantidad: number;
  movimientos: number;
  /** Los pacientes, cuando el movimiento los tiene. Vacío si no. */
  pacientes: Array<{
    pacienteId: string;
    nombre: string;
    atencionId: string | null;
    cantidad: number;
  }>;
}

export async function consumoDeProducto(
  db: PoolClient,
  productoId: string,
  desde: string,
  hasta: string
): Promise<ConsumoPorOrigen[]> {
  const grupos = await db.query<{
    tipo: string;
    tipo_nombre: string;
    cantidad: string;
    movimientos: string;
  }>(
    `SELECT m.tipo, t.nombre AS tipo_nombre,
            sum(m.cantidad_base)::text AS cantidad,
            count(*)::text AS movimientos
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento t ON t.codigo = m.tipo
      WHERE m.producto_id = $1
        AND t.direccion = 'salida'
        AND m.creado_en >= $2::date
        AND m.creado_en < ($3::date + interval '1 day')
      GROUP BY m.tipo, t.nombre, t.orden
      ORDER BY t.orden`,
    [productoId, desde, hasta]
  );

  const pacientes = await db.query<{
    tipo: string;
    paciente_id: string;
    nombre: string;
    atencion_id: string | null;
    cantidad: string;
  }>(
    `SELECT m.tipo, m.paciente_id, p.nombre, m.atencion_id,
            sum(m.cantidad_base)::text AS cantidad
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento t ON t.codigo = m.tipo
       JOIN pacientes p ON p.id = m.paciente_id
      WHERE m.producto_id = $1
        AND t.direccion = 'salida'
        AND m.paciente_id IS NOT NULL
        AND m.creado_en >= $2::date
        AND m.creado_en < ($3::date + interval '1 day')
      GROUP BY m.tipo, m.paciente_id, p.nombre, m.atencion_id
      ORDER BY p.nombre`,
    [productoId, desde, hasta]
  );

  return grupos.rows.map((g) => ({
    tipo: g.tipo,
    tipoNombre: g.tipo_nombre,
    cantidad: Number(g.cantidad),
    movimientos: Number(g.movimientos),
    pacientes: pacientes.rows
      .filter((p) => p.tipo === g.tipo)
      .map((p) => ({
        pacienteId: p.paciente_id,
        nombre: p.nombre,
        atencionId: p.atencion_id,
        cantidad: Number(p.cantidad),
      })),
  }));
}

/** El kardex de un producto: la historia, con filtros. */
export async function kardexDeProducto(
  db: PoolClient,
  productoId: string,
  filtros: { desde?: string; hasta?: string; tipo?: string; bodegaId?: string } = {}
) {
  const condiciones = ["m.producto_id = $1"];
  const valores: unknown[] = [productoId];
  const agregar = (sql: string, valor: unknown) => {
    valores.push(valor);
    condiciones.push(sql.replace("$?", `$${valores.length}`));
  };
  if (filtros.desde) agregar("m.creado_en >= $?::date", filtros.desde);
  if (filtros.hasta) agregar("m.creado_en < ($?::date + interval '1 day')", filtros.hasta);
  if (filtros.tipo) agregar("m.tipo = $?", filtros.tipo);
  if (filtros.bodegaId) agregar("m.bodega_id = $?", filtros.bodegaId);

  const r = await db.query(
    `SELECT m.id, m.tipo, t.nombre AS tipo_nombre, t.direccion,
            m.cantidad_base, m.costo_unitario, m.creado_en,
            b.nombre AS bodega, l.numero AS lote,
            pr.nombre AS presentacion, m.cantidad_presentacion,
            mo.nombre AS motivo, m.motivo_detalle,
            per.nombre AS persona, pa.nombre AS paciente, m.atencion_id
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento t ON t.codigo = m.tipo
       JOIN inv_bodegas b ON b.id = m.bodega_id
       LEFT JOIN inv_lotes l ON l.id = m.lote_id
       LEFT JOIN inv_presentaciones pr ON pr.id = m.presentacion_id
       LEFT JOIN inv_motivos mo ON mo.codigo = m.motivo
       LEFT JOIN personas per ON per.id = m.persona_id
       LEFT JOIN pacientes pa ON pa.id = m.paciente_id
      WHERE ${condiciones.join(" AND ")}
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT 500`,
    valores
  );
  return r.rows;
}

// ---------------------------------------------------------------------
// ALERTAS
//
// Las seis que pide el prompt, en UNA consulta por tipo y no una
// pantalla que las calcule: el dashboard, el correo y la pantalla
// tienen que ver lo mismo.
// ---------------------------------------------------------------------
export interface Alertas {
  bajoMinimo: Array<Record<string, unknown>>;
  enPuntoReorden: Array<Record<string, unknown>>;
  porVencer30: Array<Record<string, unknown>>;
  porVencer60: Array<Record<string, unknown>>;
  porVencer90: Array<Record<string, unknown>>;
  envasesAbiertosVencidos: Array<Record<string, unknown>>;
  lotesVencidosConExistencia: Array<Record<string, unknown>>;
}

export async function alertasDeInventario(db: PoolClient): Promise<Alertas> {
  // Existencia total por producto, una sola vez: las dos primeras
  // alertas la necesitan y calcularla dos veces daría dos números si
  // alguien cambia una y no la otra.
  const stock = await db.query<{
    id: string;
    nombre: string;
    unidad_base: string;
    existencia: string;
    minimo: string;
    punto_reorden: string;
  }>(
    `SELECT p.id, p.nombre, p.unidad_base, p.minimo, p.punto_reorden,
            COALESCE(sum(l.cantidad), 0)::text AS existencia
       FROM inv_productos p
       LEFT JOIN inv_lotes l ON l.producto_id = p.id
      WHERE p.activo
      GROUP BY p.id
      ORDER BY p.nombre`
  );

  const porVencer = async (dias: number) =>
    (
      await db.query(
        `SELECT l.id, l.numero, l.vencimiento_efectivo, l.cantidad, p.nombre AS producto,
                p.unidad_base, b.nombre AS bodega
           FROM inv_lotes l
           JOIN inv_productos p ON p.id = l.producto_id
           JOIN inv_bodegas b ON b.id = l.bodega_id
          WHERE l.cantidad > 0
            AND l.vencimiento_efectivo IS NOT NULL
            AND l.vencimiento_efectivo >= CURRENT_DATE
            AND l.vencimiento_efectivo <= CURRENT_DATE + ($1 || ' days')::interval
          ORDER BY l.vencimiento_efectivo`,
        [dias]
      )
    ).rows;

  const envasesAbiertosVencidos = (
    await db.query(
      `SELECT l.id, l.numero, l.fecha_apertura, l.vencimiento_apertura, l.cantidad,
              p.nombre AS producto, b.nombre AS bodega
         FROM inv_lotes l
         JOIN inv_productos p ON p.id = l.producto_id
         JOIN inv_bodegas b ON b.id = l.bodega_id
        WHERE l.cantidad > 0
          AND l.vencimiento_apertura IS NOT NULL
          AND l.vencimiento_apertura < CURRENT_DATE
        ORDER BY l.vencimiento_apertura`
    )
  ).rows;

  const lotesVencidosConExistencia = (
    await db.query(
      `SELECT l.id, l.numero, l.vencimiento_efectivo, l.cantidad,
              p.nombre AS producto, b.nombre AS bodega
         FROM inv_lotes l
         JOIN inv_productos p ON p.id = l.producto_id
         JOIN inv_bodegas b ON b.id = l.bodega_id
        WHERE l.cantidad > 0
          AND l.vencimiento_efectivo IS NOT NULL
          AND l.vencimiento_efectivo < CURRENT_DATE
        ORDER BY l.vencimiento_efectivo`
    )
  ).rows;

  return {
    bajoMinimo: stock.rows.filter((p) => Number(p.existencia) < Number(p.minimo)),
    // "En punto de reorden" es distinto de "bajo mínimo": el reorden es
    // el aviso de que hay que pedir; el mínimo, el de que ya es tarde.
    // Un producto bajo el mínimo no se repite acá.
    enPuntoReorden: stock.rows.filter(
      (p) =>
        Number(p.existencia) >= Number(p.minimo) &&
        Number(p.existencia) <= Number(p.punto_reorden) &&
        Number(p.punto_reorden) > 0
    ),
    porVencer30: await porVencer(30),
    porVencer60: await porVencer(60),
    porVencer90: await porVencer(90),
    envasesAbiertosVencidos,
    lotesVencidosConExistencia,
  };
}
