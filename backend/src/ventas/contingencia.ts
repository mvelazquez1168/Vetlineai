import { PoolClient } from "pg";
import { emitir } from "../facturacion/emision";
import { DocumentoVenta } from "../facturacion/tipos";
import { lineasParaFacturar } from "./cuentas";

// ---------------------------------------------------------------------
// CONTINGENCIA SIN INTERNET.
//
// Hay DOS contingencias distintas y conviene no confundirlas:
//
//   * **Hacienda caída, con internet.** Ya la resuelve el facturador:
//     el comprobante se firma, queda en cola y el job lo reintenta. La
//     venta nunca se bloquea. Acá no hay nada que hacer.
//
//   * **Sin internet.** El sistema no puede ni firmar ni enviar. Ahí se
//     usa el talonario de provisionales en papel, y después se
//     regulariza.
//
// LA REFERENCIA, confirmada contra la fuente: el catálogo de códigos de
// referencia del Anexo 4.4 (Nota 9) define el código **05**,
// "Sustituye comprobante provisional por contingencia". Es exactamente
// este caso, y es el que se usa al regularizar.
//
// LA FECHA QUE VALE ES LA DE LA VENTA, no la de la regularización. Por
// eso el provisional guarda `fecha_venta` y el comprobante se emite con
// ella: emitir con la fecha de hoy una venta de anteayer declararía mal
// el período.
// ---------------------------------------------------------------------

/** Nota 9 del Anexo 4.4. */
export const CODIGO_REFERENCIA_PROVISIONAL = "05";
/** Nota 10: el documento referenciado es "Otros" (un papel, no un XML). */
export const TIPO_DOC_REFERENCIA_OTROS = "99";

/**
 * Emite un talonario de provisionales prenumerados.
 *
 * Se generan POR ADELANTADO y en bloque: cuando no hay internet
 * tampoco hay sistema para pedir un número, así que los números tienen
 * que existir en el papel antes de que haga falta.
 */
export async function emitirTalonario(
  db: PoolClient,
  tenantId: string,
  datos: { cajaId?: string; cantidad: number }
): Promise<{ desde: number; hasta: number; numeros: number[] }> {
  if (!(datos.cantidad > 0) || datos.cantidad > 500) {
    throw new Error("El talonario va de 1 a 500 comprobantes por vez.");
  }

  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':vta_provisional'))`, [tenantId]);
  const ultimo = await db.query<{ numero: number }>(
    `SELECT COALESCE(max(numero), 0) AS numero FROM vta_provisionales WHERE tenant_id = $1`,
    [tenantId]
  );
  const desde = Number(ultimo.rows[0].numero) + 1;
  const numeros: number[] = [];

  for (let i = 0; i < datos.cantidad; i++) {
    const numero = desde + i;
    await db.query(
      `INSERT INTO vta_provisionales (tenant_id, caja_id, numero) VALUES ($1,$2,$3)`,
      [tenantId, datos.cajaId ?? null, numero]
    );
    numeros.push(numero);
  }

  return { desde, hasta: desde + datos.cantidad - 1, numeros };
}

export interface ResultadoRegularizacion {
  provisionalId: string;
  comprobanteId: string;
  consecutivo: string;
  estado: string;
}

/**
 * Regulariza una venta hecha en contingencia.
 *
 * Emite el comprobante electrónico **con la fecha real de la venta** y
 * con la referencia al provisional de papel, usando el código 05 del
 * Anexo 4.4.
 */
export async function regularizarProvisional(
  db: PoolClient,
  tenantId: string,
  datos: {
    numeroProvisional: number;
    cuentaId: string;
    fechaVenta: string;
    tipoComprobante?: "01" | "04";
    receptor?: DocumentoVenta["receptor"];
    condicionVenta?: string;
    mediosPago?: Array<{ codigo: string; monto?: number }>;
  }
): Promise<ResultadoRegularizacion> {
  const p = await db.query<{ id: string; estado: string }>(
    `SELECT id, estado FROM vta_provisionales WHERE tenant_id = $1 AND numero = $2`,
    [tenantId, datos.numeroProvisional]
  );
  if (p.rows.length === 0) {
    throw new Error(
      `El provisional ${datos.numeroProvisional} no está en el talonario. Los números se emiten antes de usarlos.`
    );
  }
  if (p.rows[0].estado === "regularizado") {
    throw new Error(`El provisional ${datos.numeroProvisional} ya fue regularizado.`);
  }
  if (p.rows[0].estado === "anulado") {
    throw new Error(`El provisional ${datos.numeroProvisional} está anulado.`);
  }

  const lineas = await lineasParaFacturar(db, datos.cuentaId);
  if (lineas.length === 0) {
    throw new Error("La cuenta de esa venta no tiene cargos: no hay nada que regularizar.");
  }

  const emitido = await emitir(tenantId, {
    tipoComprobante: datos.tipoComprobante ?? (datos.receptor?.identificacion ? "01" : "04"),
    condicionVenta: datos.condicionVenta ?? "01",
    // LA FECHA REAL de la venta, no la de hoy.
    fechaEmision: datos.fechaVenta,
    receptor: datos.receptor,
    lineas,
    mediosPago: datos.mediosPago ?? [{ codigo: "01" }],
    referencias: [
      {
        tipoDocumento: TIPO_DOC_REFERENCIA_OTROS,
        tipoDocumentoOtro: "Comprobante provisional por contingencia",
        numero: String(datos.numeroProvisional),
        fechaEmision: datos.fechaVenta,
        codigo: CODIGO_REFERENCIA_PROVISIONAL,
        razon: `Sustituye el comprobante provisional ${datos.numeroProvisional} emitido en contingencia`,
      },
    ],
    claveIdempotencia: `provisional:${p.rows[0].id}`,
  });

  await db.query(
    `UPDATE vta_provisionales
        SET estado = 'regularizado', fecha_venta = $2::timestamptz, cuenta_id = $3,
            comprobante_id = $4, regularizado_en = now()
      WHERE id = $1`,
    [p.rows[0].id, datos.fechaVenta, datos.cuentaId, emitido.comprobanteId]
  );

  return {
    provisionalId: p.rows[0].id,
    comprobanteId: emitido.comprobanteId,
    consecutivo: emitido.consecutivo,
    estado: emitido.estado,
  };
}

export async function provisionalesPendientes(db: PoolClient) {
  const r = await db.query(
    `SELECT p.*, c.nombre AS caja
       FROM vta_provisionales p LEFT JOIN vta_cajas c ON c.id = p.caja_id
      WHERE p.estado IN ('disponible','usado')
      ORDER BY p.numero LIMIT 500`
  );
  return r.rows;
}
