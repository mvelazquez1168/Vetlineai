import { Pool, PoolClient } from "pg";
import { obtenerProveedorPagos } from "./proveedorPagos";
import { calcularImpuestoPais } from "./documentoFiscal";
import { enviarCorreoTransaccional, obtenerAdminClinica, urlMedioPago } from "../correos";

// ---------------------------------------------------------------------
// Motor de cobros, Pasos 3 y 4 — ciclo de cobro recurrente y política de
// reintentos. Deliberadamente NO toca suscripciones.proximo_cobro_en: esa
// columna ya es propiedad del motor de CRÉDITO (jobs/ciclo.job.ts —
// bloque 5), que la reprograma cada vez que avanza un período,
// independientemente de si el cobro tuvo éxito. Reutilizarla acá para la
// cadencia de reintentos (0/3/7/10 días) acoplaría los dos ciclos que el
// prompt pide mantener separados a propósito.
//
// En su lugar, la referencia de reintentos es suscripciones.cobro_intento_
// desde (fija mientras dura la ventana de reintentos de UN período) más
// el conteo de cobros 'fallido' ya generados para ese mismo periodo_fin.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

async function leerDiasReintento(db: EjecutorSql): Promise<number[]> {
  const result = await db.query(`SELECT valor FROM parametros_plataforma WHERE clave = 'cobro.reintentos_dias'`);
  const crudo: string = result.rows[0]?.valor ?? "0,3,7,10";
  return crudo
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

interface Candidato {
  suscripcionId: string;
  tenantId: string;
  paisCodigo: string | null;
  precioPactadoUsd: number;
  periodoFin: Date;
  cobroIntentoDesde: Date | null;
}

async function seleccionarCandidatos(db: EjecutorSql): Promise<Candidato[]> {
  const result = await db.query(
    `SELECT s.id AS suscripcion_id, s.tenant_id, t.pais_codigo, s.precio_pactado_usd, s.periodo_fin, s.cobro_intento_desde
     FROM suscripciones s
     JOIN tenants t ON t.suscripcion_id = s.id
     WHERE s.estado IN ('activa', 'morosa')
       AND s.periodo_fin <= now()
       AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.suscripcion_id = s.id AND c.estado = 'pendiente')`
  );
  return result.rows.map((r) => ({
    suscripcionId: r.suscripcion_id,
    tenantId: r.tenant_id,
    paisCodigo: r.pais_codigo,
    precioPactadoUsd: Number(r.precio_pactado_usd),
    periodoFin: new Date(r.periodo_fin),
    cobroIntentoDesde: r.cobro_intento_desde ? new Date(r.cobro_intento_desde) : null,
  }));
}

// Decide si a ESTE candidato le toca un intento ahora, y con qué número
// de intento — sin tocar nada todavía.
async function calcularProximoIntento(
  db: EjecutorSql,
  candidato: Candidato
): Promise<{ debeIntentar: boolean; intentoNumero: number }> {
  const fallidosResult = await db.query(
    `SELECT COUNT(*)::int AS n FROM cobros
     WHERE suscripcion_id = $1 AND tipo = 'suscripcion' AND estado = 'fallido' AND periodo_fin = $2`,
    [candidato.suscripcionId, candidato.periodoFin.toISOString()]
  );
  const intentosFallidos: number = fallidosResult.rows[0].n;
  const dias = await leerDiasReintento(db);

  if (intentosFallidos === 0) {
    return { debeIntentar: true, intentoNumero: 1 };
  }
  if (intentosFallidos >= dias.length) {
    // Ya se agotó la política (4 intentos) — debería estar suspendida.
    // Si sigue apareciendo como candidato es una inconsistencia (ver Paso
    // 9); no se reintenta más para no violar la política.
    console.error(
      `[cicloCobro] Suscripción ${candidato.suscripcionId} tiene ${intentosFallidos} intentos fallidos ` +
        `(>= política de ${dias.length}) pero sigue activa/morosa — revisar Paso 9.`
    );
    return { debeIntentar: false, intentoNumero: intentosFallidos + 1 };
  }

  const desde = candidato.cobroIntentoDesde ?? candidato.periodoFin;
  const proximoIntentoEn = new Date(desde.getTime() + dias[intentosFallidos] * 24 * 60 * 60 * 1000);
  return { debeIntentar: new Date() >= proximoIntentoEn, intentoNumero: intentosFallidos + 1 };
}

async function crearCobroSuscripcion(
  db: EjecutorSql,
  candidato: Candidato,
  intentoNumero: number
): Promise<{ cobroId: string; orderNumber: string; metodoPago: { id: string; referenciaExterna: string } | null }> {
  if (candidato.cobroIntentoDesde == null) {
    await db.query(`UPDATE suscripciones SET cobro_intento_desde = now() WHERE id = $1`, [candidato.suscripcionId]);
  }

  const metodoResult = await db.query(
    `SELECT id, referencia_externa FROM metodos_pago
     WHERE tenant_id = $1 AND predeterminado = true AND estado != 'eliminado'`,
    [candidato.tenantId]
  );
  const metodo = metodoResult.rows[0];

  const { impuestoUsd } = await calcularImpuestoPais(db, candidato.paisCodigo ?? "CR", candidato.precioPactadoUsd);
  const orderNumber = `susc_${candidato.suscripcionId.slice(0, 8)}_i${intentoNumero}_${Date.now()}`;

  const cobroResult = await db.query(
    `INSERT INTO cobros
       (tenant_id, proveedor, order_number, monto, neto_usd, impuesto_usd, moneda, estado, tipo,
        intento_numero, metodo_pago_id, suscripcion_id, periodo_inicio, periodo_fin)
     VALUES ($1, 'simulado', $2, $3, $4, $5, 'USD', 'pendiente', 'suscripcion', $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      candidato.tenantId,
      orderNumber,
      Number((candidato.precioPactadoUsd + impuestoUsd).toFixed(2)),
      candidato.precioPactadoUsd.toFixed(2),
      impuestoUsd.toFixed(2),
      intentoNumero,
      metodo?.id ?? null,
      candidato.suscripcionId,
      candidato.periodoFin.toISOString(),
      candidato.periodoFin.toISOString(),
    ]
  );

  return {
    cobroId: cobroResult.rows[0].id,
    orderNumber,
    metodoPago: metodo ? { id: metodo.id, referenciaExterna: metodo.referencia_externa } : null,
  };
}

// Un intento de cobro: crea la fila `cobros` y, si hay medio de pago,
// manda el cargo a la pasarela (el resultado real llega después, por
// callback — acá nunca se decide éxito/fallo). Si NO hay medio de pago,
// no hay nada que enviar: se resuelve como fallido de inmediato, por el
// mismo camino de consecuencias que un fallo real de la pasarela (Paso 3:
// "no se intenta el cobro, la suscripción pasa a morosa con aviso").
export async function intentarCobroSuscripcion(db: Pool, candidato: Candidato, intentoNumero: number): Promise<void> {
  const { cobroId, orderNumber, metodoPago } = await crearCobroSuscripcion(db, candidato, intentoNumero);

  if (!metodoPago) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE cobros SET estado = 'fallido', mensaje_error = $1 WHERE id = $2`, [
        "La clínica no tiene un medio de pago registrado.",
        cobroId,
      ]);
      await confirmarCobroSuscripcionFallido(client, { id: cobroId, suscripcion_id: candidato.suscripcionId, periodo_fin: candidato.periodoFin.toISOString(), tenant_id: candidato.tenantId }, undefined);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  const proveedor = obtenerProveedorPagos();
  const envio = await proveedor.ejecutarCargo(candidato.paisCodigo ?? "CR", {
    referenciaMetodoPago: metodoPago.referenciaExterna,
    montoUsd: candidato.precioPactadoUsd,
    ordenId: orderNumber,
    descripcion: `Renovación de suscripción — intento ${intentoNumero}`,
  });

  if (!envio.enviado) {
    // Fallo de ENVÍO (no de cobro): no hay notificación de callback en
    // camino porque la pasarela nunca recibió la orden. Se resuelve como
    // un intento fallido más, mismo camino de consecuencias.
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE cobros SET estado = 'fallido', mensaje_error = $1 WHERE id = $2`, [
        envio.mensajeError ?? "No se pudo enviar el cargo a la pasarela.",
        cobroId,
      ]);
      await confirmarCobroSuscripcionFallido(client, { id: cobroId, suscripcion_id: candidato.suscripcionId, periodo_fin: candidato.periodoFin.toISOString(), tenant_id: candidato.tenantId }, undefined);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

// Job programado — recorre las suscripciones activas/morosas con período
// vencido y, para cada una, dispara el intento que corresponda según la
// política de reintentos.
export async function ejecutarJobCicloCobro(db: Pool): Promise<{ evaluadas: number; intentadas: number }> {
  const candidatos = await seleccionarCandidatos(db);
  let intentadas = 0;

  for (const candidato of candidatos) {
    try {
      const { debeIntentar, intentoNumero } = await calcularProximoIntento(db, candidato);
      if (!debeIntentar) continue;
      await intentarCobroSuscripcion(db, candidato, intentoNumero);
      intentadas++;
    } catch (err) {
      console.error(`[cicloCobro] Error procesando la suscripción ${candidato.suscripcionId}`, err);
    }
  }

  return { evaluadas: candidatos.length, intentadas };
}

// ---------------------------------------------------------------------
// Vetline_Ai_Suspension_Bloqueo.md sección 4.2 — "Regularizar el pago...
// disponible, y cancela el cierre". No había ningún disparador para esto:
// seleccionarCandidatos excluye a propósito 'suspendida'/'ventana_purga'
// (la política de reintentos automáticos ya se agotó para llegar ahí), y
// "Cambiar de plan" exige un plan estrictamente superior — no sirve para
// simplemente ponerse al día. Reemplazar la tarjeta (Medio de pago) es la
// única acción que le queda disponible al cliente en ese momento, así que
// ese es el disparador natural: un intento de cobro inmediato por el
// monto ya pactado, con el mismo camino (intentarCobroSuscripcion) que
// usa el job programado. Recibe el `pool` crudo, no `req.db!` (PoolClient)
// — igual que el resto de este archivo, opera con tenantId explícito en
// cada query, no con el contexto RLS de la request.
// ---------------------------------------------------------------------
export async function intentarRegularizarPagoTrasNuevaTarjeta(db: Pool, tenantId: string): Promise<void> {
  const result = await db.query(
    `SELECT s.id AS suscripcion_id, s.precio_pactado_usd, s.periodo_fin, s.estado,
            t.pais_codigo, t.ventana_purga_origen
     FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE t.id = $1`,
    [tenantId]
  );
  const fila = result.rows[0];
  if (!fila) return;

  const aplica =
    fila.estado === "suspendida" || (fila.estado === "ventana_purga" && fila.ventana_purga_origen === "impago");
  if (!aplica) return;

  const fallidosResult = await db.query(
    `SELECT COUNT(*)::int AS n FROM cobros
     WHERE suscripcion_id = $1 AND tipo = 'suscripcion' AND estado = 'fallido' AND periodo_fin = $2`,
    [fila.suscripcion_id, fila.periodo_fin]
  );

  const candidato: Candidato = {
    suscripcionId: fila.suscripcion_id,
    tenantId,
    paisCodigo: fila.pais_codigo,
    precioPactadoUsd: Number(fila.precio_pactado_usd),
    periodoFin: new Date(fila.periodo_fin),
    cobroIntentoDesde: null,
  };

  await intentarCobroSuscripcion(db, candidato, fallidosResult.rows[0].n + 1);
}

// ---------------------------------------------------------------------
// Confirmación por callback (llamadas SOLO desde callbackCobros.ts,
// dentro de la transacción del cobro).
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function confirmarCobroSuscripcionExitoso(client: PoolClient, cobro: any): Promise<void> {
  // periodos_suspendida_consecutivos vuelve a 0 acá — Vetline_Ai_Suspension_
  // Bloqueo.md sección 3.1: "un cobro exitoso posterior reactiva la
  // suscripción". Si venía de 'suspendida', el reloj de cierre por impago
  // (purga.ts::procesarCierrePorImpago) se reinicia con ella.
  //
  // Sección 3.2: "Una suspensión manual no se levanta sola con un cobro
  // exitoso" — si suspendida_manualmente está en true, el pago se procesó
  // (el caller ya registró el cobro) pero la suscripción se queda como
  // estaba. La reactivación tiene que ser una decisión explícita de
  // Platform Admin (reactivarManualmente, en suspensionBloqueo.ts).
  const suscripcionResult = await client.query(
    `SELECT suspendida_manualmente, estado FROM suscripciones WHERE id = $1`,
    [cobro.suscripcion_id]
  );
  const suscripcion = suscripcionResult.rows[0];
  if (suscripcion?.suspendida_manualmente) {
    return;
  }

  await client.query(
    `UPDATE suscripciones SET estado = 'activa', cobro_intento_desde = NULL, periodos_suspendida_consecutivos = 0 WHERE id = $1`,
    [cobro.suscripcion_id]
  );

  // Sección 4.2: "Regularizar el pago... cancela el cierre restaurando el
  // acceso completo" — si el cobro llegó mientras la clínica estaba en
  // ventana de cierre (necesariamente por impago: la ventana de prueba no
  // convertida se cancela por upgrade.ts/conversionPrueba.ts, no por acá),
  // hay que deshacer también lo que puso ahí a la clínica: los campos de
  // purga programada y el evento correspondiente en la auditoría.
  if (suscripcion?.estado === "ventana_purga") {
    await client.query(
      `UPDATE tenants SET purga_programada_para = NULL, purga_aviso_en = NULL, purga_recordatorio_en = NULL,
                          ventana_purga_origen = NULL
       WHERE id = $1`,
      [cobro.tenant_id]
    );
    await client.query(
      `INSERT INTO clinica_eventos_ciclo_vida (tenant_id, tipo_evento, motivo, estado_anterior, estado_nuevo)
       VALUES ($1, 'cancelacion_ventana_cierre', 'Cobro exitoso durante la ventana de cierre.', 'ventana_purga', 'activa')`,
      [cobro.tenant_id]
    );
  }
}

export async function confirmarCobroSuscripcionFallido(
  client: PoolClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cobro: any,
  motivoFalla: string | undefined
): Promise<void> {
  const fallidosResult = await client.query(
    `SELECT COUNT(*)::int AS n FROM cobros
     WHERE suscripcion_id = $1 AND tipo = 'suscripcion' AND estado = 'fallido' AND periodo_fin = $2`,
    [cobro.suscripcion_id, cobro.periodo_fin]
  );
  const intentoNumero: number = fallidosResult.rows[0].n;
  const dias = await leerDiasReintento(client);

  const admin = await obtenerAdminClinica(client, cobro.tenant_id);

  if (intentoNumero >= dias.length) {
    await client.query(`UPDATE suscripciones SET estado = 'suspendida' WHERE id = $1`, [cobro.suscripcion_id]);
    await client.query(`INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje) VALUES ($1, 'suscripcion_suspendida', $2)`, [
      cobro.tenant_id,
      "No pudimos procesar el cobro de tu suscripción después de varios intentos y tu cuenta quedó suspendida — " +
        "el crédito y el trabajo clínico ya cargado siguen disponibles, pero no se sumará crédito nuevo hasta " +
        "que actualices tu medio de pago y se confirme un cobro.",
    ]);
    if (admin) {
      await enviarCorreoTransaccional(client, cobro.tenant_id, admin.email, "cuenta_suspendida", {
        montoUsd: Number(cobro.monto),
        enlace: urlMedioPago(),
      });
    }
    return;
  }

  await client.query(`UPDATE suscripciones SET estado = 'morosa' WHERE id = $1 AND estado != 'suspendida'`, [
    cobro.suscripcion_id,
  ]);

  const mensajesPorIntento: Record<number, string> = {
    1: "No pudimos procesar el cobro de tu suscripción — vamos a reintentarlo en los próximos días. Podés revisar tu medio de pago cuando quieras.",
    2: "Seguimos sin poder procesar el cobro de tu suscripción. Te recomendamos revisar tu medio de pago pronto.",
    3: `Último aviso: si el próximo intento de cobro falla, tu cuenta quedará suspendida${motivoFalla ? ` (motivo: ${motivoFalla})` : ""}. Actualizá tu medio de pago para evitarlo.`,
  };
  const mensaje = mensajesPorIntento[intentoNumero] ?? mensajesPorIntento[1];

  await client.query(`INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje) VALUES ($1, 'cobro_fallido', $2)`, [
    cobro.tenant_id,
    mensaje,
  ]);

  if (admin) {
    // Próxima fecha de reintento — mismo cálculo que calcularProximoIntento
    // (desde = cobro_intento_desde, gap = dias[intentoNumero], el próximo
    // índice de la política tras esta falla).
    const desdeResult = await client.query(`SELECT cobro_intento_desde, periodo_fin FROM suscripciones WHERE id = $1`, [
      cobro.suscripcion_id,
    ]);
    const desde = desdeResult.rows[0]?.cobro_intento_desde ?? desdeResult.rows[0]?.periodo_fin;
    const proximoIntentoFecha =
      desde && dias[intentoNumero] != null
        ? new Intl.DateTimeFormat("es", { day: "2-digit", month: "long", year: "numeric" }).format(
            new Date(new Date(desde).getTime() + dias[intentoNumero] * 24 * 60 * 60 * 1000)
          )
        : null;

    await enviarCorreoTransaccional(client, cobro.tenant_id, admin.email, "cobro_fallido", {
      montoUsd: Number(cobro.monto),
      intentoNumero,
      esUltimoIntento: intentoNumero === dias.length - 1,
      proximoIntentoFecha,
      enlace: urlMedioPago(),
    });
  }
}
