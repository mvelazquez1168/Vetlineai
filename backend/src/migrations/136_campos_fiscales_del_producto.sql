-- ---------------------------------------------------------------------
-- 136 — LOS CAMPOS FISCALES DEL PRODUCTO (prompt 09b, B3)
--
-- Las LÍNEAS del comprobante ya los llevan desde el facturador
-- (`fact_comprobante_lineas`: `registro_medicamento`,
-- `forma_farmaceutica`, `codigo_comercial_tipo`, `codigo_comercial`). Lo
-- que falta es que el PRODUCTO los tenga, para que no haya que
-- escribirlos a mano en cada factura.
--
-- TODO LO DE ACÁ SALE DEL XSD OFICIAL v4.4 que vive en
-- `backend/esquemas/fe-cr/xml-schemas/v4.4/`, leído del archivo:
--
--   * `RegistroMedicamento` — texto, máximo 100. «Se refiere al
--     respectivo número de registro del Ministerio de Salud».
--   * `FormaFarmaceutica` — máximo 3. «Código de la presentación del
--     medicamento». EL XSD NO TRAE LA ENUMERACIÓN: el catálogo de
--     formas farmacéuticas está en el Anexo de Hacienda y no en el
--     esquema, así que la columna acepta el código de 3 y NO se siembra
--     una lista inventada. Queda anotado en el informe.
--   * `CodigoComercial` — es un `CodigoType` con dos partes, `Tipo` y
--     `Codigo`, y hasta CINCO por línea. El tipo tiene su enumeración:
--     01 código del vendedor, 02 del comprador, 03 de la industria,
--     04 de uso interno, 99 otros.
--   * `PartidaArancelaria` — 12 caracteres exactos, y **solo existe en
--     el comprobante de EXPORTACIÓN**: no está en el XSD de la factura
--     normal. Se guarda en el producto porque es un dato del producto,
--     y el comprobante lo usa únicamente cuando es de exportación.
-- ---------------------------------------------------------------------
ALTER TABLE inv_productos
  /* El número de registro del Ministerio de Salud. */
  ADD COLUMN IF NOT EXISTS registro_medicamento VARCHAR(100),
  /* El código de la forma farmacéutica: 3 caracteres del catálogo de
     Hacienda. La longitud la impone el XSD; el contenido, el Anexo. */
  ADD COLUMN IF NOT EXISTS forma_farmaceutica VARCHAR(3),
  /* El código comercial y de qué tipo es. Uno solo en el producto: el
     comprobante admite cinco, y los otros cuatro son casos que una
     veterinaria no tiene. */
  ADD COLUMN IF NOT EXISTS codigo_comercial VARCHAR(20),
  ADD COLUMN IF NOT EXISTS codigo_comercial_tipo VARCHAR(2),
  /* Doce caracteres EXACTOS, y solo se usa en exportación. */
  ADD COLUMN IF NOT EXISTS partida_arancelaria VARCHAR(12);

ALTER TABLE inv_productos
  DROP CONSTRAINT IF EXISTS inv_productos_codigo_comercial_tipo_check;
ALTER TABLE inv_productos
  ADD CONSTRAINT inv_productos_codigo_comercial_tipo_check
  CHECK (codigo_comercial_tipo IS NULL
         OR codigo_comercial_tipo IN ('01', '02', '03', '04', '99'));

-- EL TIPO Y EL CÓDIGO VAN JUNTOS. Un código comercial sin tipo no se
-- puede escribir en el XML (el nodo lleva los dos), y un tipo sin código
-- no dice nada.
ALTER TABLE inv_productos
  DROP CONSTRAINT IF EXISTS inv_productos_codigo_comercial_completo;
ALTER TABLE inv_productos
  ADD CONSTRAINT inv_productos_codigo_comercial_completo
  CHECK ((codigo_comercial IS NULL) = (codigo_comercial_tipo IS NULL));

-- DOCE CARACTERES, no «hasta doce»: el XSD pone minLength y maxLength
-- en 12, así que una partida de 10 dígitos hace que Hacienda rechace el
-- comprobante entero.
ALTER TABLE inv_productos
  DROP CONSTRAINT IF EXISTS inv_productos_partida_arancelaria_check;
ALTER TABLE inv_productos
  ADD CONSTRAINT inv_productos_partida_arancelaria_check
  CHECK (partida_arancelaria IS NULL OR length(partida_arancelaria) = 12);

COMMENT ON COLUMN inv_productos.registro_medicamento IS
  'Número de registro del Ministerio de Salud. Va en RegistroMedicamento de la línea del comprobante (XSD v4.4, máximo 100).';
COMMENT ON COLUMN inv_productos.forma_farmaceutica IS
  'Código de 3 de la forma farmacéutica. La longitud sale del XSD; el catálogo de valores está en el Anexo de Hacienda y NO en el esquema.';
COMMENT ON COLUMN inv_productos.partida_arancelaria IS
  'Doce caracteres exactos. Solo se usa en el comprobante de EXPORTACIÓN: no existe en el XSD de la factura normal.';
