import { Router } from "express";
import moment from "moment-timezone";
import { pool } from "../db";

export const paisesRouter = Router();

/**
 * Zonas horarias "representativas" para un país, a partir de datos reales
 * de moment-timezone (IANA tzdb) — nunca offsets inventados a mano.
 *
 * moment.tz.zonesForCountry devuelve TODAS las zonas IANA del país (para
 * Argentina son 12 ciudades, para Estados Unidos son ~29), lo cual es
 * demasiado para un dropdown simple. Colapsamos a una zona representativa
 * por cada offset actual distinto (hoy todas las zonas de Argentina
 * comparten GMT-3, así que quedan en 1 sola opción).
 *
 * El default es la zona representativa del offset con más zonas asociadas
 * en el país (el offset "mayoritario") — sigue siendo un dato real de la
 * tzdb, no una elección arbitraria.
 */
export function zonasHorariasParaPais(codigoIso: string): {
  zonas: string[];
  default: string | null;
} {
  const zonas = moment.tz.zonesForCountry(codigoIso, true) as
    | { name: string; offset: number }[]
    | null;

  if (!zonas || zonas.length === 0) {
    return { zonas: [], default: null };
  }

  const representativaPorOffset = new Map<number, string>();
  const conteoPorOffset = new Map<number, number>();
  for (const z of zonas) {
    if (!representativaPorOffset.has(z.offset)) {
      representativaPorOffset.set(z.offset, z.name);
    }
    conteoPorOffset.set(z.offset, (conteoPorOffset.get(z.offset) ?? 0) + 1);
  }

  const [offsetMayoritario] = [...conteoPorOffset.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    zonas: [...representativaPorOffset.values()],
    default: representativaPorOffset.get(offsetMayoritario) ?? zonas[0].name,
  };
}

// Catálogo público: se usa desde formularios que a veces corren antes de
// tener sesión (por eso no lleva `authenticate`). Sin RLS, como agentes.
// `estado` se agrega para el wizard de registro (paso 1: país habilitado
// vs. lista de espera) — aditivo, no rompe a los consumidores existentes
// (CountryCombobox) que no lo usan.
paisesRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT codigo_iso, nombre, idioma_default, estado FROM paises ORDER BY nombre`
    );

    const paises = result.rows.map((p) => {
      const { zonas, default: zonaDefault } = zonasHorariasParaPais(p.codigo_iso);
      return {
        ...p,
        zona_horaria_default: zonaDefault,
        zonas_horarias: zonas,
      };
    });

    res.json({ paises });
  } catch (err) {
    console.error("GET /paises", err);
    res.status(500).json({ error: "Error al listar países." });
  }
});

// Público — tipos de identificación disponibles para el wizard de
// registro, antes de tener sesión. Mismo criterio de filtro que la
// versión autenticada bajo /admin/tipos-identificacion.
paisesRouter.get("/:codigo/tipos-identificacion", async (req, res) => {
  const codigoIso = req.params.codigo.toUpperCase();
  const tipoPersona = req.query.tipoPersona as "fisica" | "juridica" | undefined;
  try {
    const condicionPersona =
      tipoPersona === "fisica"
        ? "AND aplica_persona_fisica = true"
        : tipoPersona === "juridica"
        ? "AND aplica_persona_juridica = true"
        : "";
    const result = await pool.query(
      `SELECT id, codigo, etiqueta FROM tipos_identificacion
       WHERE pais_codigo = $1 AND activo = true ${condicionPersona}
       ORDER BY orden`,
      [codigoIso]
    );
    res.json({ tipos: result.rows });
  } catch (err) {
    console.error("GET /paises/:codigo/tipos-identificacion", err);
    res.status(500).json({ error: "Error al listar los tipos de identificación." });
  }
});
