-- ---------------------------------------------------------------------
-- 135 — EL DESCUENTO SE AUTORIZA AL COTIZAR, NO AL CONVERTIR
--       (prompt 08b, A1 y A3)
--
-- Defecto de diseño que encontré corriendo el verificador: al convertir
-- un presupuesto con descuento, la conversión volvía a pasar por el
-- control de descuentos y chocaba con «nadie autoriza su propio
-- descuento» —porque quien convierte es la misma persona que registra la
-- conversión—.
--
-- El control estaba en el lugar equivocado. El momento en que se decide
-- cobrar menos es cuando se COTIZA: ahí está el cliente discutiendo el
-- precio, ahí hay que pedir la autorización, y ahí se guarda. Al
-- convertir, el presupuesto aceptado ES el respaldo de ese descuento:
-- volver a pedir autorización sería pedirla dos veces por lo mismo.
--
-- Sin estas dos columnas, la autorización del descuento cotizado no
-- quedaba en ninguna parte y el cargo convertido no podía decir quién lo
-- había aprobado.
-- ---------------------------------------------------------------------
ALTER TABLE vta_presupuesto_lineas
  ADD COLUMN IF NOT EXISTS motivo_descuento_id UUID
    REFERENCES vta_motivos_descuento(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS descuento_codigo VARCHAR(2),
  ADD COLUMN IF NOT EXISTS descuento_codigo_otro VARCHAR(100),
  ADD COLUMN IF NOT EXISTS descuento_naturaleza VARCHAR(120),
  ADD COLUMN IF NOT EXISTS descuento_autorizado_por UUID
    REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN vta_presupuesto_lineas.descuento_autorizado_por IS
  'Quién autorizó el descuento AL COTIZAR. Al convertir no se vuelve a pedir: el presupuesto aceptado es el respaldo (prompt 08b, A1).';
