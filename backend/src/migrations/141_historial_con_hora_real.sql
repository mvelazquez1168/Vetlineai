-- ---------------------------------------------------------------------
-- 141 — EL HISTORIAL DE POLÍTICAS NECESITA LA HORA REAL, NO LA DE LA
--       TRANSACCIÓN (prompt 04, §4)
--
-- Defecto encontrado por el verificador del 04: dos cambios de política
-- guardados en la misma transacción quedaban con el MISMO
-- `cambiado_en`, porque `now()` en Postgres devuelve la hora de inicio
-- de la transacción y no la del momento. Resultado: «¿cuál fue el
-- último cambio?» no tenía respuesta, y la pantalla mostraba cualquiera
-- de los dos.
--
-- `clock_timestamp()` devuelve la hora real de cada llamada. Es lo que
-- hace falta en un historial donde el orden ES la información.
--
-- No se toca el resto del sistema: en una tabla de hechos de negocio
-- —un cobro, una atención— que todas las filas de una transacción
-- compartan la hora es correcto y hasta deseable. Acá no.
-- ---------------------------------------------------------------------
ALTER TABLE politicas_historial
  ALTER COLUMN cambiado_en SET DEFAULT clock_timestamp();

COMMENT ON COLUMN politicas_historial.cambiado_en IS
  'clock_timestamp() y no now(): dos cambios en la misma transacción tienen que poder ordenarse (prompt 04).';
