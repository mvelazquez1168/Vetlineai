import { PoolClient } from "pg";
import { obtenerProveedorPagos } from "./proveedorPagos";
import { calcularImpuestoPais } from "./documentoFiscal";

// ---------------------------------------------------------------------
// Motor de cobros, Paso 7 — CONVERSIÓN: una clínica en 'prueba' pasa a
// pagar. Pregunta qué agentes quiere (nunca arrastra los de la prueba —
// por eso `agentesElegidos` es una selección nueva, no una lectura de
// tenant_agentes actual) y cobra el primer período completo. Reutiliza
// cambios_suscripcion/cambio_agentes_conservados con tipo
// 'conversion_prueba', mismo patrón que upgrade/downgrade.
// ---------------------------------------------------------------------

export type ResultadoEjecutarConversion =
  | { ok: true }
  | {
      ok: false;
      motivo: "suscripcion_no_encontrada" | "plan_no_encontrado" | "sin_metodo_pago" | "no_esta_en_prueba" | "envio_fallido";
      mensajeError?: string;
    };

export async function ejecutarConversionPrueba(
  db: PoolClient,
  tenantId: string,
  personaId: string,
  params: { planDestinoId: string; agentesElegidos: string[] }
): Promise<ResultadoEjecutarConversion> {
  const suscResult = await db.query(
    `SELECT s.id, s.estado, s.periodicidad
     FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE t.id = $1`,
    [tenantId]
  );
  const susc = suscResult.rows[0];
  if (!susc) return { ok: false, motivo: "suscripcion_no_encontrada" };
  if (susc.estado !== "prueba") return { ok: false, motivo: "no_esta_en_prueba" };

  const planResult = await db.query(
    `SELECT id, nombre, agentes_incluidos, medicos_incluidos, credito_ia_usd, precio_mensual_usd, precio_anual_usd
     FROM planes WHERE id = $1 AND activo = true`,
    [params.planDestinoId]
  );
  const plan = planResult.rows[0];
  if (!plan) return { ok: false, motivo: "plan_no_encontrado" };

  const metodoResult = await db.query(
    `SELECT id, referencia_externa FROM metodos_pago WHERE tenant_id = $1 AND predeterminado = true AND estado != 'eliminado'`,
    [tenantId]
  );
  const metodo = metodoResult.rows[0];
  if (!metodo) return { ok: false, motivo: "sin_metodo_pago" };

  const tenantResult = await db.query(`SELECT pais_codigo FROM tenants WHERE id = $1`, [tenantId]);
  const paisCodigo: string = tenantResult.rows[0]?.pais_codigo;
  if (!paisCodigo) return { ok: false, motivo: "suscripcion_no_encontrada" };

  const precioPeriodo =
    susc.periodicidad === "anual" && plan.precio_anual_usd != null
      ? Number(plan.precio_anual_usd)
      : Number(plan.precio_mensual_usd);
  const creditoPlan = Number(plan.credito_ia_usd);

  const { impuestoUsd } = await calcularImpuestoPais(db, paisCodigo, precioPeriodo);
  const intervalo = susc.periodicidad === "anual" ? "1 year" : "1 month";
  const orderNumber = `conversion_${tenantId.slice(0, 8)}_${Date.now()}`;

  const cobroResult = await db.query(
    `INSERT INTO cobros
       (tenant_id, proveedor, order_number, monto, neto_usd, impuesto_usd, moneda, estado, tipo,
        metodo_pago_id, suscripcion_id, periodo_inicio, periodo_fin)
     VALUES ($1, 'simulado', $2, $3, $4, $5, 'USD', 'pendiente', 'conversion_prueba', $6, $7, now(), now() + $8::interval)
     RETURNING id`,
    [
      tenantId,
      orderNumber,
      Number((precioPeriodo + impuestoUsd).toFixed(2)),
      precioPeriodo.toFixed(2),
      impuestoUsd.toFixed(2),
      metodo.id,
      susc.id,
      intervalo,
    ]
  );
  const cobroId = cobroResult.rows[0].id;

  // 'espera_pago', no 'programado' — ver migración 056 / cambios.ts:
  // solicitarDowngrade solo toca filas 'programado', así que un cambio a
  // la espera de que confirme el cobro nunca puede quedar en riesgo de
  // que otro flujo lo cancele por error.
  const cambioResult = await db.query(
    `INSERT INTO cambios_suscripcion
       (suscripcion_id, tipo, plan_destino_id, agentes_destino, medicos_destino, estado, efectivo_en,
        cobro_id, monto_prorrateado_usd, credito_prorrateado_usd, solicitado_por)
     VALUES ($1, 'conversion_prueba', $2, $3, $4, 'espera_pago', now(), $5, $6, $7, $8)
     RETURNING id`,
    [
      susc.id,
      plan.id,
      plan.agentes_incluidos,
      plan.medicos_incluidos,
      cobroId,
      precioPeriodo,
      creditoPlan,
      personaId,
    ]
  );
  const cambioId = cambioResult.rows[0].id;

  for (const agenteId of params.agentesElegidos) {
    await db.query(`INSERT INTO cambio_agentes_conservados (cambio_id, agente_id) VALUES ($1, $2)`, [
      cambioId,
      agenteId,
    ]);
  }

  const proveedor = obtenerProveedorPagos();
  const envio = await proveedor.ejecutarCargo(paisCodigo, {
    referenciaMetodoPago: metodo.referencia_externa,
    montoUsd: precioPeriodo,
    ordenId: orderNumber,
    descripcion: `Conversión de prueba a ${plan.nombre}`,
  });

  if (!envio.enviado) {
    await db.query("BEGIN");
    try {
      await db.query(`UPDATE cobros SET estado = 'fallido', mensaje_error = $1 WHERE id = $2`, [
        envio.mensajeError ?? "No se pudo enviar el cargo a la pasarela.",
        cobroId,
      ]);
      await db.query(`UPDATE cambios_suscripcion SET estado = 'fallido' WHERE id = $1`, [cambioId]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
    return { ok: false, motivo: "envio_fallido", mensajeError: envio.mensajeError };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------
// Confirmación por callback (llamadas SOLO desde pagos/callbackCobros.ts).
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function confirmarConversionExitosa(client: PoolClient, cobro: any): Promise<void> {
  // AND estado = 'espera_pago' — mismo motivo que confirmarUpgradeExitoso:
  // un callback repetido no debe reaplicar la conversión sobre una fila
  // que ya se resolvió.
  const cambioResult = await client.query(
    `UPDATE cambios_suscripcion SET estado = 'ejecutado', ejecutado_en = now()
     WHERE cobro_id = $1 AND estado = 'espera_pago'
     RETURNING id, suscripcion_id, plan_destino_id, monto_prorrateado_usd, credito_prorrateado_usd`,
    [cobro.id]
  );
  const cambio = cambioResult.rows[0];
  if (!cambio) {
    console.error(`[conversionPrueba] Cobro ${cobro.id} exitoso pero no hay cambios_suscripcion en espera_pago asociado (¿callback duplicado?).`);
    return;
  }

  const planResult = await client.query(
    `SELECT agentes_incluidos, medicos_incluidos FROM planes WHERE id = $1`,
    [cambio.plan_destino_id]
  );
  const plan = planResult.rows[0];

  const suscResult = await client.query(`SELECT periodicidad FROM suscripciones WHERE id = $1`, [
    cambio.suscripcion_id,
  ]);
  const intervalo = suscResult.rows[0]?.periodicidad === "anual" ? "1 year" : "1 month";

  // El primer período paga arranca AHORA — a diferencia del ciclo
  // recurrente normal (que nunca toca periodo_inicio/fin desde el motor
  // de cobros), acá es la conversión misma la que define cuándo empieza
  // a correr el primer ciclo pago.
  await client.query(
    `UPDATE suscripciones
     SET plan_id = $1, precio_pactado_usd = $2, credito_pactado_usd = $3,
         agentes_contratados = $4, medicos_contratados = $5, estado = 'activa',
         periodo_inicio = now(), periodo_fin = now() + $6::interval, cobro_intento_desde = NULL
     WHERE id = $7`,
    [
      cambio.plan_destino_id,
      cambio.monto_prorrateado_usd,
      cambio.credito_prorrateado_usd,
      plan?.agentes_incluidos ?? null,
      plan?.medicos_incluidos ?? null,
      intervalo,
      cambio.suscripcion_id,
    ]
  );

  await client.query(
    `UPDATE tenants SET purga_programada_para = NULL, purga_aviso_en = NULL, purga_recordatorio_en = NULL
     WHERE id = $1`,
    [cobro.tenant_id]
  );

  // Habilita exactamente los agentes elegidos en la conversión — nunca
  // arrastra los que estuvieran habilitados durante la prueba.
  const elegidosResult = await client.query(`SELECT agente_id FROM cambio_agentes_conservados WHERE cambio_id = $1`, [
    cambio.id,
  ]);
  const agentesElegidos: string[] = elegidosResult.rows.map((r) => r.agente_id);

  for (const agenteId of agentesElegidos) {
    await client.query(
      `INSERT INTO tenant_agentes (tenant_id, agente_id, estado, habilitado_en, actualizado_en)
       VALUES ($1, $2, 'habilitado', now(), now())
       ON CONFLICT (tenant_id, agente_id) DO UPDATE SET estado = 'habilitado', habilitado_en = now(), actualizado_en = now()`,
      [cobro.tenant_id, agenteId]
    );
  }
  await client.query(
    `UPDATE tenant_agentes SET estado = 'deshabilitado', deshabilitado_en = now(), actualizado_en = now()
     WHERE tenant_id = $1 AND estado = 'habilitado' AND NOT (agente_id = ANY($2::uuid[]))`,
    [cobro.tenant_id, agentesElegidos]
  );

  const creditoAdicionalUsd = Number(cambio.credito_prorrateado_usd);
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
       (tenant_id, tipo, bolsa, monto_usd, referencia_tabla, referencia_id, saldo_plan_post, saldo_comprado_post, descripcion)
     VALUES ($1, 'conversion_prueba', 'plan', $2, 'cobros', $3, $4, $5, $6)`,
    [
      cobro.tenant_id,
      creditoAdicionalUsd.toFixed(4),
      cobro.id,
      Number(saldoResult.rows[0].credito_plan_usd).toFixed(4),
      Number(saldoResult.rows[0].credito_comprado_usd).toFixed(4),
      "Conversión de prueba a plan pago — crédito del primer período",
    ]
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function confirmarConversionFallida(client: PoolClient, cobro: any): Promise<void> {
  await client.query(`UPDATE cambios_suscripcion SET estado = 'fallido' WHERE cobro_id = $1 AND estado = 'espera_pago'`, [
    cobro.id,
  ]);
}
