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
// EL PROBLEMA DE FONDO, QUE AHORA SÍ SE RESUELVE (2026-11-27).
//
// `pacientes.especie` era texto libre y la base tenía CINCO escrituras
// del mismo concepto: «Canino» (16), «canino» (1), «Felino» (3),
// «perro» (45) y «gato» (32). El mapeo de abajo aceptaba exactamente
// «Canino» y «Felino», así que **78 de 97 pacientes no podían guardar su
// raza**: editar a un golden retriever contestaba «La raza seleccionada
// no corresponde a la especie indicada», que además es un mensaje que
// culpa al usuario de un desajuste nuestro.
//
// Se cierra por tres lados a la vez, porque cerrar uno solo lo deja
// volver:
//
//   1. **La comparación tolera** mayúsculas, tildes y sinónimos. Es lo
//      que arregla los datos que YA están;
//   2. **la escritura normaliza** (`especieCanonica`), en el POST y en
//      el PATCH: lo que entra queda en el vocabulario único;
//   3. **la migración 165 normaliza lo existente**. Sin esto, el punto 2
//      solo alcanza a lo que alguien vuelva a guardar.
//
// `razas.especie` sigue con su propio vocabulario ('canina'/'felina',
// migración 009) y no se toca: es el de un catálogo compartido entre
// clínicas. Este archivo es el único puente entre los dos.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

/** "Canino" → 'canina'. Único punto donde se cruzan los dos vocabularios. */
export const ESPECIE_PACIENTE_A_RAZA: Record<string, string> = {
  Canino: "canina",
  Felino: "felina",
};

/** El vocabulario único de `pacientes.especie`. Lo que el selector ofrece. */
export const ESPECIES_CANONICAS = ["Canino", "Felino"] as const;
export type EspecieCanonica = (typeof ESPECIES_CANONICAS)[number];

/**
 * TODAS las formas de escribir cada especie que aparecen en los datos
 * reales o que alguien podría teclear, en un solo lugar.
 *
 * Están sin tildes y en minúscula porque la comparación normaliza antes:
 * agregar «canina» y «Canina» por separado sería la lista que un día se
 * olvida de una de las dos.
 */
const SINONIMOS: Record<string, EspecieCanonica> = {
  canino: "Canino",
  canina: "Canino",
  can: "Canino",
  perro: "Canino",
  perra: "Canino",
  perrito: "Canino",
  perrita: "Canino",
  cachorro: "Canino",
  cachorra: "Canino",
  canino_domestico: "Canino",
  felino: "Felino",
  felina: "Felino",
  gato: "Felino",
  gata: "Felino",
  gatito: "Felino",
  gatita: "Felino",
  minino: "Felino",
  michi: "Felino",
};

/** Minúsculas, sin tildes y sin espacios de sobra. */
function plano(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/**
 * La especie en el vocabulario único, o `null` si no se reconoce.
 *
 * DEVUELVE `null` Y NO «Canino» cuando no entiende. Suponer perro ante
 * la duda es exactamente el defecto que esto arregla: el formulario
 * mostraba «Canino» para un paciente cuya especie decía otra cosa, y
 * guardarlo así habría cambiado la especie del animal sin avisar.
 */
export function especieCanonica(texto: string | null | undefined): EspecieCanonica | null {
  if (!texto) return null;
  return SINONIMOS[plano(texto)] ?? null;
}

/** La especie de `razas` que corresponde, tolerando cómo esté escrita. */
export function especieDeRaza(texto: string | null | undefined): string | null {
  const canonica = especieCanonica(texto);
  return canonica ? ESPECIE_PACIENTE_A_RAZA[canonica] : null;
}

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

  // TOLERANTE: «Canino», «canino», «perro» y «canina» son la misma
  // especie. Lo que no se puede es inventar: una especie que no se
  // reconoce se dice, no se asume.
  const especieEsperada = especieDeRaza(especie);
  if (!especieEsperada) {
    return {
      ok: false,
      error:
        `La especie registrada («${especie.trim()}») no se reconoce, así que no se puede ` +
        "comprobar si la raza corresponde. Elegí la especie en el selector.",
    };
  }
  if (razaResult.rows[0].especie !== especieEsperada) {
    return {
      ok: false,
      error: `La raza seleccionada es de otra especie (${razaResult.rows[0].especie}).`,
    };
  }

  return { ok: true, razaNombre: razaResult.rows[0].nombre };
}
