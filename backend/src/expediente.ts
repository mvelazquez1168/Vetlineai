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

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 3.1 — número de expediente DEL PACIENTE
// (migración 087). Contador propio en `tenants`
// (`paciente_expediente_ultimo_numero`), independiente del de casos.
//
// Vive en este archivo y no en `pacientes.routes.ts` por lo mismo que
// dice el comentario de arriba: es la misma forma del problema, y ya
// está consolidada acá. Las dos asignaciones juntas también hacen
// evidente que son dos contadores distintos y no uno reutilizado — que
// es justo la confusión que motivó renombrar la etiqueta del número de
// caso en la interfaz.
//
// Mismas garantías que `asignarNumeroExpediente`: el UPDATE...RETURNING
// toma lock de fila sobre el tenant hasta el COMMIT del llamador, así que
// dos altas simultáneas NUNCA obtienen el mismo número; y si la
// transacción del llamador hace ROLLBACK, el incremento se deshace con
// ella. Se llama SIEMPRE dentro de la misma transacción que el INSERT del
// paciente.
// ---------------------------------------------------------------------
export async function asignarNumeroExpedientePaciente(db: EjecutorSql, tenantId: string): Promise<number> {
  // EL CONTADOR PUEDE HABER QUEDADO ATRÁS, Y SE CORRIGE SOLO.
  //
  // Defecto real encontrado al construir el alta desde el fichero
  // (anexo 07-03, A5): una clínica con dos pacientes numerados 1 y 2
  // tenía el contador en 0, porque esos pacientes se insertaron sin
  // pasar por acá (sembrado, importación, reconstrucción). El contador y
  // la tabla pueden separarse, y cuando se separan el alta falla con una
  // violación de la unicidad de `numero_expediente` — un 500 que al
  // usuario le dice «Error al crear la mascota» y no le deja hacer nada.
  //
  // El GREATEST hace que el contador se ponga al día en la misma
  // sentencia en vez de chocar. No cambia el camino normal: cuando el
  // contador está bien, `contador + 1` ya es el mayor de los dos.
  //
  // La subconsulta corre bajo el MISMO lock de fila del tenant que ya
  // tomaba el UPDATE, así que las garantías de antes se mantienen: dos
  // altas simultáneas no obtienen el mismo número, y un ROLLBACK del
  // llamador deshace el incremento.
  const result = await db.query(
    `UPDATE tenants t
        SET paciente_expediente_ultimo_numero = GREATEST(
              t.paciente_expediente_ultimo_numero + 1,
              COALESCE((SELECT max(p.numero_expediente) FROM pacientes p
                         WHERE p.tenant_id = t.id), 0) + 1
            )
      WHERE t.id = $1
      RETURNING paciente_expediente_ultimo_numero`,
    [tenantId]
  );
  return result.rows[0].paciente_expediente_ultimo_numero as number;
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
