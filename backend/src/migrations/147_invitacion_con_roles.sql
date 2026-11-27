-- ---------------------------------------------------------------------
-- 147 — SE INVITA A UNA PERSONA CON SUS ROLES (prompt 04, sección 1)
--
-- La invitación nació para médicos: `invitaciones_medico`, y quien la
-- aceptaba nacía con `es_medico = true` y colegiatura obligatoria. Con
-- ocho roles, ese es el único camino de alta de personal y no sirve para
-- invitar a la recepción: le pediría un número de colegiatura que no
-- tiene.
--
-- LA TABLA NO SE RENOMBRA. `invitaciones_medico` queda con su nombre
-- —renombrarla toca el módulo de invitaciones, el registro público, tres
-- verificadores y los correos— y se le agrega qué roles va a tener la
-- persona. Queda anotado en el informe como deuda de nombre: la tabla
-- hoy es «invitaciones de personal».
--
-- EL CUPO ES DE MÉDICOS Y SIGUE SIENDO DE MÉDICOS. El plan se cobra por
-- médico; invitar a la recepción no consume un cupo de médico. Eso se
-- impone en el código (`crearInvitacion` y `contarInvitacionesPendientes`
-- miran `roles`), y acá se deja el dato para que pueda mirarlo.
-- ---------------------------------------------------------------------
ALTER TABLE invitaciones_medico
  ADD COLUMN IF NOT EXISTS roles VARCHAR(40)[] NOT NULL DEFAULT ARRAY['medico']::varchar[];

COMMENT ON COLUMN invitaciones_medico.roles IS
  'Los roles que la persona va a tener al aceptar (prompt 04). El default es medico: es lo que todas las invitaciones anteriores a esta migración fueron.';

-- Las invitaciones pendientes que ya existen fueron de médicos, y el
-- DEFAULT ya las dejó así. No hay nada que corregir: se dice para que no
-- parezca un olvido.

-- Que los roles existan de verdad. Un array con 'recepcionista' —que no
-- es el código, el código es 'recepcion'— dejaría a la persona sin
-- permisos al aceptar, y eso se descubre cuando ya entró.
--
-- No puede ser una FK (es un array), así que es un CHECK con subconsulta
-- envuelta en una función: es el mismo patrón que ya se usa para validar
-- códigos de catálogo en arrays.
CREATE OR REPLACE FUNCTION roles_existen(codigos varchar[]) RETURNS boolean AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(codigos) AS c(codigo)
     WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.codigo = c.codigo)
  );
$$ LANGUAGE sql STABLE;

ALTER TABLE invitaciones_medico
  DROP CONSTRAINT IF EXISTS invitaciones_medico_roles_check;
ALTER TABLE invitaciones_medico
  ADD CONSTRAINT invitaciones_medico_roles_check
  CHECK (array_length(roles, 1) >= 1 AND roles_existen(roles));
