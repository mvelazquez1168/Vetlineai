-- ---------------------------------------------------------------------
-- 162 — EL HISTORIAL DE PRECIOS MIRA SI LA CLÍNICA TODAVÍA EXISTE
--
-- La 161 intentó resolverlo con `fact_es_operacion_directa()`
-- —`pg_trigger_depth() = 1`—, y **no alcanzó**: con el borrado en
-- cascada desde `tenants`, la profundidad que ve este trigger sigue
-- siendo 1, así que el guard no se activaba y la purga seguía fallando.
--
-- Queda escrito porque es la trampa: `pg_trigger_depth()` no distingue
-- todos los caminos de cascada, y confiar en él sin probarlo contra el
-- borrado real es cómo este repo lleva tres triggers que trabaron la
-- purga.
--
-- LA PREGUNTA QUE SÍ FUNCIONA es la directa: **¿la clínica todavía
-- existe?** Si no existe, lo que está pasando es que se la están
-- borrando, y no hay ningún historial que escribir.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv_precio_cambio() RETURNS TRIGGER AS $$
DECLARE
  v_persona UUID;
  v_tenant UUID;
BEGIN
  v_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);

  -- La clínica se está borrando: esto no es un cambio de precio.
  IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = v_tenant) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.precio IS NOT DISTINCT FROM OLD.precio THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_persona := NULLIF(current_setting('app.persona_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_persona := NULL;
  END;

  INSERT INTO inv_precios_historial
    (tenant_id, lista_id, presentacion_id, servicio_id,
     precio_anterior, precio_nuevo, cambiado_por)
  VALUES (
    v_tenant,
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

-- Y el cierre de controlados, por el mismo motivo: la 160 usó el mismo
-- guard que no alcanza. Se le agrega la misma pregunta.
CREATE OR REPLACE FUNCTION cmp_cierres_solo_agregar() RETURNS TRIGGER AS $$
BEGIN
  IF NOT fact_es_operacion_directa()
     OR NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'El cierre del libro de controlados no se edita ni se borra: está firmado. Un error se corrige con un cierre nuevo que lo explique.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
