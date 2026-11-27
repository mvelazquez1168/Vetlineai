-- ---------------------------------------------------------------------
-- 160 — EL CIERRE FIRMADO NO PUEDE TRABAR LA PURGA (defecto de la 158)
--
-- MISMO DEFECTO QUE LA 126, corregido por la 129, y van dos veces: un
-- trigger de «solo de agregar» escrito sin excepción también bloquea el
-- DELETE EN CASCADA. Cuando se borra una clínica —la purga de datos, o
-- una clínica de prueba— Postgres borra sus filas por la FK, el trigger
-- se dispara y la purga falla entera.
--
-- Lo encontró el verificador del 11 al limpiar su clínica de prueba.
--
-- `fact_es_operacion_directa()` ya existe desde la 129 y responde la
-- pregunta correcta: `pg_trigger_depth() = 1` es verdadero cuando
-- alguien escribió el DELETE a mano, y falso cuando viene en cascada de
-- otra tabla.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cmp_cierres_solo_agregar() RETURNS TRIGGER AS $$
BEGIN
  -- En cascada, se deja pasar: borrar la clínica entera no es editar su
  -- libro de controlados.
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'El cierre del libro de controlados no se edita ni se borra: está firmado. Un error se corrige con un cierre nuevo que lo explique.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
