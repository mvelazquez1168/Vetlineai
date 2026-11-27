-- ---------------------------------------------------------------------
-- 129 — LA AUDITORÍA DE FUSIONES NO PUEDE TRABAR LA PURGA
--
-- Defecto de la migración 126, encontrado al correr el verificador del
-- anexo: su limpieza hace `DELETE FROM tenants`, y ahí falló con
--
--   crm_unificaciones es solo de inserción
--   SQL statement "DELETE FROM ONLY crm_unificaciones WHERE tenant_id = …"
--
-- El trigger append-only de la 126 bloqueaba TODO DELETE, incluido el
-- que dispara la cascada de `tenants`. Es decir: una clínica con una
-- fusión registrada no se podía purgar. Es exactamente la familia del
-- D-006 («purga trabada por 42 FK»), y el verificador lo destapó porque
-- borra su clínica de prueba al terminar.
--
-- LA SOLUCIÓN YA EXISTÍA EN EL REPO y no la usé: `fact_es_operacion_directa()`
-- (migración 091) devuelve `pg_trigger_depth() = 1`, o sea «esto es un
-- DELETE que alguien escribió» y no «esto es una cascada». Las dos
-- tablas append-only del CRM —`crm_interacciones` y
-- `crm_consentimiento_historial`— ya la usaban; la 126 escribió su
-- propio trigger sin ella.
--
-- Lo que queda protegido es lo que importa: nadie puede reescribir ni
-- borrar una fila de auditoría a mano. Si la clínica entera se va, su
-- auditoría se va con ella, que es lo que la purga promete.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_unificaciones_solo_insert() RETURNS TRIGGER AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'crm_unificaciones es solo de inserción: una unificación registrada no se reescribe.';
END;
$$ LANGUAGE plpgsql;
