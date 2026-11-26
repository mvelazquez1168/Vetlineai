import { PoolClient } from "pg";
import { registrarMovimiento } from "./movimientos";

// ---------------------------------------------------------------------
// AJUSTES de inventario, con aprobación por encima de un umbral.
//
// Un ajuste es la forma legítima de decir "la existencia que dice el
// sistema no es la que hay". Siempre lleva motivo de catálogo —no texto
// libre— porque un motivo escrito a mano no se puede agrupar en un
// dashboard, y la pregunta que importa ("¿cuánto perdemos por rotura?")
// es exactamente una agrupación.
//
// POR QUÉ EL UMBRAL ES EN DINERO Y NO EN UNIDADES: ajustar mil gasas
// baratas no es lo mismo que ajustar una ampolla cara, y contar
// unidades no distingue los dos casos. El umbral se compara contra el
// valor de lo ajustado, al costo del lote.
//
// EL AJUSTE NO MUEVE STOCK HASTA QUE SE APLICA. Un ajuste pendiente es
// una solicitud: la existencia sigue siendo la de antes. Mover primero
// y revertir si no se aprueba dejaría el kardex con dos movimientos por
// cada ajuste rechazado y la existencia oscilando sola.
// ---------------------------------------------------------------------

export interface LineaAjuste {
  productoId: string;
  bodegaId: string;
  loteId?: string;
  /** En unidad base, siempre positiva. El signo lo da el tipo. */
  cantidadBase: string | number;
}

export interface SolicitudAjuste {
  tipo: "positivo" | "negativo";
  motivo: string;
  motivoDetalle?: string;
  lineas: LineaAjuste[];
  solicitadoPor?: string;
  conteoId?: string;
}

export interface ResultadoAjuste {
  id: string;
  estado: "pendiente" | "aplicado";
  valor: string;
  umbral: string;
  /** true si quedó esperando que un administrador lo apruebe. */
  requiereAprobacion: boolean;
}

const UMBRAL_POR_DEFECTO = 10000;

async function umbralDe(db: PoolClient, tenantId: string): Promise<number> {
  const r = await db.query<{ umbral_aprobacion_ajuste: string }>(
    `SELECT umbral_aprobacion_ajuste FROM inv_parametros WHERE tenant_id = $1`,
    [tenantId]
  );
  return r.rows.length > 0 ? Number(r.rows[0].umbral_aprobacion_ajuste) : UMBRAL_POR_DEFECTO;
}

/**
 * Cuánto vale lo que se ajusta, al costo del lote.
 *
 * Si la línea no fija lote, se usa el costo promedio de los lotes con
 * existencia de ese producto en esa bodega. Es una aproximación y está
 * dicho: el costo exacto solo se conoce cuando se sabe de qué lote
 * sale, y eso lo decide FEFO al aplicar.
 */
async function valorDe(db: PoolClient, lineas: LineaAjuste[]): Promise<number> {
  let total = 0;
  for (const l of lineas) {
    const cantidad = Number(String(l.cantidadBase).replace(",", "."));
    const r = l.loteId
      ? await db.query<{ costo: string }>(
          `SELECT costo_unitario::text AS costo FROM inv_lotes WHERE id = $1`,
          [l.loteId]
        )
      : await db.query<{ costo: string }>(
          `SELECT COALESCE(avg(costo_unitario), 0)::text AS costo FROM inv_lotes
            WHERE producto_id = $1 AND bodega_id = $2 AND cantidad > 0`,
          [l.productoId, l.bodegaId]
        );
    total += cantidad * Number(r.rows[0]?.costo ?? 0);
  }
  return total;
}

/**
 * Pide un ajuste. Si su valor no supera el umbral, se aplica en el
 * acto; si lo supera, queda pendiente de aprobación y NO mueve stock.
 */
export async function solicitarAjuste(
  db: PoolClient,
  tenantId: string,
  solicitud: SolicitudAjuste
): Promise<ResultadoAjuste> {
  if (solicitud.lineas.length === 0) {
    throw new Error("Un ajuste sin líneas no ajusta nada.");
  }

  const motivo = await db.query<{ exige_detalle: boolean }>(
    `SELECT exige_detalle FROM inv_motivos WHERE codigo = $1 AND activo`,
    [solicitud.motivo]
  );
  if (motivo.rows.length === 0) {
    throw new Error(`"${solicitud.motivo}" no es un motivo de ajuste del catálogo.`);
  }
  if (motivo.rows[0].exige_detalle && !solicitud.motivoDetalle?.trim()) {
    throw new Error("Ese motivo exige que se escriba cuál es. Sin eso, 'Otro' no dice nada.");
  }

  const umbral = await umbralDe(db, tenantId);
  const valor = await valorDe(db, solicitud.lineas);
  const requiereAprobacion = valor > umbral;

  const a = await db.query<{ id: string }>(
    `INSERT INTO inv_ajustes (tenant_id, tipo, estado, motivo, motivo_detalle, valor,
                              solicitado_por, conteo_id)
     VALUES ($1,$2,'pendiente',$3,$4,$5,$6,$7) RETURNING id`,
    [
      tenantId,
      solicitud.tipo,
      solicitud.motivo,
      solicitud.motivoDetalle ?? null,
      valor,
      solicitud.solicitadoPor ?? null,
      solicitud.conteoId ?? null,
    ]
  );
  const ajusteId = a.rows[0].id;

  for (const l of solicitud.lineas) {
    await db.query(
      `INSERT INTO inv_ajuste_lineas (tenant_id, ajuste_id, producto_id, bodega_id, lote_id,
                                      cantidad_base)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, ajusteId, l.productoId, l.bodegaId, l.loteId ?? null, l.cantidadBase]
    );
  }

  if (requiereAprobacion) {
    return { id: ajusteId, estado: "pendiente", valor: String(valor), umbral: String(umbral), requiereAprobacion };
  }

  await aplicarAjuste(db, tenantId, ajusteId);
  return { id: ajusteId, estado: "aplicado", valor: String(valor), umbral: String(umbral), requiereAprobacion };
}

/**
 * Aprueba un ajuste pendiente y lo aplica.
 *
 * Quién aprueba queda registrado junto a quién lo pidió: son dos
 * personas distintas y las dos importan para la auditoría.
 */
export async function aprobarAjuste(
  db: PoolClient,
  tenantId: string,
  ajusteId: string,
  aprobadoPor: string
): Promise<void> {
  const r = await db.query<{ estado: string; solicitado_por: string | null }>(
    `SELECT estado, solicitado_por FROM inv_ajustes WHERE id = $1`,
    [ajusteId]
  );
  if (r.rows.length === 0) throw new Error(`No existe el ajuste ${ajusteId}.`);
  if (r.rows[0].estado !== "pendiente") {
    throw new Error(`El ajuste ya está en estado "${r.rows[0].estado}": no se puede aprobar de nuevo.`);
  }

  await db.query(
    `UPDATE inv_ajustes SET estado = 'aprobado', aprobado_por = $2, aprobado_en = now()
      WHERE id = $1`,
    [ajusteId, aprobadoPor]
  );
  await aplicarAjuste(db, tenantId, ajusteId);
}

export async function rechazarAjuste(
  db: PoolClient,
  ajusteId: string,
  rechazadoPor: string
): Promise<void> {
  const r = await db.query<{ estado: string }>(`SELECT estado FROM inv_ajustes WHERE id = $1`, [
    ajusteId,
  ]);
  if (r.rows.length === 0) throw new Error(`No existe el ajuste ${ajusteId}.`);
  if (r.rows[0].estado !== "pendiente") {
    throw new Error(`El ajuste ya está en estado "${r.rows[0].estado}".`);
  }
  // Un rechazado NO mueve stock, así que no deja rastro en el kardex.
  // Queda la fila del ajuste, que es donde se ve que alguien lo pidió
  // y alguien dijo que no.
  await db.query(
    `UPDATE inv_ajustes SET estado = 'rechazado', aprobado_por = $2, aprobado_en = now()
      WHERE id = $1`,
    [ajusteId, rechazadoPor]
  );
}

/**
 * Aplica las líneas del ajuste como movimientos. Interna: se llega acá
 * por `solicitarAjuste` (bajo el umbral) o por `aprobarAjuste`.
 */
async function aplicarAjuste(db: PoolClient, tenantId: string, ajusteId: string): Promise<void> {
  const a = await db.query<{
    tipo: string;
    motivo: string;
    motivo_detalle: string | null;
    solicitado_por: string | null;
  }>(`SELECT tipo, motivo, motivo_detalle, solicitado_por FROM inv_ajustes WHERE id = $1`, [
    ajusteId,
  ]);
  const ajuste = a.rows[0];
  const tipoMovimiento = ajuste.tipo === "positivo" ? "ajuste_positivo" : "ajuste_negativo";

  const lineas = await db.query<{
    producto_id: string;
    bodega_id: string;
    lote_id: string | null;
    cantidad_base: string;
  }>(
    `SELECT producto_id, bodega_id, lote_id, cantidad_base FROM inv_ajuste_lineas
      WHERE ajuste_id = $1`,
    [ajusteId]
  );

  for (const l of lineas.rows) {
    if (tipoMovimiento === "ajuste_positivo" && !l.lote_id) {
      // Una entrada necesita saber a qué lote entra. Sin lote elegido
      // se usa el de ajustes, que es honesto: la unidad apareció y no
      // se sabe de qué tanda.
      await registrarMovimiento(db, tenantId, {
        tipo: tipoMovimiento,
        productoId: l.producto_id,
        bodegaId: l.bodega_id,
        cantidadBase: l.cantidad_base,
        lote: { numero: "AJUSTE", costoUnitario: 0 },
        motivo: ajuste.motivo,
        motivoDetalle: ajuste.motivo_detalle ?? undefined,
        personaId: ajuste.solicitado_por ?? undefined,
        ajusteId,
      });
      continue;
    }

    if (tipoMovimiento === "ajuste_positivo") {
      const lote = await db.query<{ numero: string; costo_unitario: string }>(
        `SELECT numero, costo_unitario FROM inv_lotes WHERE id = $1`,
        [l.lote_id]
      );
      await registrarMovimiento(db, tenantId, {
        tipo: tipoMovimiento,
        productoId: l.producto_id,
        bodegaId: l.bodega_id,
        cantidadBase: l.cantidad_base,
        lote: { numero: lote.rows[0].numero, costoUnitario: lote.rows[0].costo_unitario },
        motivo: ajuste.motivo,
        motivoDetalle: ajuste.motivo_detalle ?? undefined,
        personaId: ajuste.solicitado_por ?? undefined,
        ajusteId,
      });
      continue;
    }

    await registrarMovimiento(db, tenantId, {
      tipo: tipoMovimiento,
      productoId: l.producto_id,
      bodegaId: l.bodega_id,
      cantidadBase: l.cantidad_base,
      loteId: l.lote_id ?? undefined,
      motivo: ajuste.motivo,
      motivoDetalle: ajuste.motivo_detalle ?? undefined,
      personaId: ajuste.solicitado_por ?? undefined,
      ajusteId,
    });
  }

  await db.query(
    `UPDATE inv_ajustes SET estado = 'aplicado', aplicado_en = now() WHERE id = $1`,
    [ajusteId]
  );
}
