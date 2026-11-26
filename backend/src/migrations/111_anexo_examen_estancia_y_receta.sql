-- ---------------------------------------------------------------------
-- 111 — Anexo Digital Vet, parte A: el examen físico de verdad, el
--       ingreso y la salida, los catálogos de receta y los datos
--       opcionales del paciente
--
-- El bloque B del prompt 07 ya dejó el examen por sistemas con tres
-- estados y los signos básicos. Este anexo lo lleva a lo que una
-- clínica usa todos los días:
--
--   * los signos que faltaban, con su catálogo POR CLÍNICA en vez de
--     una lista fija en el código;
--   * la lista de sistemas, configurable por clínica;
--   * la hora de ingreso y de salida, y la estancia;
--   * los catálogos de la receta y la posología sugerida del producto;
--   * los datos opcionales del paciente y su baja con motivo.
--
-- POR QUÉ CATÁLOGOS Y NO ENUMERACIONES. «Mucosas: rosadas, pálidas,
-- ictéricas…» parece una lista cerrada, y en una especie lo es. Pero una
-- clínica de exóticos examina otras cosas, y una de equinos tiene su
-- propia escala de condición corporal. Un CHECK con cinco valores
-- obliga a una migración para agregar el sexto; una tabla por clínica,
-- a un INSERT que la clínica hace sola.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- LOS CATÁLOGOS CLÍNICOS DE LA CLÍNICA
--
-- Una sola tabla con un `tipo` y no seis tablas de dos columnas: son
-- todas la misma cosa —una lista de opciones ordenada, por clínica— y
-- seis tablas serían seis pantallas de administración para lo mismo.
--
-- `tenant_id` NULL = valores iniciales de la plataforma, que toda
-- clínica ve hasta que define los suyos. Mismo patrón que las
-- plantillas de atención.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exp_catalogos_clinicos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  tipo      VARCHAR(30) NOT NULL
              CHECK (tipo IN ('mucosas', 'hidratacion', 'actitud', 'dolor',
                              'sistema_examen', 'via_administracion', 'frecuencia',
                              'unidad_dosis', 'caracter', 'habitat', 'tipo_dieta',
                              'pelaje', 'motivo_baja')),
  codigo    VARCHAR(40) NOT NULL,
  etiqueta  VARCHAR(120) NOT NULL,
  /* Para las frecuencias: cada cuántas horas, que es lo que permite
     calcular la cantidad total de una receta y el texto legible. */
  horas     NUMERIC(6,2),
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogo_clinico_plataforma
  ON exp_catalogos_clinicos (tipo, codigo) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogo_clinico_tenant
  ON exp_catalogos_clinicos (tenant_id, tipo, codigo) WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- LOS PARÁMETROS CLÍNICOS DE LA CLÍNICA
--
-- La escala de condición corporal es el caso que el anexo nombra: 1 a 9
-- por defecto, 1 a 5 como configuración. Va acá y no en una columna de
-- `tenants` porque lo que viene detrás —si se exige el dolor, qué
-- sistemas son obligatorios— es de la misma clase.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exp_parametros_clinicos (
  tenant_id            UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE
                         DEFERRABLE INITIALLY DEFERRED,
  escala_condicion_max SMALLINT NOT NULL DEFAULT 9
                         CHECK (escala_condicion_max IN (5, 9)),
  /* Cuántos segundos es "normal" de llenado capilar, para avisar. */
  llenado_capilar_max  NUMERIC(3,1) NOT NULL DEFAULT 2.0,
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- EL EXAMEN FÍSICO: lo que faltaba
--
-- `condicion_corporal`, `mucosas`, `hidratacion` y
-- `tiempo_llenado_capilar` ya existían (migración 105). Se agregan los
-- que el anexo pide y que no estaban, y los dos que convierten el
-- llenado capilar en un número comparable.
-- ---------------------------------------------------------------------

ALTER TABLE atenciones
  ADD COLUMN IF NOT EXISTS actitud VARCHAR(40),
  ADD COLUMN IF NOT EXISTS dolor_escala SMALLINT,
  /* El llenado capilar venía como texto libre: "2 seg", "<2", "rápido".
     Un dato así no se puede comparar entre visitas ni graficar. La
     columna nueva es el número en segundos; la vieja se mantiene por
     compatibilidad y se deja de escribir. */
  ADD COLUMN IF NOT EXISTS llenado_capilar_seg NUMERIC(3,1),
  /* INGRESO Y SALIDA (A2). */
  ADD COLUMN IF NOT EXISTS ingreso_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS salida_en TIMESTAMPTZ,
  /* Una atención de ESTANCIA: el paciente queda en la clínica más de la
     consulta. NO es hospitalización —no hay hoja de tratamiento, ni
     jaulas, ni rondas—: es el dato que permite saber quién está adentro
     y por cuánto, y el gancho para que ese módulo cuelgue después. */
  ADD COLUMN IF NOT EXISTS es_estancia BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estancia_motivo VARCHAR(120);

ALTER TABLE atenciones DROP CONSTRAINT IF EXISTS atenciones_dolor_check;
ALTER TABLE atenciones
  ADD CONSTRAINT atenciones_dolor_check
  CHECK (dolor_escala IS NULL OR dolor_escala BETWEEN 0 AND 10);

/* La salida no puede ser antes del ingreso. Un paciente que sale antes
   de entrar es un dato mal cargado, y el tiempo de estancia saldría
   negativo en la lista de quién está en la clínica. */
ALTER TABLE atenciones DROP CONSTRAINT IF EXISTS atenciones_salida_despues_del_ingreso;
ALTER TABLE atenciones
  ADD CONSTRAINT atenciones_salida_despues_del_ingreso
  CHECK (salida_en IS NULL OR ingreso_en IS NULL OR salida_en >= ingreso_en);

COMMENT ON COLUMN atenciones.es_estancia IS
  'El paciente queda en la clínica más de la consulta. NO es hospitalización: es el dato que permite la lista de quién está adentro, y el gancho para que ese módulo cuelgue después.';
COMMENT ON COLUMN atenciones.tiempo_llenado_capilar IS
  'OBSOLETA: era texto libre y no se puede comparar entre visitas. El dato vive en llenado_capilar_seg. Se conserva para no perder lo ya cargado.';

/* El examen por sistemas: una nota es OBLIGATORIA cuando el estado es
   anormal. «Anormal» sin decir qué no le sirve a nadie, y es lo que el
   anexo pide. Se impone en la base y no solo en la pantalla. */
ALTER TABLE exp_examen_sistemas DROP CONSTRAINT IF EXISTS examen_anormal_con_detalle;
ALTER TABLE exp_examen_sistemas
  ADD CONSTRAINT examen_anormal_con_detalle
  CHECK (estado <> 'anormal' OR (nota IS NOT NULL AND length(btrim(nota)) > 0));

-- ---------------------------------------------------------------------
-- LA POSOLOGÍA SUGERIDA DEL PRODUCTO (A3)
--
-- Vive en el producto del catálogo y no en una tabla aparte: es un dato
-- del producto, como su precio o su CABYS. `dosis_por_kg` y `dosis_fija`
-- son excluyentes —o se calcula por peso o es una dosis fija— y el CHECK
-- lo impone: con los dos cargados, nadie sabría cuál usar.
-- ---------------------------------------------------------------------

ALTER TABLE inv_productos
  ADD COLUMN IF NOT EXISTS dosis_por_kg NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS dosis_fija NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS unidad_dosis VARCHAR(40),
  ADD COLUMN IF NOT EXISTS via_administracion VARCHAR(40),
  ADD COLUMN IF NOT EXISTS frecuencia_sugerida VARCHAR(40),
  ADD COLUMN IF NOT EXISTS duracion_sugerida_cantidad SMALLINT,
  ADD COLUMN IF NOT EXISTS duracion_sugerida_unidad VARCHAR(10)
    CHECK (duracion_sugerida_unidad IS NULL
           OR duracion_sugerida_unidad IN ('dias', 'semanas', 'meses'));

ALTER TABLE inv_productos DROP CONSTRAINT IF EXISTS producto_una_sola_dosis;
ALTER TABLE inv_productos
  ADD CONSTRAINT producto_una_sola_dosis
  CHECK (dosis_por_kg IS NULL OR dosis_fija IS NULL);

/* La duración de la receta, como cantidad + unidad. `receta_items.duracion`
   era texto libre ("7 días", "una semana", "7d"), y de ahí no se puede
   calcular cuántas unidades dispensar ni cuándo termina el tratamiento.
   El texto se conserva: es lo que ya está impreso en las recetas
   emitidas. */
ALTER TABLE receta_items
  ADD COLUMN IF NOT EXISTS duracion_cantidad SMALLINT,
  ADD COLUMN IF NOT EXISTS duracion_unidad VARCHAR(10)
    CHECK (duracion_unidad IS NULL OR duracion_unidad IN ('dias', 'semanas', 'meses')),
  /* La presentación dispensada, cuando el ítem sale del inventario y no
     del catálogo de medicamentos de la plataforma. */
  ADD COLUMN IF NOT EXISTS presentacion_id UUID
    REFERENCES inv_presentaciones(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------
-- DATOS OPCIONALES DEL PACIENTE (A5)
--
-- Todos opcionales, por la regla de los niveles de completitud: una
-- mascota registrada en el mostrador con el nombre y la especie sigue
-- siendo válida.
--
-- NO se agregan «patologías permanentes» ni «tratamientos permanentes»:
-- eso ya es la lista de problemas (`exp_problemas`, estado crónico) y la
-- medicación activa del expediente. Un campo de texto aparte sería el
-- mismo dato en dos lugares.
-- ---------------------------------------------------------------------

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS pelaje VARCHAR(60),
  ADD COLUMN IF NOT EXISTS caracter VARCHAR(40),
  ADD COLUMN IF NOT EXISTS habitat VARCHAR(20)
    CHECK (habitat IS NULL OR habitat IN ('interior', 'exterior', 'mixto')),
  ADD COLUMN IF NOT EXISTS tipo_dieta VARCHAR(40),
  ADD COLUMN IF NOT EXISTS alimentacion_detalle VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pedigri BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pedigri_registro VARCHAR(60),
  ADD COLUMN IF NOT EXISTS partos SMALLINT CHECK (partos IS NULL OR partos >= 0),
  /* LA BAJA DEL PACIENTE. `estado` ya admitía 'activo' y 'fallecido';
     el anexo pide también extraviado, transferido y otro. El motivo y
     la fecha valen para los cuatro. */
  ADD COLUMN IF NOT EXISTS baja_motivo VARCHAR(200),
  ADD COLUMN IF NOT EXISTS baja_en DATE;

/* Partos solo tiene sentido en una hembra. Con un macho con 3 partos
   cargados, el dato que está mal es el sexo o el parto, y nadie sabría
   cuál. */
ALTER TABLE pacientes DROP CONSTRAINT IF EXISTS pacientes_partos_solo_hembra;
ALTER TABLE pacientes
  ADD CONSTRAINT pacientes_partos_solo_hembra
  CHECK (partos IS NULL OR partos = 0 OR sexo = 'hembra');

DO $$
BEGIN
  /* El CHECK de estado se amplía sin perder lo que ya valía. Se busca el
     constraint por nombre real porque pudo nacer con otro. */
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'pacientes'::regclass AND conname = 'pacientes_estado_check'
  ) THEN
    ALTER TABLE pacientes DROP CONSTRAINT pacientes_estado_check;
  END IF;
  ALTER TABLE pacientes
    ADD CONSTRAINT pacientes_estado_check
    CHECK (estado IN ('activo', 'fallecido', 'extraviado', 'transferido', 'baja_otro'));
END $$;

COMMENT ON COLUMN pacientes.baja_motivo IS
  'Por qué se dio de baja. Vale para fallecido, extraviado, transferido y otro. La fecha de fallecimiento sigue en fecha_fallecimiento: es la que los avisos ya miran.';

-- ---------------------------------------------------------------------
-- EL BORRADOR AUTOGUARDADO Y EL BLOQUEO DE EDICIÓN (A4)
--
-- Dos problemas distintos y una sola tabla:
--
--   1. QUIÉN TIENE EL DOCUMENTO ABIERTO. Si la misma atención se abre en
--      dos sesiones, la segunda entra en lectura y dice quién la tiene.
--      Sin esto, el último en guardar pisa al otro sin que ninguno se
--      entere.
--   2. QUÉ SE GUARDÓ Y CUÁNDO, para poder mostrar «Guardado hace 12 s»
--      y para que un borrador sobreviva a un navegador que se cierra.
--
-- El borrador NO es el documento: lo guardado acá es lo que el usuario
-- está escribiendo. Al firmar, la atención toma el valor y el borrador
-- deja de importar. Por eso `documento_tipo` y no una tabla por
-- documento: el consentimiento editable y el informe tienen el mismo
-- problema.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exp_borradores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  documento_tipo VARCHAR(30) NOT NULL
                   CHECK (documento_tipo IN ('atencion', 'consentimiento', 'informe')),
  documento_id   UUID NOT NULL,
  persona_id     UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  /* Lo que el usuario está escribiendo, campo por campo. */
  contenido      JSONB NOT NULL DEFAULT '{}'::jsonb,
  /* El latido de la sesión que lo tiene abierto. Un bloqueo sin latido
     sería un documento trabado para siempre porque alguien cerró la
     laptop. */
  ultimo_latido  TIMESTAMPTZ NOT NULL DEFAULT now(),
  guardado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (documento_tipo, documento_id)
);

CREATE INDEX IF NOT EXISTS idx_borradores_latido ON exp_borradores (ultimo_latido);

COMMENT ON TABLE exp_borradores IS
  'Borrador autoguardado y bloqueo de edición. Una fila por documento: quien la tiene es quien edita, y el resto entra en lectura. El latido vence a los minutos para que un navegador cerrado no trabe el documento.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

ALTER TABLE exp_parametros_clinicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_parametros_clinicos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exp_parametros_clinicos_tenant ON exp_parametros_clinicos;
CREATE POLICY exp_parametros_clinicos_tenant ON exp_parametros_clinicos
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE exp_borradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_borradores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exp_borradores_tenant ON exp_borradores;
CREATE POLICY exp_borradores_tenant ON exp_borradores
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

/* Los catálogos clínicos: cada clínica ve los suyos Y los de la
   plataforma, y solo escribe los suyos. */
ALTER TABLE exp_catalogos_clinicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_catalogos_clinicos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exp_catalogos_clinicos_tenant ON exp_catalogos_clinicos;
CREATE POLICY exp_catalogos_clinicos_tenant ON exp_catalogos_clinicos
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
