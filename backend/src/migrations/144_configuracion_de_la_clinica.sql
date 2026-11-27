-- ---------------------------------------------------------------------
-- 144 — HORARIOS, FERIADOS, TIPOS DE CITA Y NUMERACIONES
--       (prompt 04, sección 3)
--
-- Lo que el relevamiento encontró y que no existía:
--
--   * **horario de la CLÍNICA**: solo había `horarios_configuracion`
--     por médico, así que la clínica como tal no tenía horario y la
--     agenda no tenía contra qué comparar;
--   * **feriados y bloqueos**: nada;
--   * **tipos de cita**: nada. `citas` no tiene ninguna columna de tipo;
--   * **numeraciones con prefijo**: los consecutivos se calculaban con
--     `max(numero)+1` por tabla y el del expediente vivía en
--     `tenants.paciente_expediente_ultimo_numero`. Sin prefijo y sin un
--     lugar donde verlos.
--
-- LO QUE SÍ EXISTE SE REUSA: las salas (`salas`, de la agenda de
-- Vetline Ai) y el horario por médico. Esta migración no los duplica.
--
-- LOS CONSECUTIVOS DE HACIENDA NO SE TOCAN: los controla
-- `fact_consecutivos` y el prompt lo dice explícitamente.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- EL HORARIO DE LA CLÍNICA.
--
-- Uno por día de la semana, con sus bloques. Mismo formato de bloques
-- que `horarios_configuracion` —un jsonb de `{desde, hasta}`— para que
-- la agenda los compare sin traducir.
--
-- EL DE LA CLÍNICA ES EL MARCO Y EL DEL MÉDICO VA ADENTRO. Si la
-- clínica abre de 8 a 17 y un médico declara de 7 a 20, sus citas
-- válidas son de 8 a 17: nadie atiende con la clínica cerrada.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinica_horario (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* 0 = domingo, como `horarios_configuracion` y como `EXTRACT(DOW)`. */
  dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  /* [{"desde":"08:00","hasta":"12:00"},{"desde":"14:00","hasta":"18:00"}] */
  bloques   JSONB NOT NULL DEFAULT '[]'::jsonb,
  /* Un día sin bloques y `abierto = false` es «cerrado»; con `abierto`
     en true y sin bloques, está mal configurado y la agenda lo dice. */
  abierto   BOOLEAN NOT NULL DEFAULT true,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinica_horario_dia
  ON clinica_horario (tenant_id, dia_semana);

ALTER TABLE clinica_horario ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinica_horario FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinica_horario_tenant ON clinica_horario;
CREATE POLICY clinica_horario_tenant ON clinica_horario
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE clinica_horario IS
  'El horario semanal de la clínica. Es el marco: el horario de cada médico va adentro (prompt 04, §3).';

-- ---------------------------------------------------------------------
-- LAS EXCEPCIONES: feriados, vacaciones y bloqueos puntuales.
--
-- UNA SOLA TABLA para las tres cosas, porque las tres contestan la
-- misma pregunta —«¿se puede citar el 25 de diciembre a las 10?»— y
-- tres tablas serían tres lugares donde buscar la respuesta.
--
-- `medico_id` NULL = de toda la clínica. Con médico, es la vacación o
-- el bloqueo de esa persona.
--
-- LOS FERIADOS DE COSTA RICA VIENEN PRECARGADOS Y SON EDITABLES, como
-- pide el prompt: hay clínicas que abren el 1.º de mayo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinica_excepciones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* 'feriado', 'vacaciones', 'bloqueo'. */
  tipo      VARCHAR(20) NOT NULL,
  nombre    VARCHAR(120) NOT NULL,
  desde     DATE NOT NULL,
  hasta     DATE NOT NULL,
  /* Para un bloqueo de unas horas y no de todo el día. NULL = todo el día. */
  hora_desde TIME,
  hora_hasta TIME,
  /* NULL = toda la clínica. */
  medico_id UUID REFERENCES personas(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* Un feriado que la clínica trabaja: se deja la fila para que se vea
     en el calendario, y no bloquea. */
  bloquea   BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clinica_excepciones_tipo_check CHECK (tipo IN ('feriado', 'vacaciones', 'bloqueo')),
  CONSTRAINT clinica_excepciones_rango_check CHECK (hasta >= desde),
  /* Las horas van juntas o no van: media hora de bloqueo no se entiende. */
  CONSTRAINT clinica_excepciones_horas_check CHECK ((hora_desde IS NULL) = (hora_hasta IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_clinica_excepciones_fecha
  ON clinica_excepciones (tenant_id, desde, hasta);

ALTER TABLE clinica_excepciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinica_excepciones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinica_excepciones_tenant ON clinica_excepciones;
CREATE POLICY clinica_excepciones_tenant ON clinica_excepciones
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE clinica_excepciones IS
  'Feriados, vacaciones y bloqueos. Una sola tabla porque las tres contestan la misma pregunta (prompt 04, §3).';

-- ---------------------------------------------------------------------
-- LOS TIPOS DE CITA.
--
-- No existían: `citas` no tiene columna de tipo. Con esto, agendar
-- «Consulta general» trae su duración, su color, su sala sugerida y el
-- servicio del catálogo que la atención va a precargar.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tipos_cita (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nombre    VARCHAR(80) NOT NULL,
  duracion_minutos SMALLINT NOT NULL DEFAULT 30 CHECK (duracion_minutos > 0),
  /* Hex, para el calendario. */
  color     VARCHAR(7),
  sala_id   UUID REFERENCES salas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  linea_negocio VARCHAR(40) REFERENCES lineas_negocio(codigo)
              DEFERRABLE INITIALLY DEFERRED,
  /* El servicio que la atención precarga: es lo que convierte un tipo
     de cita en algo que además se cobra sin volver a elegirlo. */
  servicio_id UUID REFERENCES inv_servicios(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  activo    BOOLEAN NOT NULL DEFAULT true,
  orden     SMALLINT NOT NULL DEFAULT 100,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tipos_cita_nombre
  ON tipos_cita (tenant_id, nombre);

ALTER TABLE tipos_cita ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_cita FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tipos_cita_tenant ON tipos_cita;
CREATE POLICY tipos_cita_tenant ON tipos_cita
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- La cita puede decir de qué tipo es. Opcional: las que ya existen no
-- lo tienen y no se puede inventar.
ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS tipo_cita_id UUID REFERENCES tipos_cita(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  /* Quién autorizó citar fuera de horario, y por qué. El prompt pide
     que quede registrado. */
  ADD COLUMN IF NOT EXISTS fuera_de_horario_por UUID REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS fuera_de_horario_motivo VARCHAR(200);

COMMENT ON COLUMN citas.fuera_de_horario_por IS
  'Quién autorizó citar fuera del horario o sobre un bloqueo. Queda registrado porque es una excepción a una política (prompt 04, §3).';

-- ---------------------------------------------------------------------
-- LAS NUMERACIONES.
--
-- Prefijo y siguiente número, en un lugar donde se ven. Hoy el
-- expediente usa `tenants.paciente_expediente_ultimo_numero` y las
-- demás calculan `max(numero)+1` con un lock; esta tabla **no cambia
-- esos cálculos todavía**: existe para que la pantalla pueda mostrar y
-- fijar el prefijo y el siguiente número, y para que el día que se
-- unifiquen haya un solo lugar.
--
-- Lo digo así de claro porque la alternativa —cambiar hoy los cuatro
-- consecutivos para que lean de acá— toca el alta de pacientes, la
-- apertura de cuentas, los presupuestos y las órdenes de compra en la
-- misma entrega que cambia el modelo de permisos. Eso es cómo se rompe
-- la numeración de una clínica en producción.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinica_numeraciones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* 'expediente', 'presupuesto', 'recibo', 'anticipo'. */
  documento VARCHAR(30) NOT NULL,
  prefijo   VARCHAR(10),
  /* Solo informativo mientras cada módulo siga calculando el suyo. */
  siguiente INTEGER NOT NULL DEFAULT 1 CHECK (siguiente > 0),
  /* Con cuántos dígitos se muestra: `VET-00042`. */
  digitos   SMALLINT NOT NULL DEFAULT 1 CHECK (digitos BETWEEN 1 AND 12),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clinica_numeraciones_documento_check CHECK (
    documento IN ('expediente', 'presupuesto', 'recibo', 'anticipo')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinica_numeraciones
  ON clinica_numeraciones (tenant_id, documento);

ALTER TABLE clinica_numeraciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinica_numeraciones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinica_numeraciones_tenant ON clinica_numeraciones;
CREATE POLICY clinica_numeraciones_tenant ON clinica_numeraciones
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE clinica_numeraciones IS
  'Prefijo y dígitos de cada documento interno. El siguiente número lo sigue calculando cada módulo: unificar los cuatro consecutivos es un cambio aparte (prompt 04, §3).';

-- ---------------------------------------------------------------------
-- LOS FERIADOS DE COSTA RICA, precargados para cada clínica.
--
-- Son los de la Ley 2412 y sus reformas, en su fecha de calendario. Los
-- que la ley traslada a lunes se cargan en su fecha original y la
-- clínica los mueve si los traslada: trasladarlos nosotros exigiría
-- implementar la regla de traslado de cada año, y equivocarse ahí es
-- cerrar la clínica un día que estaba abierta.
--
-- Son de 2026 y 2027. Los de los años siguientes se cargan desde la
-- pantalla, y el informe anota que esto necesita o un job anual o una
-- fuente: inventar diez años de feriados ahora sería inventarlos.
-- ---------------------------------------------------------------------
INSERT INTO clinica_excepciones (tenant_id, tipo, nombre, desde, hasta, bloquea)
SELECT t.id, 'feriado', v.nombre, v.fecha::date, v.fecha::date, true
  FROM tenants t
  CROSS JOIN (VALUES
    ('Año nuevo',                     '2026-01-01'),
    ('Día de Juan Santamaría',        '2026-04-11'),
    ('Jueves Santo',                  '2026-04-02'),
    ('Viernes Santo',                 '2026-04-03'),
    ('Día del Trabajador',            '2026-05-01'),
    ('Anexión del Partido de Nicoya', '2026-07-25'),
    ('Día de la Virgen de los Ángeles','2026-08-02'),
    ('Día de la Madre',               '2026-08-15'),
    ('Día de la Persona Negra y la Cultura Afrocostarricense', '2026-08-31'),
    ('Día de la Independencia',       '2026-09-15'),
    ('Día de las Culturas',           '2026-12-01'),
    ('Navidad',                       '2026-12-25'),
    ('Año nuevo',                     '2027-01-01'),
    ('Día de Juan Santamaría',        '2027-04-11'),
    ('Jueves Santo',                  '2027-03-25'),
    ('Viernes Santo',                 '2027-03-26'),
    ('Día del Trabajador',            '2027-05-01'),
    ('Anexión del Partido de Nicoya', '2027-07-25'),
    ('Día de la Virgen de los Ángeles','2027-08-02'),
    ('Día de la Madre',               '2027-08-15'),
    ('Día de la Persona Negra y la Cultura Afrocostarricense', '2027-08-31'),
    ('Día de la Independencia',       '2027-09-15'),
    ('Día de las Culturas',           '2027-12-01'),
    ('Navidad',                       '2027-12-25')
  ) AS v(nombre, fecha)
 WHERE NOT EXISTS (
   SELECT 1 FROM clinica_excepciones e
    WHERE e.tenant_id = t.id AND e.tipo = 'feriado' AND e.desde = v.fecha::date
 );

-- Un horario inicial de lunes a viernes de 8 a 17 y sábado de 8 a 12,
-- para que la agenda tenga contra qué comparar desde el primer día. Es
-- editable y es lo que una clínica de barrio hace.
INSERT INTO clinica_horario (tenant_id, dia_semana, bloques, abierto)
SELECT t.id, v.dia, v.bloques::jsonb, v.abierto
  FROM tenants t
  CROSS JOIN (VALUES
    (0, '[]', false),
    (1, '[{"desde":"08:00","hasta":"17:00"}]', true),
    (2, '[{"desde":"08:00","hasta":"17:00"}]', true),
    (3, '[{"desde":"08:00","hasta":"17:00"}]', true),
    (4, '[{"desde":"08:00","hasta":"17:00"}]', true),
    (5, '[{"desde":"08:00","hasta":"17:00"}]', true),
    (6, '[{"desde":"08:00","hasta":"12:00"}]', true)
  ) AS v(dia, bloques, abierto)
 WHERE NOT EXISTS (
   SELECT 1 FROM clinica_horario h WHERE h.tenant_id = t.id AND h.dia_semana = v.dia
 );
