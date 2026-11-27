import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// CUENTAS POR PAGAR — prompt 10a, §1.
//
// FINANZAS CONSOLIDA, NO RECAPTURA. Una cuenta no se escribe a mano con
// los datos de una factura que el sistema ya tiene: nace del comprobante
// recibido (09b) o de la compra (06), y guarda el vínculo. Lo propio de
// la cuenta es cuándo vence y qué se pagó.
//
// EL SALDO NO SE GUARDA, se calcula con `fin_saldo_cuenta` (migración
// 150) — la misma decisión que el 08 tomó para el saldo del cliente. Y
// el ESTADO tampoco: se deriva del saldo y de la fecha. Un estado
// guardado es un estado que un día dice «pendiente» de algo ya pagado.
// ---------------------------------------------------------------------

export class CuentaPorPagarInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CuentaPorPagarInvalida";
  }
}

/** El SQL del saldo y del estado, en un solo lugar. */
const COLUMNAS_DERIVADAS = `
  fin_saldo_cuenta(c.id) AS saldo,
  CASE
    WHEN fin_saldo_cuenta(c.id) <= 0.001 THEN 'pagada'
    WHEN c.vencimiento < CURRENT_DATE THEN 'vencida'
    WHEN fin_saldo_cuenta(c.id) < c.exigible THEN 'parcial'
    ELSE 'pendiente'
  END AS estado,
  (c.vencimiento - CURRENT_DATE) AS dias_para_vencer
`;

export interface CuentaPorPagar {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  documento: string | null;
  fecha: string;
  vencimiento: string;
  moneda: string;
  monto: string;
  exigible: string;
  saldo: string;
  estado: string;
  dias_para_vencer: number;
  sin_comprobante: boolean;
  recibido_id: string | null;
  compra_id: string | null;
  reduce_a_cuenta_id: string | null;
}

/**
 * Nace una cuenta por pagar.
 *
 * `vencimiento` sale de los días de crédito del proveedor, salvo que
 * quien registra diga otro: un proveedor con 30 días de condición puede
 * haber dado 45 en esta factura, y la fecha que manda es la del papel.
 */
export async function crearCuentaPorPagar(
  db: PoolClient,
  tenantId: string,
  datos: {
    proveedorId: string;
    documento?: string | null;
    fecha: string;
    vencimiento?: string | null;
    moneda?: string;
    monto: number;
    exigible?: number;
    recibidoId?: string | null;
    compraId?: string | null;
    sinComprobante?: boolean;
    reduceACuentaId?: string | null;
    nota?: string | null;
    personaId: string;
  }
): Promise<{ id: string; vencimiento: string }> {
  if (!(datos.monto > 0)) {
    throw new CuentaPorPagarInvalida("El monto de la cuenta tiene que ser mayor que cero.");
  }
  const exigible = datos.exigible ?? datos.monto;
  if (exigible > datos.monto) {
    throw new CuentaPorPagarInvalida(
      "Lo exigible no puede ser mayor que el monto del documento: se acepta hasta lo que dice la factura."
    );
  }

  // EL VENCIMIENTO SE CALCULA CON LOS DÍAS DEL PROVEEDOR. Antes del 10a
  // su condición de pago era texto libre («30 días») y no se podía
  // calcular nada con eso.
  let vencimiento = datos.vencimiento ?? null;
  if (!vencimiento) {
    const p = await db.query<{ dias: number }>(
      `SELECT dias_credito AS dias FROM inv_proveedores WHERE id = $1`,
      [datos.proveedorId]
    );
    if (p.rows.length === 0) throw new CuentaPorPagarInvalida("Ese proveedor no existe.");
    const dias = p.rows[0].dias ?? 0;
    const r = await db.query<{ v: string }>(
      `SELECT ($1::date + ($2 || ' days')::interval)::date::text AS v`,
      [datos.fecha, dias]
    );
    vencimiento = r.rows[0].v;
  }

  const r = await db.query<{ id: string; vencimiento: string }>(
    `INSERT INTO fin_cuentas_pagar
       (tenant_id, proveedor_id, recibido_id, compra_id, documento, fecha, vencimiento,
        moneda, monto, exigible, sin_comprobante, reduce_a_cuenta_id, nota, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id, vencimiento::text`,
    [
      tenantId,
      datos.proveedorId,
      datos.recibidoId ?? null,
      datos.compraId ?? null,
      datos.documento ?? null,
      datos.fecha,
      vencimiento,
      datos.moneda ?? "CRC",
      datos.monto,
      exigible,
      datos.sinComprobante ?? false,
      datos.reduceACuentaId ?? null,
      datos.nota ?? null,
      datos.personaId,
    ]
  );
  return r.rows[0];
}

/**
 * La cuenta que nace de un comprobante recibido ya aceptado (09b).
 *
 * `montoAceptado` es lo exigible cuando la aceptación fue parcial: el
 * comprobante dice 100 000 y la clínica reconoce 80 000 porque faltaba
 * una caja. Se paga sobre 80 000 y el documento sigue diciendo 100 000.
 *
 * Es idempotente: si ese comprobante ya tiene su cuenta, la devuelve en
 * vez de crear una segunda —el índice único de la base lo impediría, y
 * un error ahí sería un error de pantalla, no un problema del usuario—.
 */
export async function cuentaDesdeComprobanteRecibido(
  db: PoolClient,
  tenantId: string,
  datos: { recibidoId: string; proveedorId: string; montoAceptado?: number; personaId: string }
): Promise<{ id: string; yaExistia: boolean }> {
  const ya = await db.query<{ id: string }>(
    `SELECT id FROM fin_cuentas_pagar WHERE recibido_id = $1`,
    [datos.recibidoId]
  );
  if (ya.rows.length > 0) return { id: ya.rows[0].id, yaExistia: true };

  const rec = await db.query<{
    consecutivo: string;
    fecha_emision: string;
    total_comprobante: string;
    moneda: string;
    tipo_comprobante: string;
  }>(
    `SELECT consecutivo, fecha_emision::date::text AS fecha_emision,
            total_comprobante::text, moneda, tipo_comprobante
       FROM fact_recibidos WHERE id = $1 AND tenant_id = $2`,
    [datos.recibidoId, tenantId]
  );
  if (rec.rows.length === 0) throw new CuentaPorPagarInvalida("Ese comprobante no está en la bandeja.");
  const c = rec.rows[0];

  const creada = await crearCuentaPorPagar(db, tenantId, {
    proveedorId: datos.proveedorId,
    documento: c.consecutivo,
    fecha: c.fecha_emision,
    moneda: c.moneda || "CRC",
    monto: Number(c.total_comprobante),
    exigible: datos.montoAceptado,
    recibidoId: datos.recibidoId,
    personaId: datos.personaId,
  });
  return { id: creada.id, yaExistia: false };
}

/**
 * Cuando el comprobante llega después de la compra, se concilia con la
 * cuenta que nació «sin comprobante» en vez de crear una segunda.
 *
 * Es el caso del proveedor que entrega la mercadería el lunes y manda la
 * factura el viernes. Sin esto, la clínica debe dos veces lo mismo.
 */
export async function conciliarComprobanteConCuenta(
  db: PoolClient,
  tenantId: string,
  datos: { cuentaId: string; recibidoId: string }
): Promise<void> {
  const cuenta = await db.query<{ sin_comprobante: boolean; recibido_id: string | null }>(
    `SELECT sin_comprobante, recibido_id FROM fin_cuentas_pagar
      WHERE id = $1 AND tenant_id = $2`,
    [datos.cuentaId, tenantId]
  );
  if (cuenta.rows.length === 0) throw new CuentaPorPagarInvalida("Esa cuenta no existe.");
  if (cuenta.rows[0].recibido_id) {
    throw new CuentaPorPagarInvalida("Esa cuenta ya tiene su comprobante: no se puede atar a otro.");
  }

  const otra = await db.query(`SELECT id FROM fin_cuentas_pagar WHERE recibido_id = $1`, [
    datos.recibidoId,
  ]);
  if (otra.rows.length > 0) {
    throw new CuentaPorPagarInvalida(
      "Ese comprobante ya generó su propia cuenta por pagar. Revisá cuál de las dos corresponde."
    );
  }

  await db.query(
    `UPDATE fin_cuentas_pagar
        SET recibido_id = $2, sin_comprobante = false
      WHERE id = $1 AND tenant_id = $3`,
    [datos.cuentaId, datos.recibidoId, tenantId]
  );
}

export async function cuentasPorPagar(
  db: PoolClient,
  tenantId: string,
  filtros: { proveedorId?: string; estado?: string; hasta?: string } = {}
): Promise<CuentaPorPagar[]> {
  const r = await db.query<CuentaPorPagar>(
    `SELECT c.id, c.proveedor_id, p.nombre AS proveedor_nombre, c.documento,
            c.fecha::text, c.vencimiento::text, c.moneda, c.monto::text, c.exigible::text,
            c.sin_comprobante, c.recibido_id, c.compra_id, c.reduce_a_cuenta_id,
            ${COLUMNAS_DERIVADAS}
       FROM fin_cuentas_pagar c
       JOIN inv_proveedores p ON p.id = c.proveedor_id
      WHERE c.tenant_id = $1
        -- Las notas de crédito no son cuentas a pagar: son el descuento
        -- de otra. Se ven dentro de la cuenta que reducen.
        AND c.reduce_a_cuenta_id IS NULL
        AND ($2::uuid IS NULL OR c.proveedor_id = $2::uuid)
        AND ($3::date IS NULL OR c.vencimiento <= $3::date)
      ORDER BY c.vencimiento, p.nombre`,
    [tenantId, filtros.proveedorId ?? null, filtros.hasta ?? null]
  );
  // El estado se filtra acá y no en el SQL para no repetir su definición
  // en un WHERE: está escrita una sola vez, en COLUMNAS_DERIVADAS.
  return filtros.estado ? r.rows.filter((c) => c.estado === filtros.estado) : r.rows;
}

export interface ResumenPorPagar {
  total: number;
  vencido: number;
  vence7: number;
  vence30: number;
  /** Al día, 1–30, 31–60, más de 60. */
  antiguedad: Array<{ tramo: string; monto: number }>;
  /** Por semana, para el calendario de pagos. */
  calendario: Array<{ semana: string; monto: number }>;
}

/**
 * Los indicadores, la antigüedad y el calendario.
 *
 * TODO EN COLONES, con una advertencia honesta: lo que está en dólares se
 * convierte con el tipo de cambio de hoy para poder sumarlo. El saldo de
 * cada cuenta sigue estando en su moneda; lo que se convierte es el
 * total, porque «debo 3 000 dólares y 2 millones de colones» no se puede
 * poner en un indicador.
 */
export async function resumenPorPagar(
  db: PoolClient,
  tenantId: string
): Promise<ResumenPorPagar> {
  const tc = await tipoCambioDelDia(db, tenantId);
  const cuentas = await cuentasPorPagar(db, tenantId);
  const enColones = (c: CuentaPorPagar) =>
    Number(c.saldo) * (c.moneda === "USD" ? tc : 1);

  const abiertas = cuentas.filter((c) => Number(c.saldo) > 0.001);
  const suma = (lista: CuentaPorPagar[]) =>
    Math.round(lista.reduce((t, c) => t + enColones(c), 0) * 100) / 100;

  const tramo = (c: CuentaPorPagar) => {
    const d = -c.dias_para_vencer; // días vencida
    if (d <= 0) return "al_dia";
    if (d <= 30) return "1_30";
    if (d <= 60) return "31_60";
    return "mas_60";
  };

  const porTramo = new Map<string, number>();
  for (const c of abiertas) {
    porTramo.set(tramo(c), (porTramo.get(tramo(c)) ?? 0) + enColones(c));
  }

  const porSemana = new Map<string, number>();
  for (const c of abiertas) {
    // La semana se arma con la fecha de vencimiento, en ISO: el
    // calendario de pagos se lee por semana, no por día.
    const semana = c.vencimiento.slice(0, 10);
    porSemana.set(semana, (porSemana.get(semana) ?? 0) + enColones(c));
  }

  return {
    total: suma(abiertas),
    vencido: suma(abiertas.filter((c) => c.dias_para_vencer < 0)),
    vence7: suma(abiertas.filter((c) => c.dias_para_vencer >= 0 && c.dias_para_vencer <= 7)),
    vence30: suma(abiertas.filter((c) => c.dias_para_vencer >= 0 && c.dias_para_vencer <= 30)),
    antiguedad: ["al_dia", "1_30", "31_60", "mas_60"].map((t) => ({
      tramo: t,
      monto: Math.round((porTramo.get(t) ?? 0) * 100) / 100,
    })),
    calendario: [...porSemana.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semana, monto]) => ({ semana, monto: Math.round(monto * 100) / 100 })),
  };
}

/**
 * El tipo de cambio del día, del que ya usa el sistema
 * (`vta_tipos_cambio`, del prompt 08).
 *
 * Si no hay ninguno cargado devuelve 1, que es honesto: significa «no
 * sé convertir», y entonces los dólares se suman como si fueran colones
 * —se ve raro y se corrige— en vez de inventar un tipo de cambio.
 */
export async function tipoCambioDelDia(
  db: PoolClient,
  tenantId: string,
  moneda = "USD"
): Promise<number> {
  const r = await db.query<{ valor: string }>(
    `SELECT valor::text FROM vta_tipos_cambio
      WHERE tenant_id = $1 AND moneda = $2
      ORDER BY fecha DESC LIMIT 1`,
    [tenantId, moneda]
  );
  return r.rows.length > 0 ? Number(r.rows[0].valor) : 1;
}

/** Una cuenta con su comprobante, su compra, sus pagos y sus notas. */
export async function detalleDeCuenta(db: PoolClient, tenantId: string, cuentaId: string) {
  const c = await db.query<CuentaPorPagar>(
    `SELECT c.id, c.proveedor_id, p.nombre AS proveedor_nombre, c.documento,
            c.fecha::text, c.vencimiento::text, c.moneda, c.monto::text, c.exigible::text,
            c.sin_comprobante, c.recibido_id, c.compra_id, c.reduce_a_cuenta_id,
            ${COLUMNAS_DERIVADAS}
       FROM fin_cuentas_pagar c
       JOIN inv_proveedores p ON p.id = c.proveedor_id
      WHERE c.id = $1 AND c.tenant_id = $2`,
    [cuentaId, tenantId]
  );
  if (c.rows.length === 0) throw new CuentaPorPagarInvalida("Esa cuenta no existe.");

  const pagos = await db.query(
    `SELECT pg.id, pg.fecha::text, pg.medio, pg.referencia, pg.estado, pg.moneda,
            pg.tipo_cambio::text, a.monto::text, b.nombre AS cuenta_banco,
            per.nombre AS registrado_por
       FROM fin_pago_aplicaciones a
       JOIN fin_pagos pg ON pg.id = a.pago_id
       LEFT JOIN fin_cuentas_banco b ON b.id = pg.cuenta_banco_id
       LEFT JOIN personas per ON per.id = pg.creado_por
      WHERE a.cuenta_id = $1
      ORDER BY pg.fecha DESC`,
    [cuentaId]
  );

  const notas = await db.query(
    `SELECT id, documento, fecha::text, exigible::text AS monto
       FROM fin_cuentas_pagar WHERE reduce_a_cuenta_id = $1 ORDER BY fecha`,
    [cuentaId]
  );

  const comprobante = c.rows[0].recibido_id
    ? (
        await db.query(
          `SELECT id, clave, consecutivo, emisor_nombre, mensaje_tipo, total_comprobante::text
             FROM fact_recibidos WHERE id = $1`,
          [c.rows[0].recibido_id]
        )
      ).rows[0] ?? null
    : null;

  const compra = c.rows[0].compra_id
    ? (
        await db.query(
          `SELECT id, numero, factura_proveedor, estado, recibida_en
             FROM inv_ordenes_compra WHERE id = $1`,
          [c.rows[0].compra_id]
        )
      ).rows[0] ?? null
    : null;

  return { cuenta: c.rows[0], pagos: pagos.rows, notas: notas.rows, comprobante, compra };
}
