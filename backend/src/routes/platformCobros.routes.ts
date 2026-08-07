import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { paisTieneCredenciales } from "../pagos/credencialesPasarela";

// ---------------------------------------------------------------------
// Motor de cobros, Paso 9 — verificaciones periódicas. Un solo endpoint
// agregado (no 8 sueltos) porque las 8 son la misma clase de operación
// (una consulta de reconciliación de solo lectura) y en la práctica se
// van a mirar juntas, como un panel de salud del motor de cobros.
// ---------------------------------------------------------------------

export const platformCobrosRouter = Router();

platformCobrosRouter.use(authenticate, withTenantClient);
platformCobrosRouter.use((req, res, next) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "El diagnóstico del motor de cobros es solo para super_admin." });
  }
  next();
});

async function leerParametroHoras(db: import("pg").PoolClient, clave: string, porDefecto: number): Promise<number> {
  const result = await db.query(`SELECT valor FROM parametros_plataforma WHERE clave = $1`, [clave]);
  return result.rows[0]?.valor != null ? Number(result.rows[0].valor) : porDefecto;
}

platformCobrosRouter.get("/diagnostico", async (req, res) => {
  const db = req.db!;
  try {
    const plazoPendienteHoras = await leerParametroHoras(db, "cobro.plazo_pendiente_horas", 24);

    // 1. Cobros pendiente más allá del plazo razonable — callback perdido.
    const cobrosPendientesVencidos = await db.query(
      `SELECT id, tenant_id, tipo, order_number, monto, creado_en
       FROM cobros WHERE estado = 'pendiente' AND creado_en < now() - ($1 || ' hours')::interval
       ORDER BY creado_en ASC LIMIT 100`,
      [plazoPendienteHoras]
    );

    // 2. Recargas pendiente cuyo cobro ya está exitoso — el crédito no se
    // acreditó (debería ser imposible si el callback corrió bien; señal
    // de un bug real, no de timing).
    const recargasSinAcreditar = await db.query(
      `SELECT r.id AS recarga_id, r.tenant_id, r.cobro_id, r.monto_pagado_usd, c.estado AS estado_cobro
       FROM recargas r JOIN cobros c ON c.id = r.cobro_id
       WHERE r.estado = 'pendiente' AND c.estado = 'exitoso'
       LIMIT 100`
    );

    // 3. Suscripciones activas sin medio de pago vigente.
    const suscripcionesSinMetodo = await db.query(
      `SELECT s.id AS suscripcion_id, s.tenant_id, t.nombre AS tenant_nombre
       FROM suscripciones s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.estado = 'activa'
         AND NOT EXISTS (
           SELECT 1 FROM metodos_pago mp WHERE mp.tenant_id = s.tenant_id AND mp.predeterminado = true AND mp.estado != 'eliminado'
         )
       LIMIT 100`
    );

    // 4. Métodos de pago por vencer (este mes o el próximo).
    const metodosPorVencer = await db.query(
      `SELECT mp.id, mp.tenant_id, t.nombre AS tenant_nombre, mp.marca, mp.ultimos4, mp.vencimiento_mes, mp.vencimiento_anio
       FROM metodos_pago mp JOIN tenants t ON t.id = mp.tenant_id
       WHERE mp.predeterminado = true AND mp.estado = 'activo'
         AND (mp.vencimiento_anio, mp.vencimiento_mes) <= (
           EXTRACT(YEAR FROM now() + interval '1 month')::int, EXTRACT(MONTH FROM now() + interval '1 month')::int
         )
       LIMIT 100`
    );

    // 5. Suscripciones con período vencido hace más de un día y ningún
    // cobro reciente para ese período — el job pudo haberse detenido.
    const suscripcionesSinIntento = await db.query(
      `SELECT s.id AS suscripcion_id, s.tenant_id, t.nombre AS tenant_nombre, s.periodo_fin
       FROM suscripciones s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.estado IN ('activa', 'morosa')
         AND s.periodo_fin < now() - interval '1 day'
         AND NOT EXISTS (
           SELECT 1 FROM cobros c
           WHERE c.suscripcion_id = s.id AND c.tipo = 'suscripcion' AND c.periodo_fin = s.periodo_fin
         )
       LIMIT 100`
    );

    // 6. Cobros exitosos sin documento fiscal emitido.
    const cobrosSinDocumento = await db.query(
      `SELECT c.id AS cobro_id, c.tenant_id, c.tipo, c.monto, c.creado_en
       FROM cobros c
       WHERE c.estado = 'exitoso'
         AND NOT EXISTS (SELECT 1 FROM documentos_fiscales df WHERE df.cobro_id = c.id)
       ORDER BY c.creado_en DESC LIMIT 100`
    );

    // 7. Divergencia entre recargas acreditadas y sus movimientos de
    // crédito — cada recarga acreditada debería tener exactamente un
    // movimiento tipo='recarga' con referencia_id = recarga.id.
    const recargasSinMovimiento = await db.query(
      `SELECT r.id AS recarga_id, r.tenant_id, r.credito_acreditado_usd
       FROM recargas r
       WHERE r.estado = 'acreditada'
         AND NOT EXISTS (
           SELECT 1 FROM movimientos_credito mc WHERE mc.referencia_tabla = 'recargas' AND mc.referencia_id = r.id
         )
       LIMIT 100`
    );

    // 8. Países habilitados sin credenciales de pasarela configuradas —
    // detectable ANTES de que le venza el primer cobro a un cliente de
    // ese país (mismo chequeo que corre al arrancar, expuesto acá para
    // poder mirarlo sin reiniciar el backend).
    const paisesResult = await db.query(`SELECT codigo_iso, nombre FROM paises WHERE estado = 'habilitado'`);
    const paisesSinCredenciales = paisesResult.rows.filter((p) => !paisTieneCredenciales(p.codigo_iso));

    res.json({
      cobrosPendientesVencidos: cobrosPendientesVencidos.rows,
      recargasSinAcreditar: recargasSinAcreditar.rows,
      suscripcionesSinMetodo: suscripcionesSinMetodo.rows,
      metodosPorVencer: metodosPorVencer.rows,
      suscripcionesSinIntento: suscripcionesSinIntento.rows,
      cobrosSinDocumento: cobrosSinDocumento.rows,
      recargasSinMovimiento: recargasSinMovimiento.rows,
      paisesSinCredenciales: paisesSinCredenciales.map((p) => ({ codigoIso: p.codigo_iso, nombre: p.nombre })),
    });
  } catch (err) {
    console.error("GET /platform-admin/cobros/diagnostico", err);
    res.status(500).json({ error: "No se pudo generar el diagnóstico del motor de cobros." });
  }
});
