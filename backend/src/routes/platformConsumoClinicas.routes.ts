import { Request, Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import {
  bloquear,
  contarUsuariosActivos,
  desbloquear,
  listarHistorialCicloVida,
  reactivarManualmente,
  suspenderManualmente,
  TransicionInvalidaError,
} from "../suspensionBloqueo";

// ---------------------------------------------------------------------
// Platform Admin — consumo y saldo por clínica. El ajuste manual es la
// operación más sensible de este router: escribe crédito real (bolsa
// 'comprado', el mismo patrón de movimientos_credito que usa el motor de
// crédito para consumo/recargas/colchón — ver tarifas.ts) y exige motivo
// obligatorio. Queda auditada dos veces: por el registro en
// movimientos_credito en sí (que sobrevive como comprobante) y por el
// middleware global de auditoría (bitacora_auditoria) que ya cubre
// cualquier escritura autenticada.
// ---------------------------------------------------------------------

export const platformConsumoClinicasRouter = Router();

platformConsumoClinicasRouter.use(authenticate, withTenantClient);

platformConsumoClinicasRouter.use((req, res, next) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "El consumo por clínica es solo para super_admin." });
  }
  next();
});

const CONCEPTO_LABEL: Record<string, string> = {
  clinico: "Casos clínicos procesados",
  regeneracion: "Regeneraciones de dashboard",
  operativo: "Operativo",
  cortesia: "Cortesía",
};

// GET /clinicas — listado con filtros por estado y plan.
platformConsumoClinicasRouter.get("/clinicas", async (req, res) => {
  const { q, estado, planId } = req.query as { q?: string; estado?: string; planId?: string };
  try {
    const result = await req.db!.query(
      `SELECT t.id AS tenant_id, t.nombre, p.id AS plan_id, p.nombre AS plan_nombre, p.codigo AS plan_codigo,
              s.estado, s.proximo_cobro_en, s.periodo_fin,
              COALESCE(sa.credito_plan_usd, 0) AS credito_plan_usd,
              COALESCE(sa.credito_comprado_usd, 0) AS credito_comprado_usd,
              COALESCE(consumo.monto, 0) AS consumo_periodo_usd
       FROM tenants t
       JOIN suscripciones s ON s.id = t.suscripcion_id
       JOIN planes p ON p.id = s.plan_id
       LEFT JOIN saldos_ia sa ON sa.tenant_id = t.id
       LEFT JOIN LATERAL (
         SELECT SUM(costo_usd_calculado) AS monto FROM uso_api
         WHERE tenant_id = t.id AND "timestamp" >= s.periodo_inicio
       ) consumo ON true
       WHERE ($1::varchar IS NULL OR t.nombre ILIKE '%' || $1 || '%')
         AND ($2::varchar IS NULL OR s.estado = $2)
         AND ($3::uuid IS NULL OR p.id = $3)
       ORDER BY t.nombre`,
      [q ?? null, estado ?? null, planId ?? null]
    );

    res.json({
      clinicas: result.rows.map((r) => ({
        tenantId: r.tenant_id,
        nombre: r.nombre,
        plan: { id: r.plan_id, nombre: r.plan_nombre, codigo: r.plan_codigo },
        estado: r.estado,
        saldoUsd: Number(r.credito_plan_usd) + Number(r.credito_comprado_usd),
        consumoPeriodoUsd: Number(r.consumo_periodo_usd),
        proximoCobro: r.estado === "prueba" ? r.periodo_fin : r.proximo_cobro_en,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/clinicas", err);
    res.status(500).json({ error: "Error al listar clínicas." });
  }
});

// GET /clinicas/resumen — tarjetas agregadas.
platformConsumoClinicasRouter.get("/clinicas/resumen", async (req, res) => {
  try {
    const agregadoResult = await req.db!.query(
      `SELECT
         COUNT(*) FILTER (WHERE s.estado NOT IN ('prueba', 'cancelada', 'finalizada')) AS clinicas_activas,
         COUNT(*) FILTER (WHERE s.estado = 'prueba') AS clinicas_prueba,
         COALESCE(SUM(
           CASE WHEN s.periodicidad = 'anual' THEN s.precio_pactado_usd / 12 ELSE s.precio_pactado_usd END
         ) FILTER (WHERE s.estado NOT IN ('prueba', 'cancelada', 'finalizada')), 0) AS ingresos_recurrentes_usd
       FROM tenants t
       JOIN suscripciones s ON s.id = t.suscripcion_id`
    );
    const consumoResult = await req.db!.query(
      `SELECT COALESCE(SUM(costo_usd_calculado), 0) AS consumo
       FROM uso_api WHERE "timestamp" >= date_trunc('month', now())`
    );

    res.json({
      clinicasActivas: Number(agregadoResult.rows[0].clinicas_activas),
      clinicasPrueba: Number(agregadoResult.rows[0].clinicas_prueba),
      consumoAgregadoMesUsd: Number(consumoResult.rows[0].consumo),
      ingresosRecurrentesUsd: Number(agregadoResult.rows[0].ingresos_recurrentes_usd),
    });
  } catch (err) {
    console.error("GET /platform-admin/clinicas/resumen", err);
    res.status(500).json({ error: "Error al calcular el resumen de clínicas." });
  }
});

// GET /clinicas/rentabilidad — prompt_code_panel_consumo_sin_api, Bloque 3
// ("¿Qué clínica me conviene?"). Período fijo de 30 días, consistente con
// el gráfico y el desglose de bolsas del panel de saldo del proveedor.
// DEBE registrarse antes de "/clinicas/:tenantId" — si no, Express la
// matchea como tenantId="rentabilidad".
//
// La comisión de pasarela (cobros.comision_pasarela) está NULL en todos
// los cobros existentes (062) — nunca se trata como cero: si algún cobro
// del período no tiene el dato, comisionConocida queda en false y el
// margen se calcula SIN comisión, marcado como tal para que el panel lo
// muestre explícitamente.
platformConsumoClinicasRouter.get("/clinicas/rentabilidad", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT t.id AS tenant_id, t.nombre, s.estado, p.credito_ia_usd,
              COALESCE(ingreso.monto, 0) AS ingreso_usd,
              COALESCE(consumo.monto, 0) AS costo_ia_usd,
              COALESCE(bonif.monto, 0) AS bonificacion_usd,
              comision.suma AS comision_suma_usd,
              COALESCE(comision.faltantes, 0) AS comision_faltantes
       FROM tenants t
       JOIN suscripciones s ON s.id = t.suscripcion_id
       JOIN planes p ON p.id = s.plan_id
       LEFT JOIN LATERAL (
         SELECT SUM(monto) AS monto FROM cobros
         WHERE tenant_id = t.id AND estado = 'exitoso' AND tipo IN ('suscripcion', 'recarga')
           AND creado_en >= now() - interval '30 days'
       ) ingreso ON true
       LEFT JOIN LATERAL (
         SELECT SUM(costo_usd_calculado) AS monto FROM uso_api
         WHERE tenant_id = t.id AND "timestamp" >= now() - interval '30 days'
       ) consumo ON true
       LEFT JOIN LATERAL (
         SELECT SUM(credito_acreditado_usd - monto_pagado_usd) AS monto FROM recargas
         WHERE tenant_id = t.id AND estado = 'acreditada' AND creada_en >= now() - interval '30 days'
       ) bonif ON true
       LEFT JOIN LATERAL (
         SELECT SUM(comision_pasarela) AS suma, COUNT(*) FILTER (WHERE comision_pasarela IS NULL) AS faltantes
         FROM cobros
         WHERE tenant_id = t.id AND estado = 'exitoso' AND creado_en >= now() - interval '30 days'
       ) comision ON true
       WHERE s.estado NOT IN ('cancelada', 'finalizada')
       ORDER BY t.nombre`
    );

    const UMBRAL_CONSUMO_CERCA_DE_INGRESO = 0.8; // señal 1
    const UMBRAL_BAJO_CONSUMO_RELATIVO = 0.2; // señal 2

    const clinicas = result.rows.map((r) => {
      const ingresoUsd = Number(r.ingreso_usd);
      const costoIaUsd = Number(r.costo_ia_usd);
      const bonificacionUsd = Number(r.bonificacion_usd);
      const comisionFaltantes = Number(r.comision_faltantes);
      const comisionConocida = comisionFaltantes === 0;
      const comisionUsd = comisionConocida ? Number(r.comision_suma_usd ?? 0) : 0;

      const costoTotalUsd = costoIaUsd + bonificacionUsd + comisionUsd;
      const margenUsd = ingresoUsd - costoTotalUsd;
      const proporcionIaSobreIngreso = ingresoUsd > 0 ? costoIaUsd / ingresoUsd : null;

      const creditoIaUsd = Number(r.credito_ia_usd);
      const proporcionConsumoSobreCredito = creditoIaUsd > 0 ? costoIaUsd / creditoIaUsd : null;

      return {
        tenantId: r.tenant_id,
        nombre: r.nombre,
        estado: r.estado,
        ingresoUsd,
        costoIaUsd,
        bonificacionUsd,
        comisionUsd,
        comisionConocida,
        margenUsd,
        margenSinComision: !comisionConocida,
        proporcionIaSobreIngreso,
        senalConsumoCercaDeIngreso:
          proporcionIaSobreIngreso !== null && proporcionIaSobreIngreso >= UMBRAL_CONSUMO_CERCA_DE_INGRESO,
        senalBajoConsumoRelativo:
          proporcionConsumoSobreCredito !== null && proporcionConsumoSobreCredito < UMBRAL_BAJO_CONSUMO_RELATIVO,
      };
    });

    res.json({ periodoDias: 30, clinicas });
  } catch (err) {
    console.error("GET /platform-admin/clinicas/rentabilidad", err);
    res.status(500).json({ error: "Error al calcular la rentabilidad por clínica." });
  }
});

// GET /clinicas/:tenantId — detalle: desglose de consumo del período por
// tipo + historial de movimientos de crédito.
platformConsumoClinicasRouter.get("/clinicas/:tenantId", async (req, res) => {
  const { tenantId } = req.params;
  try {
    const clinicaResult = await req.db!.query(
      `SELECT t.nombre, p.nombre AS plan_nombre, s.estado, s.periodo_inicio,
              COALESCE(sa.credito_plan_usd, 0) AS credito_plan_usd,
              COALESCE(sa.credito_comprado_usd, 0) AS credito_comprado_usd
       FROM tenants t
       JOIN suscripciones s ON s.id = t.suscripcion_id
       JOIN planes p ON p.id = s.plan_id
       LEFT JOIN saldos_ia sa ON sa.tenant_id = t.id
       WHERE t.id = $1`,
      [tenantId]
    );
    const clinica = clinicaResult.rows[0];
    if (!clinica) return res.status(404).json({ error: "Clínica no encontrada." });

    const desgloseResult = await req.db!.query(
      `SELECT tipo_consumo, COUNT(*) AS cantidad, COALESCE(SUM(costo_usd_calculado), 0) AS monto_usd
       FROM uso_api WHERE tenant_id = $1 AND "timestamp" >= $2
       GROUP BY tipo_consumo ORDER BY monto_usd DESC`,
      [tenantId, clinica.periodo_inicio]
    );

    const movimientosResult = await req.db!.query(
      `SELECT mc.id, mc.tipo, mc.bolsa, mc.monto_usd, mc.saldo_plan_post, mc.saldo_comprado_post,
              mc.descripcion, mc.creado_en, COALESCE(p.nombre, sp.nombre, 'Sistema') AS operador
       FROM movimientos_credito mc
       LEFT JOIN personas p ON p.id = mc.creado_por
       LEFT JOIN staff_plataforma sp ON sp.id = mc.creado_por
       WHERE mc.tenant_id = $1
       ORDER BY mc.creado_en DESC
       LIMIT 100`,
      [tenantId]
    );

    const usuariosActivos = await contarUsuariosActivos(req.db!, tenantId);
    const historialCicloVida = await listarHistorialCicloVida(req.db!, tenantId);

    res.json({
      nombre: clinica.nombre,
      plan: clinica.plan_nombre,
      estado: clinica.estado,
      saldoUsd: Number(clinica.credito_plan_usd) + Number(clinica.credito_comprado_usd),
      usuariosActivos,
      desgloseConsumo: desgloseResult.rows.map((r) => ({
        tipo: r.tipo_consumo,
        etiqueta: CONCEPTO_LABEL[r.tipo_consumo] ?? r.tipo_consumo,
        cantidad: Number(r.cantidad),
        montoUsd: Number(r.monto_usd),
      })),
      movimientos: movimientosResult.rows.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        bolsa: m.bolsa,
        montoUsd: Number(m.monto_usd),
        saldoPlanPost: Number(m.saldo_plan_post),
        saldoCompradoPost: Number(m.saldo_comprado_post),
        descripcion: m.descripcion,
        operador: m.operador,
        creadoEn: m.creado_en,
      })),
      historialCicloVida: historialCicloVida.map((e) => ({
        id: e.id,
        tipoEvento: e.tipoEvento,
        motivo: e.motivo,
        estadoAnterior: e.estadoAnterior,
        estadoNuevo: e.estadoNuevo,
        ejecutadoPorNombre: e.ejecutadoPorNombre,
        ejecutadoEn: e.ejecutadoEn,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/clinicas/:tenantId", err);
    res.status(500).json({ error: "Error al obtener el detalle de la clínica." });
  }
});

// POST /clinicas/:tenantId/ajuste-saldo — motivo obligatorio, siempre
// contra la bolsa 'comprado' (no expira, no está atada a un período de
// plan) — el mismo patrón de escritura doble (saldos_ia + movimientos_credito
// con saldo_post) que usa el motor de crédito para consumo/recargas/colchón.
platformConsumoClinicasRouter.post("/clinicas/:tenantId/ajuste-saldo", async (req, res) => {
  const { tenantId } = req.params;
  const { montoUsd, motivo } = req.body as { montoUsd?: number; motivo?: string };

  if (typeof montoUsd !== "number" || !Number.isFinite(montoUsd) || montoUsd === 0) {
    return res.status(400).json({ error: "El monto del ajuste debe ser un número distinto de cero." });
  }
  if (!motivo || !motivo.trim()) {
    return res.status(400).json({ error: "El motivo del ajuste es obligatorio." });
  }

  try {
    const saldoResult = await req.db!.query(
      `UPDATE saldos_ia
       SET credito_comprado_usd = credito_comprado_usd + $1, actualizado_en = now()
       WHERE tenant_id = $2
       RETURNING credito_plan_usd, credito_comprado_usd`,
      [montoUsd, tenantId]
    );
    if (saldoResult.rows.length === 0) {
      return res.status(404).json({ error: "Clínica no encontrada." });
    }

    await req.db!.query(
      `INSERT INTO movimientos_credito
         (tenant_id, tipo, bolsa, monto_usd, saldo_plan_post, saldo_comprado_post, descripcion, creado_por)
       VALUES ($1, 'ajuste_admin', 'comprado', $2, $3, $4, $5, $6)`,
      [
        tenantId,
        montoUsd.toFixed(4),
        Number(saldoResult.rows[0].credito_plan_usd).toFixed(4),
        Number(saldoResult.rows[0].credito_comprado_usd).toFixed(4),
        motivo.trim(),
        req.auth!.userId,
      ]
    );

    res.status(201).json({
      saldoUsd: Number(saldoResult.rows[0].credito_plan_usd) + Number(saldoResult.rows[0].credito_comprado_usd),
    });
  } catch (err) {
    console.error("POST /platform-admin/clinicas/:tenantId/ajuste-saldo", err);
    res.status(500).json({ error: "Error al aplicar el ajuste de saldo." });
  }
});

// ---------------------------------------------------------------------
// Vetline_Ai_Suspension_Bloqueo.md — 4 acciones manuales de ciclo de
// vida. Todas motivo obligatorio, todas quedan en clinica_eventos_ciclo_
// vida (ver suspensionBloqueo.ts). ejecutado_por es req.auth!.userId, que
// para un super_admin es el id de staff_plataforma (no de personas).
// ---------------------------------------------------------------------

function leerMotivoObligatorio(req: Request, res: Response): string | null {
  const { motivo } = req.body as { motivo?: string };
  if (!motivo || !motivo.trim()) {
    res.status(400).json({ error: "El motivo es obligatorio." });
    return null;
  }
  return motivo.trim();
}

platformConsumoClinicasRouter.post("/clinicas/:tenantId/suspender", async (req, res) => {
  const motivo = leerMotivoObligatorio(req, res);
  if (motivo === null) return;
  try {
    await suspenderManualmente(req.db!, req.params.tenantId, motivo, req.auth!.userId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof TransicionInvalidaError) return res.status(409).json({ error: err.message });
    console.error("POST /platform-admin/clinicas/:tenantId/suspender", err);
    res.status(500).json({ error: "Error al suspender la clínica." });
  }
});

platformConsumoClinicasRouter.post("/clinicas/:tenantId/reactivar", async (req, res) => {
  const motivo = leerMotivoObligatorio(req, res);
  if (motivo === null) return;
  try {
    await reactivarManualmente(req.db!, req.params.tenantId, motivo, req.auth!.userId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof TransicionInvalidaError) return res.status(409).json({ error: err.message });
    console.error("POST /platform-admin/clinicas/:tenantId/reactivar", err);
    res.status(500).json({ error: "Error al reactivar la clínica." });
  }
});

platformConsumoClinicasRouter.post("/clinicas/:tenantId/bloquear", async (req, res) => {
  const motivo = leerMotivoObligatorio(req, res);
  if (motivo === null) return;
  try {
    await bloquear(req.db!, req.params.tenantId, motivo, req.auth!.userId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof TransicionInvalidaError) return res.status(409).json({ error: err.message });
    console.error("POST /platform-admin/clinicas/:tenantId/bloquear", err);
    res.status(500).json({ error: "Error al bloquear la clínica." });
  }
});

platformConsumoClinicasRouter.post("/clinicas/:tenantId/desbloquear", async (req, res) => {
  const motivo = leerMotivoObligatorio(req, res);
  if (motivo === null) return;
  try {
    await desbloquear(req.db!, req.params.tenantId, motivo, req.auth!.userId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof TransicionInvalidaError) return res.status(409).json({ error: err.message });
    console.error("POST /platform-admin/clinicas/:tenantId/desbloquear", err);
    res.status(500).json({ error: "Error al desbloquear la clínica." });
  }
});
