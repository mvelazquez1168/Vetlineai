-- ---------------------------------------------------------------------
-- 101 — El expediente clínico, bloque A (prompt 07, secciones 1 a 8)
--
-- QUÉ YA EXISTÍA, para no duplicarlo (relevado antes de escribir esto):
--
--   * `atenciones` (id, cita_id, paciente_id, medico_id, nota_medica,
--     peso, temperatura): la visita con una nota libre. Sin SOAP, sin
--     firma y sin cierre — eso llega con el bloque B.
--   * `cuidados_preventivos`: vacunas y desparasitaciones con lote,
--     producto, fecha y próxima. La pestaña de vacunas LEE de acá.
--   * `recetas` + `receta_items`: prescripciones ligadas a
--     `medicamentos` (el catálogo de Vetline Ai).
--   * `pacientes` ya trae `alergias`, `alerta_manejo`, `microchip`,
--     `estado_reproductivo`, `numero_expediente` y el estado (prompt
--     01), así que la franja de alertas y el indicador de completitud
--     no necesitan tablas nuevas para eso.
--   * `archivos` guarda adjuntos, pero SOLO del caso de Vetline Ai
--     (caso_id, mensaje_id). Se extiende acá en vez de crear una tabla
--     de archivos del expediente: el prompt pide reusar el
--     almacenamiento existente con sus reglas de acceso, y dos tablas
--     de archivos serían dos lugares donde aplicar esas reglas.
--   * `razas` + `razas_alias_documento` ya vinculan la raza con la
--     sección del documento de predisposiciones. La ficha racial LEE de
--     ahí; no se copia ni se reescribe nada.
--
-- LO QUE SE AGREGA, y por qué cada cosa es una tabla y no un campo:
-- todo lo de acá abajo es algo que se consulta, se filtra o se grafica
-- (problemas activos, analitos en el tiempo, hallazgos de grooming
-- pendientes). Guardarlo como JSON en una columna haría imposible
-- preguntarle a la base "qué pacientes tienen un problema crónico
-- activo" sin recorrer todo.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. LISTA DE PROBLEMAS
--
-- La lista maestra de problemas: el hilo que une visitas separadas en el
-- tiempo. Un problema NO es un diagnóstico de una visita: nace en una,
-- se trata en varias y se resuelve (o no) en otra.
-- ---------------------------------------------------------------------
CREATE TABLE exp_problemas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id   UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  descripcion   VARCHAR(200) NOT NULL,
  estado        VARCHAR(12) NOT NULL DEFAULT 'activo'
                  CHECK (estado IN ('activo', 'cronico', 'resuelto')),
  fecha_inicio  DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_resolucion DATE,
  -- De dónde salió y dónde se trató. Opcionales: un problema puede
  -- cargarse al abrir el expediente de un paciente que llega con
  -- historia de otra clínica.
  atencion_origen_id UUID REFERENCES atenciones(id) ON DELETE SET NULL
                       DEFERRABLE INITIALLY DEFERRED,
  caso_id       UUID REFERENCES casos(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  nota          TEXT,
  creado_por    UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un problema resuelto tiene fecha de resolución y uno activo no: si
  -- no, "resuelto" deja de significar algo.
  CONSTRAINT exp_problemas_resuelto_con_fecha
    CHECK ((estado = 'resuelto') = (fecha_resolucion IS NOT NULL)),
  CONSTRAINT exp_problemas_resolucion_posterior
    CHECK (fecha_resolucion IS NULL OR fecha_resolucion >= fecha_inicio)
);

CREATE INDEX idx_exp_problemas_paciente ON exp_problemas (paciente_id, estado);

ALTER TABLE exp_problemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_problemas FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_problemas_isolation ON exp_problemas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Qué atenciones trataron un problema. Muchos a muchos: una visita
-- toca varios problemas y un problema se trata en varias visitas.
CREATE TABLE exp_problema_atenciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  problema_id UUID NOT NULL REFERENCES exp_problemas(id) ON DELETE CASCADE,
  atencion_id UUID NOT NULL REFERENCES atenciones(id) ON DELETE CASCADE,
  UNIQUE (problema_id, atencion_id)
);

ALTER TABLE exp_problema_atenciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_problema_atenciones FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_problema_atenciones_isolation ON exp_problema_atenciones
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 2. ALERGIAS Y REACCIONES ADVERSAS, estructuradas
--
-- `pacientes.alergias` existe y es TEXTO LIBRE. Sirve para que el
-- médico lea "alérgico a las picaduras de pulga", pero NO sirve para la
-- alerta al recetar: nadie puede comparar un nombre de fármaco contra
-- una frase y acertar siempre.
--
-- Por eso esta tabla, que apunta al `medicamento_id` del catálogo o
-- —cuando el fármaco no está en el catálogo— guarda el principio activo
-- y el grupo como texto normalizado. La alerta del bloque B mira ACÁ.
--
-- Las dos conviven y la pantalla muestra las dos cosas etiquetadas: la
-- nota libre no se migra sola porque interpretarla sería inventar
-- datos clínicos.
-- ---------------------------------------------------------------------
CREATE TABLE exp_alergias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id   UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  tipo          VARCHAR(20) NOT NULL DEFAULT 'alergia'
                  CHECK (tipo IN ('alergia', 'reaccion_adversa', 'intolerancia')),
  medicamento_id UUID REFERENCES medicamentos(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  /* El principio activo o la sustancia, en minúscula y sin acentos para
     poder compararla. Se llena siempre, incluso cuando hay
     medicamento_id, porque es con lo que se compara. */
  sustancia     VARCHAR(120) NOT NULL,
  /* El grupo farmacológico (penicilinas, AINEs, sulfas…): una alergia a
     un grupo alcanza a fármacos que no están cargados. */
  grupo         VARCHAR(80),
  severidad     VARCHAR(12) NOT NULL DEFAULT 'moderada'
                  CHECK (severidad IN ('leve', 'moderada', 'grave')),
  reaccion      VARCHAR(200),
  nota          TEXT,
  registrado_por UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exp_alergias_paciente ON exp_alergias (paciente_id);
CREATE INDEX idx_exp_alergias_sustancia ON exp_alergias (tenant_id, sustancia);

ALTER TABLE exp_alergias ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_alergias FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_alergias_isolation ON exp_alergias
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 3. LABORATORIO
--
-- Tres tablas: el catálogo de rangos de referencia POR ESPECIE, el
-- estudio (que es también la orden, con su estado) y cada analito.
--
-- EL RANGO ES POR ESPECIE y no un número en la pantalla: la creatinina
-- normal de un gato no es la de un perro, y un valor marcado como alto
-- con el rango equivocado manda a tratar a un paciente sano.
-- ---------------------------------------------------------------------
CREATE TABLE exp_analitos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* Catálogo GLOBAL, como `lineas_negocio` y `especialidades`: los
     rangos de referencia son del analito y de la especie, no de la
     clínica. Una clínica que use otro laboratorio con otro rango lo
     dice en el estudio, que guarda su propio rango. */
  codigo      VARCHAR(30) NOT NULL,
  nombre      VARCHAR(80) NOT NULL,
  unidad      VARCHAR(20) NOT NULL,
  especie     VARCHAR(20) NOT NULL,
  ref_min     NUMERIC(14,4),
  ref_max     NUMERIC(14,4),
  grupo       VARCHAR(40),
  orden       INTEGER NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (codigo, especie)
);

CREATE TABLE exp_estudios_lab (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id   UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  atencion_id   UUID REFERENCES atenciones(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  tipo_estudio  VARCHAR(40) NOT NULL,
  /* `solicitado` es la ORDEN. No hay una tabla de órdenes aparte: una
     orden es un estudio que todavía no tiene resultado, y separarlas
     obligaría a copiar los datos del estudio al llegar el resultado. */
  estado        VARCHAR(20) NOT NULL DEFAULT 'solicitado'
                  CHECK (estado IN ('solicitado', 'muestra_enviada', 'resultado_recibido',
                                    'cancelado')),
  es_externo    BOOLEAN NOT NULL DEFAULT false,
  laboratorio   VARCHAR(120),
  fecha_solicitud TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_resultado TIMESTAMPTZ,
  /* El PDF del laboratorio externo, en `archivos`. */
  archivo_id    UUID REFERENCES archivos(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  observaciones TEXT,
  solicitado_por UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  /* Cuándo lo vio el médico. NULL = todavía es un aviso pendiente. */
  visto_en      TIMESTAMPTZ,
  visto_por     UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exp_estudios_resultado_con_fecha
    CHECK (estado <> 'resultado_recibido' OR fecha_resultado IS NOT NULL)
);

CREATE INDEX idx_exp_estudios_paciente ON exp_estudios_lab (paciente_id, fecha_solicitud DESC);
CREATE INDEX idx_exp_estudios_pendientes ON exp_estudios_lab (tenant_id, estado)
  WHERE estado <> 'resultado_recibido';

ALTER TABLE exp_estudios_lab ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_estudios_lab FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_estudios_lab_isolation ON exp_estudios_lab
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE exp_lab_resultados (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estudio_id  UUID NOT NULL REFERENCES exp_estudios_lab(id) ON DELETE CASCADE,
  analito_id  UUID REFERENCES exp_analitos(id) ON DELETE SET NULL,
  /* El nombre tal como vino, para los analitos que no están en el
     catálogo: un resultado que no se puede graficar sigue siendo un
     resultado y no se descarta. */
  analito_texto VARCHAR(80) NOT NULL,
  valor       NUMERIC(14,4),
  valor_texto VARCHAR(80),
  unidad      VARCHAR(20),
  /* El rango CON EL QUE SE LEYÓ este resultado, copiado del catálogo al
     cargarlo. Si el catálogo cambia, un resultado viejo sigue
     interpretándose con el rango que tenía. */
  ref_min     NUMERIC(14,4),
  ref_max     NUMERIC(14,4),
  bandera     VARCHAR(8) CHECK (bandera IS NULL OR bandera IN ('alto', 'bajo', 'normal')),
  orden       INTEGER NOT NULL DEFAULT 0,
  /* Un resultado es un número o un texto ("positivo", "negativo"), pero
     no ninguno de los dos. */
  CONSTRAINT exp_lab_resultado_con_valor
    CHECK (valor IS NOT NULL OR valor_texto IS NOT NULL)
);

CREATE INDEX idx_exp_lab_resultados_estudio ON exp_lab_resultados (estudio_id);
CREATE INDEX idx_exp_lab_resultados_analito ON exp_lab_resultados (tenant_id, analito_id);

ALTER TABLE exp_lab_resultados ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_lab_resultados FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_lab_resultados_isolation ON exp_lab_resultados
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 4. IMÁGENES Y DOCUMENTOS: se extiende `archivos`
--
-- `archivos` era del caso de Vetline Ai (caso_id, mensaje_id). Ahora
-- también cuelga del paciente y de la atención, con su tipo y su fecha,
-- y distinguiendo lo EXTERNO (la historia que trae de otra clínica) de
-- lo generado acá — que es el punto de la sección 5.
-- ---------------------------------------------------------------------
ALTER TABLE archivos
  ADD COLUMN IF NOT EXISTS paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS atencion_id UUID REFERENCES atenciones(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(30),
  ADD COLUMN IF NOT EXISTS es_externo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS descripcion VARCHAR(250),
  ADD COLUMN IF NOT EXISTS fecha_documento DATE;

COMMENT ON COLUMN archivos.es_externo IS
  'true = lo trajo el cliente o otra clínica. Mezclarlo con lo generado acá haría imposible saber qué midió esta clínica.';

CREATE INDEX IF NOT EXISTS idx_archivos_paciente ON archivos (paciente_id, fecha_documento DESC);

-- ---------------------------------------------------------------------
-- 5. GROOMING
--
-- Con su canal de HALLAZGOS hacia el médico, que es lo que un sistema
-- con grooming separado pierde: el groomer es quien toca al animal
-- entero todos los meses.
-- ---------------------------------------------------------------------
CREATE TABLE exp_grooming (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id   UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  cita_id       UUID REFERENCES citas(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT now(),
  groomer_id    UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  tipo_corte    VARCHAR(80),
  comportamiento VARCHAR(20)
                  CHECK (comportamiento IS NULL OR comportamiento IN
                         ('tranquilo', 'nervioso', 'agresivo', 'no_coopera')),
  observaciones TEXT,
  foto_antes_id   UUID REFERENCES archivos(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  foto_despues_id UUID REFERENCES archivos(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exp_grooming_paciente ON exp_grooming (paciente_id, fecha DESC);

ALTER TABLE exp_grooming ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_grooming FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_grooming_isolation ON exp_grooming
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Los servicios del grooming, del catálogo del inventario. No texto
-- libre: el bloque B les pone precio y descarga sus insumos, y eso no
-- se puede hacer sobre "baño y corte" escrito a mano.
CREATE TABLE exp_grooming_servicios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grooming_id UUID NOT NULL REFERENCES exp_grooming(id) ON DELETE CASCADE,
  servicio_id UUID REFERENCES inv_servicios(id) ON DELETE SET NULL
                DEFERRABLE INITIALLY DEFERRED,
  descripcion VARCHAR(120) NOT NULL,
  UNIQUE (grooming_id, servicio_id)
);

ALTER TABLE exp_grooming_servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_grooming_servicios FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_grooming_servicios_isolation ON exp_grooming_servicios
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE exp_grooming_hallazgos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grooming_id UUID NOT NULL REFERENCES exp_grooming(id) ON DELETE CASCADE,
  paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  tipo        VARCHAR(30) NOT NULL
                CHECK (tipo IN ('bulto', 'herida', 'parasitos', 'otitis', 'dermatitis',
                                'dolor', 'dientes', 'otro')),
  descripcion VARCHAR(250) NOT NULL,
  /* Mientras `atendido_en` sea NULL, el hallazgo está en la franja de
     alertas del paciente y en los avisos del médico. */
  atendido_en TIMESTAMPTZ,
  atendido_por UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  atencion_id UUID REFERENCES atenciones(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exp_hallazgos_pendientes ON exp_grooming_hallazgos (tenant_id, paciente_id)
  WHERE atendido_en IS NULL;

ALTER TABLE exp_grooming_hallazgos ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_grooming_hallazgos FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_grooming_hallazgos_isolation ON exp_grooming_hallazgos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 6. CONSENTIMIENTOS
--
-- La plantilla es de la clínica; el consentimiento firmado guarda el
-- TEXTO CONGELADO con el que se firmó. Si después se corrige la
-- plantilla, lo que el cliente firmó no cambia — es el mismo principio
-- que el receptor de una factura, y acá importa más: es el documento
-- que la clínica muestra si alguien reclama.
-- ---------------------------------------------------------------------
CREATE TABLE exp_plantillas_consentimiento (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo        VARCHAR(30) NOT NULL,
  titulo      VARCHAR(120) NOT NULL,
  /* El cuerpo con marcadores {{paciente}}, {{cliente}}, {{fecha}}… */
  cuerpo      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tipo, titulo)
);

ALTER TABLE exp_plantillas_consentimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_plantillas_consentimiento FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_plantillas_consentimiento_isolation ON exp_plantillas_consentimiento
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE exp_consentimientos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id   UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  atencion_id   UUID REFERENCES atenciones(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  plantilla_id  UUID REFERENCES exp_plantillas_consentimiento(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  titulo        VARCHAR(120) NOT NULL,
  texto         TEXT NOT NULL,
  firmante_nombre VARCHAR(160) NOT NULL,
  firmante_identificacion VARCHAR(30),
  /* La firma dibujada, como PNG en base64. Va en la fila y no en
     `archivos` porque es parte del documento, no un adjunto: el PDF se
     arma con ella y sin ella el consentimiento no vale. */
  firma_png     TEXT NOT NULL,
  firmado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  testigo_id    UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  pdf_archivo_id UUID REFERENCES archivos(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exp_consentimientos_paciente
  ON exp_consentimientos (paciente_id, firmado_en DESC);

ALTER TABLE exp_consentimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_consentimientos FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_consentimientos_isolation ON exp_consentimientos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- UN CONSENTIMIENTO FIRMADO NO SE EDITA NI SE BORRA.
--
-- Es la misma clase de registro que un arqueo de caja o un movimiento
-- de inventario: existe para poder mostrarlo después. Si se firmó mal,
-- se firma otro.
CREATE OR REPLACE FUNCTION exp_consentimiento_inmutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un consentimiento firmado no se borra: es el documento que respalda el procedimiento. Si está mal, se firma otro.';
  END IF;
  -- Lo único que puede cambiar después de firmar es el PDF generado.
  IF NEW.texto <> OLD.texto OR NEW.firma_png <> OLD.firma_png
     OR NEW.firmante_nombre <> OLD.firmante_nombre OR NEW.firmado_en <> OLD.firmado_en THEN
    RAISE EXCEPTION 'Un consentimiento firmado no se modifica. Solo se le puede adjuntar el PDF generado.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER exp_consentimiento_inmutable
  BEFORE UPDATE OR DELETE ON exp_consentimientos
  FOR EACH ROW EXECUTE FUNCTION exp_consentimiento_inmutable();

-- ---------------------------------------------------------------------
-- 7. ADENDAS: la integridad del registro médico
--
-- Una atención cerrada no se edita. Lo que se le agrega es una adenda
-- con autor, fecha y motivo, y el original queda.
--
-- Las columnas de cierre y firma de `atenciones` se agregan ACÁ y no en
-- el bloque B porque la regla es del expediente (sección 1), no del
-- cobro: una atención vieja sin SOAP igual se cierra y se firma.
-- ---------------------------------------------------------------------
ALTER TABLE atenciones
  ADD COLUMN IF NOT EXISTS estado VARCHAR(12) NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'cerrada', 'anulada')),
  ADD COLUMN IF NOT EXISTS cerrada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS firmada_por UUID REFERENCES personas(id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS firmada_nombre VARCHAR(160);

COMMENT ON COLUMN atenciones.firmada_nombre IS
  'Copia del nombre del médico que firmó. El registro médico tiene que poder leerse dentro de diez años aunque esa persona ya no esté en la clínica.';

-- Las atenciones que ya existían quedan CERRADAS: son visitas del
-- pasado, nadie las está escribiendo. Dejarlas en borrador habría hecho
-- que apareciera media clínica como "atención en curso".
UPDATE atenciones SET estado = 'cerrada', cerrada_en = creado_en WHERE estado = 'borrador';

CREATE TABLE exp_adendas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  atencion_id UUID NOT NULL REFERENCES atenciones(id) ON DELETE CASCADE,
  motivo      VARCHAR(200) NOT NULL,
  texto       TEXT NOT NULL,
  autor_id    UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  autor_nombre VARCHAR(160),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exp_adendas_atencion ON exp_adendas (atencion_id, creado_en);

ALTER TABLE exp_adendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_adendas FORCE ROW LEVEL SECURITY;
CREATE POLICY exp_adendas_isolation ON exp_adendas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- UNA ADENDA TAMPOCO SE EDITA: si hiciera falta corregirla, se escribe
-- otra. Un historial de correcciones que se puede corregir no es un
-- historial.
CREATE OR REPLACE FUNCTION exp_adenda_solo_agregar() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Una adenda no se modifica ni se borra. Si hace falta corregirla, se agrega otra.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER exp_adenda_solo_agregar
  BEFORE UPDATE OR DELETE ON exp_adendas
  FOR EACH ROW EXECUTE FUNCTION exp_adenda_solo_agregar();

-- ---------------------------------------------------------------------
-- 8. UNA ATENCIÓN CERRADA NO SE EDITA
--
-- Con una excepción estrecha y dicha: las columnas del CIERRE mismo
-- (estado, cerrada_en, firmada_por, firmada_nombre) y el vínculo a la
-- cuenta que el bloque B agrega. Todo lo clínico queda congelado.
--
-- Igual que en el facturador y en inventario, la operación directa se
-- distingue de la cascada de la purga: sin eso, borrar una clínica
-- fallaría al llegar a sus atenciones.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exp_atencion_cerrada_inmutable() RETURNS trigger AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'cerrada' THEN
      RAISE EXCEPTION 'La atención del % no se borra: es un registro médico cerrado. Se anula o se le agrega una adenda.', to_char(OLD.creado_en, 'DD/MM/YYYY');
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.estado = 'cerrada' THEN
    IF NEW.nota_medica IS DISTINCT FROM OLD.nota_medica
       OR NEW.peso IS DISTINCT FROM OLD.peso
       OR NEW.temperatura IS DISTINCT FROM OLD.temperatura
       OR NEW.paciente_id IS DISTINCT FROM OLD.paciente_id
       OR NEW.medico_id IS DISTINCT FROM OLD.medico_id THEN
      RAISE EXCEPTION 'La atención ya está cerrada y firmada: no se edita. Agregale una adenda con el motivo.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER exp_atencion_cerrada_inmutable
  BEFORE UPDATE OR DELETE ON atenciones
  FOR EACH ROW EXECUTE FUNCTION exp_atencion_cerrada_inmutable();

-- ---------------------------------------------------------------------
-- 9. Semilla del catálogo de analitos
--
-- Los de uso diario en una clínica de perros y gatos, con rangos de
-- referencia por especie. Es un catálogo global y chico a propósito:
-- lo que no está se carga como texto en el resultado y se grafica
-- cuando alguien lo agregue acá.
-- ---------------------------------------------------------------------
INSERT INTO exp_analitos (codigo, nombre, unidad, especie, ref_min, ref_max, grupo, orden) VALUES
  ('HTO',  'Hematocrito',            '%',      'perro', 37, 55, 'hemograma', 1),
  ('HTO',  'Hematocrito',            '%',      'gato',  30, 45, 'hemograma', 1),
  ('HB',   'Hemoglobina',            'g/dL',   'perro', 12, 18, 'hemograma', 2),
  ('HB',   'Hemoglobina',            'g/dL',   'gato',   8, 15, 'hemograma', 2),
  ('LEU',  'Leucocitos',             '10^3/uL','perro',  6, 17, 'hemograma', 3),
  ('LEU',  'Leucocitos',             '10^3/uL','gato',  5.5, 19.5, 'hemograma', 3),
  ('PLQ',  'Plaquetas',              '10^3/uL','perro', 200, 500, 'hemograma', 4),
  ('PLQ',  'Plaquetas',              '10^3/uL','gato',  300, 800, 'hemograma', 4),
  ('CREA', 'Creatinina',             'mg/dL',  'perro', 0.5, 1.5, 'quimica', 10),
  ('CREA', 'Creatinina',             'mg/dL',  'gato',  0.8, 2.4, 'quimica', 10),
  ('BUN',  'Nitrógeno ureico (BUN)', 'mg/dL',  'perro',  7, 27, 'quimica', 11),
  ('BUN',  'Nitrógeno ureico (BUN)', 'mg/dL',  'gato',  16, 36, 'quimica', 11),
  ('ALT',  'ALT',                    'U/L',    'perro', 10, 100, 'quimica', 12),
  ('ALT',  'ALT',                    'U/L',    'gato',  20, 100, 'quimica', 12),
  ('FA',   'Fosfatasa alcalina',     'U/L',    'perro', 23, 212, 'quimica', 13),
  ('FA',   'Fosfatasa alcalina',     'U/L',    'gato',  14,  71, 'quimica', 13),
  ('GLU',  'Glucosa',                'mg/dL',  'perro', 70, 120, 'quimica', 14),
  ('GLU',  'Glucosa',                'mg/dL',  'gato',  70, 150, 'quimica', 14),
  ('ALB',  'Albúmina',               'g/dL',   'perro', 2.6, 4.0, 'quimica', 15),
  ('ALB',  'Albúmina',               'g/dL',   'gato',  2.5, 3.9, 'quimica', 15),
  ('T4',   'T4 total',               'ug/dL',  'gato',  0.8, 4.0, 'endocrino', 20),
  ('DGO',  'Densidad urinaria',      '',       'perro', 1.015, 1.045, 'urianalisis', 30),
  ('DGO',  'Densidad urinaria',      '',       'gato',  1.035, 1.060, 'urianalisis', 30)
ON CONFLICT (codigo, especie) DO NOTHING;
