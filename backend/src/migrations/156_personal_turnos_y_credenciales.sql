-- ---------------------------------------------------------------------
-- 156 — TURNOS, AUSENCIAS Y CREDENCIALES (prompt 11, §2)
--
-- EL TURNO NO ES EL HORARIO. El horario del médico
-- (`horarios_configuracion`, de Vetline Ai) dice **cuándo puede**
-- atender: «los lunes de 8 a 17». El turno dice **cuándo le toca**: «el
-- lunes 7 de diciembre, de 8 a 13, la Dra. Mora». Son dos preguntas
-- distintas y por eso son dos tablas: una clínica con tres médicos y un
-- consultorio necesita las dos.
--
-- LAS AUSENCIAS NO SON UNA TABLA NUEVA. `clinica_excepciones` del 04 ya
-- bloquea la agenda por médico, con su nivel y su motivo, y la agenda ya
-- la consulta. Crear `personal_ausencias` significaría que la agenda
-- tendría que mirar dos tablas y que un día una diga que sí y la otra
-- que no. Lo que le falta es la **aprobación**, y eso son tres columnas.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS personal_turnos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  fecha     DATE NOT NULL,
  hora_desde TIME NOT NULL,
  hora_hasta TIME NOT NULL,
  /* `guardia` es el turno de disponibilidad fuera del horario normal:
     cuenta para la planilla y NO abre la agenda. */
  tipo      VARCHAR(12) NOT NULL DEFAULT 'turno'
              CHECK (tipo IN ('turno', 'guardia')),
  nota      VARCHAR(120),
  creado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_turnos_horas CHECK (hora_hasta > hora_desde)
);

-- Una persona no puede tener dos turnos del mismo tipo que empiecen a la
-- misma hora el mismo día: es un doble clic, no dos turnos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_turnos_unico
  ON personal_turnos (persona_id, fecha, hora_desde, tipo);
CREATE INDEX IF NOT EXISTS idx_personal_turnos_fecha
  ON personal_turnos (tenant_id, fecha);

-- --- La aprobación de las ausencias, sobre la tabla que ya existe ----
ALTER TABLE clinica_excepciones
  ADD COLUMN IF NOT EXISTS estado VARCHAR(12) NOT NULL DEFAULT 'aprobada'
    CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  ADD COLUMN IF NOT EXISTS solicitado_por UUID REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS aprobado_por UUID REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS aprobado_en TIMESTAMPTZ;

COMMENT ON COLUMN clinica_excepciones.estado IS
  'Las ausencias del personal (prompt 11) se piden y se aprueban. El default es aprobada porque los feriados y los bloqueos de la clínica no se piden: los pone el administrador.';

-- UNA AUSENCIA PENDIENTE NO BLOQUEA LA AGENDA. Lo que bloquea es
-- `bloquea = true`, y eso lo decide la aprobación: pedir vacaciones no
-- puede cerrarle la agenda a nadie antes de que se las aprueben.
UPDATE clinica_excepciones SET estado = 'aprobada' WHERE estado IS NULL;

-- --- Credenciales con vencimiento ------------------------------------
--
-- La colegiatura, la licencia de regencia, la de radiología. Lo que
-- importa es **cuándo vence** y que alguien se entere antes.
--
-- `personas.colegiatura` ya existe y se queda: es el número que se
-- imprime en la receta y lo lee medio sistema. Acá se guarda su
-- vencimiento, que es lo que no existía.
CREATE TABLE IF NOT EXISTS personal_credenciales (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  tipo      VARCHAR(40) NOT NULL,
  numero    VARCHAR(60),
  emitida_el DATE,
  vence_el  DATE,
  /* La clave del archivo en el almacenamiento, no el archivo. */
  archivo_clave TEXT,
  /* Cuándo se avisó por última vez, para no avisar todos los días. */
  avisado_en TIMESTAMPTZ,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_credenciales_vence
  ON personal_credenciales (tenant_id, vence_el) WHERE activo;

COMMENT ON TABLE personal_credenciales IS
  'Colegiatura, regencia, radiología y otras credenciales con vencimiento (prompt 11, §2). El número de colegiatura sigue viviendo en personas.colegiatura: acá va su vencimiento.';

SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['personal_turnos', 'personal_credenciales'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t || '_tenant', t
    );
  END LOOP;
END $$;
