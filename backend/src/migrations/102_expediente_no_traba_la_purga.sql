-- ---------------------------------------------------------------------
-- 102 — Los triggers del expediente no pueden trabar la purga
--
-- DEFECTO REAL, encontrado por `verificar_expediente_bloque_a` en su
-- última sección: los triggers de inmutabilidad que la migración 101
-- puso sobre `exp_consentimientos` y `exp_adendas` se disparan TAMBIÉN
-- cuando la purga borra una clínica, porque un `DELETE FROM tenants`
-- llega a esas tablas por la cascada de la FK.
--
-- Resultado: borrar una clínica fallaba con
-- "Un consentimiento firmado no se borra", y la purga quedaba trabada.
-- Es exactamente la familia del defecto D-006, y se arregla igual: con
-- `fact_es_operacion_directa()`, la función que ya distingue una
-- operación normal de la cascada de la purga y que usan los triggers
-- del facturador, de inventario y de caja.
--
-- LA REGLA NO SE DEBILITA: un consentimiento firmado y una adenda
-- siguen sin poder editarse ni borrarse desde la aplicación. Lo único
-- que pasa es que la purga de una clínica entera —que borra TODO,
-- incluidos los pacientes de los que esos documentos cuelgan— deja de
-- chocar contra una regla pensada para proteger una fila, no para
-- impedir que la clínica se vaya.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION exp_consentimiento_inmutable() RETURNS trigger AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un consentimiento firmado no se borra: es el documento que respalda el procedimiento. Si está mal, se firma otro.';
  END IF;
  IF NEW.texto <> OLD.texto OR NEW.firma_png <> OLD.firma_png
     OR NEW.firmante_nombre <> OLD.firmante_nombre OR NEW.firmado_en <> OLD.firmado_en THEN
    RAISE EXCEPTION 'Un consentimiento firmado no se modifica. Solo se le puede adjuntar el PDF generado.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION exp_adenda_solo_agregar() RETURNS trigger AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Una adenda no se modifica ni se borra. Si hace falta corregirla, se agrega otra.';
END;
$$ LANGUAGE plpgsql;
