import { PoolClient } from "pg";
import { obtenerProveedorPagos } from "./proveedorPagos";
import { calcularImpuestoPais } from "./documentoFiscal";
import { enviarCorreoTransaccional, obtenerAdminClinica, urlMedioPago, urlRecargar } from "../correos";

// ---------------------------------------------------------------------
// Pantallas de pago — Pasos 2-4: recarga de crédito, autorecarga y medio
// de pago. Todo lo que cobra pasa por obtenerProveedorPagos() (Paso 1) —
// nunca se llama a Tilopay directo desde acá.
//
// Motor de cobros — Paso 6: el crédito de una recarga se acredita SOLO
// con la confirmación del callback (confirmarRecargaExitosa/Fallida más
// abajo), nunca en la respuesta síncrona de ejecutarCargo. ejecutarRecarga
// deja la fila en 'pendiente' y termina ahí.
// ---------------------------------------------------------------------

async function obtenerPaisTenant(db: PoolClient, tenantId: string): Promise<string> {
  const result = await db.query(`SELECT pais_codigo FROM tenants WHERE id = $1`, [tenantId]);
  const paisCodigo = result.rows[0]?.pais_codigo;
  if (!paisCodigo) throw new Error(`El tenant ${tenantId} no tiene país configurado.`);
  return paisCodigo;
}

export interface PaqueteRecarga {
  id: string;
  nombre: string;
  montoPagadoUsd: number;
  creditoAcreditadoUsd: number;
  esMinimo: boolean;
  orden: number;
}

export async function listarPaquetesActivos(db: PoolClient): Promise<PaqueteRecarga[]> {
  const result = await db.query(
    `SELECT id, nombre, monto_pagado_usd, credito_acreditado_usd, es_minimo, orden
     FROM paquetes_recarga WHERE activo = true ORDER BY orden`
  );
  return result.rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    montoPagadoUsd: Number(r.monto_pagado_usd),
    creditoAcreditadoUsd: Number(r.credito_acreditado_usd),
    esMinimo: r.es_minimo,
    orden: r.orden,
  }));
}

export interface MetodoPago {
  id: string;
  marca: string | null;
  ultimos4: string | null;
  vencimientoMes: number | null;
  vencimientoAnio: number | null;
  estado: "activo" | "vencido" | "eliminado";
}

// El estado de vencimiento es derivado, no una columna que haya que
// mantener sincronizada con un job — se calcula al leer, comparando
// contra el mes/año actual.
function calcularEstadoVencimiento(mes: number | null, anio: number | null): "vencido" | "por_vencer" | "vigente" | null {
  if (mes == null || anio == null) return null;
  const ahora = new Date();
  const anioActual = ahora.getUTCFullYear();
  const mesActual = ahora.getUTCMonth() + 1;
  if (anio < anioActual || (anio === anioActual && mes < mesActual)) return "vencido";
  const mesesRestantes = (anio - anioActual) * 12 + (mes - mesActual);
  if (mesesRestantes <= 1) return "por_vencer";
  return "vigente";
}

export async function obtenerMetodoPagoVigente(
  db: PoolClient,
  tenantId: string
): Promise<(MetodoPago & { estadoVencimiento: "vencido" | "por_vencer" | "vigente" | null }) | null> {
  const result = await db.query(
    `SELECT id, marca, ultimos4, vencimiento_mes, vencimiento_anio, estado
     FROM metodos_pago WHERE tenant_id = $1 AND predeterminado = true AND estado != 'eliminado'
     LIMIT 1`,
    [tenantId]
  );
  const fila = result.rows[0];
  if (!fila) return null;
  return {
    id: fila.id,
    marca: fila.marca,
    ultimos4: fila.ultimos4,
    vencimientoMes: fila.vencimiento_mes,
    vencimientoAnio: fila.vencimiento_anio,
    estado: fila.estado,
    estadoVencimiento: calcularEstadoVencimiento(fila.vencimiento_mes, fila.vencimiento_anio),
  };
}

type MetodoPagoConVencimiento = MetodoPago & { estadoVencimiento: "vencido" | "por_vencer" | "vigente" | null };

export type ResultadoTokenizarMetodo =
  | { ok: true; metodo: MetodoPagoConVencimiento }
  | { ok: false; mensajeError: string };

// El anterior NO se elimina: pierde `predeterminado`, conserva su fila
// para que los cobros pasados (metodos_pago_id) sigan siendo trazables.
export async function reemplazarMetodoPago(
  db: PoolClient,
  tenantId: string,
  datosTarjeta: { numero: string; nombreTitular: string; vencimientoMes: number; vencimientoAnio: number; cvv: string }
): Promise<ResultadoTokenizarMetodo> {
  const paisCodigo = await obtenerPaisTenant(db, tenantId);
  const proveedor = obtenerProveedorPagos();
  const resultado = await proveedor.tokenizarTarjeta(paisCodigo, datosTarjeta);
  if (!resultado.exito || !resultado.metodoPago) {
    return { ok: false, mensajeError: resultado.mensajeError ?? "No se pudo registrar la tarjeta." };
  }

  await db.query("BEGIN");
  try {
    await db.query(
      `UPDATE metodos_pago SET predeterminado = false, actualizado_en = now()
       WHERE tenant_id = $1 AND predeterminado = true`,
      [tenantId]
    );
    // El token queda ligado al país con el que se tokenizó (afiliación) —
    // uno emitido bajo Costa Rica no sirve contra la de Panamá.
    const insertResult = await db.query(
      `INSERT INTO metodos_pago
         (tenant_id, proveedor, referencia_externa, pais_codigo, marca, ultimos4, vencimiento_mes, vencimiento_anio, predeterminado, estado)
       VALUES ($1, 'simulado', $2, $3, $4, $5, $6, $7, true, 'activo')
       RETURNING id, marca, ultimos4, vencimiento_mes, vencimiento_anio, estado`,
      [
        tenantId,
        resultado.metodoPago.referenciaExterna,
        paisCodigo,
        resultado.metodoPago.marca,
        resultado.metodoPago.ultimos4,
        resultado.metodoPago.vencimientoMes,
        resultado.metodoPago.vencimientoAnio,
      ]
    );
    await db.query("COMMIT");
    const fila = insertResult.rows[0];
    return {
      ok: true,
      metodo: {
        id: fila.id,
        marca: fila.marca,
        ultimos4: fila.ultimos4,
        vencimientoMes: fila.vencimiento_mes,
        vencimientoAnio: fila.vencimiento_anio,
        estado: fila.estado,
        estadoVencimiento: calcularEstadoVencimiento(fila.vencimiento_mes, fila.vencimiento_anio),
      },
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export interface ConfigRecarga {
  autorecargaActiva: boolean;
  umbralUsd: number;
  paqueteId: string | null;
  topeMensualRecargasUsd: number | null;
}

export async function obtenerConfigRecarga(db: PoolClient, tenantId: string): Promise<ConfigRecarga> {
  const result = await db.query(
    `SELECT autorecarga_activa, umbral_usd, paquete_id, tope_mensual_recargas_usd
     FROM config_recarga WHERE tenant_id = $1`,
    [tenantId]
  );
  const fila = result.rows[0];
  return {
    autorecargaActiva: fila?.autorecarga_activa ?? false,
    umbralUsd: fila ? Number(fila.umbral_usd) : 5,
    paqueteId: fila?.paquete_id ?? null,
    topeMensualRecargasUsd: fila?.tope_mensual_recargas_usd != null ? Number(fila.tope_mensual_recargas_usd) : null,
  };
}

export type ResultadoActualizarConfig =
  | { ok: true; config: ConfigRecarga }
  | { ok: false; motivo: "umbral_mayor_o_igual_al_paquete" };

// DECISIÓN — "el umbral no puede ser mayor que el monto del paquete"
// (pedido explícito del prompt): se valida como umbral >= monto también
// rechazado, no solo umbral > monto — un umbral igual al paquete produce
// el mismo ciclo (la recarga deja el saldo justo en el umbral, que
// vuelve a dispararla de inmediato).
export async function actualizarConfigRecarga(
  db: PoolClient,
  tenantId: string,
  params: { autorecargaActiva: boolean; umbralUsd: number; paqueteId: string | null; topeMensualRecargasUsd: number | null }
): Promise<ResultadoActualizarConfig> {
  if (params.autorecargaActiva && params.paqueteId) {
    const paqueteResult = await db.query(`SELECT monto_pagado_usd FROM paquetes_recarga WHERE id = $1`, [
      params.paqueteId,
    ]);
    const montoPaquete = paqueteResult.rows[0] ? Number(paqueteResult.rows[0].monto_pagado_usd) : null;
    if (montoPaquete != null && params.umbralUsd >= montoPaquete) {
      return { ok: false, motivo: "umbral_mayor_o_igual_al_paquete" };
    }
  }

  await db.query(
    `INSERT INTO config_recarga (tenant_id, autorecarga_activa, umbral_usd, paquete_id, tope_mensual_recargas_usd, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       autorecarga_activa = EXCLUDED.autorecarga_activa,
       umbral_usd = EXCLUDED.umbral_usd,
       paquete_id = EXCLUDED.paquete_id,
       tope_mensual_recargas_usd = EXCLUDED.tope_mensual_recargas_usd,
       actualizado_en = now()`,
    [tenantId, params.autorecargaActiva, params.umbralUsd, params.paqueteId, params.topeMensualRecargasUsd]
  );

  return { ok: true, config: await obtenerConfigRecarga(db, tenantId) };
}

// Suma TODAS las recargas acreditadas del mes calendario (manuales y
// automáticas) — el tope mide consumo acumulado, no origen. Lo que
// distingue manual de automática es qué pasa DESPUÉS de superarlo: la
// automática se frena (fuera de alcance de este prompt, no hay job que
// la dispare todavía), la manual solo avisa y procede.
async function consumoRecargasDelMes(db: PoolClient, tenantId: string): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(SUM(monto_pagado_usd), 0) AS total FROM recargas
     WHERE tenant_id = $1 AND estado = 'acreditada' AND creada_en >= date_trunc('month', now())`,
    [tenantId]
  );
  return Number(result.rows[0].total);
}

export interface RecargaEjecutada {
  id: string;
  estado: "pendiente";
  montoPagadoUsd: number;
  creditoAcreditadoUsd: number;
  superaTopeMensual: boolean;
}

export type ResultadoEjecutarRecarga =
  | { ok: true; recarga: RecargaEjecutada }
  | { ok: false; motivo: "sin_metodo_pago" | "paquete_no_encontrado" | "envio_fallido"; mensajeError?: string };

// Manda el cargo y deja la recarga en 'pendiente' — el crédito se acredita
// SOLO con la confirmación del callback (confirmarRecargaExitosa más
// abajo). La recarga manual SIEMPRE procede aunque supere el tope
// mensual (con aviso vía superaTopeMensual): el tope es lo que frena la
// autorecarga automática, no una recarga que el administrador pide a
// propósito.
export async function ejecutarRecarga(
  db: PoolClient,
  tenantId: string,
  personaId: string,
  paqueteId: string
): Promise<ResultadoEjecutarRecarga> {
  const paqueteResult = await db.query(
    `SELECT monto_pagado_usd, credito_acreditado_usd FROM paquetes_recarga WHERE id = $1 AND activo = true`,
    [paqueteId]
  );
  const paquete = paqueteResult.rows[0];
  if (!paquete) return { ok: false, motivo: "paquete_no_encontrado" };
  const montoPagadoUsd = Number(paquete.monto_pagado_usd);
  const creditoAcreditadoUsd = Number(paquete.credito_acreditado_usd);

  const metodoResult = await db.query(
    `SELECT id, referencia_externa FROM metodos_pago WHERE tenant_id = $1 AND predeterminado = true AND estado != 'eliminado'`,
    [tenantId]
  );
  const metodo = metodoResult.rows[0];
  if (!metodo) return { ok: false, motivo: "sin_metodo_pago" };

  const paisCodigo = await obtenerPaisTenant(db, tenantId);
  const config = await obtenerConfigRecarga(db, tenantId);
  const consumoActual = await consumoRecargasDelMes(db, tenantId);
  const superaTopeMensual =
    config.topeMensualRecargasUsd != null && consumoActual + montoPagadoUsd > config.topeMensualRecargasUsd;

  const { impuestoUsd } = await calcularImpuestoPais(db, paisCodigo, montoPagadoUsd);
  const orderNumber = `recarga_${tenantId.slice(0, 8)}_${Date.now()}`;
  const cobroResult = await db.query(
    `INSERT INTO cobros (tenant_id, proveedor, order_number, monto, neto_usd, impuesto_usd, moneda, estado, tipo, metodo_pago_id)
     VALUES ($1, 'simulado', $2, $3, $4, $5, 'USD', 'pendiente', 'recarga', $6)
     RETURNING id`,
    [tenantId, orderNumber, Number((montoPagadoUsd + impuestoUsd).toFixed(2)), montoPagadoUsd.toFixed(2), impuestoUsd.toFixed(2), metodo.id]
  );
  const cobroId = cobroResult.rows[0].id;

  const recargaResult = await db.query(
    `INSERT INTO recargas (tenant_id, paquete_id, origen, monto_pagado_usd, credito_acreditado_usd, cobro_id, estado, solicitada_por)
     VALUES ($1, $2, 'manual', $3, $4, $5, 'pendiente', $6)
     RETURNING id`,
    [tenantId, paqueteId, montoPagadoUsd, creditoAcreditadoUsd, cobroId, personaId]
  );
  const recargaId = recargaResult.rows[0].id;

  const proveedor = obtenerProveedorPagos();
  const envio = await proveedor.ejecutarCargo(paisCodigo, {
    referenciaMetodoPago: metodo.referencia_externa,
    montoUsd: montoPagadoUsd,
    ordenId: orderNumber,
    descripcion: "Recarga de crédito Vetline Ai",
  });

  if (!envio.enviado) {
    // Nunca hay reintento automático de una recarga manual fallida — la
    // decisión queda del lado del cliente (Paso 6, pedido explícito).
    await db.query("BEGIN");
    try {
      await db.query(`UPDATE cobros SET estado = 'fallido', mensaje_error = $1 WHERE id = $2`, [
        envio.mensajeError ?? "No se pudo enviar el cargo a la pasarela.",
        cobroId,
      ]);
      await db.query(`UPDATE recargas SET estado = 'fallida' WHERE id = $1`, [recargaId]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
    return { ok: false, motivo: "envio_fallido", mensajeError: envio.mensajeError };
  }

  return {
    ok: true,
    recarga: {
      id: recargaId,
      estado: "pendiente",
      montoPagadoUsd,
      creditoAcreditadoUsd,
      superaTopeMensual,
    },
  };
}

// ---------------------------------------------------------------------
// Confirmación por callback (llamadas SOLO desde callbackCobros.ts).
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function confirmarRecargaExitosa(client: PoolClient, cobro: any): Promise<void> {
  const recargaResult = await client.query(
    `UPDATE recargas SET estado = 'acreditada', acreditada_en = now() WHERE cobro_id = $1 RETURNING id, tenant_id, credito_acreditado_usd, solicitada_por, paquete_id`,
    [cobro.id]
  );
  const recarga = recargaResult.rows[0];
  if (!recarga) {
    console.error(`[recargas] Cobro ${cobro.id} exitoso pero no hay recarga asociada — nada que acreditar.`);
    return;
  }

  const creditoAcreditadoUsd = Number(recarga.credito_acreditado_usd);
  await client.query(
    `UPDATE saldos_ia SET credito_comprado_usd = credito_comprado_usd + $1, actualizado_en = now() WHERE tenant_id = $2`,
    [creditoAcreditadoUsd, recarga.tenant_id]
  );
  const saldoResult = await client.query(
    `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1`,
    [recarga.tenant_id]
  );
  await client.query(
    `INSERT INTO movimientos_credito
       (tenant_id, tipo, bolsa, monto_usd, referencia_tabla, referencia_id, saldo_plan_post, saldo_comprado_post, descripcion, creado_por)
     VALUES ($1, 'recarga', 'comprado', $2, 'recargas', $3, $4, $5, $6, $7)`,
    [
      recarga.tenant_id,
      creditoAcreditadoUsd.toFixed(4),
      recarga.id,
      Number(saldoResult.rows[0].credito_plan_usd).toFixed(4),
      Number(saldoResult.rows[0].credito_comprado_usd).toFixed(4),
      `Recarga — paquete ${recarga.paquete_id}`,
      recarga.solicitada_por,
    ]
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function confirmarRecargaFallida(client: PoolClient, cobro: any): Promise<void> {
  const result = await client.query(
    `UPDATE recargas SET estado = 'fallida' WHERE cobro_id = $1 RETURNING tenant_id, origen, monto_pagado_usd`,
    [cobro.id]
  );
  const recarga = result.rows[0];
  // Solo la automática avisa acá — la manual ya le devuelve el error al
  // administrador en la respuesta del endpoint que la disparó, y NUNCA se
  // reintenta sola (Paso 6, pedido explícito): la decisión de reintentar
  // queda del lado del cliente.
  if (recarga?.origen === "automatica") {
    await client.query(
      `INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje) VALUES ($1, 'autorecarga_fallida', $2)`,
      [
        recarga.tenant_id,
        "La recarga automática de crédito no se pudo procesar — no se va a reintentar sola. " +
          "Revisá tu medio de pago o hacé una recarga manual si necesitás crédito ahora.",
      ]
    );
    const admin = await obtenerAdminClinica(client, recarga.tenant_id);
    if (admin) {
      await enviarCorreoTransaccional(client, recarga.tenant_id, admin.email, "autorecarga_fallida", {
        montoUsd: Number(recarga.monto_pagado_usd),
        enlaceAutorecarga: urlMedioPago(),
        enlaceRecargarManual: urlRecargar(),
      });
    }
  }
}

// ---------------------------------------------------------------------
// Motor de cobros, Paso 6 — autorecarga. Se llama desde tarifas.ts justo
// después de descontar saldo por consumo, dentro de la MISMA transacción
// (misma fila de saldos_ia que ya está bloqueada con FOR UPDATE en esa
// operación) — así dos consumos concurrentes no pueden disparar dos
// autorecargas para el mismo cruce de umbral.
// ---------------------------------------------------------------------
export async function dispararAutorecargaSiCorresponde(
  db: PoolClient,
  tenantId: string,
  personaId: string | null
): Promise<void> {
  const config = await obtenerConfigRecarga(db, tenantId);
  if (!config.autorecargaActiva || !config.paqueteId) return;

  const saldoResult = await db.query(
    `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1`,
    [tenantId]
  );
  const saldo = saldoResult.rows[0];
  if (!saldo) return;
  const saldoDisponible = Number(saldo.credito_plan_usd) + Number(saldo.credito_comprado_usd);
  if (saldoDisponible >= config.umbralUsd) return;

  // Guard contra doble disparo: si ya hay una autorecarga en camino
  // (esperando su callback), no se manda otra aunque el saldo siga bajo.
  const enCursoResult = await db.query(
    `SELECT 1 FROM recargas WHERE tenant_id = $1 AND origen = 'automatica' AND estado = 'pendiente' LIMIT 1`,
    [tenantId]
  );
  if (enCursoResult.rows.length > 0) return;

  const paqueteResult = await db.query(
    `SELECT monto_pagado_usd, credito_acreditado_usd FROM paquetes_recarga WHERE id = $1 AND activo = true`,
    [config.paqueteId]
  );
  const paquete = paqueteResult.rows[0];
  if (!paquete) return;
  const montoPagadoUsd = Number(paquete.monto_pagado_usd);
  const creditoAcreditadoUsd = Number(paquete.credito_acreditado_usd);

  if (config.topeMensualRecargasUsd != null) {
    const consumoActual = await consumoRecargasDelMes(db, tenantId);
    if (consumoActual + montoPagadoUsd > config.topeMensualRecargasUsd) {
      const yaAvisado = await db.query(
        `SELECT 1 FROM notificaciones_uso
         WHERE tenant_id = $1 AND umbral = 'tope_recargas' AND fecha >= date_trunc('month', now()) LIMIT 1`,
        [tenantId]
      );
      if (yaAvisado.rows.length === 0) {
        await db.query(`INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje) VALUES ($1, 'tope_recargas', $2)`, [
          tenantId,
          "Tu clínica alcanzó el tope mensual de recargas automáticas — la autorecarga queda en pausa hasta el próximo ciclo. Podés recargar manualmente si lo necesitás.",
        ]);
      }
      return; // No se reintenta hasta el próximo período (pedido explícito).
    }
  }

  const metodoResult = await db.query(
    `SELECT id, referencia_externa FROM metodos_pago WHERE tenant_id = $1 AND predeterminado = true AND estado != 'eliminado'`,
    [tenantId]
  );
  const metodo = metodoResult.rows[0];
  if (!metodo) {
    await db.query(`INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje) VALUES ($1, 'autorecarga_fallida', $2)`, [
      tenantId,
      "Tu clínica tiene la recarga automática activa pero no hay un medio de pago registrado — agregá uno para que pueda funcionar.",
    ]);
    const adminSinMetodo = await obtenerAdminClinica(db, tenantId);
    if (adminSinMetodo) {
      await enviarCorreoTransaccional(db, tenantId, adminSinMetodo.email, "autorecarga_fallida", {
        montoUsd: montoPagadoUsd,
        enlaceAutorecarga: urlMedioPago(),
        enlaceRecargarManual: urlRecargar(),
      });
    }
    return;
  }

  const paisCodigo = await obtenerPaisTenant(db, tenantId);
  const { impuestoUsd } = await calcularImpuestoPais(db, paisCodigo, montoPagadoUsd);
  const orderNumber = `autorecarga_${tenantId.slice(0, 8)}_${Date.now()}`;

  const cobroResult = await db.query(
    `INSERT INTO cobros (tenant_id, proveedor, order_number, monto, neto_usd, impuesto_usd, moneda, estado, tipo, metodo_pago_id)
     VALUES ($1, 'simulado', $2, $3, $4, $5, 'USD', 'pendiente', 'recarga', $6)
     RETURNING id`,
    [tenantId, orderNumber, Number((montoPagadoUsd + impuestoUsd).toFixed(2)), montoPagadoUsd.toFixed(2), impuestoUsd.toFixed(2), metodo.id]
  );
  const cobroId = cobroResult.rows[0].id;

  await db.query(
    `INSERT INTO recargas (tenant_id, paquete_id, origen, monto_pagado_usd, credito_acreditado_usd, cobro_id, estado, solicitada_por)
     VALUES ($1, $2, 'automatica', $3, $4, $5, 'pendiente', $6)`,
    [tenantId, config.paqueteId, montoPagadoUsd, creditoAcreditadoUsd, cobroId, personaId]
  );

  const proveedor = obtenerProveedorPagos();
  const envio = await proveedor.ejecutarCargo(paisCodigo, {
    referenciaMetodoPago: metodo.referencia_externa,
    montoUsd: montoPagadoUsd,
    ordenId: orderNumber,
    descripcion: "Recarga automática de crédito Vetline Ai",
  });

  if (!envio.enviado) {
    await db.query(`UPDATE cobros SET estado = 'fallido', mensaje_error = $1 WHERE id = $2`, [
      envio.mensajeError ?? "No se pudo enviar el cargo a la pasarela.",
      cobroId,
    ]);
    await db.query(`UPDATE recargas SET estado = 'fallida' WHERE cobro_id = $1`, [cobroId]);
    await db.query(`INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje) VALUES ($1, 'autorecarga_fallida', $2)`, [
      tenantId,
      "La recarga automática de crédito no se pudo procesar — no se va a reintentar sola.",
    ]);
    const adminEnvioFallido = await obtenerAdminClinica(db, tenantId);
    if (adminEnvioFallido) {
      await enviarCorreoTransaccional(db, tenantId, adminEnvioFallido.email, "autorecarga_fallida", {
        montoUsd: montoPagadoUsd,
        enlaceAutorecarga: urlMedioPago(),
        enlaceRecargarManual: urlRecargar(),
      });
    }
  }
}

export interface RecargaHistorial {
  id: string;
  paqueteNombre: string | null;
  origen: "manual" | "automatica";
  montoPagadoUsd: number;
  creditoAcreditadoUsd: number;
  estado: "pendiente" | "acreditada" | "fallida";
  creadaEn: string;
}

export async function listarRecargas(db: PoolClient, tenantId: string): Promise<RecargaHistorial[]> {
  const result = await db.query(
    `SELECT r.id, pr.nombre AS paquete_nombre, r.origen, r.monto_pagado_usd, r.credito_acreditado_usd, r.estado, r.creada_en
     FROM recargas r LEFT JOIN paquetes_recarga pr ON pr.id = r.paquete_id
     WHERE r.tenant_id = $1 ORDER BY r.creada_en DESC LIMIT 20`,
    [tenantId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    paqueteNombre: r.paquete_nombre,
    origen: r.origen,
    montoPagadoUsd: Number(r.monto_pagado_usd),
    creditoAcreditadoUsd: Number(r.credito_acreditado_usd),
    estado: r.estado,
    creadaEn: r.creada_en,
  }));
}
