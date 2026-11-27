import { PoolClient } from "pg";
import { crearCuentaPorPagar } from "./cuentasPagar";

// ---------------------------------------------------------------------
// GASTOS OPERATIVOS — prompt 10a, §3.
//
// Lo que no es inventario: alquiler, luz, internet, planilla,
// publicidad, laboratorio externo.
//
// NO SE RETIPEA NADA. Un recibo de electricidad que ya está en la
// bandeja del 09b se clasifica como gasto **desde ahí**, con un clic, y
// el gasto guarda el vínculo al comprobante. Lo que se escribe a mano es
// solo lo que no tiene comprobante electrónico, y queda marcado para que
// el contador sepa qué no tiene soporte fiscal.
//
// LA CATEGORÍA SE SUGIERE POR PROVEEDOR, y la sugerencia **se deriva**
// del último gasto de ese proveedor en vez de guardarse en una tabla
// aparte: una preferencia guardada que nadie actualiza es una sugerencia
// que un día recomienda la categoría equivocada para siempre.
// ---------------------------------------------------------------------

export class GastoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "GastoInvalido";
  }
}

export async function categoriasDeGasto(
  db: PoolClient,
  tenantId: string,
  incluirInactivas = false
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT id, codigo, nombre, activo, orden FROM fin_categorias_gasto
      WHERE tenant_id = $1 AND ($2 OR activo)
      ORDER BY orden, nombre`,
    [tenantId, incluirInactivas]
  );
  return r.rows;
}

export async function guardarCategoria(
  db: PoolClient,
  tenantId: string,
  datos: { id?: string; codigo?: string; nombre: string; activo?: boolean; orden?: number }
): Promise<{ id: string }> {
  if (!datos.nombre?.trim()) throw new GastoInvalido("La categoría necesita un nombre.");
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE fin_categorias_gasto SET nombre = $3, activo = COALESCE($4, activo),
              orden = COALESCE($5, orden)
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [datos.id, tenantId, datos.nombre.trim(), datos.activo ?? null, datos.orden ?? null]
    );
    if (r.rows.length === 0) throw new GastoInvalido("Esa categoría no existe.");
    return r.rows[0];
  }
  // El código se deriva del nombre si no vino: es para la API y los
  // reportes, no para que alguien lo teclee.
  const codigo =
    datos.codigo ??
    datos.nombre
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 40);
  const r = await db.query<{ id: string }>(
    `INSERT INTO fin_categorias_gasto (tenant_id, codigo, nombre, orden)
     VALUES ($1,$2,$3,COALESCE($4,100))
     ON CONFLICT (tenant_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true
     RETURNING id`,
    [tenantId, codigo, datos.nombre.trim(), datos.orden ?? null]
  );
  return r.rows[0];
}

/** La categoría que este proveedor tuvo la última vez. */
export async function categoriaSugerida(
  db: PoolClient,
  tenantId: string,
  proveedorId: string
): Promise<{ categoria_id: string; nombre: string } | null> {
  const r = await db.query<{ categoria_id: string; nombre: string }>(
    `SELECT g.categoria_id, c.nombre
       FROM fin_gastos g
       JOIN fin_categorias_gasto c ON c.id = g.categoria_id
      WHERE g.tenant_id = $1 AND g.proveedor_id = $2 AND g.estado <> 'anulado'
      ORDER BY g.fecha DESC, g.creado_en DESC
      LIMIT 1`,
    [tenantId, proveedorId]
  );
  return r.rows[0] ?? null;
}

export async function registrarGasto(
  db: PoolClient,
  tenantId: string,
  datos: {
    fecha: string;
    categoriaId: string;
    proveedorId?: string | null;
    descripcion: string;
    moneda?: string;
    monto: number;
    lineaNegocio?: string | null;
    recibidoId?: string | null;
    sinComprobante?: boolean;
    respaldoUrl?: string | null;
    recurrenteId?: string | null;
    /** Si no vino pagado, genera su cuenta por pagar. */
    generaCuentaPorPagar?: boolean;
    vencimiento?: string | null;
    documento?: string | null;
    personaId: string;
  }
): Promise<{ id: string; cuentaPagarId: string | null }> {
  if (!(datos.monto > 0)) throw new GastoInvalido("El monto del gasto tiene que ser mayor que cero.");
  if (!datos.descripcion?.trim()) {
    throw new GastoInvalido("El gasto necesita una descripción: «otros ₡80 000» no se puede auditar.");
  }
  if (datos.sinComprobante && datos.recibidoId) {
    throw new GastoInvalido(
      "Un gasto que sale de un comprobante no puede marcarse «sin comprobante»."
    );
  }

  // LA CUENTA POR PAGAR PRIMERO, para poder guardarla en el gasto.
  let cuentaPagarId: string | null = null;
  if (datos.generaCuentaPorPagar) {
    if (!datos.proveedorId) {
      throw new GastoInvalido(
        "Para que el gasto genere una cuenta por pagar hace falta el proveedor: a alguien se le debe."
      );
    }
    const cuenta = await crearCuentaPorPagar(db, tenantId, {
      proveedorId: datos.proveedorId,
      documento: datos.documento ?? null,
      fecha: datos.fecha,
      vencimiento: datos.vencimiento ?? null,
      moneda: datos.moneda ?? "CRC",
      monto: datos.monto,
      recibidoId: datos.recibidoId ?? null,
      sinComprobante: datos.sinComprobante ?? !datos.recibidoId,
      nota: datos.descripcion.trim(),
      personaId: datos.personaId,
    });
    cuentaPagarId = cuenta.id;
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO fin_gastos
       (tenant_id, fecha, categoria_id, proveedor_id, descripcion, moneda, monto,
        linea_negocio, recibido_id, cuenta_pagar_id, recurrente_id, sin_comprobante,
        respaldo_url, estado, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'real',$14)
     RETURNING id`,
    [
      tenantId,
      datos.fecha,
      datos.categoriaId,
      datos.proveedorId ?? null,
      datos.descripcion.trim(),
      datos.moneda ?? "CRC",
      datos.monto,
      datos.lineaNegocio ?? null,
      datos.recibidoId ?? null,
      cuentaPagarId,
      datos.recurrenteId ?? null,
      datos.sinComprobante ?? false,
      datos.respaldoUrl ?? null,
      datos.personaId,
    ]
  );
  return { id: r.rows[0].id, cuentaPagarId };
}

/**
 * Clasificar como gasto un comprobante que ya está en la bandeja (09b).
 *
 * Es la acción que hace que no se retipee nada: el monto, la fecha, el
 * emisor y el número salen del comprobante. Lo único que se elige es la
 * **categoría** y, si corresponde, la **línea de negocio**.
 *
 * Idempotente: si ese comprobante ya es un gasto, se devuelve el que ya
 * existe. El índice único de la base lo garantiza igual.
 */
export async function gastoDesdeComprobante(
  db: PoolClient,
  tenantId: string,
  datos: {
    recibidoId: string;
    categoriaId: string;
    proveedorId?: string | null;
    lineaNegocio?: string | null;
    generaCuentaPorPagar?: boolean;
    personaId: string;
  }
): Promise<{ id: string; cuentaPagarId: string | null; yaExistia: boolean }> {
  const ya = await db.query<{ id: string; cuenta_pagar_id: string | null }>(
    `SELECT id, cuenta_pagar_id FROM fin_gastos WHERE recibido_id = $1`,
    [datos.recibidoId]
  );
  if (ya.rows.length > 0) {
    return { id: ya.rows[0].id, cuentaPagarId: ya.rows[0].cuenta_pagar_id, yaExistia: true };
  }

  const rec = await db.query<{
    consecutivo: string;
    fecha_emision: string;
    total_comprobante: string;
    moneda: string;
    emisor_nombre: string;
    registrado_en_inventario: string | null;
  }>(
    `SELECT consecutivo, fecha_emision::date::text AS fecha_emision, total_comprobante::text,
            moneda, emisor_nombre, registrado_en_inventario
       FROM fact_recibidos WHERE id = $1 AND tenant_id = $2`,
    [datos.recibidoId, tenantId]
  );
  if (rec.rows.length === 0) throw new GastoInvalido("Ese comprobante no está en la bandeja.");
  const c = rec.rows[0];

  // UN COMPROBANTE QUE YA ENTRÓ AL INVENTARIO NO ES UN GASTO. Lo que
  // entró al inventario es un activo y se convierte en costo cuando se
  // vende: contarlo también como gasto duplicaría la salida de plata en
  // el estado de resultados del 10b.
  // `registrado_en_inventario` es la FECHA en que entró al inventario,
  // no un booleano: el nombre engaña y por eso se compara contra NULL.
  if (c.registrado_en_inventario) {
    throw new GastoInvalido(
      "Ese comprobante ya entró al inventario como compra. Una compra no es un gasto: se vuelve costo cuando se vende."
    );
  }

  const g = await registrarGasto(db, tenantId, {
    fecha: c.fecha_emision,
    categoriaId: datos.categoriaId,
    proveedorId: datos.proveedorId ?? null,
    descripcion: `${c.emisor_nombre} ${c.consecutivo}`,
    moneda: c.moneda || "CRC",
    monto: Number(c.total_comprobante),
    lineaNegocio: datos.lineaNegocio ?? null,
    recibidoId: datos.recibidoId,
    documento: c.consecutivo,
    generaCuentaPorPagar: datos.generaCuentaPorPagar ?? false,
    personaId: datos.personaId,
  });
  return { ...g, yaExistia: false };
}

export async function anularGasto(
  db: PoolClient,
  tenantId: string,
  datos: { gastoId: string; motivo: string }
): Promise<void> {
  if (!datos.motivo?.trim()) throw new GastoInvalido("Para anular un gasto hace falta el motivo.");
  const r = await db.query(
    `UPDATE fin_gastos SET estado = 'anulado', anulado_motivo = $3
      WHERE id = $1 AND tenant_id = $2 AND estado <> 'anulado'`,
    [datos.gastoId, tenantId, datos.motivo.trim()]
  );
  if (r.rowCount === 0) throw new GastoInvalido("Ese gasto no existe o ya estaba anulado.");
}

export async function gastos(
  db: PoolClient,
  tenantId: string,
  filtros: { desde?: string; hasta?: string; categoriaId?: string; estado?: string } = {}
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT g.id, g.fecha::text, g.descripcion, g.moneda, g.monto::text, g.linea_negocio,
            g.sin_comprobante, g.estado, g.recibido_id, g.cuenta_pagar_id, g.recurrente_id,
            c.nombre AS categoria, c.id AS categoria_id,
            p.nombre AS proveedor, per.nombre AS registrado_por
       FROM fin_gastos g
       JOIN fin_categorias_gasto c ON c.id = g.categoria_id
       LEFT JOIN inv_proveedores p ON p.id = g.proveedor_id
       LEFT JOIN personas per ON per.id = g.creado_por
      WHERE g.tenant_id = $1
        AND ($2::date IS NULL OR g.fecha >= $2::date)
        AND ($3::date IS NULL OR g.fecha <= $3::date)
        AND ($4::uuid IS NULL OR g.categoria_id = $4::uuid)
        AND ($5::varchar IS NULL OR g.estado = $5::varchar)
      ORDER BY g.fecha DESC, g.creado_en DESC`,
    [
      tenantId,
      filtros.desde ?? null,
      filtros.hasta ?? null,
      filtros.categoriaId ?? null,
      filtros.estado ?? null,
    ]
  );
  return r.rows;
}

/** El resumen del mes: total, por categoría, y contra el mes anterior. */
export async function resumenDeGastos(
  db: PoolClient,
  tenantId: string,
  mes: string
): Promise<{
  total: number;
  totalMesAnterior: number;
  porCategoria: Array<{ categoria: string; monto: number }>;
  sinComprobante: number;
}> {
  const r = await db.query<{ categoria: string; monto: string }>(
    `SELECT c.nombre AS categoria, sum(g.monto)::text AS monto
       FROM fin_gastos g
       JOIN fin_categorias_gasto c ON c.id = g.categoria_id
      WHERE g.tenant_id = $1 AND g.estado = 'real'
        AND date_trunc('month', g.fecha) = date_trunc('month', $2::date)
      GROUP BY c.nombre ORDER BY sum(g.monto) DESC`,
    [tenantId, mes]
  );
  const anterior = await db.query<{ total: string }>(
    `SELECT COALESCE(sum(monto), 0)::text AS total FROM fin_gastos
      WHERE tenant_id = $1 AND estado = 'real'
        AND date_trunc('month', fecha) = date_trunc('month', $2::date - interval '1 month')`,
    [tenantId, mes]
  );
  const sin = await db.query<{ total: string }>(
    `SELECT COALESCE(sum(monto), 0)::text AS total FROM fin_gastos
      WHERE tenant_id = $1 AND estado = 'real' AND sin_comprobante
        AND date_trunc('month', fecha) = date_trunc('month', $2::date)`,
    [tenantId, mes]
  );

  const porCategoria = r.rows.map((f) => ({ categoria: f.categoria, monto: Number(f.monto) }));
  return {
    total: Math.round(porCategoria.reduce((t, c) => t + c.monto, 0) * 100) / 100,
    totalMesAnterior: Number(anterior.rows[0].total),
    porCategoria,
    sinComprobante: Number(sin.rows[0].total),
  };
}

// ---------------------------------------------------------------------
// LOS RECURRENTES.
//
// El alquiler de cada mes. `generarPendientes` crea el gasto
// **estimado** del mes, y cuando llega el comprobante real se concilia
// con ese estimado en vez de duplicarlo. Sin esa conciliación el
// alquiler aparece dos veces todos los meses y el total del mes miente.
// ---------------------------------------------------------------------

export async function recurrentes(
  db: PoolClient,
  tenantId: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT g.id, g.descripcion, g.monto_estimado::text, g.moneda, g.dia_del_mes,
            g.linea_negocio, g.activo, c.nombre AS categoria, c.id AS categoria_id,
            p.nombre AS proveedor, g.proveedor_id
       FROM fin_gastos_recurrentes g
       JOIN fin_categorias_gasto c ON c.id = g.categoria_id
       LEFT JOIN inv_proveedores p ON p.id = g.proveedor_id
      WHERE g.tenant_id = $1 ORDER BY g.activo DESC, g.dia_del_mes`,
    [tenantId]
  );
  return r.rows;
}

export async function guardarRecurrente(
  db: PoolClient,
  tenantId: string,
  datos: {
    id?: string;
    categoriaId: string;
    proveedorId?: string | null;
    descripcion: string;
    montoEstimado: number;
    moneda?: string;
    diaDelMes?: number;
    lineaNegocio?: string | null;
    activo?: boolean;
  }
): Promise<{ id: string }> {
  if (!(datos.montoEstimado > 0)) throw new GastoInvalido("El monto estimado tiene que ser mayor que cero.");
  const dia = datos.diaDelMes ?? 1;
  if (dia < 1 || dia > 28) {
    throw new GastoInvalido(
      "El día del mes va de 1 a 28, para que exista en febrero: un gasto recurrente el 31 se saltearía un mes al año."
    );
  }
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE fin_gastos_recurrentes
          SET categoria_id = $3, proveedor_id = $4, descripcion = $5, monto_estimado = $6,
              moneda = $7, dia_del_mes = $8, linea_negocio = $9, activo = COALESCE($10, activo)
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [
        datos.id,
        tenantId,
        datos.categoriaId,
        datos.proveedorId ?? null,
        datos.descripcion,
        datos.montoEstimado,
        datos.moneda ?? "CRC",
        dia,
        datos.lineaNegocio ?? null,
        datos.activo ?? null,
      ]
    );
    if (r.rows.length === 0) throw new GastoInvalido("Ese gasto recurrente no existe.");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO fin_gastos_recurrentes
       (tenant_id, categoria_id, proveedor_id, descripcion, monto_estimado, moneda,
        dia_del_mes, linea_negocio)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      tenantId,
      datos.categoriaId,
      datos.proveedorId ?? null,
      datos.descripcion,
      datos.montoEstimado,
      datos.moneda ?? "CRC",
      dia,
      datos.lineaNegocio ?? null,
    ]
  );
  return r.rows[0];
}

/**
 * Los gastos estimados del mes que falten.
 *
 * Re-corrible: no duplica. Lo que decide si ya existe es «este
 * recurrente, en este mes», y por eso se consulta así y no por fecha
 * exacta: un estimado conciliado puede haber cambiado de día.
 */
export async function generarPendientes(
  db: PoolClient,
  tenantId: string,
  mes: string,
  personaId: string
): Promise<{ generados: number }> {
  const lista = await db.query<{
    id: string;
    categoria_id: string;
    proveedor_id: string | null;
    descripcion: string;
    monto_estimado: string;
    moneda: string;
    dia_del_mes: number;
    linea_negocio: string | null;
  }>(
    `SELECT id, categoria_id, proveedor_id, descripcion, monto_estimado::text, moneda,
            dia_del_mes, linea_negocio
       FROM fin_gastos_recurrentes WHERE tenant_id = $1 AND activo`,
    [tenantId]
  );

  let generados = 0;
  for (const rec of lista.rows) {
    const ya = await db.query(
      `SELECT 1 FROM fin_gastos
        WHERE tenant_id = $1 AND recurrente_id = $2
          AND date_trunc('month', fecha) = date_trunc('month', $3::date)`,
      [tenantId, rec.id, mes]
    );
    if (ya.rows.length > 0) continue;

    const fecha = await db.query<{ f: string }>(
      `SELECT (date_trunc('month', $1::date) + ($2 - 1 || ' days')::interval)::date::text AS f`,
      [mes, rec.dia_del_mes]
    );
    await db.query(
      `INSERT INTO fin_gastos
         (tenant_id, fecha, categoria_id, proveedor_id, descripcion, moneda, monto,
          linea_negocio, recurrente_id, estado, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'estimado',$10)`,
      [
        tenantId,
        fecha.rows[0].f,
        rec.categoria_id,
        rec.proveedor_id,
        rec.descripcion,
        rec.moneda,
        Number(rec.monto_estimado),
        rec.linea_negocio,
        rec.id,
        personaId,
      ]
    );
    generados += 1;
  }
  return { generados };
}

/**
 * El comprobante real del alquiler llega: se concilia con el estimado.
 *
 * El gasto estimado pasa a real, con el monto y la fecha del
 * comprobante. **No nace un segundo gasto**, que es el punto.
 */
export async function conciliarRecurrente(
  db: PoolClient,
  tenantId: string,
  datos: {
    gastoEstimadoId: string;
    recibidoId?: string | null;
    monto?: number | null;
    fecha?: string | null;
    generaCuentaPorPagar?: boolean;
    personaId: string;
  }
): Promise<{ montoFinal: number; cambioElMonto: boolean; cuentaPagarId: string | null }> {
  const g = await db.query<{
    estado: string;
    monto: string;
    proveedor_id: string | null;
    moneda: string;
    descripcion: string;
    fecha: string;
  }>(
    `SELECT estado, monto::text, proveedor_id, moneda, descripcion, fecha::text
       FROM fin_gastos WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [datos.gastoEstimadoId, tenantId]
  );
  if (g.rows.length === 0) throw new GastoInvalido("Ese gasto no existe.");
  if (g.rows[0].estado !== "estimado") {
    throw new GastoInvalido("Ese gasto ya es real: no hay nada que conciliar.");
  }

  const montoFinal = datos.monto ?? Number(g.rows[0].monto);
  const fecha = datos.fecha ?? g.rows[0].fecha;

  let cuentaPagarId: string | null = null;
  if (datos.generaCuentaPorPagar && g.rows[0].proveedor_id) {
    const cuenta = await crearCuentaPorPagar(db, tenantId, {
      proveedorId: g.rows[0].proveedor_id,
      fecha,
      moneda: g.rows[0].moneda,
      monto: montoFinal,
      recibidoId: datos.recibidoId ?? null,
      sinComprobante: !datos.recibidoId,
      nota: g.rows[0].descripcion,
      personaId: datos.personaId,
    });
    cuentaPagarId = cuenta.id;
  }

  await db.query(
    `UPDATE fin_gastos
        SET estado = 'real', monto = $2, fecha = $3, recibido_id = $4,
            cuenta_pagar_id = COALESCE($5, cuenta_pagar_id),
            sin_comprobante = ($4::uuid IS NULL)
      WHERE id = $1`,
    [datos.gastoEstimadoId, montoFinal, fecha, datos.recibidoId ?? null, cuentaPagarId]
  );

  return {
    montoFinal,
    cambioElMonto: Math.abs(montoFinal - Number(g.rows[0].monto)) > 0.001,
    cuentaPagarId,
  };
}
