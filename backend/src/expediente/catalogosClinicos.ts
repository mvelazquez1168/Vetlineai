import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------
// LOS CATÁLOGOS CLÍNICOS DE LA CLÍNICA — anexo Digital Vet, A1/A3/A5.
//
// Mucosas, hidratación, actitud, dolor, sistemas del examen, vías de
// administración, frecuencias, unidades de dosis, carácter, hábitat,
// dieta, pelaje y motivos de baja. Todos la misma forma —una lista
// ordenada de opciones— y por eso una sola tabla con un `tipo`.
//
// LA CLÍNICA GANA SOBRE LA PLATAFORMA: si una clínica definió sus
// propias mucosas, se usan las suyas y no se mezclan con las de la
// plataforma. Mezclarlas daría una lista con «Rosadas» dos veces, una de
// cada origen, y la clínica no podría quitar la que no usa.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export type TipoCatalogo =
  | "mucosas"
  | "hidratacion"
  | "actitud"
  | "dolor"
  | "sistema_examen"
  | "via_administracion"
  | "frecuencia"
  | "unidad_dosis"
  | "caracter"
  | "habitat"
  | "tipo_dieta"
  | "pelaje"
  | "motivo_baja";

export interface OpcionCatalogo {
  id: string;
  codigo: string;
  etiqueta: string;
  horas: number | null;
  orden: number;
  /** Si viene de la plataforma: la clínica no la edita, la reemplaza. */
  de_la_plataforma: boolean;
}

export async function catalogo(
  db: EjecutorSql,
  tipo: TipoCatalogo
): Promise<OpcionCatalogo[]> {
  // Una sola consulta: si hay filas de la clínica se devuelven esas, y
  // si no, las de la plataforma. Dos consultas con un `if` en medio
  // harían lo mismo con un viaje más.
  const r = await db.query<OpcionCatalogo & { horas: string | null }>(
    `SELECT id, codigo, etiqueta, horas, orden, tenant_id IS NULL AS de_la_plataforma
       FROM exp_catalogos_clinicos
      WHERE tipo = $1 AND activo
        AND (tenant_id IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM exp_catalogos_clinicos propio
                             WHERE propio.tipo = $1 AND propio.tenant_id IS NOT NULL
                               AND propio.activo))
      ORDER BY orden, etiqueta`,
    [tipo]
  );
  return r.rows.map((o) => ({ ...o, horas: o.horas === null ? null : Number(o.horas) }));
}

/** Todos los catálogos de una vez: es lo que una pantalla necesita. */
export async function todosLosCatalogos(
  db: EjecutorSql
): Promise<Record<string, OpcionCatalogo[]>> {
  const r = await db.query<OpcionCatalogo & { tipo: string; horas: string | null }>(
    `SELECT tipo, id, codigo, etiqueta, horas, orden, tenant_id IS NULL AS de_la_plataforma
       FROM exp_catalogos_clinicos c
      WHERE activo
        AND (tenant_id IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM exp_catalogos_clinicos propio
                             WHERE propio.tipo = c.tipo AND propio.tenant_id IS NOT NULL
                               AND propio.activo))
      ORDER BY tipo, orden, etiqueta`
  );
  const salida: Record<string, OpcionCatalogo[]> = {};
  for (const o of r.rows) {
    const lista = salida[o.tipo] ?? [];
    lista.push({
      id: o.id,
      codigo: o.codigo,
      etiqueta: o.etiqueta,
      horas: o.horas === null ? null : Number(o.horas),
      orden: o.orden,
      de_la_plataforma: o.de_la_plataforma,
    });
    salida[o.tipo] = lista;
  }
  return salida;
}

/**
 * Agrega o cambia una opción de la clínica.
 *
 * Si la clínica todavía no tiene lista propia de ese tipo, se COPIAN las
 * de la plataforma antes de agregar la nueva. Sin eso, agregar «mucosas
 * grisáceas» haría desaparecer las cinco de la plataforma —porque la
 * lectura da prioridad a la lista propia— y la clínica se quedaría con
 * una sola opción sin entender por qué.
 */
export async function guardarOpcion(
  db: PoolClient,
  tenantId: string,
  tipo: TipoCatalogo,
  datos: { codigo: string; etiqueta: string; horas?: number | null; orden?: number }
): Promise<{ id: string; copiadas: number }> {
  const tienePropias = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM exp_catalogos_clinicos
      WHERE tipo = $1 AND tenant_id = $2`,
    [tipo, tenantId]
  );
  let copiadas = 0;
  if (tienePropias.rows[0].n === "0") {
    const copia = await db.query(
      `INSERT INTO exp_catalogos_clinicos (tenant_id, tipo, codigo, etiqueta, horas, orden)
       SELECT $2, tipo, codigo, etiqueta, horas, orden
         FROM exp_catalogos_clinicos
        WHERE tipo = $1 AND tenant_id IS NULL AND activo
       ON CONFLICT DO NOTHING`,
      [tipo, tenantId]
    );
    copiadas = copia.rowCount ?? 0;
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_catalogos_clinicos (tenant_id, tipo, codigo, etiqueta, horas, orden)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, 500))
     ON CONFLICT (tenant_id, tipo, codigo) WHERE tenant_id IS NOT NULL
       DO UPDATE SET etiqueta = EXCLUDED.etiqueta, horas = EXCLUDED.horas,
                     orden = EXCLUDED.orden, activo = true
     RETURNING id`,
    [tenantId, tipo, datos.codigo, datos.etiqueta, datos.horas ?? null, datos.orden ?? null]
  );
  return { id: r.rows[0].id, copiadas };
}

/**
 * Desactiva una opción de la clínica.
 *
 * No la borra: una opción usada en una atención firmada tiene que seguir
 * resolviéndose. Desactivada deja de ofrecerse y sigue existiendo para
 * lo ya escrito.
 */
export async function desactivarOpcion(
  db: PoolClient,
  tenantId: string,
  id: string
): Promise<void> {
  const r = await db.query(
    `UPDATE exp_catalogos_clinicos SET activo = false
      WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  if (r.rowCount === 0) {
    throw new Error(
      "Esa opción es de la plataforma: no se desactiva, se reemplaza creando la lista propia de la clínica."
    );
  }
}

// ---------------------------------------------------------------------
// LOS PARÁMETROS CLÍNICOS
// ---------------------------------------------------------------------

export interface ParametrosClinicos {
  escalaCondicionMax: 5 | 9;
  llenadoCapilarMax: number;
}

const POR_DEFECTO: ParametrosClinicos = { escalaCondicionMax: 9, llenadoCapilarMax: 2 };

export async function parametrosClinicos(
  db: EjecutorSql,
  tenantId: string
): Promise<ParametrosClinicos> {
  const r = await db.query<{ escala_condicion_max: number; llenado_capilar_max: string }>(
    `SELECT escala_condicion_max, llenado_capilar_max
       FROM exp_parametros_clinicos WHERE tenant_id = $1`,
    [tenantId]
  );
  if (r.rows.length === 0) return POR_DEFECTO;
  return {
    escalaCondicionMax: r.rows[0].escala_condicion_max === 5 ? 5 : 9,
    llenadoCapilarMax: Number(r.rows[0].llenado_capilar_max),
  };
}

export async function guardarParametrosClinicos(
  db: PoolClient,
  tenantId: string,
  p: Partial<ParametrosClinicos>
): Promise<ParametrosClinicos> {
  const actual = await parametrosClinicos(db, tenantId);
  const nueva = { ...actual, ...p };
  if (nueva.escalaCondicionMax !== 5 && nueva.escalaCondicionMax !== 9) {
    throw new Error("La escala de condición corporal es de 1 a 5 o de 1 a 9.");
  }
  await db.query(
    `INSERT INTO exp_parametros_clinicos (tenant_id, escala_condicion_max, llenado_capilar_max)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id) DO UPDATE
       SET escala_condicion_max = EXCLUDED.escala_condicion_max,
           llenado_capilar_max = EXCLUDED.llenado_capilar_max,
           actualizado_en = now()`,
    [tenantId, nueva.escalaCondicionMax, nueva.llenadoCapilarMax]
  );
  return nueva;
}
