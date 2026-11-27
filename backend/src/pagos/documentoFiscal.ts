import { fechaHoyEnZona } from "../fecha";
import { Pool, PoolClient } from "pg";
import crypto from "crypto";

// ---------------------------------------------------------------------
// Motor de cobros, Paso 8 — documento fiscal. Se emite CON la
// confirmación del cobro, nunca antes (se llama solo desde el camino de
// "cobro exitoso" del callback). Los datos fiscales del cliente se
// COPIAN acá, no se referencian — si el tenant edita su nombre fiscal
// después, los documentos ya emitidos no deben cambiar retroactivamente.
//
// La emisión electrónica queda fuera de alcance (pedido explícito): esto
// deja el registro interno completo, con estado_externo='no_aplica', y
// el lugar exacto donde un adaptador por país (Hacienda CR, etc.)
// engancharía más adelante sin tocar el resto del motor de cobros.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

// Tasa vigente del país al momento de llamar — usada tanto para calcular
// el impuesto al CREAR un cobro (Paso 8: "se calcula al momento del
// cobro") como, internamente acá, para el documento — nunca se
// recalcula en la emisión: el documento lee el neto/impuesto que ya
// quedaron congelados en `cobros` en el momento del cargo.
export async function calcularImpuestoPais(
  db: EjecutorSql,
  paisCodigo: string,
  netoUsd: number
): Promise<{ nombre: string | null; tasa: number; impuestoUsd: number }> {
  const impuestoResult = await db.query(
    `SELECT nombre, tasa FROM impuestos_pais
     WHERE pais_codigo = $1 AND (vigente_hasta IS NULL OR vigente_hasta > now())
     ORDER BY vigente_desde DESC LIMIT 1`,
    [paisCodigo]
  );
  const impuesto = impuestoResult.rows[0];
  const tasa = impuesto ? Number(impuesto.tasa) : 0;
  return {
    nombre: impuesto?.nombre ?? null,
    tasa,
    impuestoUsd: Number((netoUsd * tasa).toFixed(2)),
  };
}

export async function emitirDocumentoFiscal(
  db: EjecutorSql,
  cobro: { id: string; tenant_id: string; neto_usd: string | number; impuesto_usd: string | number; moneda: string }
): Promise<void> {
  const tenantResult = await db.query(
    `SELECT pais_codigo, tipo_identificacion_id, numero_identificacion, nombre_fiscal,
            zona_horaria
     FROM tenants WHERE id = $1`,
    [cobro.tenant_id]
  );
  const tenant = tenantResult.rows[0];
  if (!tenant) {
    console.error(`[documentoFiscal] Tenant ${cobro.tenant_id} no encontrado — no se emite documento para cobro ${cobro.id}.`);
    return;
  }

  const tipoIdResult = tenant.tipo_identificacion_id
    ? await db.query(`SELECT etiqueta FROM tipos_identificacion WHERE id = $1`, [tenant.tipo_identificacion_id])
    : null;

  const impuestoResult = await db.query(
    `SELECT nombre, tasa FROM impuestos_pais
     WHERE pais_codigo = $1 AND (vigente_hasta IS NULL OR vigente_hasta > now())
     ORDER BY vigente_desde DESC LIMIT 1`,
    [tenant.pais_codigo]
  );
  const impuesto = impuestoResult.rows[0];

  const neto = Number(cobro.neto_usd);
  const impuestoUsd = Number(cobro.impuesto_usd);
  const total = neto + impuestoUsd;

  // La fecha del número interno es la del día de la clínica: con la de
  // UTC, un documento emitido a las 18:30 en Costa Rica se numeraba con
  // la fecha de mañana y no cuadraba con su propia fecha de emisión.
  const numeroInterno = `DOC-${fechaHoyEnZona(tenant.zona_horaria).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8)}`;

  await db.query(
    `INSERT INTO documentos_fiscales
       (tenant_id, cobro_id, tipo, numero_interno, pais_codigo, nombre_fiscal, tipo_identificacion,
        numero_identificacion, neto_usd, impuesto_nombre, impuesto_tasa, impuesto_usd, total_usd,
        moneda, estado_externo, emitido_en)
     VALUES ($1, $2, 'factura', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'no_aplica', now())`,
    [
      cobro.tenant_id,
      cobro.id,
      numeroInterno,
      tenant.pais_codigo,
      tenant.nombre_fiscal,
      tipoIdResult?.rows[0]?.etiqueta ?? null,
      tenant.numero_identificacion,
      neto.toFixed(2),
      impuesto?.nombre ?? null,
      impuesto?.tasa ?? null,
      impuestoUsd.toFixed(2),
      total.toFixed(2),
      cobro.moneda,
    ]
  );
}
