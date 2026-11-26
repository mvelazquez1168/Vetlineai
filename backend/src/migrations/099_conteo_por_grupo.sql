-- ---------------------------------------------------------------------
-- 099 — El conteo POR GRUPO, dicho por su nombre
--
-- La toma física tenía dos tipos: 'total' y 'ciclico'. El cíclico es el
-- conteo por clasificación ABC, y está deshabilitado a propósito porque
-- la clasificación se calcula con la rotación y eso llega con los
-- dashboards.
--
-- Lo que la clínica necesita entre esos dos es contar UN GRUPO: "hoy
-- contamos farmacia", "contamos los controlados". Se podría haber
-- guardado como 'ciclico' con una lista de productos —el motor ya lo
-- soporta— pero entonces el tipo diría "cíclico" y sería un conteo por
-- línea de negocio: la columna mentiría, y la pantalla de conteos
-- mostraría "cíclico" en algo que nadie pidió por clasificación.
--
-- Así que el tipo se extiende y se guarda EL CRITERIO del grupo, que es
-- el dato que hace falta para releer el conteo seis meses después.
-- ---------------------------------------------------------------------

ALTER TABLE inv_conteos DROP CONSTRAINT IF EXISTS inv_conteos_tipo_check;
ALTER TABLE inv_conteos
  ADD CONSTRAINT inv_conteos_tipo_check CHECK (tipo IN ('total', 'ciclico', 'grupo'));

ALTER TABLE inv_conteos
  ADD COLUMN IF NOT EXISTS grupo_criterio VARCHAR(20),
  ADD COLUMN IF NOT EXISTS grupo_valor VARCHAR(60);

COMMENT ON COLUMN inv_conteos.grupo_criterio IS
  'Por qué se agrupó: linea_negocio, categoria o controlados. NULL en el total y en el cíclico.';
COMMENT ON COLUMN inv_conteos.grupo_valor IS
  'El valor del criterio (p. ej. la línea "farmacia"). NULL cuando el criterio no lo necesita.';

-- Un conteo por grupo sin criterio no se puede releer: sería un conteo
-- parcial del que nadie sabe qué abarcaba.
ALTER TABLE inv_conteos DROP CONSTRAINT IF EXISTS inv_conteos_grupo_con_criterio;
ALTER TABLE inv_conteos
  ADD CONSTRAINT inv_conteos_grupo_con_criterio
  CHECK (tipo <> 'grupo' OR grupo_criterio IS NOT NULL);
