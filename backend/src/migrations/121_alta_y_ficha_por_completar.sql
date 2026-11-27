-- ---------------------------------------------------------------------
-- 121 — EL ALTA QUE FALTABA Y LA FICHA POR COMPLETAR (anexo del 07, A5)
--
-- Tres cosas, y las tres salen de lo mismo: hasta hoy un paciente solo
-- se podía crear desde el wizard de Nuevo caso o desde el modal de una
-- cita, y ese segundo camino pide nombre y especie y nada más. El
-- resultado son fichas a medias que nadie sabe que están a medias.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. LOS DATOS BÁSICOS QUE FALTAN, EN UN SOLO LUGAR
--
-- «Ficha por completar» es exactamente esto: los datos que el alta
-- rápida no pide. Vive en una función de la base y no repartido en
-- consultas porque lo van a leer tres: el listado del fichero, la ficha
-- del paciente y el resumen del expediente. Tres copias de la misma
-- lista de criterios es la forma de que un día digan cosas distintas.
--
-- POR QUÉ NO ES LO MISMO QUE `completitud`. El resumen del expediente
-- (`expediente/resumen.ts`) ya calcula una completitud sobre NUEVE
-- cosas: a los cinco básicos les suma peso, microchip, alergias y
-- cliente. Eso mide «qué tan completo está el expediente». Esto otro
-- mide «qué le falta a la ficha para no ser un alta rápida», que es una
-- pregunta distinta y tiene otra respuesta. Se llaman distinto a
-- propósito, y `resumen.ts` llama a esta función para los cinco que
-- comparten en vez de repetirlos.
--
-- Es IMMUTABLE y recibe columnas sueltas —no la fila entera— para poder
-- usarse en un índice si algún día el filtro del fichero lo necesita.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pacientes_datos_basicos_faltantes(
  p_especie              VARCHAR,
  p_raza                 VARCHAR,
  p_raza_id              UUID,
  p_sexo                 VARCHAR,
  p_estado_reproductivo  VARCHAR,
  p_fecha_nacimiento     DATE,
  p_edad_anios           INTEGER
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

-- ---------------------------------------------------------------------
-- 2. `habitat` tenía dos dueños
--
-- La migración 111 le puso un CHECK fijo —interior, exterior, mixto— y
-- al mismo tiempo sembró un catálogo `habitat` por clínica en
-- `exp_catalogos_clinicos`. Las dos cosas a la vez significan que una
-- clínica que agregue su propia opción al catálogo —«finca», «granja»,
-- «acuario»— recibe una violación de constraint al guardar el paciente.
--
-- Gana el catálogo, que es lo que el anexo pide («los catálogos son por
-- clínica, con valores iniciales»). El CHECK se va; el largo de la
-- columna sigue acotando. Mismo criterio que ya rige para `caracter`,
-- `tipo_dieta` y `pelaje`, que nacieron sin CHECK.
-- ---------------------------------------------------------------------
ALTER TABLE pacientes DROP CONSTRAINT IF EXISTS pacientes_habitat_check;

COMMENT ON COLUMN pacientes.habitat IS
  'Interior, exterior, mixto o lo que la clínica agregue: lo gobierna el catálogo habitat de exp_catalogos_clinicos, no un CHECK (migración 121).';

-- ---------------------------------------------------------------------
-- 3. EL TELÉFONO NORMALIZADO, PARA PODER AVISAR DEL DUPLICADO
--
-- El alta tiene que poder decir «ya existe un cliente con este
-- teléfono» antes de crear otro. `propietarios.telefono` es texto libre:
-- «8888-7777», «88887777» y «+506 8888 7777» son el mismo teléfono y
-- tres cadenas distintas.
--
-- Índice sobre la expresión y no columna nueva: una columna derivada es
-- un segundo lugar donde vive el mismo dato, y el día que alguien
-- escriba el teléfono sin pasar por la aplicación quedan distintos.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_propietarios_telefono_normalizado
  ON propietarios (tenant_id, regexp_replace(telefono, '[^0-9]', '', 'g'))
  WHERE telefono IS NOT NULL AND btrim(telefono) <> '';

-- El correo tampoco estaba indexado y la detección de duplicados lo
-- necesita (hoy el listado lo busca con ILIKE sin índice).
CREATE INDEX IF NOT EXISTS idx_propietarios_email
  ON propietarios (tenant_id, lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';
