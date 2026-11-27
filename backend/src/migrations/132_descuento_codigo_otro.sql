-- ---------------------------------------------------------------------
-- 132 — `CodigoDescuentoOTRO` ES OTRO CAMPO, NO LA NATURALEZA
--
-- Al cablear el catálogo de motivos (prompt 08b, A3) estuve a punto de
-- guardar el texto de «otros descuentos» en `vta_cargos.descuento_naturaleza`.
-- No son lo mismo, y el XSD oficial lo dice: `DescuentoType` tiene
--
--   MontoDescuento · CodigoDescuento · CodigoDescuentoOTRO · NaturalezaDescuento
--
-- cuatro elementos distintos, los dos últimos opcionales. Y
-- `fact_linea_descuentos` ya tenía las tres columnas separadas
-- (`codigo_descuento`, `codigo_descuento_otro`, `naturaleza`): el que
-- estaba corto era `vta_cargos`, que es de donde salen las líneas al
-- facturar una cuenta de caja.
--
-- El efecto de haberlo mezclado: el comprobante habría salido con
-- «Cortesía de la clínica» en NaturalezaDescuento y sin
-- CodigoDescuentoOTRO, que es el campo que explica un código 99.
-- ---------------------------------------------------------------------
ALTER TABLE vta_cargos
  ADD COLUMN IF NOT EXISTS descuento_codigo_otro VARCHAR(100);

COMMENT ON COLUMN vta_cargos.descuento_codigo_otro IS
  'El texto que acompaña al código 99 «otros descuentos» en el comprobante (CodigoDescuentoOTRO del XSD v4.4). Distinto de descuento_naturaleza.';
COMMENT ON COLUMN vta_cargos.descuento_naturaleza IS
  'NaturalezaDescuento del XSD v4.4: en qué consiste el descuento, en palabras. Distinto de descuento_codigo_otro.';
