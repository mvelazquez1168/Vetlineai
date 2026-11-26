import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// PUNTO ÚNICO de la búsqueda tolerante de clientes (`propietarios`).
//
// Nació dentro de `busqueda.routes.ts` (la búsqueda global del
// encabezado). Sale a su propio módulo cuando la pantalla de emisión
// del facturador necesitó exactamente la misma búsqueda para elegir al
// receptor: copiar la consulta habría dejado dos lugares donde ajustar
// el umbral, los campos por los que se busca y el orden de los
// resultados, y nada fallaría el día que divergieran.
//
// Cómo funciona, y por qué así:
//
//   * El `%` es el operador de trigramas de pg_trgm y es el que usa el
//     índice GIN de la migración 090. La expresión del WHERE es
//     IDÉNTICA a la indexada; `similarity()` aparece aparte solo para
//     ordenar. Si se usara `similarity()` en el WHERE, el índice no
//     entraría y esto haría un recorrido completo de la tabla sin
//     fallar — que es la peor clase de defecto.
//
//   * El teléfono y el número de identificación van POR PREFIJO, no por
//     similitud. En una cadena de dígitos, un trigrama parecido no
//     significa "lo mismo mal tipeado": significa otro número.
// ---------------------------------------------------------------------

/**
 * Qué tan parecido tiene que ser para aparecer. 0.3 es el default de
 * pg_trgm; se fija explícitamente porque es una propiedad de la
 * búsqueda, no del servidor donde corra.
 */
const UMBRAL_SIMILITUD = 0.3;

export interface PropietarioEncontrado {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  numero_identificacion: string | null;
  tipo_identificacion_id: string | null;
  tipo_identificacion_etiqueta: string | null;
  /** El código del catálogo de la clínica. Para CR coincide con la Nota 4 de Hacienda. */
  tipo_identificacion_codigo: string | null;
  cantidad_pacientes: number;
  puntaje: number;
}

/**
 * Busca clientes por nombre (tolerante a errores de tipeo), teléfono o
 * número de identificación.
 *
 * `db` tiene que ser el cliente de una transacción con `app.tenant_id`
 * ya seteado: el umbral se fija como configuración LOCAL a esa
 * transacción (tercer argumento `true`), igual que `app.tenant_id`, así
 * la conexión vuelve al pool sin un umbral pegado de otra request.
 */
export async function buscarPropietariosTolerante(
  db: PoolClient,
  q: string,
  limite = 10
): Promise<PropietarioEncontrado[]> {
  const texto = q.trim();
  if (texto === "") return [];

  await db.query("SELECT set_config('pg_trgm.similarity_threshold', $1, true)", [
    String(UMBRAL_SIMILITUD),
  ]);

  const r = await db.query<PropietarioEncontrado>(
    `SELECT pr.id, pr.nombre, pr.telefono, pr.email, pr.numero_identificacion,
            pr.tipo_identificacion_id,
            ti.etiqueta AS tipo_identificacion_etiqueta,
            ti.codigo AS tipo_identificacion_codigo,
            (SELECT count(*) FROM pacientes pa WHERE pa.propietario_id = pr.id)::int
              AS cantidad_pacientes,
            GREATEST(
              similarity(inmutable_unaccent(lower(pr.nombre)), inmutable_unaccent(lower($1))),
              CASE WHEN pr.telefono LIKE $1 || '%' THEN 0.9 ELSE 0 END,
              CASE WHEN pr.numero_identificacion LIKE $1 || '%' THEN 0.9 ELSE 0 END
            ) AS puntaje
       FROM propietarios pr
       LEFT JOIN tipos_identificacion ti ON ti.id = pr.tipo_identificacion_id
      WHERE inmutable_unaccent(lower(pr.nombre)) % inmutable_unaccent(lower($1))
         OR pr.telefono LIKE $1 || '%'
         OR pr.numero_identificacion LIKE $1 || '%'
      ORDER BY puntaje DESC, pr.nombre ASC
      LIMIT $2`,
    [texto, limite]
  );
  return r.rows;
}
