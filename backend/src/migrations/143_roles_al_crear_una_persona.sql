-- ---------------------------------------------------------------------
-- 143 — UNA PERSONA NUEVA NACE CON SUS ROLES (prompt 04)
--
-- DEFECTO ENCONTRADO POR EL VERIFICADOR DE CAJA, y es el más grave de
-- esta entrega: con los roles en `persona_roles`, **toda persona creada
-- por un camino que no inserte ahí queda sin ningún permiso**. No es un
-- detalle de pruebas: los caminos que crean personas en producción son
-- la invitación de médicos, el registro público de una clínica y el
-- alta de un administrador desde la plataforma, y ninguno sabía de la
-- tabla nueva.
--
-- Síntoma concreto: un médico recién invitado entraba y no podía hacer
-- nada; un administrador recién creado no podía autorizar un descuento
-- en su propia clínica.
--
-- SE ARREGLA EN LA BASE Y NO EN LOS TRES CAMINOS, con un trigger.
--
-- Por qué así: los tres caminos ya escriben `es_medico` y
-- `es_admin_clinica` —es su forma de decir qué es esa persona— y el
-- trigger traduce eso a roles en el mismo INSERT. Arreglarlo en los
-- tres lugares dejaría el cuarto camino, el que alguien escriba el mes
-- que viene, con el mismo defecto; y este sistema ya tiene la lección
-- de los `CHECK` cerrados que se quedan cortos cuando aparece un
-- disparador nuevo.
--
-- El trigger NO pisa roles existentes: si quien inserta ya puso las
-- filas de `persona_roles` —la pantalla de personas del 04, que elige
-- roles de verdad—, no hace nada.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION personas_roles_por_omision() RETURNS TRIGGER AS $$
BEGIN
  -- Las columnas son derivadas desde el prompt 04, pero los caminos
  -- viejos siguen escribiéndolas: son la única pista de qué rol darle.
  IF NEW.es_admin_clinica THEN
    INSERT INTO persona_roles (persona_id, rol)
    VALUES (NEW.id, 'admin_clinica')
    ON CONFLICT (persona_id, rol) DO NOTHING;
  END IF;
  IF NEW.es_medico THEN
    INSERT INTO persona_roles (persona_id, rol)
    VALUES (NEW.id, 'medico')
    ON CONFLICT (persona_id, rol) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_personas_roles_por_omision ON personas;
CREATE TRIGGER trg_personas_roles_por_omision
  AFTER INSERT ON personas
  FOR EACH ROW EXECUTE FUNCTION personas_roles_por_omision();

COMMENT ON FUNCTION personas_roles_por_omision() IS
  'Traduce es_medico/es_admin_clinica a filas de persona_roles al crear una persona, para que ningún camino de alta la deje sin permisos (prompt 04).';

-- Y las que ya quedaron sin roles por haberse creado entre la 139 y
-- esta migración.
INSERT INTO persona_roles (persona_id, rol)
SELECT p.id, 'admin_clinica' FROM personas p
 WHERE p.es_admin_clinica
   AND NOT EXISTS (SELECT 1 FROM persona_roles pr WHERE pr.persona_id = p.id);
INSERT INTO persona_roles (persona_id, rol)
SELECT p.id, 'medico' FROM personas p
 WHERE p.es_medico
   AND NOT EXISTS (SELECT 1 FROM persona_roles pr WHERE pr.persona_id = p.id);
