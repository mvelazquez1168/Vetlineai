import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// CIERRE DIARIO CONSOLIDADO — prompt 10a, §5.
//
// La caja ya se cuenta sesión por sesión (08 y 08b). Esto es la vista
// del DÍA: todas las sesiones juntas, el datáfono, los SINPE marcados
// uno por uno contra lo que llegó al banco, y los depósitos de efectivo.
//
// POR QUÉ SINPE SE MARCA UNO POR UNO: un cobro por SINPE que el cliente
// dijo que hizo y no hizo deja un total que cuadra con la caja y no con
// el banco. Lo que se concilia es el cobro, no la suma.
//
// NADA DE ESTO RECALCULA LAS VENTAS. Los totales salen de los cobros y
// sus medios, que es donde viven: finanzas consolida, no recaptura.
// ---------------------------------------------------------------------

export class CierreInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CierreInvalido";
  }
}

export interface CierreDelDia {
  fecha: string;
  porMedio: Array<{ medio: string; moneda: string; monto: number; cantidad: number }>;
  totalVentas: number;
  /** Los cobros por SINPE del día, uno por uno, con su marca. */
  sinpe: Array<{
    cobro_medio_id: string;
    monto: string;
    referencia: string | null;
    cliente: string | null;
    conciliado: boolean;
    conciliado_por: string | null;
  }>;
  /** Lo que el datáfono declara contra lo cobrado con tarjeta (08b). */
  datafono: Array<{
    banco: string | null;
    tipo_tarjeta: string | null;
    marca: string | null;
    declarado: number;
    cobrado: number;
    diferencia: number;
  }>;
  depositos: Array<Record<string, unknown>>;
  efectivoDelDia: number;
  depositado: number;
  /** Lo que falta conciliar, que es lo que hay que justificar para cerrar. */
  diferencia: number;
  cerrado: { cerrado_en: string; cerrado_por: string | null; justificacion: string | null } | null;
}

export async function cierreDelDia(
  db: PoolClient,
  tenantId: string,
  fecha: string
): Promise<CierreDelDia> {
  // VENTAS POR MEDIO DE PAGO, de todas las sesiones del día. Los cobros
  // anulados no cuentan: el día no vendió lo que después se anuló.
  const medios = await db.query<{
    medio: string;
    moneda: string;
    monto: string;
    cantidad: string;
  }>(
    `SELECT cm.medio, cm.moneda, sum(cm.monto)::text AS monto, count(*)::text AS cantidad
       FROM vta_cobro_medios cm
       JOIN vta_cobros c ON c.id = cm.cobro_id
      WHERE cm.tenant_id = $1
        AND c.creado_en::date = $2::date
        AND c.estado <> 'anulado'
      GROUP BY cm.medio, cm.moneda
      ORDER BY cm.medio`,
    [tenantId, fecha]
  );

  const sinpe = await db.query<{
    cobro_medio_id: string;
    monto: string;
    referencia: string | null;
    cliente: string | null;
    conciliado: boolean;
    conciliado_por: string | null;
  }>(
    `SELECT cm.id AS cobro_medio_id, cm.monto::text, cm.referencia,
            COALESCE(p.nombre, cu.cliente_nombre) AS cliente,
            (con.id IS NOT NULL) AS conciliado,
            per.nombre AS conciliado_por
       FROM vta_cobro_medios cm
       JOIN vta_cobros c ON c.id = cm.cobro_id
       LEFT JOIN vta_cuentas cu ON cu.id = c.cuenta_id
       LEFT JOIN propietarios p ON p.id = cu.propietario_id
       LEFT JOIN fin_conciliaciones con ON con.cobro_medio_id = cm.id
       LEFT JOIN personas per ON per.id = con.conciliado_por
      WHERE cm.tenant_id = $1
        AND c.creado_en::date = $2::date
        AND c.estado <> 'anulado'
        AND cm.medio = 'sinpe'
      ORDER BY c.creado_en`,
    [tenantId, fecha]
  );

  // EL DATÁFONO: lo declarado en el lote (08b) contra lo cobrado con
  // tarjeta. Se compara por banco y tipo, que es como el banco liquida.
  const datafono = await db.query<{
    banco: string | null;
    tipo_tarjeta: string | null;
    marca: string | null;
    declarado: string;
    cobrado: string;
  }>(
    // LAS LLAVES SE NORMALIZAN A '' Y NO SE COMPARAN CON `IS NOT
    // DISTINCT FROM`: Postgres no sabe hacer un FULL JOIN con esa
    // condición («FULL JOIN is only supported with merge-joinable or
    // hash-joinable join conditions»). Con la llave ya normalizada, la
    // unión de llaves y dos LEFT JOIN dan el mismo resultado y se pueden
    // planificar.
    `WITH lotes AS (
       SELECT COALESCE(l.banco, '') AS banco,
              COALESCE(l.tipo_tarjeta, '') AS tipo,
              COALESCE(l.marca, '') AS marca,
              sum(l.monto) AS declarado
         FROM vta_lote_datafono l
         JOIN vta_sesiones_caja s ON s.id = l.sesion_id
        WHERE l.tenant_id = $1 AND s.abierta_en::date = $2::date
        GROUP BY 1, 2, 3
     ),
     cobrado AS (
       SELECT COALESCE(cm.banco, '') AS banco,
              COALESCE(cm.tipo_tarjeta, '') AS tipo,
              COALESCE(cm.marca_tarjeta, '') AS marca,
              sum(cm.monto_crc) AS cobrado
         FROM vta_cobro_medios cm
         JOIN vta_cobros c ON c.id = cm.cobro_id
        WHERE cm.tenant_id = $1 AND c.creado_en::date = $2::date
          AND c.estado <> 'anulado' AND cm.medio = 'tarjeta'
        GROUP BY 1, 2, 3
     ),
     llaves AS (
       SELECT banco, tipo, marca FROM lotes
       UNION
       SELECT banco, tipo, marca FROM cobrado
     )
     SELECT NULLIF(k.banco, '') AS banco,
            NULLIF(k.tipo, '') AS tipo_tarjeta,
            NULLIF(k.marca, '') AS marca,
            COALESCE(l.declarado, 0)::text AS declarado,
            COALESCE(c.cobrado, 0)::text AS cobrado
       FROM llaves k
       LEFT JOIN lotes l USING (banco, tipo, marca)
       LEFT JOIN cobrado c USING (banco, tipo, marca)
      ORDER BY 1, 2, 3`,
    [tenantId, fecha]
  );

  const depositos = await db.query(
    `SELECT con.id, con.monto::text, con.moneda, con.referencia, con.respaldo_url,
            b.nombre AS cuenta_banco, per.nombre AS conciliado_por, con.conciliado_en
       FROM fin_conciliaciones con
       LEFT JOIN fin_cuentas_banco b ON b.id = con.cuenta_banco_id
       LEFT JOIN personas per ON per.id = con.conciliado_por
      WHERE con.tenant_id = $1 AND con.fecha = $2::date AND con.tipo = 'deposito'
      ORDER BY con.conciliado_en`,
    [tenantId, fecha]
  );

  const cerrado = await db.query<{
    cerrado_en: string;
    cerrado_por: string | null;
    justificacion: string | null;
  }>(
    `SELECT c.cerrado_en::text, per.nombre AS cerrado_por, c.justificacion
       FROM fin_cierre_dia c
       LEFT JOIN personas per ON per.id = c.cerrado_por
      WHERE c.tenant_id = $1 AND c.fecha = $2::date`,
    [tenantId, fecha]
  );

  const porMedio = medios.rows.map((m) => ({
    medio: m.medio,
    moneda: m.moneda,
    monto: Number(m.monto),
    cantidad: Number(m.cantidad),
  }));
  const totalVentas =
    Math.round(porMedio.reduce((t, m) => t + m.monto, 0) * 100) / 100;

  const efectivoDelDia = porMedio
    .filter((m) => m.medio === "efectivo")
    .reduce((t, m) => t + m.monto, 0);
  const depositado = depositos.rows.reduce((t, d) => t + Number(d.monto), 0);

  // LA DIFERENCIA QUE HAY QUE JUSTIFICAR: los SINPE sin marcar más el
  // efectivo sin depositar. No incluye el datáfono a propósito: ahí la
  // diferencia es del banco y se resuelve con el banco, no cerrando el
  // día.
  const sinpeSinConciliar = sinpe.rows
    .filter((s) => !s.conciliado)
    .reduce((t, s) => t + Number(s.monto), 0);

  return {
    fecha,
    porMedio,
    totalVentas,
    sinpe: sinpe.rows,
    datafono: datafono.rows.map((d) => ({
      banco: d.banco,
      tipo_tarjeta: d.tipo_tarjeta,
      marca: d.marca,
      declarado: Number(d.declarado),
      cobrado: Number(d.cobrado),
      diferencia: Math.round((Number(d.declarado) - Number(d.cobrado)) * 100) / 100,
    })),
    depositos: depositos.rows,
    efectivoDelDia: Math.round(efectivoDelDia * 100) / 100,
    depositado: Math.round(depositado * 100) / 100,
    diferencia:
      Math.round((sinpeSinConciliar + (efectivoDelDia - depositado)) * 100) / 100,
    cerrado: cerrado.rows[0] ?? null,
  };
}

/** Marca un cobro por SINPE como recibido en la cuenta. */
export async function conciliarSinpe(
  db: PoolClient,
  tenantId: string,
  datos: { cobroMedioId: string; cuentaBancoId?: string | null; personaId: string }
): Promise<{ id: string }> {
  const cm = await db.query<{ monto: string; moneda: string; fecha: string }>(
    `SELECT cm.monto::text, cm.moneda, c.creado_en::date::text AS fecha
       FROM vta_cobro_medios cm
       JOIN vta_cobros c ON c.id = cm.cobro_id
      WHERE cm.id = $1 AND cm.tenant_id = $2 AND cm.medio = 'sinpe'`,
    [datos.cobroMedioId, tenantId]
  );
  if (cm.rows.length === 0) throw new CierreInvalido("Ese cobro por SINPE no existe.");

  const r = await db.query<{ id: string }>(
    `INSERT INTO fin_conciliaciones
       (tenant_id, tipo, fecha, cobro_medio_id, monto, moneda, cuenta_banco_id, conciliado_por)
     VALUES ($1,'sinpe',$2,$3,$4,$5,$6,$7)
     -- El índice único es PARCIAL: tiene WHERE cobro_medio_id IS NOT
     -- NULL, así que el ON CONFLICT tiene que repetir ese predicado. Sin
     -- eso Postgres no lo reconoce y contesta que no hay ninguna
     -- restricción que coincida.
     ON CONFLICT (cobro_medio_id) WHERE cobro_medio_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      tenantId,
      cm.rows[0].fecha,
      datos.cobroMedioId,
      Number(cm.rows[0].monto),
      cm.rows[0].moneda,
      datos.cuentaBancoId ?? null,
      datos.personaId,
    ]
  );
  if (r.rows.length === 0) {
    throw new CierreInvalido("Ese cobro ya estaba conciliado. Lo marcó alguien más.");
  }
  return r.rows[0];
}

export async function desconciliarSinpe(
  db: PoolClient,
  tenantId: string,
  cobroMedioId: string
): Promise<void> {
  await db.query(
    `DELETE FROM fin_conciliaciones
      WHERE tenant_id = $1 AND cobro_medio_id = $2 AND tipo = 'sinpe'`,
    [tenantId, cobroMedioId]
  );
}

export async function registrarDeposito(
  db: PoolClient,
  tenantId: string,
  datos: {
    fecha: string;
    monto: number;
    moneda?: string;
    cuentaBancoId: string;
    referencia?: string | null;
    respaldoUrl?: string | null;
    personaId: string;
  }
): Promise<{ id: string }> {
  if (!(datos.monto > 0)) throw new CierreInvalido("El depósito tiene que ser mayor que cero.");
  if (!datos.cuentaBancoId) {
    throw new CierreInvalido("Un depósito necesita la cuenta a la que entró.");
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO fin_conciliaciones
       (tenant_id, tipo, fecha, monto, moneda, cuenta_banco_id, referencia, respaldo_url, conciliado_por)
     VALUES ($1,'deposito',$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      tenantId,
      datos.fecha,
      datos.monto,
      datos.moneda ?? "CRC",
      datos.cuentaBancoId,
      datos.referencia ?? null,
      datos.respaldoUrl ?? null,
      datos.personaId,
    ]
  );
  return r.rows[0];
}

/**
 * Cierra el día.
 *
 * Con diferencia, exige justificación **y** el permiso: es la misma
 * regla del arqueo del 08b. Lo que se guarda son los números que el
 * cierre vio, congelados: una anulación posterior no puede reescribir lo
 * que se cerró.
 */
export async function cerrarDia(
  db: PoolClient,
  tenantId: string,
  datos: { fecha: string; justificacion?: string | null; personaId: string }
): Promise<{ diferencia: number }> {
  const resumen = await cierreDelDia(db, tenantId, datos.fecha);
  if (resumen.cerrado) throw new CierreInvalido("Ese día ya está cerrado.");

  if (Math.abs(resumen.diferencia) > 0.001 && !datos.justificacion?.trim()) {
    throw new CierreInvalido(
      `El día cierra con una diferencia de ${resumen.diferencia}. Hace falta una justificación: una diferencia sin explicación es una diferencia que nadie va a poder investigar el mes que viene.`
    );
  }

  const efectivo = resumen.porMedio
    .filter((m) => m.medio === "efectivo")
    .reduce((t, m) => t + m.monto, 0);
  const tarjeta = resumen.porMedio
    .filter((m) => m.medio === "tarjeta")
    .reduce((t, m) => t + m.monto, 0);
  const sinpeTotal = resumen.porMedio
    .filter((m) => m.medio === "sinpe")
    .reduce((t, m) => t + m.monto, 0);
  const conciliado =
    resumen.sinpe.filter((s) => s.conciliado).reduce((t, s) => t + Number(s.monto), 0) +
    resumen.depositado;

  await db.query(
    `INSERT INTO fin_cierre_dia
       (tenant_id, fecha, total_ventas, total_efectivo, total_tarjeta, total_sinpe,
        total_conciliado, diferencia, justificacion, cerrado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      tenantId,
      datos.fecha,
      resumen.totalVentas,
      efectivo,
      tarjeta,
      sinpeTotal,
      conciliado,
      resumen.diferencia,
      datos.justificacion?.trim() || null,
      datos.personaId,
    ]
  );
  return { diferencia: resumen.diferencia };
}
