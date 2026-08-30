-- La síntesis se completa en dos fases.
--
-- Genera las dos vistas y tarda ~220 s. Con 70 dashboards y 0 informes en
-- el uso real, hacer esperar todo eso a quien solo va a mirar la pantalla
-- es el peor reparto posible: se le agrega trabajo a la llamada que sí se
-- usa para tener listo lo que casi nadie pide.
--
-- Se parte en dos llamadas encadenadas sobre la MISMA síntesis. El núcleo
-- —lo que el dashboard muestra— se genera y se muestra; el complemento
-- —lo que solo el informe usa— se completa después, recibiendo el núcleo
-- ya hecho y sin volver a razonar.
--
-- Sigue habiendo UNA fuente: por eso las dos vistas no pueden
-- contradecirse, que es lo que importaba más que el ahorro.

ALTER TABLE casos
  ADD COLUMN IF NOT EXISTS sintesis_estado text;

ALTER TABLE casos
  DROP CONSTRAINT IF EXISTS casos_sintesis_estado_check;
ALTER TABLE casos
  ADD CONSTRAINT casos_sintesis_estado_check
  CHECK (sintesis_estado IS NULL OR sintesis_estado IN ('nucleo', 'completa'));

-- Las síntesis que ya existían se generaron enteras, antes de la partición.
UPDATE casos SET sintesis_estado = 'completa'
 WHERE sintesis IS NOT NULL AND sintesis_estado IS NULL;

-- El estado va con la síntesis: las cuatro columnas van juntas o ninguna.
-- Una síntesis sin estado no se sabe si el informe puede usarla.
ALTER TABLE casos
  DROP CONSTRAINT IF EXISTS casos_sintesis_completa_check;
ALTER TABLE casos
  ADD CONSTRAINT casos_sintesis_completa_check
  CHECK (
    (sintesis IS NULL     AND sintesis_huella IS NULL     AND sintesis_generada_en IS NULL     AND sintesis_estado IS NULL)
    OR
    (sintesis IS NOT NULL AND sintesis_huella IS NOT NULL AND sintesis_generada_en IS NOT NULL AND sintesis_estado IS NOT NULL)
  );


COMMENT ON COLUMN casos.sintesis_estado IS
  '''nucleo'' = solo lo que el dashboard necesita, el informe todavía no puede usarla. ''completa'' = las dos vistas.';
