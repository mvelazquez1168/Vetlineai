import cron from "node-cron";
import { pool } from "../db";
import { ejecutarCambiosVencidos } from "../cambios";
import {
  procesarFinDePruebas,
  enviarRecordatoriosPurga,
  ejecutarPurgas,
  enviarAvisoPruebaPorTerminar,
  enviarAvisoCuentaNoOperativa,
  procesarCuentasNoOperativas,
  procesarCierrePorImpago,
} from "../purga";

// ---------------------------------------------------------------------
// Motor de crédito, Bloque 5 — trabajo programado del ciclo de
// facturación. Reemplaza (para el modelo nuevo) la responsabilidad que
// suscripciones.job.ts cumplía para el modelo viejo — ese archivo quedó
// desactivado el 2026-08-04 (ver comentario ahí) por seguir escribiendo
// en columnas que el resto del sistema ya no lee, tras confirmar que ya
// había hecho divergir datos reales de un tenant.
//
// UBICACIÓN: archivo nuevo, no agregado a suscripciones.job.ts — ese
// archivo es 100% modelo viejo (Stripe + cupos + tenants.estado_suscripcion)
// y agregarle esta responsabilidad hubiera mezclado dos fuentes de verdad
// desconectadas en el mismo módulo.
//
// Corre vía `pool` directo (no `req.db`), mismo patrón que
// notificaciones.job.ts: no hay request/tenant activo, así que cada
// query filtra tenant explícitamente. Usa node-cron (ya instalado para
// notificaciones.job.ts), no el setInterval crudo del archivo viejo.
// ---------------------------------------------------------------------

interface CandidatoCiclo {
  suscripcion_id: string;
  tenant_id: string;
  tenant_nombre: string;
  periodicidad: string;
  credito_pactado_usd: string;
  periodo_fin: string;
}

interface ResumenCiclo {
  procesadas: number;
  conError: number;
  creditoOtorgadoTotal: number;
  creditoExpiradoTotal: number;
}

// PASO 2 — Selección: período vencido y estado activa/morosa/cancelada.
// prueba/ventana_purga/suspendida/finalizada NO reciben crédito de período
// (prueba tiene su propio mecanismo de trial, no este job; el resto son
// estados terminales o de excepción que no deben seguir generando crédito).
async function seleccionarCandidatos(): Promise<CandidatoCiclo[]> {
  const result = await pool.query(
    `SELECT s.id AS suscripcion_id, s.tenant_id, t.nombre AS tenant_nombre,
            s.periodicidad, s.credito_pactado_usd, s.periodo_fin
     FROM suscripciones s
     JOIN tenants t ON t.id = s.tenant_id
     WHERE s.periodo_fin < now()
       AND s.estado IN ('activa', 'morosa', 'cancelada')`
  );
  return result.rows;
}

// PASO 4 — Idempotencia: si ya existe un otorgamiento_plan con fecha
// posterior al periodo_inicio NUEVO (= periodo_fin viejo, el límite de
// ciclo que este candidato está por cruzar), ya se procesó — puede pasar
// por un reintento o un redeploy en medio del job. Se elige este mecanismo
// (en vez de, por ejemplo, una tabla de "corridas de job" separada)
// porque reusa el mismo libro mayor que ya es la fuente de verdad para
// todo lo demás en este motor, sin agregar una tabla nueva solo para esto.
async function yaProcesado(tenantId: string, nuevoPeriodoInicio: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM movimientos_credito
     WHERE tenant_id = $1 AND tipo = 'otorgamiento_plan' AND creado_en >= $2
     LIMIT 1`,
    [tenantId, nuevoPeriodoInicio]
  );
  return result.rows.length > 0;
}

// PASO 3 — Secuencia exacta: expirar -> saldar colchón -> otorgar ->
// avanzar período -> rehabilitar avisos (implícito: rehabilitar avisos no
// necesita una acción propia, el avance de periodo_inicio ya hace que
// verificarUmbralesYNotificar — que consulta "fecha >= periodo_inicio" —
// vuelva a permitir cada umbral en el ciclo nuevo).
async function procesarUnaSuscripcion(
  candidato: CandidatoCiclo
): Promise<{ creditoOtorgado: number; creditoExpirado: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (await yaProcesado(candidato.tenant_id, candidato.periodo_fin)) {
      await client.query("ROLLBACK");
      console.log(`[jobs:ciclo] "${candidato.tenant_nombre}" ya estaba procesado para este ciclo — se omite.`);
      return { creditoOtorgado: 0, creditoExpirado: 0 };
    }

    const saldoResult = await client.query(
      `SELECT credito_plan_usd, credito_comprado_usd, colchon_usado_usd
       FROM saldos_ia WHERE tenant_id = $1 FOR UPDATE`,
      [candidato.tenant_id]
    );
    if (saldoResult.rows.length === 0) {
      throw new Error(`No existe fila de saldos_ia para el tenant ${candidato.tenant_id}.`);
    }
    const creditoPlanActual = Number(saldoResult.rows[0].credito_plan_usd);
    const creditoCompradoActual = Number(saldoResult.rows[0].credito_comprado_usd);
    const colchonUsadoActual = Number(saldoResult.rows[0].colchon_usado_usd);

    // 1. EXPIRAR el crédito del plan no consumido.
    let creditoExpirado = 0;
    if (creditoPlanActual > 0) {
      creditoExpirado = creditoPlanActual;
      await client.query(
        `INSERT INTO movimientos_credito
           (tenant_id, tipo, bolsa, monto_usd, saldo_plan_post, saldo_comprado_post, descripcion)
         VALUES ($1, 'expiracion_plan', 'plan', $2, 0, $3, 'Expiración del crédito del plan no consumido')`,
        [candidato.tenant_id, (-creditoExpirado).toFixed(4), creditoCompradoActual.toFixed(4)]
      );
    }

    // 2. SALDAR el colchón (si estaba consumido), descontándolo del
    // crédito nuevo, ANTES de acreditar el resto.
    const creditoPactado = Number(candidato.credito_pactado_usd);
    let creditoOtorgado = creditoPactado;
    if (colchonUsadoActual > 0) {
      creditoOtorgado = Math.max(creditoPactado - colchonUsadoActual, 0);
      await client.query(
        `INSERT INTO movimientos_credito
           (tenant_id, tipo, bolsa, monto_usd, saldo_plan_post, saldo_comprado_post, descripcion)
         VALUES ($1, 'colchon', 'colchon', $2, 0, $3, 'Colchón de gracia saldado contra el crédito del nuevo período')`,
        [candidato.tenant_id, colchonUsadoActual.toFixed(4), creditoCompradoActual.toFixed(4)]
      );
    }

    // 3. OTORGAR el crédito del período — de suscripciones.credito_pactado_usd,
    // NO del catálogo de planes (el plan pudo cambiar de precio desde que
    // se pactó esta suscripción; lo pactado es lo que rige).
    await client.query(
      `UPDATE saldos_ia
       SET credito_plan_usd = $1, colchon_usado_usd = 0, actualizado_en = now()
       WHERE tenant_id = $2`,
      [creditoOtorgado.toFixed(4), candidato.tenant_id]
    );
    await client.query(
      `INSERT INTO movimientos_credito
         (tenant_id, tipo, bolsa, monto_usd, saldo_plan_post, saldo_comprado_post, descripcion)
       VALUES ($1, 'otorgamiento_plan', 'plan', $2, $3, $4, 'Otorgamiento de crédito del nuevo período')`,
      [
        candidato.tenant_id,
        creditoOtorgado.toFixed(4),
        creditoOtorgado.toFixed(4),
        creditoCompradoActual.toFixed(4),
      ]
    );
    // El crédito comprado no se toca en ningún paso — creditoCompradoActual
    // se repite tal cual en cada saldo_comprado_post de arriba.

    // 4. AVANZAR el período. periodo_fin (y la referencia de arriba) son
    // los del ANTES de este UPDATE — Postgres evalúa el lado derecho de
    // un UPDATE contra la fila vieja, así que esto es seguro en una sola
    // sentencia.
    const avanceResult = await client.query(
      `UPDATE suscripciones
       SET periodo_inicio = periodo_fin,
           periodo_fin = periodo_fin + (CASE WHEN periodicidad = 'anual' THEN interval '1 year' ELSE interval '1 month' END),
           proximo_cobro_en = periodo_fin + (CASE WHEN periodicidad = 'anual' THEN interval '1 year' ELSE interval '1 month' END)
       WHERE id = $1
       RETURNING periodo_inicio, periodo_fin`,
      [candidato.suscripcion_id]
    );

    // 5. REHABILITAR avisos: sin acción propia — ver comentario de cabecera.

    await client.query("COMMIT");
    console.log(
      `[jobs:ciclo] "${candidato.tenant_nombre}": expiró $${creditoExpirado.toFixed(2)}, otorgó $${creditoOtorgado.toFixed(2)}, ` +
        `período ${avanceResult.rows[0].periodo_inicio} -> ${avanceResult.rows[0].periodo_fin}.`
    );
    return { creditoOtorgado, creditoExpirado };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// PASO 5 — cada suscripción en su propia transacción; un error no impide
// procesar las demás.
export async function ejecutarJobCiclo(): Promise<ResumenCiclo> {
  // Flujo de suscripción B — downgrades y cancelaciones vencidos se
  // ejecutan ANTES de la renovación normal: un downgrade tiene que
  // actualizar credito_pactado_usd antes de que la renovación lo lea, y
  // una cancelación efectiva tiene que dejar la suscripción en
  // 'finalizada' antes de que la renovación la considere candidata (su
  // selección incluye estado='cancelada').
  try {
    const resumenCambios = await ejecutarCambiosVencidos(pool);
    if (resumenCambios.ejecutados > 0 || resumenCambios.requierenAtencion > 0) {
      console.log(
        `[jobs:ciclo] Cambios de suscripción: ${resumenCambios.ejecutados} ejecutado(s), ${resumenCambios.requierenAtencion} requieren atención.`
      );
    }
  } catch (err) {
    console.error("[jobs:ciclo] Error al ejecutar cambios de suscripción vencidos", err);
  }

  // Flujo de suscripción C — cierre de prueba, recordatorio y purga.
  // Orden: primero detectar pruebas vencidas (entran a ventana_purga),
  // después recordatorios, y recién al final la eliminación — así una
  // prueba que se vence justo hoy todavía recibe su aviso antes de que
  // se evalúe si corresponde purgarla (no va a corresponder el mismo
  // día, purga_programada_para queda a purga.plazo_dias en el futuro,
  // pero mantiene el orden lógico correcto).
  try {
    // Correos transaccionales — el aviso de "prueba por terminar" corre
    // ANTES de procesarFinDePruebas: filtra por periodo_fin > now(), así
    // que una prueba que vence hoy ya no es candidata acá (procesarFinDePruebas
    // la toma) — no hay superposición entre los dos avisos.
    const resumenAvisoPrueba = await enviarAvisoPruebaPorTerminar(pool);
    const resumenPruebas = await procesarFinDePruebas(pool);
    // Prompt de verificación de correo, Capa 5 — mismo orden relativo que
    // el bloque de arriba: aviso intermedio antes del límite que cierra.
    const resumenAvisoNoOperativa = await enviarAvisoCuentaNoOperativa(pool);
    const resumenCuentasNoOperativas = await procesarCuentasNoOperativas(pool);
    // Suspensión/bloqueo/cierre — mismo orden relativo: detectar cierre por
    // impago prolongado ANTES del recordatorio, para que una suscripción
    // que recién cruza el umbral también quede cubierta por el aviso de
    // entrada (no solo por el recordatorio posterior).
    const resumenCierreImpago = await procesarCierrePorImpago(pool);
    const resumenRecordatorios = await enviarRecordatoriosPurga(pool);
    const resumenPurgas = await ejecutarPurgas(pool);
    if (
      resumenAvisoPrueba.enviados > 0 ||
      resumenPruebas.procesadas > 0 ||
      resumenAvisoNoOperativa.enviados > 0 ||
      resumenCuentasNoOperativas.procesadas > 0 ||
      resumenCierreImpago.cerradas > 0 ||
      resumenRecordatorios.enviados > 0 ||
      resumenPurgas.purgadas > 0
    ) {
      console.log(
        `[jobs:ciclo] Purga: ${resumenAvisoPrueba.enviados} aviso(s) de prueba por terminar, ${resumenPruebas.procesadas} prueba(s) cerrada(s), ` +
          `${resumenAvisoNoOperativa.enviados} aviso(s) de cuenta no operativa, ${resumenCuentasNoOperativas.procesadas} cuenta(s) no operativa(s) cerrada(s), ` +
          `${resumenCierreImpago.cerradas} clínica(s) entraron en cierre por impago, ` +
          `${resumenRecordatorios.enviados} recordatorio(s), ${resumenPurgas.purgadas} clínica(s) purgada(s).`
      );
    }
  } catch (err) {
    console.error("[jobs:ciclo] Error al ejecutar el ciclo de purga", err);
  }

  const resumen: ResumenCiclo = { procesadas: 0, conError: 0, creditoOtorgadoTotal: 0, creditoExpiradoTotal: 0 };
  const candidatos = await seleccionarCandidatos();

  for (const candidato of candidatos) {
    try {
      const { creditoOtorgado, creditoExpirado } = await procesarUnaSuscripcion(candidato);
      resumen.procesadas++;
      resumen.creditoOtorgadoTotal += creditoOtorgado;
      resumen.creditoExpiradoTotal += creditoExpirado;
    } catch (err) {
      resumen.conError++;
      console.error(`[jobs:ciclo] Error al procesar "${candidato.tenant_nombre}"`, err);
    }
  }

  console.log(
    `[jobs:ciclo] Resumen: ${resumen.procesadas} procesada(s), ${resumen.conError} con error, ` +
      `$${resumen.creditoOtorgadoTotal.toFixed(2)} otorgado en total, $${resumen.creditoExpiradoTotal.toFixed(2)} expirado en total.`
  );
  return resumen;
}

/* ---------------------------------------------------------------------
 * PASO 6 — Verificaciones periódicas de integridad. Se dejan como
 * consultas documentadas (no como endpoints nuevos de administración):
 * son para uso interno/soporte, no para una pantalla — agregar
 * endpoints hubiera sido trabajo de superficie (auth, rutas, UI) fuera
 * del alcance de este bloque. Correr a mano contra la base cuando se
 * sospeche un problema, o adaptarlas a un script si hace falta
 * automatizarlas más adelante.
 *
 * 1. Divergencia entre saldo materializado y libro mayor (por tenant):
 *
 *   SELECT si.tenant_id,
 *          si.credito_plan_usd - COALESCE(SUM(mc.monto_usd) FILTER (WHERE mc.bolsa = 'plan'), 0) AS diff_plan,
 *          si.credito_comprado_usd - COALESCE(SUM(mc.monto_usd) FILTER (WHERE mc.bolsa = 'comprado'), 0) AS diff_comprado
 *   FROM saldos_ia si
 *   LEFT JOIN movimientos_credito mc ON mc.tenant_id = si.tenant_id
 *   GROUP BY si.tenant_id, si.credito_plan_usd, si.credito_comprado_usd
 *   HAVING si.credito_plan_usd - COALESCE(SUM(mc.monto_usd) FILTER (WHERE mc.bolsa = 'plan'), 0) != 0
 *       OR si.credito_comprado_usd - COALESCE(SUM(mc.monto_usd) FILTER (WHERE mc.bolsa = 'comprado'), 0) != 0;
 *
 * 2. Uso de API cobrable sin movimiento de crédito asociado:
 *
 *   SELECT ua.id, ua.tenant_id, ua.costo_usd_calculado
 *   FROM uso_api ua
 *   WHERE ua.cobrable = true AND ua.costo_usd_calculado > 0
 *     AND NOT EXISTS (
 *       SELECT 1 FROM movimientos_credito mc
 *       WHERE mc.referencia_tabla = 'uso_api' AND mc.referencia_id = ua.id
 *     );
 *
 * 3. Movimientos de consumo sin uso de API asociado:
 *
 *   SELECT mc.id, mc.tenant_id, mc.monto_usd
 *   FROM movimientos_credito mc
 *   WHERE mc.tipo = 'consumo'
 *     AND NOT EXISTS (SELECT 1 FROM uso_api ua WHERE ua.id = mc.referencia_id);
 *
 * 4. Saldos negativos:
 *
 *   SELECT tenant_id, credito_plan_usd, credito_comprado_usd
 *   FROM saldos_ia
 *   WHERE credito_plan_usd < 0 OR credito_comprado_usd < 0;
 *
 * 5. Modelos en uso_api sin tarifa vigente, o con tarifa vigente en cero
 * y facturable en true (el segundo caso sería un precio cargado mal —
 * costo real cero pero facturable, en vez de la convención de precio
 * cero + facturable=false para modelos de prueba):
 *
 *   SELECT DISTINCT ua.modelo
 *   FROM uso_api ua
 *   WHERE ua.tarifa_entrada_id IS NULL
 *   UNION
 *   SELECT DISTINCT tm.modelo
 *   FROM tarifas_modelo tm
 *   WHERE tm.vigente_hasta IS NULL AND tm.precio_usd_por_millon = 0 AND tm.facturable = true;
 *
 * 6. Suscripciones con período vencido y sin otorgamiento de crédito —
 * la que detecta que este mismo job dejó de correr:
 *
 *   SELECT s.id, s.tenant_id, s.periodo_fin
 *   FROM suscripciones s
 *   WHERE s.estado IN ('activa', 'morosa', 'cancelada')
 *     AND s.periodo_fin < now() - interval '1 day'
 *     AND NOT EXISTS (
 *       SELECT 1 FROM movimientos_credito mc
 *       WHERE mc.tenant_id = s.tenant_id AND mc.tipo = 'otorgamiento_plan' AND mc.creado_en >= s.periodo_fin
 *     );
 * --------------------------------------------------------------------- */

// Horario fijo — 5:00 AM, una vez al día, antes del de notificaciones
// (6:00 AM) para que un aviso de saldo_bajo que dependa del ciclo ya
// tenga el período avanzado cuando corra. No dispara al arrancar (mismo
// criterio que notificaciones.job.ts): es idempotente por diseño, así
// que no hay urgencia de no esperar el primer horario — correrlo a mano
// para verificar está disponible vía ejecutarJobCiclo().
export function iniciarJobCiclo() {
  cron.schedule("0 5 * * *", () => {
    ejecutarJobCiclo();
  });
}
