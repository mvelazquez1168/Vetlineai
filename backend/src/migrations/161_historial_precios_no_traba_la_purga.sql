-- ---------------------------------------------------------------------
-- 161 — EL HISTORIAL DE PRECIOS TAMPOCO TRABA LA PURGA (defecto de la 159)
--
-- Tercera vez en este repo que un trigger escrito sin pensar en el
-- DELETE EN CASCADA rompe el borrado de una clínica. Acá el trigger no
-- bloquea: **escribe**, y al borrar la clínica intenta insertar una fila
-- de historial con el `tenant_id` que se está borrando. La FK lo
-- rechaza y la purga falla entera.
--
-- Lo encontró el verificador del 11 al limpiar su clínica de prueba, que
-- es exactamente el camino de la purga real.
--
-- La regla, para la próxima: **un trigger que escribe en otra tabla
-- tiene que preguntarse qué pasa cuando lo que se borra es el padre.**
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv_precio_cambio() RETURNS TRIGGER AS $$
DECLARE
  v_persona UUID;
BEGIN
  -- Un borrado en cascada no es un cambio de precio: es una clínica que
  -- se va. No hay nada que historiar y el padre ya no existe.
  IF TG_OP = 'DELETE' AND NOT fact_es_operacion_directa() THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_persona := NULLIF(current_setting('app.persona_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_persona := NULL;
  END;

  IF TG_OP = 'UPDATE' AND NEW.precio IS NOT DISTINCT FROM OLD.precio THEN
    RETURN NULL;
  END IF;

  INSERT INTO inv_precios_historial
    (tenant_id, lista_id, presentacion_id, servicio_id,
     precio_anterior, precio_nuevo, cambiado_por)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    COALESCE(NEW.lista_id, OLD.lista_id),
    COALESCE(NEW.presentacion_id, OLD.presentacion_id),
    COALESCE(NEW.servicio_id, OLD.servicio_id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.precio END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.precio END,
    v_persona
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
