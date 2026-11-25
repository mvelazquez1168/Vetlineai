import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 3.2 — el cruce entre `pacientes.especie` y
// `razas.especie`, y la validación que lo usa.
//
// Por qué se MUEVE acá en vez de copiarse: el mapeo vivía dentro de
// `routes/pacientes.routes.ts` como una constante del archivo, usada por
// un solo endpoint (`POST /`). Ahora el `PATCH /:id` necesita exactamente
// la misma validación. Copiarla serían dos reglas que hoy coinciden y
// mañana no — el prompt lo pide explícitamente ("si hay que moverlo para
// reusarlo, se mueve, no se copia").
//
// El problema de fondo que este archivo documenta, y que NO resuelve:
// `pacientes.especie` guarda "Canino"/"Felino" (texto libre, tal como lo
// manda el formulario desde la migración 001) y `razas.especie` guarda
// 'canina'/'felina' (vocabulario de la migración 009). Son dos
// vocabularios para el mismo concepto y este mapeo es el único puente.
// Unificarlos es una migración de datos sobre `pacientes.especie`, no
// algo que corresponda hacer de paso acá.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

/** "Canino" → 'canina'. Único punto donde se cruzan los dos vocabularios. */
export const ESPECIE_PACIENTE_A_RAZA: Record<string, string> = {
  Canino: "canina",
  Felino: "felina",
};

export type ResultadoValidacionRaza =
  | { ok: true; razaNombre: string | null }
  | { ok: false; error: string };

/**
 * Valida que una raza exista y que corresponda a la especie declarada.
 * `razaId` nulo/ausente es válido (la raza es opcional, igual que antes
 * lo era el texto libre) y devuelve `razaNombre: null`.
 *
 * Devuelve el mensaje de error ya escrito, en vez de un código, para que
 * los dos llamadores (POST y PATCH) respondan exactamente lo mismo ante
 * el mismo problema.
 */
export async function validarRazaParaEspecie(
  db: EjecutorSql,
  razaId: string | null | undefined,
  especie: string
): Promise<ResultadoValidacionRaza> {
  if (!razaId) return { ok: true, razaNombre: null };

  const razaResult = await db.query(`SELECT especie, nombre FROM razas WHERE id = $1`, [razaId]);
  if (razaResult.rows.length === 0) {
    return { ok: false, error: "La raza seleccionada no existe." };
  }

  const especieEsperada = ESPECIE_PACIENTE_A_RAZA[especie.trim()];
  if (razaResult.rows[0].especie !== especieEsperada) {
    return { ok: false, error: "La raza seleccionada no corresponde a la especie indicada." };
  }

  return { ok: true, razaNombre: razaResult.rows[0].nombre };
}
