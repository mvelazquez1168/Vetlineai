import { PoolClient } from "pg";
import { obtenerProveedorPagos } from "./pagos/proveedorPagos";
import { calcularImpuestoPais } from "./pagos/documentoFiscal";

// ---------------------------------------------------------------------
// Pantallas de pago — Paso 5: upgrade de plan. A diferencia del downgrade
// (cambios.ts, programado a fin de período, nunca cobra), el upgrade
// cobra un prorrateo y se aplica DE INMEDIATO solo si el cobro es
// exitoso — nunca antes. Vive en un archivo propio (no en cambios.ts)
// porque cambios.ts fue escrito explícitamente separando el upgrade por
// depender de la pasarela, que hasta este prompt no existía ni simulada.
//
// Prorrateo (confirmado con el usuario en el Paso 1):
//   fracción = días_restantes_del_período / días_totales_del_período
//   monto_a_cobrar_hoy = (precio_nuevo − precio_actual) × fracción
//   crédito_adicional = crédito_ia_del_plan_nuevo × fracción
// El cálculo vive acá, no en el frontend — la cotización y la ejecución
// usan la MISMA función para que nunca puedan divergir.
//
// Motor de cobros — ejecutarUpgrade YA NO aplica el cambio de plan en la
// respuesta síncrona: crea el cobro y una fila `cambios_suscripcion` en
// estado 'programado' (a la espera del callback) y manda el cargo. El
// cambio de plan/crédito se aplica SOLO en confirmarUpgradeExitoso, más
// abajo, llamada exclusivamente desde pagos/callbackCobros.ts.
// ---------------------------------------------------------------------

interface DatosProrrateo {
  suscripcionId: string;
  planActualId: string;
  planActualOrden: number;
  periodicidad: string;
  precioActualUsd: number;
  periodoInicio: Date;
  periodoFin: Date;
}

async function obtenerDatosProrrateo(db: PoolClient, tenantId: string): Promise<DatosProrrateo | null> {
  const result = await db.query(
    `SELECT s.id AS suscripcion_id, s.plan_id AS plan_actual_id, pa.orden AS plan_actual_orden,
            s.periodicidad, s.precio_pactado_usd, s.periodo_inicio, s.periodo_fin
     FROM tenants t
     JOIN suscripciones s ON s.id = t.suscripcion_id
     JOIN planes pa ON pa.id = s.plan_id
     WHERE t.id = $1`,
    [tenantId]
  );
  const fila = result.rows[0];
  if (!fila) return null;
  return {
    suscripcionId: fila.suscripcion_id,
    planActualId: fila.plan_actual_id,
    planActualOrden: fila.plan_actual_orden,
    periodicidad: fila.periodicidad,
    precioActualUsd: Number(fila.precio_pactado_usd),
    periodoInicio: new Date(fila.periodo_inicio),
    periodoFin: new Date(fila.periodo_fin),
  };
}

interface PlanDestino {
  id: string;
  nombre: string;
  orden: number;
  agentesIncluidos: number | null;
  medicosIncluidos: number;
  creditoIaUsd: number;
  precioMensualUsd: number;
  precioAnualUsd: number | null;
}

async function obtenerPlanDestino(db: PoolClient, planDestinoId: string): Promise<PlanDestino | null> {
  const result = await db.query(
    `SELECT id, nombre, orden, agentes_incluidos, medicos_incluidos, credito_ia_usd, precio_mensual_usd, precio_anual_usd
     FROM planes WHERE id = $1 AND activo = true`,
    [planDestinoId]
  );
  const fila = result.rows[0];
  if (!fila) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    orden: fila.orden,
    agentesIncluidos: fila.agentes_incluidos != null ? Number(fila.agentes_incluidos) : null,
    medicosIncluidos: Number(fila.medicos_incluidos),
    creditoIaUsd: Number(fila.credito_ia_usd),
    precioMensualUsd: Number(fila.precio_mensual_usd),
    precioAnualUsd: fila.precio_anual_usd != null ? Number(fila.precio_anual_usd) : null,
  };
}

export interface CotizacionUpgrade {
  planDestinoId: string;
  planDestinoNombre: string;
  montoACobrarHoyUsd: number;
  creditoAdicionalUsd: number;
  agentesIncluidos: number | null;
  medicosIncluidos: number;
  precioProximaRenovacionUsd: number;
  fechaProximaRenovacion: string;
}

export type ResultadoCotizarUpgrade =
  | { ok: true; cotizacion: CotizacionUpgrade }
  | { ok: false; motivo: "suscripcion_no_encontrada" | "plan_no_encontrado" | "no_es_superior" };

async function calcularCotizacion(
  datos: DatosProrrateo,
  planDestino: PlanDestino
): Promise<CotizacionUpgrade> {
  const diasTotales = Math.max(
    (datos.periodoFin.getTime() - datos.periodoInicio.getTime()) / (1000 * 60 * 60 * 24),
    1
  );
  const diasRestantes = Math.max((datos.periodoFin.getTime() - Date.now()) / (1000 * 60 * 60 * 24), 0);
  const fraccion = Math.min(diasRestantes / diasTotales, 1);

  const precioNuevo = datos.periodicidad === "anual" && planDestino.precioAnualUsd != null
    ? planDestino.precioAnualUsd
    : planDestino.precioMensualUsd;

  const montoACobrarHoyUsd = Math.max((precioNuevo - datos.precioActualUsd) * fraccion, 0);
  const creditoAdicionalUsd = planDestino.creditoIaUsd * fraccion;

  return {
    planDestinoId: planDestino.id,
    planDestinoNombre: planDestino.nombre,
    montoACobrarHoyUsd: Number(montoACobrarHoyUsd.toFixed(2)),
    creditoAdicionalUsd: Number(creditoAdicionalUsd.toFixed(2)),
    agentesIncluidos: planDestino.agentesIncluidos,
    medicosIncluidos: planDestino.medicosIncluidos,
    precioProximaRenovacionUsd: precioNuevo,
    fechaProximaRenovacion: datos.periodoFin.toISOString(),
  };
}

export async function cotizarUpgrade(
  db: PoolClient,
  tenantId: string,
  planDestinoId: string
): Promise<ResultadoCotizarUpgrade> {
  const datos = await obtenerDatosProrrateo(db, tenantId);
  if (!datos) return { ok: false, motivo: "suscripcion_no_encontrada" };

  const planDestino = await obtenerPlanDestino(db, planDestinoId);
  if (!planDestino) return { ok: false, motivo: "plan_no_encontrado" };

  if (planDestino.orden <= datos.planActualOrden) return { ok: false, motivo: "no_es_superior" };

  return { ok: true, cotizacion: await calcularCotizacion(datos, planDestino) };
}

export type ResultadoEjecutarUpgrade =
  | { ok: true; cotizacion: CotizacionUpgrade }
  | { ok: false; motivo: "suscripcion_no_encontrada" | "plan_no_encontrado" | "no_es_superior" | "sin_metodo_pago" | "envio_fallido"; mensajeError?: string };

// Recalcula la cotización server-side (nunca confía en montos mandados
// por el cliente), manda el cargo y deja un `cambios_suscripcion` en
// 'programado' — el cambio de plan se aplica SOLO cuando confirma el
// callback (ver confirmarUpgradeExitoso). Si el cobro falla, esa fila
// queda en 'fallido' y la suscripción actual nunca se toca.
export async function ejecutarUpgrade(
  db: PoolClient,
  tenantId: string,
  personaId: string,
  planDestinoId: string
): Promise<ResultadoEjecutarUpgrade> {
  const datos = await obtenerDatosProrrateo(db, tenantId);
  if (!datos) return { ok: false, motivo: "suscripcion_no_encontrada" };

  const planDestino = await obtenerPlanDestino(db, planDestinoId);
  if (!planDestino) return { ok: false, motivo: "plan_no_encontrado" };
  if (planDestino.orden <= datos.planActualOrden) return { ok: false, motivo: "no_es_superior" };

  const cotizacion = await calcularCotizacion(datos, planDestino);

  const metodoResult = await db.query(
    `SELECT id, referencia_externa FROM metodos_pago WHERE tenant_id = $1 AND predeterminado = true AND estado != 'eliminado'`,
    [tenantId]
  );
  const metodo = metodoResult.rows[0];
  if (!metodo) return { ok: false, motivo: "sin_metodo_pago" };

  const tenantResult = await db.query(`SELECT pais_codigo FROM tenants WHERE id = $1`, [tenantId]);
  const paisCodigo: string = tenantResult.rows[0]?.pais_codigo;
  if (!paisCodigo) return { ok: false, motivo: "suscripcion_no_encontrada" };

  const { impuestoUsd } = await calcularImpuestoPais(db, paisCodigo, cotizacion.montoACobrarHoyUsd);
  const orderNumber = `upgrade_${tenantId.slice(0, 8)}_${Date.now()}`;
  const cobroResult = await db.query(
    `INSERT INTO cobros
       (tenant_id, proveedor, order_number, monto, neto_usd, impuesto_usd, moneda, estado, tipo,
        metodo_pago_id, suscripcion_id, periodo_inicio, periodo_fin)
     VALUES ($1, 'simulado', $2, $3, $4, $5, 'USD', 'pendiente', 'prorrateo_upgrade', $6, $7, now(), $8)
     RETURNING id`,
    [
      tenantId,
      orderNumber,
      Number((cotizacion.montoACobrarHoyUsd + impuestoUsd).toFixed(2)),
      cotizacion.montoACobrarHoyUsd.toFixed(2),
      impuestoUsd.toFixed(2),
      metodo.id,
      datos.suscripcionId,
      datos.periodoFin.toISOString(),
    ]
  );
  const cobroId = cobroResult.rows[0].id;

  await db.query(
    `INSERT INTO cambios_suscripcion
       (suscripcion_id, tipo, plan_destino_id, estado, efectivo_en, cobro_id,
        monto_prorrateado_usd, credito_prorrateado_usd, solicitado_por)
     VALUES ($1, 'upgrade', $2, 'programado', now(), $3, $4, $5, $6)`,
    [
      datos.suscripcionId,
      planDestino.id,
      cobroId,
      cotizacion.montoACobrarHoyUsd,
      cotizacion.creditoAdicionalUsd,
      personaId,
    ]
  );

  const proveedor = obtenerProveedorPagos();
  const envio = await proveedor.ejecutarCargo(paisCodigo, {
    referenciaMetodoPago: metodo.referencia_externa,
    montoUsd: cotizacion.montoACobrarHoyUsd,
    ordenId: orderNumber,
    descripcion: `Upgrade a ${planDestino.nombre}`,
  });

  if (!envio.enviado) {
    await db.query("BEGIN");
    try {
      await db.query(`UPDATE cobros SET estado = 'fallido', mensaje_error = $1 WHERE id = $2`, [
        envio.mensajeError ?? "No se pudo enviar el cargo a la pasarela.",
        cobroId,
      ]);
      await db.query(`UPDATE cambios_suscripcion SET estado = 'fallido' WHERE cobro_id = $1`, [cobroId]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
    return { ok: false, motivo: "envio_fallido", mensajeError: envio.mensajeError };
  }

  return { ok: true, cotizacion };
}

// ---------------------------------------------------------------------
// Confirmación por callback (llamadas SOLO desde pagos/callbackCobros.ts).
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function confirmarUpgradeExitoso(client: PoolClient, cobro: any): Promise<void> {
  const cambioResult = await client.query(
    `UPDATE cambios_suscripcion SET estado = 'ejecutado', ejecutado_en = now() WHERE cobro_id = $1
     RETURNING suscripcion_id, plan_destino_id, credito_prorrateado_usd, solicitado_por`,
    [cobro.id]
  );
  const cambio = cambioResult.rows[0];
  if (!cambio) {
    console.error(`[upgrade] Cobro ${cobro.id} exitoso pero no hay cambios_suscripcion asociado.`);
    return;
  }

  const planResult = await client.query(
    `SELECT nombre, agentes_incluidos, medicos_incluidos, credito_ia_usd, precio_mensual_usd, precio_anual_usd
     FROM planes WHERE id = $1`,
    [cambio.plan_destino_id]
  );
  const plan = planResult.rows[0];
  const suscripcionResult = await client.query(`SELECT periodicidad FROM suscripciones WHERE id = $1`, [
    cambio.suscripcion_id,
  ]);
  const periodicidad = suscripcionResult.rows[0]?.periodicidad;
  const precioNuevo =
    periodicidad === "anual" && plan?.precio_anual_usd != null ? Number(plan.precio_anual_usd) : Number(plan?.precio_mensual_usd ?? 0);

  const creditoAdicionalUsd = Number(cambio.credito_prorrateado_usd);

  // Pantallas faltantes, Prompt B, Paso 4 — "contratar un plan durante la
  // ventana cancela la purga programada y restaura el acceso completo".
  // `estado = 'activa'` es un no-op si ya estaba activa.
  await client.query(
    `UPDATE suscripciones
     SET plan_id = $1, precio_pactado_usd = $2, credito_pactado_usd = credito_pactado_usd + $3,
         agentes_contratados = $4, medicos_contratados = $5, estado = 'activa'
     WHERE id = $6`,
    [
      cambio.plan_destino_id,
      precioNuevo,
      creditoAdicionalUsd,
      plan?.agentes_incluidos ?? null,
      plan?.medicos_incluidos ?? null,
      cambio.suscripcion_id,
    ]
  );

  await client.query(
    `UPDATE tenants SET purga_programada_para = NULL, purga_aviso_en = NULL, purga_recordatorio_en = NULL
     WHERE id = $1`,
    [cobro.tenant_id]
  );

  await client.query(
    `UPDATE saldos_ia SET credito_plan_usd = credito_plan_usd + $1, actualizado_en = now() WHERE tenant_id = $2`,
    [creditoAdicionalUsd, cobro.tenant_id]
  );
  const saldoResult = await client.query(
    `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1`,
    [cobro.tenant_id]
  );
  await client.query(
    `INSERT INTO movimientos_credito
       (tenant_id, tipo, bolsa, monto_usd, referencia_tabla, referencia_id, saldo_plan_post, saldo_comprado_post, descripcion, creado_por)
     VALUES ($1, 'prorrateo_upgrade', 'plan', $2, 'cobros', $3, $4, $5, $6, $7)`,
    [
      cobro.tenant_id,
      creditoAdicionalUsd.toFixed(4),
      cobro.id,
      Number(saldoResult.rows[0].credito_plan_usd).toFixed(4),
      Number(saldoResult.rows[0].credito_comprado_usd).toFixed(4),
      `Upgrade a ${plan?.nombre ?? cambio.plan_destino_id} — crédito prorrateado`,
      cambio.solicitado_por,
    ]
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function confirmarUpgradeFallido(client: PoolClient, cobro: any): Promise<void> {
  await client.query(`UPDATE cambios_suscripcion SET estado = 'fallido' WHERE cobro_id = $1`, [cobro.id]);
}
