import { Pool, PoolClient } from "pg";
import { AuthPayload } from "./middleware/auth";
import { registrarEventoDetallado } from "./middleware/auditoria";

type EjecutorSql = Pool | PoolClient;

// ---------------------------------------------------------------------
// prompt_code_expediente_y_propietario, Parte A. Único mecanismo de
// asignación — los 3 puntos reales que crean un caso (POST /api/casos,
// POST /api/workspace/casos, seed.ts) llaman a esta función en vez de
// repetir la lógica, tal como pidió el usuario ("es la tercera vez que
// aparece esa forma del problema").
//
// Atómico por diseño: UPDATE...RETURNING en una sola sentencia toma un
// lock de fila sobre el tenant hasta que la transacción que lo llama
// hace COMMIT o ROLLBACK — una segunda transacción concurrente que pida
// un número para el mismo tenant espera en ese lock, nunca lee el mismo
// valor que la primera. Si la transacción del caller hace ROLLBACK
// después (el caso no llega a crearse), el incremento se deshace con
// ella: el número no se consume. Se llama SIEMPRE dentro de la misma
// transacción que el INSERT del caso — nunca en una transacción propia.
// ---------------------------------------------------------------------
export async function asignarNumeroExpediente(db: EjecutorSql, tenantId: string): Promise<number> {
  const result = await db.query(
    `UPDATE tenants SET expediente_ultimo_numero = expediente_ultimo_numero + 1
     WHERE id = $1
     RETURNING expediente_ultimo_numero`,
    [tenantId]
  );
  return result.rows[0].expediente_ultimo_numero as number;
}

export async function obtenerProximoNumeroExpediente(db: EjecutorSql, tenantId: string): Promise<number> {
  const result = await db.query(`SELECT expediente_ultimo_numero FROM tenants WHERE id = $1`, [tenantId]);
  return Number(result.rows[0].expediente_ultimo_numero) + 1;
}

export type ResultadoConfigurarInicio =
  | { ok: true; proximoNumero: number }
  | { ok: false; motivo: "retrocede"; proximoNumeroActual: number };

// No hay columna de "número de inicio" — es derivable de
// expediente_ultimo_numero (confirmado por el usuario: configurar el
// inicio en 4521 es directamente fijar el último asignado en 4520) y
// una columna aparte solo abriría la posibilidad de que las dos
// discreparan. El registro de que la clínica configuró un salto queda
// en la bitácora de auditoría (registrarEventoDetallado), no en una
// columna de estado — es un evento, no un dato vigente del tenant.
export async function configurarInicioExpediente(
  db: EjecutorSql,
  auth: AuthPayload,
  tenantId: string,
  numeroInicio: number
): Promise<ResultadoConfigurarInicio> {
  const actual = await db.query(`SELECT expediente_ultimo_numero FROM tenants WHERE id = $1`, [tenantId]);
  const ultimoActual = Number(actual.rows[0].expediente_ultimo_numero);
  const proximoActual = ultimoActual + 1;

  if (numeroInicio <= ultimoActual) {
    return { ok: false, motivo: "retrocede", proximoNumeroActual: proximoActual };
  }

  const nuevoUltimo = numeroInicio - 1;
  await db.query(`UPDATE tenants SET expediente_ultimo_numero = $1 WHERE id = $2`, [nuevoUltimo, tenantId]);

  registrarEventoDetallado(auth, "configurar_inicio_expediente", "tenants", tenantId, {
    proximoNumeroAnterior: proximoActual,
    numeroInicioConfigurado: numeroInicio,
  });

  return { ok: true, proximoNumero: numeroInicio };
}
