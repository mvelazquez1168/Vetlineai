-- ---------------------------------------------------------------------
-- 124 — QUE DOS SESIONES NO SE PISEN LA ATENCIÓN (anexo 07-03, A4)
--
-- Hoy el autoguardado manda solo los campos que cambiaron, así que dos
-- médicos editando campos DISTINTOS de la misma atención convergen
-- bien. Editando el MISMO campo, gana el último `UPDATE` y el otro
-- navegador sigue mostrando su versión vieja hasta que alguien
-- recargue. Nadie se entera de nada.
--
-- `actualizado_en` no sirve para detectarlo: se escribe pero nunca se
-- lee para comparar, y una marca de tiempo tiene la resolución y los
-- relojes que tenga. Un contador entero no tiene ninguna de esas dudas.
-- ---------------------------------------------------------------------

ALTER TABLE atenciones ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN atenciones.version IS
  'Sube con cada guardado. El cliente manda la que tenía: si no coincide, otra sesión escribió en el medio y el guardado se rechaza con 409 en vez de pisar (anexo 07-03, A4).';
