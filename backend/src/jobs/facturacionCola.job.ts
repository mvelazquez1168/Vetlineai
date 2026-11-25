import cron from "node-cron";
import { Pool } from "pg";
import { pool } from "../db";
import { intentarEnviar } from "../facturacion/emision";

// ---------------------------------------------------------------------
// El trabajo que saca de la cola los comprobantes que Hacienda todavía
// no resolvió: los que no se pudieron enviar (contingencia) y los
// enviados que siguen sin veredicto.
//
// Las dos propiedades que lo hacen seguro:
//
// 1. **Es idempotente.** `intentarEnviar` NO manda de nuevo un
//    comprobante que ya salió: consulta su estado. Así, correrlo dos
//    veces —o dos instancias del backend a la vez— no duplica nada.
//
// 2. **No pisa a otra corrida.** La selección usa `FOR UPDATE SKIP
//    LOCKED`: si dos procesos corren al mismo tiempo, cada uno toma
//    comprobantes distintos en vez de pelearse por los mismos. Sin eso,
//    dos instancias enviarían el mismo comprobante a la vez, y aunque
//    Hacienda deduplica por clave, el motor escribiría dos veces el
//    mismo evento y el estado quedaría decidido por una carrera.
//
// Usa el pool ADMIN porque recorre todos los tenants a propósito, igual
// que `notificaciones.job.ts`. La escritura de cada comprobante sí va
// por `conAlcanceTenant` (dentro de `intentarEnviar`), así que la
// escritura nunca pierde la red de RLS.
// ---------------------------------------------------------------------

/**
 * Cuántos comprobantes se procesan por corrida.
 *
 * Hay un tope y no "todos" porque cada uno implica una o dos llamadas a
 * Hacienda: una cola de dos mil comprobantes acumulados tras una caída
 * larga no debe convertirse en dos mil llamadas seguidas. Con el cron
 * cada minuto, 50 por vuelta son 3 000 por hora, que alcanza de sobra y
 * deja a Hacienda respirar.
 */
const POR_CORRIDA = 50;

export interface ResultadoCorrida {
  procesados: number;
  aceptados: number;
  rechazados: number;
  enCola: number;
  conError: number;
}

interface FilaPendiente {
  id: string;
  tenant_id: string;
  clave: string;
  estado: string;
}

/**
 * Los comprobantes que toca atender: en cola para enviar, o enviados sin
 * veredicto, con su momento de reintento ya cumplido.
 *
 * El `SELECT ... FOR UPDATE SKIP LOCKED` se hace en su propia
 * transacción corta y se SUELTA antes de llamar a Hacienda: el bloqueo
 * sirve para repartir trabajo entre corridas, no para sostenerlo durante
 * la llamada externa. Mantenerlo tomado sería exactamente el
 * `idle in transaction` que este proyecto ya tuvo que corregir.
 */
async function tomarPendientes(db: Pool): Promise<FilaPendiente[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<FilaPendiente>(
      `SELECT id, tenant_id, clave, estado
         FROM fact_comprobantes
        WHERE estado IN ('en_cola', 'enviado')
          AND proximo_intento_en IS NOT NULL
          AND proximo_intento_en <= now()
        ORDER BY proximo_intento_en ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [POR_CORRIDA]
    );
    await client.query("COMMIT");
    return r.rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function ejecutarColaFacturacion(db: Pool = pool): Promise<ResultadoCorrida> {
  const pendientes = await tomarPendientes(db);
  const resultado: ResultadoCorrida = {
    procesados: 0,
    aceptados: 0,
    rechazados: 0,
    enCola: 0,
    conError: 0,
  };

  for (const fila of pendientes) {
    resultado.procesados++;
    try {
      const r = await intentarEnviar(fila.tenant_id, fila.id);
      if (r.estado === "aceptado" || r.estado === "aceptado_parcial") resultado.aceptados++;
      else if (r.estado === "rechazado") resultado.rechazados++;
      else if (r.estado === "error") resultado.conError++;
      else resultado.enCola++;
    } catch (err) {
      // Un comprobante que falla no detiene la cola: los demás se
      // procesan igual. Lo que no se hace es tragarse el error — queda en
      // el log con la clave, que es con lo que se busca después.
      resultado.conError++;
      console.error(
        `[facturacionCola.job] Falló el comprobante ${fila.clave} (${fila.id}) de la clínica ${fila.tenant_id}:`,
        err
      );
    }
  }

  if (resultado.procesados > 0) {
    console.log(
      `[facturacionCola.job] ${resultado.procesados} comprobante(s): ` +
        `${resultado.aceptados} aceptado(s), ${resultado.rechazados} rechazado(s), ` +
        `${resultado.enCola} sigue(n) en cola, ${resultado.conError} con error.`
    );
  }

  return resultado;
}

export function iniciarJobColaFacturacion() {
  // Cada minuto. Es la frecuencia que hace que una contingencia corta
  // —Hacienda caída dos minutos— se resuelva sola sin que nadie se
  // entere, que es el objetivo: la venta no se bloquea y el comprobante
  // se transmite en cuanto se puede.
  cron.schedule("* * * * *", () => {
    ejecutarColaFacturacion(pool).catch((err) =>
      console.error("[facturacionCola.job] Error en la corrida", err)
    );
  });
}
