import { PoolClient } from "pg";
import { CuentaPorPagarInvalida, tipoCambioDelDia } from "./cuentasPagar";

// ---------------------------------------------------------------------
// PAGOS A PROVEEDORES — prompt 10a, §2.
//
// Un pago es UN movimiento de plata que puede cubrir VARIAS cuentas del
// mismo proveedor: es lo que pasa de verdad cuando se manda una
// transferencia por tres facturas.
//
// EL EFECTIVO NO SE REGISTRA EN DOS LUGARES. Un pago en efectivo desde
// la caja abierta entra por la puerta que ya existe —un movimiento de
// `vta_movimientos_efectivo`, del 08b— y el pago guarda su id. Es ese
// movimiento el que el arqueo descuenta. Sin eso, o el efectivo sale sin
// que la caja lo sepa, o sale dos veces.
//
// UN PAGO NO SE BORRA, SE ANULA, con motivo y permiso. Y la cuenta
// recupera su saldo sola, porque el saldo se calcula y los pagos
// anulados no cuentan.
// ---------------------------------------------------------------------

export class PagoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PagoInvalido";
  }
}

export interface AplicacionPedida {
  cuentaId: string;
  monto: number;
}

export async function registrarPago(
  db: PoolClient,
  tenantId: string,
  datos: {
    proveedorId: string;
    fecha: string;
    medio: "transferencia" | "sinpe" | "cheque" | "efectivo" | "tarjeta";
    cuentaBancoId?: string | null;
    referencia?: string | null;
    respaldoUrl?: string | null;
    moneda?: string;
    tipoCambio?: number | null;
    aplicaciones: AplicacionPedida[];
    /** La sesión de caja abierta, obligatoria si el medio es efectivo. */
    sesionCajaId?: string | null;
    personaId: string;
  }
): Promise<{ id: string; total: number; movimientoEfectivoId: string | null }> {
  if (!datos.aplicaciones || datos.aplicaciones.length === 0) {
    throw new PagoInvalido("Un pago tiene que aplicarse a por lo menos una cuenta.");
  }
  const total = datos.aplicaciones.reduce((t, a) => t + a.monto, 0);
  if (!(total > 0)) throw new PagoInvalido("El monto del pago tiene que ser mayor que cero.");

  // TODAS LAS CUENTAS, DEL MISMO PROVEEDOR. Un pago que cruza dos
  // proveedores no es un pago: son dos.
  const cuentas = await db.query<{ id: string; proveedor_id: string; moneda: string; saldo: string }>(
    `SELECT id, proveedor_id, moneda, fin_saldo_cuenta(id)::text AS saldo
       FROM fin_cuentas_pagar
      WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
    [datos.aplicaciones.map((a) => a.cuentaId), tenantId]
  );
  if (cuentas.rows.length !== datos.aplicaciones.length) {
    throw new PagoInvalido("Alguna de las cuentas no existe en esta clínica.");
  }
  for (const c of cuentas.rows) {
    if (c.proveedor_id !== datos.proveedorId) {
      throw new PagoInvalido(
        "Todas las cuentas de un pago tienen que ser del mismo proveedor. Registrá un pago por proveedor."
      );
    }
  }

  const moneda = datos.moneda ?? "CRC";

  // EL TIPO DE CAMBIO, para que el contador vea la diferencia cambiaria.
  // Por omisión el de referencia que ya usa el sistema, editable: es lo
  // que pide el prompt.
  let tipoCambio = datos.tipoCambio ?? null;
  if (moneda === "USD" && !tipoCambio) {
    tipoCambio = await tipoCambioDelDia(db, tenantId, "USD");
  }

  // EL EFECTIVO SALE DE UNA CAJA ABIERTA, por la puerta del 08b.
  let movimientoEfectivoId: string | null = null;
  if (datos.medio === "efectivo") {
    if (!datos.sesionCajaId) {
      throw new PagoInvalido(
        "Para pagar en efectivo hace falta una caja abierta: el efectivo sale de ahí y el arqueo lo tiene que descontar."
      );
    }
    const sesion = await db.query<{ estado: string }>(
      `SELECT estado FROM vta_sesiones_caja WHERE id = $1 AND tenant_id = $2`,
      [datos.sesionCajaId, tenantId]
    );
    if (sesion.rows.length === 0) throw new PagoInvalido("Esa sesión de caja no existe.");
    if (sesion.rows[0].estado !== "abierta") {
      throw new PagoInvalido("Esa caja ya está cerrada: no se le puede sacar efectivo.");
    }
    const prov = await db.query<{ nombre: string }>(
      `SELECT nombre FROM inv_proveedores WHERE id = $1`,
      [datos.proveedorId]
    );
    const mov = await db.query<{ id: string }>(
      `INSERT INTO vta_movimientos_efectivo
         (tenant_id, sesion_id, tipo, moneda, monto, motivo, respaldo_url, persona_id)
       VALUES ($1,$2,'pago_proveedor',$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        tenantId,
        datos.sesionCajaId,
        moneda,
        total,
        `Pago a ${prov.rows[0]?.nombre ?? "proveedor"}${datos.referencia ? ` (${datos.referencia})` : ""}`,
        datos.respaldoUrl ?? null,
        datos.personaId,
      ]
    );
    movimientoEfectivoId = mov.rows[0].id;
  }

  const pago = await db.query<{ id: string }>(
    `INSERT INTO fin_pagos
       (tenant_id, proveedor_id, fecha, medio, cuenta_banco_id, referencia, respaldo_url,
        moneda, monto, tipo_cambio, movimiento_efectivo_id, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      tenantId,
      datos.proveedorId,
      datos.fecha,
      datos.medio,
      datos.cuentaBancoId ?? null,
      datos.referencia ?? null,
      datos.respaldoUrl ?? null,
      moneda,
      total,
      tipoCambio,
      movimientoEfectivoId,
      datos.personaId,
    ]
  );

  // Las aplicaciones. El trigger de la base rechaza la que pase el
  // saldo: la validación de dinero no se delega al código.
  for (const a of datos.aplicaciones) {
    if (!(a.monto > 0)) {
      throw new PagoInvalido("Cada aplicación tiene que ser por un monto mayor que cero.");
    }
    await db.query(
      `INSERT INTO fin_pago_aplicaciones (tenant_id, pago_id, cuenta_id, monto)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, pago.rows[0].id, a.cuentaId, a.monto]
    );
  }

  return { id: pago.rows[0].id, total, movimientoEfectivoId };
}

/**
 * Anular un pago.
 *
 * La cuenta recupera su saldo **sola**: el saldo se calcula y
 * `fin_saldo_cuenta` no cuenta los pagos anulados. No hay ningún número
 * que haya que devolver a mano, que es donde se pierde la plata.
 *
 * El movimiento de caja NO se borra: si el efectivo salió del cajón, el
 * arqueo de ese día lo vio salir. Se anota el contramovimiento cuando la
 * caja sigue abierta; si ya cerró, queda la anulación del pago y el
 * efectivo se reingresa a mano, que es lo que de verdad pasa.
 */
export async function anularPago(
  db: PoolClient,
  tenantId: string,
  datos: { pagoId: string; motivo: string; personaId: string }
): Promise<{ contramovimiento: string | null }> {
  if (!datos.motivo?.trim()) {
    throw new PagoInvalido("Para anular un pago hace falta el motivo: queda registrado.");
  }
  const p = await db.query<{
    estado: string;
    medio: string;
    monto: string;
    moneda: string;
    movimiento_efectivo_id: string | null;
  }>(
    `SELECT estado, medio, monto::text, moneda, movimiento_efectivo_id
       FROM fin_pagos WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [datos.pagoId, tenantId]
  );
  if (p.rows.length === 0) throw new PagoInvalido("Ese pago no existe.");
  if (p.rows[0].estado === "anulado") throw new PagoInvalido("Ese pago ya estaba anulado.");

  await db.query(
    `UPDATE fin_pagos
        SET estado = 'anulado', anulado_por = $2, anulado_en = now(), anulado_motivo = $3
      WHERE id = $1`,
    [datos.pagoId, datos.personaId, datos.motivo.trim()]
  );

  let contramovimiento: string | null = null;
  const mov = p.rows[0].movimiento_efectivo_id;
  if (mov) {
    const sesion = await db.query<{ sesion_id: string; estado: string }>(
      `SELECT m.sesion_id, s.estado
         FROM vta_movimientos_efectivo m
         JOIN vta_sesiones_caja s ON s.id = m.sesion_id
        WHERE m.id = $1`,
      [mov]
    );
    if (sesion.rows[0]?.estado === "abierta") {
      const c = await db.query<{ id: string }>(
        `INSERT INTO vta_movimientos_efectivo
           (tenant_id, sesion_id, tipo, moneda, monto, motivo, persona_id)
         VALUES ($1,$2,'ingreso_cambio',$3,$4,$5,$6)
         RETURNING id`,
        [
          tenantId,
          sesion.rows[0].sesion_id,
          p.rows[0].moneda,
          Number(p.rows[0].monto),
          `Reingreso por anulación de pago: ${datos.motivo.trim()}`,
          datos.personaId,
        ]
      );
      contramovimiento = c.rows[0].id;
    }
  }

  return { contramovimiento };
}

export async function pagosDelProveedor(
  db: PoolClient,
  tenantId: string,
  proveedorId: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT pg.id, pg.fecha::text, pg.medio, pg.moneda, pg.monto::text, pg.referencia,
            pg.estado, pg.anulado_motivo, b.nombre AS cuenta_banco,
            per.nombre AS registrado_por,
            (SELECT count(*) FROM fin_pago_aplicaciones a WHERE a.pago_id = pg.id) AS cuentas
       FROM fin_pagos pg
       LEFT JOIN fin_cuentas_banco b ON b.id = pg.cuenta_banco_id
       LEFT JOIN personas per ON per.id = pg.creado_por
      WHERE pg.tenant_id = $1 AND pg.proveedor_id = $2
      ORDER BY pg.fecha DESC, pg.creado_en DESC`,
    [tenantId, proveedorId]
  );
  return r.rows;
}

export async function cuentasBanco(
  db: PoolClient,
  tenantId: string,
  incluirInactivas = false
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT id, nombre, banco, terminacion, moneda, activa
       FROM fin_cuentas_banco
      WHERE tenant_id = $1 AND ($2 OR activa)
      ORDER BY activa DESC, nombre`,
    [tenantId, incluirInactivas]
  );
  return r.rows;
}

export async function guardarCuentaBanco(
  db: PoolClient,
  tenantId: string,
  datos: {
    id?: string;
    nombre: string;
    banco?: string | null;
    terminacion?: string | null;
    moneda?: string;
    activa?: boolean;
  }
): Promise<{ id: string }> {
  if (!datos.nombre?.trim()) throw new PagoInvalido("La cuenta necesita un nombre.");
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE fin_cuentas_banco
          SET nombre = $3, banco = $4, terminacion = $5, moneda = $6,
              activa = COALESCE($7, activa)
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [
        datos.id,
        tenantId,
        datos.nombre.trim(),
        datos.banco ?? null,
        datos.terminacion ?? null,
        datos.moneda ?? "CRC",
        datos.activa ?? null,
      ]
    );
    if (r.rows.length === 0) throw new PagoInvalido("Esa cuenta no existe.");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO fin_cuentas_banco (tenant_id, nombre, banco, terminacion, moneda)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [tenantId, datos.nombre.trim(), datos.banco ?? null, datos.terminacion ?? null, datos.moneda ?? "CRC"]
  );
  return r.rows[0];
}

export { CuentaPorPagarInvalida };
