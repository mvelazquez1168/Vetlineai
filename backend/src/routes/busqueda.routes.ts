import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Búsqueda global — lo que alimenta la paleta de comandos (Ctrl/Cmd+K).
//
// Tolerante a errores de tipeo y a acentos: la base está en la migración
// 090 (pg_trgm + unaccent + el envoltorio inmutable que permite
// indexarlo). Acá va la consulta.
//
// RESPETA TENANT Y PERMISOS COMO CUALQUIER OTRA RUTA: pasa por
// `withTenantClient`, así que corre sobre `tenantPool` con
// `app.tenant_id` puesto y RLS aplicada. Una clínica no puede ver
// resultados de otra ni forzando el parámetro, porque el filtro no es un
// WHERE que se pueda omitir: es la política de la tabla.
//
// Las PANTALLAS no se buscan acá. Son un catálogo fijo del frontend, no
// dependen del tenant y no tiene sentido pagar un viaje de red para
// filtrar diez strings — ver `frontend/src/lib/comandos.ts`.
// ---------------------------------------------------------------------
export const busquedaRouter = Router();

busquedaRouter.use(authenticate, withTenantClient);

busquedaRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

// Umbral calibrado contra casos reales (ver la migración 090): la
// ventana entre el peor positivo (Toby/Tobi = 0.429) y el mejor negativo
// (Lucas/Luna = 0.222) es donde tiene que caer. Se fija por transacción
// en vez de confiar en el default del servidor, que nadie versiona.
const UMBRAL_SIMILITUD = 0.3;

// 6 de cada tipo. La paleta muestra resultados mientras alguien tipea:
// más de eso no entra en pantalla sin scroll, y quien busca algo que no
// está en los primeros 6 necesita escribir más, no ver más.
const LIMITE_POR_TIPO = 6;

// Menos de 2 caracteres no se busca POR TEXTO: con una letra sola, la
// similitud de trigramas devuelve casi cualquier cosa y el viaje a la
// base no aporta.
//
// PERO un dígito solo SÍ se busca. Lo encontró la verificación: con el
// mínimo en 2 a secas, los expedientes del 1 al 9 eran inalcanzables
// desde la paleta — y toda clínica que recién arranca tiene exactamente
// esos. Una consulta numérica no pasa por similitud en ningún caso (va
// por igualdad exacta y por prefijo), así que no tiene el problema que
// el mínimo venía a evitar.
const MINIMO_CARACTERES_TEXTO = 2;
const SOLO_DIGITOS = /^\d+$/;

function buscaDemasiadoCorto(q: string): boolean {
  if (SOLO_DIGITOS.test(q)) return q.length < 1;
  return q.length < MINIMO_CARACTERES_TEXTO;
}

busquedaRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (q.length === 0 || buscaDemasiadoCorto(q)) {
    return res.json({ pacientes: [], propietarios: [], consulta: q });
  }

  try {
    // Local a la transacción (tercer argumento en true), igual que
    // `app.tenant_id`: al terminar se va con ella y la conexión vuelve
    // al pool sin un umbral pegado de otra request.
    await req.db!.query("SELECT set_config('pg_trgm.similarity_threshold', $1, true)", [
      String(UMBRAL_SIMILITUD),
    ]);

    // El `%` es el operador de trigramas y es el que usa el índice GIN;
    // la expresión es IDÉNTICA a la indexada. `similarity()` aparte solo
    // para ordenar: si se usara en el WHERE en vez del `%`, el índice no
    // entraría y esto haría un recorrido completo sin fallar.
    //
    // El número de expediente y el microchip van por prefijo, no por
    // similitud: en una cadena de dígitos un trigrama parecido no
    // significa "lo mismo mal tipeado".
    const pacientes = await req.db!.query(
      `SELECT p.id, p.nombre, p.numero_expediente, p.especie, p.microchip, p.estado,
              r.nombre AS raza,
              prop.nombre AS propietario_nombre,
              GREATEST(
                similarity(inmutable_unaccent(lower(p.nombre)), inmutable_unaccent(lower($1))),
                CASE WHEN p.numero_expediente::text = $1 THEN 1.0 ELSE 0 END,
                -- EL NÚMERO VIEJO LLEVA AL EXPEDIENTE VIVO (anexo 07-03,
                -- B1). La clínica lo tiene anotado en el carnet de
                -- vacunas y en el papel del laboratorio; después de
                -- unificar tiene que seguir encontrando algo, y ese algo
                -- es el expediente que sobrevivió.
                CASE WHEN $1 = ANY(p.numero_expediente_alias) THEN 1.0 ELSE 0 END,
                CASE WHEN lower(p.microchip) LIKE lower($1) || '%' THEN 0.9 ELSE 0 END
              ) AS puntaje
       FROM pacientes p
       JOIN propietarios prop ON prop.id = p.propietario_id
       LEFT JOIN razas r ON r.id = p.raza_id
       WHERE p.unificado_hacia_id IS NULL
         AND (inmutable_unaccent(lower(p.nombre)) % inmutable_unaccent(lower($1))
          OR p.numero_expediente::text = $1
          OR $1 = ANY(p.numero_expediente_alias)
          OR lower(p.microchip) LIKE lower($1) || '%')
       ORDER BY puntaje DESC, p.nombre ASC
       LIMIT ${LIMITE_POR_TIPO}`,
      [q]
    );

    const propietarios = await req.db!.query(
      `SELECT pr.id, pr.nombre, pr.telefono, pr.email, pr.numero_identificacion,
              ti.etiqueta AS tipo_identificacion_etiqueta,
              (SELECT count(*) FROM pacientes pa WHERE pa.propietario_id = pr.id)::int AS cantidad_pacientes,
              GREATEST(
                similarity(inmutable_unaccent(lower(pr.nombre)), inmutable_unaccent(lower($1))),
                CASE WHEN pr.telefono LIKE $1 || '%' THEN 0.9 ELSE 0 END,
                CASE WHEN pr.numero_identificacion LIKE $1 || '%' THEN 0.9 ELSE 0 END
              ) AS puntaje
       FROM propietarios pr
       LEFT JOIN tipos_identificacion ti ON ti.id = pr.tipo_identificacion_id
       WHERE pr.unificado_hacia_id IS NULL
         AND (inmutable_unaccent(lower(pr.nombre)) % inmutable_unaccent(lower($1))
          OR pr.telefono LIKE $1 || '%'
          OR pr.numero_identificacion LIKE $1 || '%')
       ORDER BY puntaje DESC, pr.nombre ASC
       LIMIT ${LIMITE_POR_TIPO}`,
      [q]
    );

    res.json({
      pacientes: pacientes.rows,
      propietarios: propietarios.rows,
      consulta: q,
    });
  } catch (err) {
    console.error("GET /busqueda", err);
    res.status(500).json({ error: "Error al buscar." });
  }
});
