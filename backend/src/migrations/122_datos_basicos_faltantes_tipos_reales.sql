-- ---------------------------------------------------------------------
-- 122 — LA FUNCIÓN DE LA 121, CON LOS TIPOS QUE LA TABLA TIENE DE VERDAD
--
-- `pacientes_datos_basicos_faltantes` nació declarando `p_edad_anios
-- INTEGER`, y `pacientes.edad_anios` es **numeric**. Postgres no
-- convierte numeric → integer para resolver una función, así que
-- cualquier llamada desde una consulta real fallaba con
-- «function … does not exist» — un error que no se ve al crear la
-- función, solo al usarla.
--
-- La 121 ya está aplicada y no se edita: se corrige acá. Se borra la
-- versión vieja antes de crear la nueva porque la firma cambia y
-- CREATE OR REPLACE no puede cambiar tipos de parámetros: quedarían las
-- dos y la llamada sería ambigua.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS pacientes_datos_basicos_faltantes(
  VARCHAR, VARCHAR, UUID, VARCHAR, VARCHAR, DATE, INTEGER
);

CREATE OR REPLACE FUNCTION pacientes_datos_basicos_faltantes(
  p_especie              VARCHAR,
  p_raza                 VARCHAR,
  p_raza_id              UUID,
  p_sexo                 VARCHAR,
  p_estado_reproductivo  VARCHAR,
  p_fecha_nacimiento     DATE,
  p_edad_anios           NUMERIC
) RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY_REMOVE(ARRAY[
    CASE WHEN p_especie IS NULL OR btrim(p_especie) = '' THEN 'especie' END,
    CASE WHEN (p_raza IS NULL OR btrim(p_raza) = '') AND p_raza_id IS NULL THEN 'raza' END,
    CASE WHEN p_sexo IS NULL OR btrim(p_sexo) = '' THEN 'sexo' END,
    CASE WHEN p_estado_reproductivo IS NULL OR btrim(p_estado_reproductivo) = ''
         THEN 'estado reproductivo' END,
    CASE WHEN p_fecha_nacimiento IS NULL AND p_edad_anios IS NULL
         THEN 'edad o fecha de nacimiento' END
  ], NULL);
$$;

COMMENT ON FUNCTION pacientes_datos_basicos_faltantes IS
  'Qué datos básicos le faltan a la ficha de un paciente: los que el alta rápida desde una cita no pide. Distinto de la completitud del expediente, que mide nueve cosas (anexo del 07, A5).';
