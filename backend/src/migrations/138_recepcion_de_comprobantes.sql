-- ---------------------------------------------------------------------
-- 138 — LA RECEPCIÓN DE COMPROBANTES DE PROVEEDORES (prompt 09b, B2)
--
-- `fact_recibidos` ya existía con la carga del XML, la validación contra
-- el XSD, la detección de duplicados por clave y el mensaje receptor con
-- sus tres estados. Lo que falta es lo que convierte una bandeja en un
-- proceso:
--
--   1. QUÉ DIJO HACIENDA del comprobante, y si el receptor somos
--      nosotros. El relevamiento encontró que `recibirComprobante` NO
--      comprueba el receptor: un XML de una factura entre dos terceros
--      se cargaba igual en la bandeja de la clínica, y el mensaje
--      receptor se habría emitido por un comprobante que no es nuestro.
--   2. SI LA FIRMA ES VÁLIDA. `verificarFirma` existe desde el
--      facturador y no se llamaba: un XML modificado a mano pasaba la
--      validación de estructura sin problema.
--   3. EL PLAZO para responder, que es lo que la bandeja tiene que
--      avisar antes de que venza.
--   4. QUE YA SE REGISTRÓ EN INVENTARIO, para no cargar la misma compra
--      dos veces.
-- ---------------------------------------------------------------------
ALTER TABLE fact_recibidos
  /* La identificación del receptor que venía EN el XML, y si coincide
     con la del emisor de esta clínica. Se guardan las dos cosas: el
     dato y el veredicto, porque el dato permite explicar el veredicto. */
  ADD COLUMN IF NOT EXISTS receptor_identificacion VARCHAR(20),
  ADD COLUMN IF NOT EXISTS receptor_es_la_clinica BOOLEAN,
  /* Si la firma digital del XML verifica. NULL = no se pudo comprobar
     (un XML sin firma, por ejemplo), que es distinto de `false`. */
  ADD COLUMN IF NOT EXISTS firma_valida BOOLEAN,
  ADD COLUMN IF NOT EXISTS firma_detalle TEXT,
  /* Hasta cuándo se puede responder. Se calcula al recibir, con la
     fecha de emisión del comprobante. */
  ADD COLUMN IF NOT EXISTS responder_hasta DATE,
  /* La compra de inventario que se creó desde este comprobante. Un
     comprobante no se registra dos veces: lo impone el índice de abajo. */
  ADD COLUMN IF NOT EXISTS compra_id UUID,
  ADD COLUMN IF NOT EXISTS registrado_en_inventario TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registrado_por UUID REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_recibidos_una_compra
  ON fact_recibidos (compra_id) WHERE compra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fact_recibidos_pendientes
  ON fact_recibidos (tenant_id, responder_hasta)
  WHERE mensaje_tipo IS NULL;

COMMENT ON COLUMN fact_recibidos.receptor_es_la_clinica IS
  'Si el receptor del XML es el emisor de esta clínica. Se comprueba al recibir: un comprobante entre terceros no se responde (prompt 09b, B2).';
COMMENT ON COLUMN fact_recibidos.firma_valida IS
  'Si la firma digital verifica. NULL = no se pudo comprobar, que no es lo mismo que inválida.';
COMMENT ON COLUMN fact_recibidos.responder_hasta IS
  'Hasta cuándo se puede emitir el mensaje receptor, con el plazo configurado por la clínica.';

-- ---------------------------------------------------------------------
-- EL PLAZO ES UN PARÁMETRO Y NO UNA CONSTANTE.
--
-- El plazo oficial para el mensaje receptor es de ocho días hábiles
-- desde la emisión, según la resolución de Hacienda. **No lo doy por
-- confirmado desde el XSD**, que no habla de plazos: el XSD define la
-- estructura y no el procedimiento. Por eso es configurable, nace en 8
-- y el informe anota que hay que confirmarlo contra la resolución
-- vigente antes de prometerle a una clínica que el aviso llega a
-- tiempo.
--
-- Y SE CUENTA EN DÍAS CORRIDOS, no hábiles: contar hábiles necesita el
-- calendario de feriados de Costa Rica, que no tenemos. Avisar antes es
-- del lado seguro; avisar después no sirve de nada.
-- ---------------------------------------------------------------------
ALTER TABLE fact_emisores
  ADD COLUMN IF NOT EXISTS dias_para_responder_recibidos SMALLINT NOT NULL DEFAULT 8
    CHECK (dias_para_responder_recibidos > 0);

COMMENT ON COLUMN fact_emisores.dias_para_responder_recibidos IS
  'Días para emitir el mensaje receptor. Nace en 8 (plazo oficial, a confirmar contra la resolución vigente) y se cuenta en días corridos porque no tenemos el calendario de feriados.';

-- ---------------------------------------------------------------------
-- LA EQUIVALENCIA PROVEEDOR → PRODUCTO, CON EL CÓDIGO DEL PROVEEDOR.
--
-- `inv_proveedor_productos` ya ligaba proveedor, producto y presentación
-- de compra, pero sin el CÓDIGO que el proveedor usa en su factura, que
-- es justamente la llave para reconocer la línea la próxima vez. Sin
-- eso, cada compra se vincula a mano otra vez.
-- ---------------------------------------------------------------------
ALTER TABLE inv_proveedor_productos
  ADD COLUMN IF NOT EXISTS codigo_proveedor VARCHAR(60),
  /* La descripción tal como viene en la factura del proveedor: cuando
     no manda código, el texto es lo único que hay para reconocerla. */
  ADD COLUMN IF NOT EXISTS descripcion_proveedor VARCHAR(300);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_proveedor_productos_codigo
  ON inv_proveedor_productos (tenant_id, proveedor_id, codigo_proveedor)
  WHERE codigo_proveedor IS NOT NULL;

COMMENT ON COLUMN inv_proveedor_productos.codigo_proveedor IS
  'El código con el que el proveedor factura este producto. Es la llave para reconocer la línea en la próxima compra (prompt 09b, B2).';
