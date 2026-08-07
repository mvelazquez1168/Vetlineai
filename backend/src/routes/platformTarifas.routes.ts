import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { invalidarCacheTarifa } from "../tarifas";

// ---------------------------------------------------------------------
// Platform Admin — administración de tarifas por token. Hasta ahora las
// filas de tarifas_modelo se cargaban a mano por SQL (ver esta misma
// sesión, seed de claude-sonnet-4-6/claude-sonnet-5-mock); este router es
// el primer punto de entrada real para cambiarlas desde una pantalla.
//
// Una tarifa NUNCA se edita: se cierra la vigente (vigente_hasta = now())
// y se inserta una nueva. tarifas.ts ya depende de este patrón (índice
// único parcial "tarifa_vigente_por_modelo" WHERE vigente_hasta IS NULL) y
// ya expone invalidarCacheTarifa()/invalidarCacheTarifasCompleta() para
// este momento exacto — sin llamarlas, un cambio de precio tarda hasta 60s
// (TARIFAS_CACHE_TTL_MS) en tomar efecto.
// ---------------------------------------------------------------------

export const platformTarifasRouter = Router();

platformTarifasRouter.use(authenticate, withTenantClient);

// Mismo nivel de sensibilidad que facturación/auditoría en
// platform-admin.routes.ts: cambiar un precio o marcar un modelo como no
// facturable afecta el cobro de TODA la plataforma — solo super_admin.
platformTarifasRouter.use((req, res, next) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "La administración de tarifas es solo para super_admin." });
  }
  next();
});

const TIPOS_TOKEN = ["entrada", "salida", "cache_escritura", "cache_lectura"] as const;
type TipoToken = (typeof TIPOS_TOKEN)[number];

// GET /tarifas — agrupado por modelo, vigentes + históricas.
platformTarifasRouter.get("/tarifas", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT id, modelo, tipo_token, precio_usd_por_millon, facturable, vigente_desde, vigente_hasta
       FROM tarifas_modelo
       ORDER BY modelo, tipo_token, vigente_desde DESC`
    );

    const porModelo = new Map<
      string,
      { modelo: string; facturable: boolean; tarifas: unknown[] }
    >();

    for (const fila of result.rows) {
      if (!porModelo.has(fila.modelo)) {
        porModelo.set(fila.modelo, { modelo: fila.modelo, facturable: true, tarifas: [] });
      }
      const grupo = porModelo.get(fila.modelo)!;
      grupo.tarifas.push({
        id: fila.id,
        tipoToken: fila.tipo_token,
        precioUsdPorMillon: Number(fila.precio_usd_por_millon),
        facturable: fila.facturable,
        vigenteDesde: fila.vigente_desde,
        vigenteHasta: fila.vigente_hasta,
        vigente: fila.vigente_hasta === null,
      });
      // facturable a nivel de modelo = AND de las 4 filas vigentes (mismo
      // criterio que resolverTarifasVigentes en tarifas.ts) — una fila
      // histórica no participa.
      if (fila.vigente_hasta === null && !fila.facturable) {
        grupo.facturable = false;
      }
    }

    res.json({ modelos: Array.from(porModelo.values()) });
  } catch (err) {
    console.error("GET /platform-admin/tarifas", err);
    res.status(500).json({ error: "Error al listar tarifas." });
  }
});

// GET /tarifas/alertas — modelos facturables con tarifa en cero, o sin
// las 4 tarifas vigentes cargadas. El universo de modelos es la unión de
// lo que aparece en uso_api (ya se usó alguna vez) y lo que ya existe en
// tarifas_modelo (se cargó pero todavía no se usó) — un modelo nuevo con
// precio $0 debe alertar antes de su primer uso, no después.
platformTarifasRouter.get("/tarifas/alertas", async (req, res) => {
  try {
    const result = await req.db!.query(
      `WITH modelos AS (
         SELECT DISTINCT modelo FROM uso_api
         UNION
         SELECT DISTINCT modelo FROM tarifas_modelo
       ),
       tarifas_agg AS (
         SELECT modelo,
                COUNT(*) AS filas_vigentes,
                BOOL_AND(facturable) AS facturable,
                BOOL_OR(precio_usd_por_millon = 0) AS tiene_precio_cero
         FROM tarifas_modelo
         WHERE vigente_hasta IS NULL
         GROUP BY modelo
       )
       SELECT m.modelo, COALESCE(ta.filas_vigentes, 0) AS filas_vigentes, ta.facturable, ta.tiene_precio_cero
       FROM modelos m
       LEFT JOIN tarifas_agg ta ON ta.modelo = m.modelo
       ORDER BY m.modelo`
    );

    const alertas = result.rows
      .map((fila) => {
        const filasVigentes = Number(fila.filas_vigentes);
        if (filasVigentes < TIPOS_TOKEN.length) {
          return { modelo: fila.modelo, motivo: "sin_tarifa_vigente" as const };
        }
        if (fila.facturable && fila.tiene_precio_cero) {
          return { modelo: fila.modelo, motivo: "tarifa_en_cero" as const };
        }
        return null;
      })
      .filter((a): a is { modelo: string; motivo: "sin_tarifa_vigente" | "tarifa_en_cero" } => a !== null);

    res.json({ alertas });
  } catch (err) {
    console.error("GET /platform-admin/tarifas/alertas", err);
    res.status(500).json({ error: "Error al calcular las alertas de tarifas." });
  }
});

// POST /tarifas — cierra la vigente (si existe) y crea una nueva. Nunca
// UPDATE sobre una fila existente.
platformTarifasRouter.post("/tarifas", async (req, res) => {
  const { modelo, tipoToken, precioUsdPorMillon } = req.body as {
    modelo?: string;
    tipoToken?: string;
    precioUsdPorMillon?: number;
  };

  if (!modelo || !tipoToken || !TIPOS_TOKEN.includes(tipoToken as TipoToken)) {
    return res.status(400).json({ error: "Faltan datos o el tipo de token no es válido." });
  }
  if (typeof precioUsdPorMillon !== "number" || !Number.isFinite(precioUsdPorMillon) || precioUsdPorMillon < 0) {
    return res.status(400).json({ error: "El precio no puede ser negativo." });
  }

  try {
    // La fila vigente (si existe) determina si el modelo sigue facturable
    // o no — este endpoint solo cambia precio, nunca ese estado.
    const cierre = await req.db!.query(
      `UPDATE tarifas_modelo SET vigente_hasta = now()
       WHERE modelo = $1 AND tipo_token = $2 AND vigente_hasta IS NULL
       RETURNING facturable`,
      [modelo, tipoToken]
    );
    const facturable = cierre.rows[0]?.facturable ?? true;

    const nueva = await req.db!.query(
      `INSERT INTO tarifas_modelo (modelo, tipo_token, precio_usd_por_millon, facturable, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, vigente_desde`,
      [modelo, tipoToken, precioUsdPorMillon, facturable, req.auth!.userId]
    );

    invalidarCacheTarifa(modelo);

    res.status(201).json({
      id: nueva.rows[0].id,
      modelo,
      tipoToken,
      precioUsdPorMillon,
      facturable,
      vigenteDesde: nueva.rows[0].vigente_desde,
    });
  } catch (err) {
    console.error("POST /platform-admin/tarifas", err);
    res.status(500).json({ error: "Error al crear la nueva tarifa." });
  }
});

// PATCH /tarifas/:modelo/facturable — marca las 4 filas vigentes del
// modelo como facturables o no. No es un cambio de precio (no cierra ni
// crea filas) — es un estado administrativo aparte, igual que
// dev-mock-model se seedeó directamente como no facturable.
platformTarifasRouter.patch("/tarifas/:modelo/facturable", async (req, res) => {
  const { modelo } = req.params;
  const { facturable } = req.body as { facturable?: boolean };

  if (typeof facturable !== "boolean") {
    return res.status(400).json({ error: "Falta el valor de 'facturable'." });
  }

  try {
    const result = await req.db!.query(
      `UPDATE tarifas_modelo SET facturable = $1
       WHERE modelo = $2 AND vigente_hasta IS NULL
       RETURNING id`,
      [facturable, modelo]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No hay tarifas vigentes para ese modelo." });
    }

    invalidarCacheTarifa(modelo);

    res.json({ modelo, facturable });
  } catch (err) {
    console.error("PATCH /platform-admin/tarifas/:modelo/facturable", err);
    res.status(500).json({ error: "Error al actualizar el estado facturable del modelo." });
  }
});
