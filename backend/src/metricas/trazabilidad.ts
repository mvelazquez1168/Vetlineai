import { PoolClient } from "pg";
import { Periodo } from "./diccionario";

// ---------------------------------------------------------------------
// §6 — TRAZABILIDAD DE PRODUCTOS.
//
// Dos preguntas, y las dos se contestan acá:
//
//   1. «¿en qué se me fue este producto?» → consumo por origen;
//   2. «el fabricante retiró el lote X, ¿a quién se lo pusimos?» →
//      trazabilidad por lote, con el contacto del cliente.
//
// LA REGLA QUE ORDENA TODO: los movimientos SIN paciente —venta de
// mostrador, consumo interno, merma— **no se esconden ni se reparten**.
// Son su propio grupo, con su origen escrito. Repartirlos entre los
// pacientes sería inventar que a alguien se le aplicó algo, y esconderlos
// haría que el consumo no sume lo que salió de la bodega.
// ---------------------------------------------------------------------

export interface ConsumoDeProducto {
  productoId: string;
  producto: string;
  unidadBase: string;
  /** La presentación principal, para expresar el consumo como se compra. */
  presentacion: { nombre: string; factor: number } | null;
  totalBase: number;
  totalPresentacion: number | null;
  porOrigen: Array<{
    origen: string;
    nombre: string;
    conPaciente: boolean;
    cantidadBase: number;
    movimientos: number;
  }>;
  tendencia: Array<{ fecha: string; cantidadBase: number }>;
  /** Solo los movimientos ligados a un paciente (§6.3). */
  pacientes: Array<{
    pacienteId: string;
    paciente: string;
    cliente: string | null;
    fecha: string;
    cantidadBase: number;
    lote: string | null;
    atencionId: string | null;
  }>;
}

export async function consumoDeProducto(
  db: PoolClient,
  tenantId: string,
  productoId: string,
  p: Periodo
): Promise<ConsumoDeProducto> {
  const prod = await db.query<{ id: string; nombre: string; unidad_base: string }>(
    `SELECT id, nombre, unidad_base FROM inv_productos
      WHERE id = $1 AND tenant_id = $2`,
    [productoId, tenantId]
  );
  if (prod.rows.length === 0) throw new Error("Ese producto no existe.");

  const pres = await db.query<{ nombre: string; factor: string }>(
    `SELECT nombre, factor::text FROM inv_presentaciones
      WHERE producto_id = $1 AND tenant_id = $2 AND activo AND para_venta
      ORDER BY factor DESC LIMIT 1`,
    [productoId, tenantId]
  );

  // El consumo es LA SALIDA: las entradas son compras, no consumo.
  const porOrigen = await db.query<{
    origen: string;
    nombre: string;
    con_paciente: boolean;
    cantidad: string;
    movimientos: number;
  }>(
    `SELECT m.tipo AS origen, tm.nombre,
            count(*) FILTER (WHERE m.paciente_id IS NOT NULL) > 0 AS con_paciente,
            sum(m.cantidad_base)::numeric(14,4)::text AS cantidad,
            count(*)::int AS movimientos
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento tm ON tm.codigo = m.tipo
      WHERE m.tenant_id = $1 AND m.producto_id = $2
        AND tm.direccion = 'salida'
        AND m.creado_en::date BETWEEN $3::date AND $4::date
      GROUP BY 1, 2 ORDER BY 4 DESC`,
    [tenantId, productoId, p.desde, p.hasta]
  );

  const tendencia = await db.query<{ fecha: string; cantidad: string }>(
    `SELECT date_trunc('week', m.creado_en)::date::text AS fecha,
            sum(m.cantidad_base)::numeric(14,4)::text AS cantidad
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento tm ON tm.codigo = m.tipo
      WHERE m.tenant_id = $1 AND m.producto_id = $2
        AND tm.direccion = 'salida'
        AND m.creado_en::date BETWEEN $3::date AND $4::date
      GROUP BY 1 ORDER BY 1`,
    [tenantId, productoId, p.desde, p.hasta]
  );

  const pacientes = await db.query<{
    paciente_id: string;
    paciente: string;
    cliente: string | null;
    fecha: string;
    cantidad: string;
    lote: string | null;
    atencion_id: string | null;
  }>(
    `SELECT pa.id AS paciente_id, pa.nombre AS paciente, pr.nombre AS cliente,
            m.creado_en::date::text AS fecha,
            m.cantidad_base::numeric(14,4)::text AS cantidad,
            l.numero AS lote, m.atencion_id
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento tm ON tm.codigo = m.tipo
       JOIN pacientes pa ON pa.id = m.paciente_id
       LEFT JOIN propietarios pr ON pr.id = pa.propietario_id
       LEFT JOIN inv_lotes l ON l.id = m.lote_id
      WHERE m.tenant_id = $1 AND m.producto_id = $2
        AND tm.direccion = 'salida'
        AND m.creado_en::date BETWEEN $3::date AND $4::date
      ORDER BY m.creado_en DESC`,
    [tenantId, productoId, p.desde, p.hasta]
  );

  const totalBase = porOrigen.rows.reduce((s, f) => s + Number(f.cantidad), 0);
  const factor = pres.rows.length > 0 ? Number(pres.rows[0].factor) : null;

  return {
    productoId,
    producto: prod.rows[0].nombre,
    unidadBase: prod.rows[0].unidad_base,
    presentacion:
      pres.rows.length > 0 ? { nombre: pres.rows[0].nombre, factor: factor! } : null,
    totalBase: Math.round(totalBase * 10000) / 10000,
    totalPresentacion:
      factor && factor > 0 ? Math.round((totalBase / factor) * 100) / 100 : null,
    porOrigen: porOrigen.rows.map((f) => ({
      origen: f.origen,
      nombre: f.nombre,
      conPaciente: f.con_paciente,
      cantidadBase: Number(f.cantidad),
      movimientos: f.movimientos,
    })),
    tendencia: tendencia.rows.map((f) => ({
      fecha: f.fecha,
      cantidadBase: Number(f.cantidad),
    })),
    pacientes: pacientes.rows.map((f) => ({
      pacienteId: f.paciente_id,
      paciente: f.paciente,
      cliente: f.cliente,
      fecha: f.fecha,
      cantidadBase: Number(f.cantidad),
      lote: f.lote,
      atencionId: f.atencion_id,
    })),
  };
}

export interface TrazabilidadDeLote {
  loteId: string;
  numero: string;
  producto: string;
  vencimiento: string | null;
  /** A quién se le aplicó, con su contacto y su consentimiento. */
  pacientes: Array<{
    pacienteId: string;
    paciente: string;
    propietarioId: string | null;
    cliente: string | null;
    telefono: string | null;
    email: string | null;
    fecha: string;
    cantidadBase: number;
    atencionId: string | null;
    /** Si se le puede escribir, según sus consentimientos del 03. */
    sePuedeAvisar: boolean;
    motivoSiNo: string | null;
  }>;
  /** Lo que salió del lote SIN paciente: también es trazabilidad. */
  sinPaciente: Array<{ origen: string; nombre: string; cantidadBase: number; fecha: string }>;
}

/**
 * TRAZABILIDAD POR LOTE — el caso de la alerta del fabricante.
 *
 * Devuelve también **si a cada cliente se le puede escribir**, resuelto
 * con los consentimientos del 03 y no a ojo: avisar de un lote retirado
 * es una comunicación necesaria, pero el canal y el consentimiento los
 * sigue mandando el cliente. La pantalla muestra el teléfono para los
 * que no consintieron correo, que es lo honesto: hay que llamarlos.
 */
export async function trazabilidadDeLote(
  db: PoolClient,
  tenantId: string,
  loteId: string
): Promise<TrazabilidadDeLote> {
  const lote = await db.query<{
    id: string;
    numero: string;
    producto: string;
    vencimiento: string | null;
  }>(
    `SELECT l.id, l.numero, p.nombre AS producto, l.vencimiento::text
       FROM inv_lotes l JOIN inv_productos p ON p.id = l.producto_id
      WHERE l.id = $1 AND l.tenant_id = $2`,
    [loteId, tenantId]
  );
  if (lote.rows.length === 0) throw new Error("Ese lote no existe.");

  const aplicados = await db.query<{
    paciente_id: string;
    paciente: string;
    propietario_id: string | null;
    cliente: string | null;
    telefono: string | null;
    email: string | null;
    fecha: string;
    cantidad: string;
    atencion_id: string | null;
    consiente: boolean | null;
  }>(
    `SELECT pa.id AS paciente_id, pa.nombre AS paciente,
            pr.id AS propietario_id, pr.nombre AS cliente, pr.telefono, pr.email,
            m.creado_en::date::text AS fecha,
            m.cantidad_base::numeric(14,4)::text AS cantidad,
            m.atencion_id,
            (SELECT co.otorgado FROM crm_consentimientos co
              WHERE co.propietario_id = pr.id AND co.finalidad = 'servicio'
              ORDER BY co.actualizado_en DESC LIMIT 1) AS consiente
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento tm ON tm.codigo = m.tipo
       JOIN pacientes pa ON pa.id = m.paciente_id
       LEFT JOIN propietarios pr ON pr.id = pa.propietario_id
      WHERE m.tenant_id = $1 AND m.lote_id = $2 AND tm.direccion = 'salida'
      ORDER BY m.creado_en DESC`,
    [tenantId, loteId]
  );

  const sinPaciente = await db.query<{
    origen: string;
    nombre: string;
    cantidad: string;
    fecha: string;
  }>(
    `SELECT m.tipo AS origen, tm.nombre,
            m.cantidad_base::numeric(14,4)::text AS cantidad,
            m.creado_en::date::text AS fecha
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento tm ON tm.codigo = m.tipo
      WHERE m.tenant_id = $1 AND m.lote_id = $2 AND tm.direccion = 'salida'
        AND m.paciente_id IS NULL
      ORDER BY m.creado_en DESC`,
    [tenantId, loteId]
  );

  return {
    loteId,
    numero: lote.rows[0].numero,
    producto: lote.rows[0].producto,
    vencimiento: lote.rows[0].vencimiento,
    pacientes: aplicados.rows.map((f) => ({
      pacienteId: f.paciente_id,
      paciente: f.paciente,
      propietarioId: f.propietario_id,
      cliente: f.cliente,
      telefono: f.telefono,
      email: f.email,
      fecha: f.fecha,
      cantidadBase: Number(f.cantidad),
      atencionId: f.atencion_id,
      sePuedeAvisar: f.consiente === true && !!f.email,
      motivoSiNo:
        f.consiente === true && f.email
          ? null
          : !f.propietario_id
            ? "El paciente no tiene cliente asociado"
            : f.consiente !== true
              ? "No consintió comunicaciones de servicio: hay que llamarlo"
              : "No tiene correo registrado: hay que llamarlo",
    })),
    sinPaciente: sinPaciente.rows.map((f) => ({
      origen: f.origen,
      nombre: f.nombre,
      cantidadBase: Number(f.cantidad),
      fecha: f.fecha,
    })),
  };
}
