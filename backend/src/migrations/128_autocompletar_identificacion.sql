-- ---------------------------------------------------------------------
-- 128 — AUTOCOMPLETAR POR IDENTIFICACIÓN (anexo 07-03, B2)
--
-- La recepción escribe la cédula y el nombre y los datos fiscales se
-- completan solos. Es el gesto que más tiempo ahorra en el alta y el que
-- más errores de tipeo evita: un nombre mal escrito en el comprobante
-- electrónico es un rechazo de Hacienda.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- LA CACHÉ ES DE LA PLATAFORMA, NO DE CADA CLÍNICA.
--
-- Una cédula es la misma para todo el país: cachearla por clínica haría
-- que diez clínicas consulten diez veces lo mismo contra un servicio
-- público que tiene límite de uso. No lleva `tenant_id` y no lleva RLS
-- por tenant: se lee desde cualquier clínica y se escribe desde el
-- backend.
--
-- NO ES UN PADRÓN NUESTRO. Es una caché con fecha: `consultado_en` dice
-- cuándo se trajo, y el código decide cuándo está vieja. Guardar el dato
-- para siempre sería armarnos un padrón paralelo que envejece sin que
-- nadie se entere —y, con la ley 8968, un tratamiento de datos
-- personales que nadie autorizó—.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identificacion_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pais_codigo   CHAR(2) NOT NULL DEFAULT 'CR',
  /* El código del catálogo, no el UUID: la caché es de la plataforma y
     el UUID de `tipos_identificacion` también, pero el código ('01',
     '02') es el que viene en la consulta y el que no cambia. */
  tipo_codigo   VARCHAR(10) NOT NULL,
  numero        VARCHAR(40) NOT NULL,
  /* Lo que devolvió el servicio. NULL cuando contestó «no existe»: eso
     también se cachea, para no volver a preguntar por una cédula que no
     está. */
  nombre        TEXT,
  /* El resto, como lo dio el proveedor: régimen tributario, actividades
     económicas, estado. Cambia según el servicio y no vale la pena una
     columna por campo. */
  datos         JSONB NOT NULL DEFAULT '{}'::jsonb,
  encontrado    BOOLEAN NOT NULL,
  proveedor     VARCHAR(40) NOT NULL,
  consultado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identificacion_cache_llave
  ON identificacion_cache (pais_codigo, tipo_codigo, numero);

COMMENT ON TABLE identificacion_cache IS
  'Caché de consultas de identificación. De la plataforma y no de cada clínica: una cédula es la misma para todo el país (anexo 07-03, B2).';

-- ---------------------------------------------------------------------
-- DE DÓNDE SALIERON LOS DATOS DEL CLIENTE.
--
-- Importa por dos razones distintas. La operativa: un nombre que vino
-- del registro público no se corrige «porque se ve raro», y uno que
-- escribió la recepción sí. La legal: la ley 8968 pide poder decir de
-- dónde salió un dato personal y cuándo, y «lo trajo el autocompletar
-- de Hacienda el 27 de noviembre» es una respuesta; «estaba ahí» no.
-- ---------------------------------------------------------------------
ALTER TABLE propietarios
  ADD COLUMN IF NOT EXISTS datos_fuente VARCHAR(30),
  ADD COLUMN IF NOT EXISTS datos_fuente_en TIMESTAMPTZ;

ALTER TABLE propietarios
  DROP CONSTRAINT IF EXISTS propietarios_datos_fuente_check;
ALTER TABLE propietarios
  ADD CONSTRAINT propietarios_datos_fuente_check
  CHECK (datos_fuente IS NULL OR datos_fuente IN ('manual', 'hacienda', 'simulado'));

COMMENT ON COLUMN propietarios.datos_fuente IS
  'De dónde salieron el nombre y los datos fiscales: manual, o el proveedor que los autocompletó (anexo 07-03, B2, ley 8968).';

-- ---------------------------------------------------------------------
-- EL FORMATO DE CADA IDENTIFICACIÓN DE COSTA RICA.
--
-- La columna `formato_regex` existía desde el facturador y estaba en
-- NULL en las cinco filas: nadie validaba nada. Se llena ahora porque el
-- autocompletar necesita saber cuándo el número está completo —antes de
-- eso no tiene sentido consultar— y porque un número con la cantidad de
-- dígitos equivocada es un rechazo de Hacienda que se puede ver desde el
-- formulario.
--
-- Los formatos son los de la factura electrónica 4.4:
--
--   01 Cédula física  9 dígitos sin guiones ni ceros de relleno
--   02 Cédula jurídica 10 dígitos
--   03 DIMEX          11 o 12 dígitos
--   04 NITE           10 dígitos
--   05 Pasaporte      no tiene formato: es de otro país
--
-- El pasaporte queda en NULL A PROPÓSITO, y no es un olvido: un
-- pasaporte brasileño y uno alemán no comparten formato, y poner
-- cualquier expresión ahí rechazaría clientes reales.
-- ---------------------------------------------------------------------
UPDATE tipos_identificacion SET formato_regex = '^[0-9]{9}$'
  WHERE pais_codigo = 'CR' AND codigo = '01' AND formato_regex IS NULL;
UPDATE tipos_identificacion SET formato_regex = '^[0-9]{10}$'
  WHERE pais_codigo = 'CR' AND codigo = '02' AND formato_regex IS NULL;
UPDATE tipos_identificacion SET formato_regex = '^[0-9]{11,12}$'
  WHERE pais_codigo = 'CR' AND codigo = '03' AND formato_regex IS NULL;
UPDATE tipos_identificacion SET formato_regex = '^[0-9]{10}$'
  WHERE pais_codigo = 'CR' AND codigo = '04' AND formato_regex IS NULL;
