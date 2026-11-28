import { PoolClient } from "pg";
import { tenantPool } from "./db";
import { enSerie } from "./clienteEnSerie";

// ---------------------------------------------------------------------
// Transacción CORTA con el alcance del tenant puesto, para usar después
// de que una ruta cerró la transacción de la request.
//
// El problema que resuelve: `withTenantClient` sostiene una transacción
// durante toda la request. En las rutas que llaman al modelo eso deja la
// conexión en `idle in transaction` durante toda la espera (medido: ~9.5 s
// en un mensaje trivial, y la síntesis clínica tarda ~220 s). El patrón
// nuevo parte la ruta en tres:
//
//   1. transacción de la request  → leer contexto y persistir lo del médico
//   2. cerrarTransaccion()        → la llamada al modelo, SIN conexión tomada
//   3. conAlcanceTenant(...)      → escribir el resultado, en milisegundos
//
// Es la misma forma que usa Converza (`ejecutarConAlcance`): la
// transacción tiene alcance de callback, no de request.
//
// `set_config(..., true)` es local a la transacción, igual que en
// withTenantClient: al terminar, el alcance se va con ella. Si fuera de
// sesión, la conexión volvería al pool con el tenant del anterior puesto,
// que es exactamente la fuga que RLS existe para impedir.
//
// Va contra `tenantPool` (rol sin BYPASSRLS) y no contra el pool admin: si
// usara el admin, esta segunda mitad escribiría sin RLS y perdería la red
// de seguridad que la primera mitad sí tiene.
// ---------------------------------------------------------------------
export async function conAlcanceTenant<T>(
  tenantId: string,
  fn: (db: PoolClient) => Promise<T>,
  /**
   * Quién está haciendo esto, para los triggers que lo necesitan.
   *
   * Un trigger no recibe parámetros: lo único que puede leer es la
   * sesión. El historial de precios (migración 159) sale de un trigger y
   * necesita saber quién cambió el precio; sin esto guardaría NULL
   * siempre. Es opcional porque un job no es una persona.
   */
  personaId?: string | null
): Promise<T> {
  const client = await tenantPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    if (personaId) {
      await client.query("SELECT set_config('app.persona_id', $1, true)", [personaId]);
    }
    // EN SERIE, igual que en una solicitud HTTP (ver clienteEnSerie.ts):
    // los jobs y los verificadores usan este camino y tienen el mismo
    // `Promise.all` sobre un solo cliente que las rutas.
    const resultado = await fn(enSerie(client));
    await client.query("COMMIT");
    client.release();
    return resultado;
  } catch (err) {
    // El ROLLBACK puede fallar si lo que se rompió es la conexión misma. En
    // ese caso NO se la devuelve al pool: `release(err)` la destruye. Una
    // conexión devuelta con la transacción todavía abierta queda en `idle
    // in transaction` hasta que alguien la reuse — verificado: pg no hace
    // rollback solo al soltarla.
    try {
      await client.query("ROLLBACK");
      client.release();
    } catch (errRollback) {
      console.error("conAlcanceTenant: falló el ROLLBACK — se descarta la conexión", errRollback);
      client.release(errRollback instanceof Error ? errRollback : new Error(String(errRollback)));
    }
    throw err;
  }
}
