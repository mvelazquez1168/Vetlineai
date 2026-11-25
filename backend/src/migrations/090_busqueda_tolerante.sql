-- =====================================================================
-- VetPlatform — Migración 090
-- vetline-clinic-01b-02, bloque C.5 — búsqueda tolerante a errores de
-- tipeo y a acentos, para la paleta de comandos (Ctrl/Cmd+K).
--
-- Qué tiene que resolver: que "Tobi" encuentre a "Toby" y que "Mendez"
-- encuentre a "Méndez". Lo primero es distancia de trigramas
-- (`pg_trgm`), lo segundo es normalización de diacríticos (`unaccent`).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------
-- EL ENVOLTORIO INMUTABLE, que es la parte no obvia.
--
-- `unaccent(text)` es STABLE, no IMMUTABLE, porque depende del
-- diccionario de búsqueda activo. Postgres NO deja usar una función
-- STABLE en la expresión de un índice (el índice quedaría inválido si el
-- diccionario cambiara), así que `CREATE INDEX ... (unaccent(nombre))`
-- falla con "functions in index expression must be marked IMMUTABLE".
--
-- La salida documentada es declarar el diccionario de forma explícita
-- (`'public.unaccent'::regdictionary`) y envolver eso en una función
-- propia marcada IMMUTABLE: al fijar el diccionario, el resultado deja
-- de depender de la configuración de la sesión.
--
-- `search_path` vacío a propósito: sin eso, la función resolvería
-- `unaccent` según el search_path de quien la llame, que es justamente
-- la dependencia que la hace no-inmutable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inmutable_unaccent(texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, texto) $$;

COMMENT ON FUNCTION inmutable_unaccent(text) IS
  'unaccent con el diccionario fijado, para poder usarlo en índices. Ver migración 090.';

-- ---------------------------------------------------------------------
-- Índices de la búsqueda.
--
-- GIN + gin_trgm_ops y no GiST: para búsqueda por similitud sobre texto
-- corto que se lee mucho más de lo que se escribe, GIN es más rápido en
-- la consulta, que es lo que importa acá (el objetivo es responder en
-- menos de un segundo mientras alguien tipea).
--
-- La expresión indexada es EXACTAMENTE la misma que usa la consulta
-- (`inmutable_unaccent(lower(...))`). Si difirieran en un `lower`, el
-- índice no se usaría y la búsqueda haría un recorrido completo sin que
-- nada falle — el tipo de problema que solo se descubre midiendo.
-- ---------------------------------------------------------------------

CREATE INDEX idx_pacientes_busqueda_nombre
  ON pacientes USING gin (inmutable_unaccent(lower(nombre)) gin_trgm_ops);

CREATE INDEX idx_propietarios_busqueda_nombre
  ON propietarios USING gin (inmutable_unaccent(lower(nombre)) gin_trgm_ops);

-- Microchip, teléfono e identificación NO van por similitud: son
-- cadenas de dígitos donde un trigrama parecido no significa nada
-- ("900123" y "900124" son dos animales distintos, no un typo). Se
-- buscan por prefijo, que es como la gente las tipea — los últimos
-- cuatro dígitos del teléfono, el principio del microchip. `text_pattern_ops`
-- es lo que hace que un `LIKE 'prefijo%'` use el índice.
CREATE INDEX idx_pacientes_busqueda_microchip
  ON pacientes (lower(microchip) text_pattern_ops)
  WHERE microchip IS NOT NULL;

CREATE INDEX idx_propietarios_busqueda_telefono
  ON propietarios (telefono text_pattern_ops)
  WHERE telefono IS NOT NULL;

CREATE INDEX idx_propietarios_busqueda_identificacion
  ON propietarios (numero_identificacion text_pattern_ops)
  WHERE numero_identificacion IS NOT NULL;

-- EL UMBRAL, medido y no supuesto. Se calibró contra casos reales antes
-- de fijarlo:
--
--   Méndez / Mendez          1.000   <- acentos: queda idéntico
--   Luna / Luna              1.000
--   Firulais / Firulai       0.700
--   Velásquez / Velazquez    0.538
--   Toby / Tobi              0.429   <- el peor POSITIVO
--   ---------------------------------
--   Lucas / Luna             0.222   <- el mejor NEGATIVO
--   Mariana / Ana            0.200
--   Rocky / Toby             0.000
--
-- La ventana que separa los dos grupos es 0.222 .. 0.429, así que 0.30
-- cae cómodo en el medio. Coincide con el default de pg_trgm, pero la
-- consulta lo fija explícitamente por transacción
-- (`set_config('pg_trgm.similarity_threshold', ...)`) en vez de confiar
-- en el default del servidor: así el comportamiento de la búsqueda no
-- depende de la configuración de la instancia, que nadie versiona.
-- Acá no se cambia nada global.
