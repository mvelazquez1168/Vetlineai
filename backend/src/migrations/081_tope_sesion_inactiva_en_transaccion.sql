-- Red de seguridad contra sesiones "idle in transaction" de larga
-- duración — la alerta alta que reportó AWS en producción.
--
-- Una sesión en ese estado retiene los bloqueos que tomó y, sobre todo,
-- congela el horizonte de vacuum: mientras exista, Postgres no puede
-- limpiar las versiones muertas de NINGUNA tabla, y las tablas calientes
-- (mensajes, uso_api) se inflan sin que nada falle a la vista. Por eso
-- degrada en silencio.
--
-- ESTO NO ES EL ARREGLO. El arreglo es que ningún camino sostenga una
-- transacción mientras espera algo que no es la base — ver el análisis en
-- middleware/auth.ts (withTenantClient). Esto es lo que impide que un
-- defecto futuro vuelva a degradar la base sin aviso: corta la sesión,
-- libera los bloqueos y deja al vacuum avanzar.
--
-- SOBRE EL VALOR (10 min). Tiene que quedar POR ENCIMA del request
-- legítimo más largo, porque hoy la transacción sigue abierta durante toda
-- la llamada al modelo: si se pone por debajo, esta red de seguridad no
-- corta sesiones colgadas sino requests sanos. Referencias reales:
--
--   * la síntesis clínica en dos fases tarda ~220 s (ver 080);
--   * un mensaje trivial ya deja ~10 s de idle in transaction, medido;
--   * el cliente de Anthropic reintenta, así que el peor caso se multiplica.
--
-- 10 minutos deja margen sobre todo eso y sigue cortando lo que importa:
-- una sesión colgada por un upstream que nunca responde queda abierta
-- durante horas, no minutos.
--
-- CUANDO se corrija el fondo (que la transacción no abarque la llamada al
-- modelo), este valor puede y debe bajar a ~1 min.
--
-- Aplica a conexiones NUEVAS, no a las ya abiertas. En producción hay que
-- reciclar las conexiones (o reiniciar el backend) para que tome efecto.
-- ALTER DATABASE no acepta una expresión como nombre, de ahí el bloque
-- dinámico: así la migración sirve en cualquier base sin hardcodear cuál.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L',
    current_database(),
    '10min'
  );
END
$$;
