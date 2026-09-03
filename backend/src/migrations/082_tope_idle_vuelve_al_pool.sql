-- Revierte el ALTER DATABASE de la migración 081.
--
-- El tope sigue existiendo: se mudó a la configuración de los dos pools
-- (`backend/src/db.ts`), que es donde puede estar versionado en código.
-- Ponerlo con una migración lo dejaba dependiendo de que alguien la
-- hubiera corrido contra ese servidor en particular: una base nueva, una
-- réplica o un entorno recién levantado quedaban sin red hasta que la
-- migración pasara. En el pool vale desde el primer arranque, siempre.
--
-- Es el mismo criterio que usa Converza (packages/db/src/acceso.ts).
--
-- SALVEDAD, para que quede dicha: al sacarlo de la base, las conexiones
-- que NO salen de estos dos pools —una sesión de psql, el runner de
-- migraciones, un script suelto— dejan de tener tope. Es aceptable porque
-- son sesiones humanas y puntuales, no tráfico; si alguna vez conviene un
-- piso para todas, se vuelve a poner acá SIN sacarlo del pool.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I RESET idle_in_transaction_session_timeout',
    current_database()
  );
END
$$;
