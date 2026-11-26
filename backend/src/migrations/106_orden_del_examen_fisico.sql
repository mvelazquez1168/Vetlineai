-- ---------------------------------------------------------------------
-- 106 — El examen físico se lee en el orden en que se examina
--
-- DEFECTO visto en el navegador, no en el verificador: la lista de
-- sistemas aparecía en un orden distinto en cada carga. La consulta
-- ordenaba por `creado_en`, y la plantilla inserta los doce sistemas en
-- la misma transacción, así que los doce tienen el MISMO timestamp:
-- Postgres los devuelve en el orden que le conviene, que cambia.
--
-- Para quien tilda doce casillas con el paciente delante, que la lista
-- se reordene entre dos cargas no es un detalle estético: se pierde el
-- lugar y se vuelve a empezar.
--
-- La plantilla ya sabe el orden —su columna `sistemas` es un array
-- ordenado, de lo general a lo particular—. Lo que faltaba era
-- guardarlo.
-- ---------------------------------------------------------------------

ALTER TABLE exp_examen_sistemas
  ADD COLUMN IF NOT EXISTS orden SMALLINT;

COMMENT ON COLUMN exp_examen_sistemas.orden IS
  'La posición del sistema en la plantilla que lo sembró. NULL para un sistema agregado a mano, que se lee al final. Existe porque ordenar por creado_en no sirve: la plantilla inserta todo en la misma transacción.';
