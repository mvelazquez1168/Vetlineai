-- Borradores de comprobante, observaciones, y el vínculo del receptor
-- con la ficha del cliente.
--
-- Tres cambios que vienen de la revisión de la pantalla "Emitir".

-- ---------------------------------------------------------------------
-- 1. OBSERVACIONES
--
-- Texto libre que viaja en el XML. El campo NO se inventa: el XSD v4.4
-- define `Otros/OtroTexto`, opcional, repetible, con un atributo
-- `codigo` opcional y un máximo de 500 caracteres (tipo
-- `restrictedString`). 500 es exactamente ese máximo, no un número
-- elegido.
-- ---------------------------------------------------------------------
ALTER TABLE fact_comprobantes
  ADD COLUMN observaciones VARCHAR(500);

COMMENT ON COLUMN fact_comprobantes.observaciones IS
  'Texto libre del emisor. Sale en el XML como Otros/OtroTexto (XSD v4.4, máx. 500) y en el PDF.';

-- ---------------------------------------------------------------------
-- 2. EL RECEPTOR APUNTA AL CLIENTE, PERO NO DEPENDE DE ÉL
--
-- `receptor_propietario_id` dice de qué ficha de cliente salieron los
-- datos. Las columnas `receptor_*` que ya existían siguen guardando la
-- COPIA de lo que se emitió, y eso es lo importante: si mañana alguien
-- corrige el nombre o la cédula en la ficha del cliente, la factura ya
-- emitida no cambia. Un comprobante dice lo que decía el día que
-- Hacienda lo aceptó.
--
-- Por eso el vínculo es ON DELETE SET NULL y no CASCADE: borrar un
-- cliente no puede llevarse una factura, y la factura se sigue
-- entendiendo sola porque tiene la copia.
--
-- No se crea una segunda tabla de clientes: `propietarios` ya es el
-- fichero de clientes de la clínica (guía rectora, sección 3).
-- ---------------------------------------------------------------------
ALTER TABLE fact_comprobantes
  ADD COLUMN receptor_propietario_id UUID
    REFERENCES propietarios(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_fact_comprobantes_receptor_propietario
  ON fact_comprobantes (receptor_propietario_id)
  WHERE receptor_propietario_id IS NOT NULL;

COMMENT ON COLUMN fact_comprobantes.receptor_propietario_id IS
  'De qué ficha de cliente salieron los datos. Las columnas receptor_* son la copia congelada de lo emitido y mandan ellas.';

-- ---------------------------------------------------------------------
-- 3. BORRADORES SIN CLAVE NI CONSECUTIVO
--
-- Hasta acá un comprobante nacía con su clave y su consecutivo ya
-- consumidos, incluso antes de firmarse. Con borradores que se pueden
-- guardar y eliminar eso dejaría HUECOS en la numeración: la Nota 3 de
-- Hacienda pide numeración consecutiva, y un borrador descartado se
-- habría llevado un número que nadie va a usar.
--
-- Así que el consecutivo y la clave se asignan AL EMITIR. Mientras el
-- comprobante es borrador, las dos columnas son NULL.
-- ---------------------------------------------------------------------
ALTER TABLE fact_comprobantes
  ALTER COLUMN clave DROP NOT NULL,
  ALTER COLUMN consecutivo DROP NOT NULL;

-- Los CHECK de formato pasan a admitir NULL. Sin esto, un borrador sin
-- clave violaría `clave ~ '^[0-9]{50}$'`.
ALTER TABLE fact_comprobantes
  DROP CONSTRAINT fact_comprobantes_clave_check,
  DROP CONSTRAINT fact_comprobantes_consecutivo_check;

ALTER TABLE fact_comprobantes
  ADD CONSTRAINT fact_comprobantes_clave_check
    CHECK (clave IS NULL OR clave ~ '^[0-9]{50}$'),
  ADD CONSTRAINT fact_comprobantes_consecutivo_check
    CHECK (consecutivo IS NULL OR consecutivo ~ '^[0-9]{20}$');

-- Pero NULL se admite SOLO en borrador. Cualquier otro estado significa
-- que el comprobante ya existe para Hacienda, y ahí los dos son
-- obligatorios. Esta es la restricción que impide que un bug deje un
-- comprobante enviado sin identidad.
ALTER TABLE fact_comprobantes
  ADD CONSTRAINT fact_comprobantes_identidad_si_no_es_borrador
    CHECK (estado = 'borrador' OR (clave IS NOT NULL AND consecutivo IS NOT NULL));

-- Las dos UNIQUE siguen valiendo: en Postgres, varios NULL no chocan
-- entre sí en un índice único, así que mil borradores conviven y, en
-- cuanto se les asigna la clave, la unicidad vuelve a aplicar. No hace
-- falta tocarlas.

-- ---------------------------------------------------------------------
-- 4. EL TRIGGER DE INMUTABILIDAD, AJUSTADO
--
-- `fact_impedir_cambio_comprobante_enviado` congelaba la clave y el
-- consecutivo en TODO estado. Con borradores eso rompería la emisión:
-- asignar la clave es justamente pasar de NULL a un valor.
--
-- La regla correcta es la misma que ya regía para `xml_firmado`:
-- de NULL a un valor SE PUEDE (es la primera asignación); de un valor a
-- otro, o a NULL, NO. Así la identidad sigue siendo inmutable desde el
-- momento en que existe, que es lo que la regla protegía.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fact_impedir_cambio_comprobante_enviado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  columna TEXT;
  editables_tras_envio TEXT[] := ARRAY[
    'estado', 'respuesta_xml', 'respuesta_ind_estado', 'respuesta_recibida_en',
    'respuesta_detalle', 'enviado_en', 'intentos_envio', 'proximo_intento_en'
  ];
  viejo JSONB := to_jsonb(OLD);
  nuevo JSONB := to_jsonb(NEW);
BEGIN
  IF OLD.xml_firmado IS NOT NULL AND NEW.xml_firmado IS DISTINCT FROM OLD.xml_firmado THEN
    RAISE EXCEPTION
      'El XML firmado del comprobante % (clave %) no se puede modificar: es el documento exacto que se le envió a Hacienda.',
      OLD.id, OLD.clave USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.respuesta_xml IS NOT NULL AND NEW.respuesta_xml IS DISTINCT FROM OLD.respuesta_xml THEN
    RAISE EXCEPTION
      'La respuesta de Hacienda del comprobante % (clave %) no se puede modificar: es la prueba de lo que Hacienda contestó.',
      OLD.id, OLD.clave USING ERRCODE = 'restrict_violation';
  END IF;

  -- La identidad es inmutable DESDE QUE EXISTE. De NULL a un valor se
  -- puede una sola vez —es lo que hace `emitirBorrador`—; de un valor a
  -- cualquier otra cosa, nunca.
  IF (OLD.clave IS NOT NULL AND NEW.clave IS DISTINCT FROM OLD.clave)
     OR (OLD.consecutivo IS NOT NULL AND NEW.consecutivo IS DISTINCT FROM OLD.consecutivo)
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.emisor_id IS DISTINCT FROM OLD.emisor_id THEN
    RAISE EXCEPTION
      'La clave, el consecutivo, el tenant y el emisor del comprobante % no se pueden modificar.',
      OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  -- Y nunca se vuelven a NULL: eso sería borrarle la identidad a un
  -- comprobante que ya la tenía.
  IF (OLD.clave IS NOT NULL AND NEW.clave IS NULL)
     OR (OLD.consecutivo IS NOT NULL AND NEW.consecutivo IS NULL) THEN
    RAISE EXCEPTION
      'No se le puede quitar la clave ni el consecutivo al comprobante %.',
      OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  IF fact_estado_ya_enviado(OLD.estado) THEN
    FOR columna IN SELECT jsonb_object_keys(viejo) LOOP
      IF columna <> ALL (editables_tras_envio)
         AND (nuevo -> columna) IS DISTINCT FROM (viejo -> columna) THEN
        RAISE EXCEPTION
          'No se puede modificar %.% del comprobante % (clave %): ya fue enviado a Hacienda (estado %). La corrección se hace con una nota, no editando el comprobante.',
          TG_TABLE_NAME, columna, OLD.id, OLD.clave, OLD.estado
          USING ERRCODE = 'restrict_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. LAS LÍNEAS DE UN BORRADOR SÍ SE EDITAN
--
-- Editar un borrador es, en la práctica, reemplazar sus líneas. Las
-- líneas cuelgan del comprobante con ON DELETE CASCADE, así que
-- borrarlas y volver a insertarlas alcanza — siempre que el comprobante
-- siga siendo borrador. Este trigger es el que lo garantiza: una vez
-- que el comprobante salió, sus líneas quedan congeladas con él.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fact_lineas_solo_en_borrador()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  estado_actual TEXT;
  comprobante UUID := COALESCE(NEW.comprobante_id, OLD.comprobante_id);
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT c.estado INTO estado_actual
    FROM fact_comprobantes c WHERE c.id = comprobante;

  -- La fila del comprobante ya no está (lo está borrando la cascada):
  -- no hay nada que proteger.
  IF estado_actual IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF fact_estado_ya_enviado(estado_actual) THEN
    RAISE EXCEPTION
      'No se pueden cambiar las líneas del comprobante %: ya fue enviado a Hacienda (estado %).',
      comprobante, estado_actual USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER fact_comprobante_lineas_solo_en_borrador
  BEFORE INSERT OR UPDATE OR DELETE ON fact_comprobante_lineas
  FOR EACH ROW EXECUTE FUNCTION fact_lineas_solo_en_borrador();
