-- ---------------------------------------------------------------------
-- 173 — QUÉ PRODUCTO SE APLICÓ, NO SOLO CÓMO SE LLAMABA
--
-- `cuidados_preventivos` guarda el nombre en texto: `vacuna` o
-- `producto_desparasitacion`. Alcanza para mostrarlo en la ficha y no
-- alcanza para nada más: «Polivalente», «polivalente», «Vacuna
-- polivalente canina» y «Nobivac DHPPi» son cuatro filas distintas para
-- cualquier reporte, aunque sean el mismo frasco.
--
-- Con el `producto_id`:
--   · el historial del paciente agrupa por producto de verdad;
--   · los reportes pueden contar cuántas dosis de CADA vacuna se
--     aplicaron, que es lo que se le pregunta al inventario;
--   · el protocolo de la próxima dosis se busca por producto —que es el
--     específico— y no por nombre tecleado.
--
-- ES OPCIONAL A PROPÓSITO. Un histórico de otra clínica puede ser un
-- producto que esta clínica no vende, y la cartilla dice un nombre y
-- nada más. Ese caso se guarda igual, con el nombre, y se muestra como
-- **fuera del catálogo**: `producto_id IS NULL` es la marca, derivada,
-- sin una columna que pueda contradecirla.
--
-- NO TOCA NADA DE LO EXISTENTE: las 16 filas de hoy quedan con
-- `producto_id` en NULL, que es exactamente lo que son —nombres
-- tecleados— y así se van a mostrar.
-- ---------------------------------------------------------------------

ALTER TABLE cuidados_preventivos
  ADD COLUMN IF NOT EXISTS producto_id UUID REFERENCES inv_productos(id) ON DELETE SET NULL;

COMMENT ON COLUMN cuidados_preventivos.producto_id IS
  'El producto del catálogo que se aplicó, cuando lo hay. NULL = fuera del catálogo: un nombre tecleado, típico de un histórico de otra clínica.';

CREATE INDEX IF NOT EXISTS cuidados_preventivos_producto_idx
  ON cuidados_preventivos (tenant_id, producto_id)
  WHERE producto_id IS NOT NULL;
