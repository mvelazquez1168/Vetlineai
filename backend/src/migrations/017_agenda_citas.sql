-- =====================================================================
-- VetPlatform — Migración 017
-- Módulo de Agenda de Citas. 100% CRUD/SQL, sin IA en ninguna parte.
--
-- NOTA DE DISEÑO (confirmada con el usuario): el mockup original mostraba
-- múltiples "clínicas/sedes" por tenant (pestañas Clínica Centro/Oeste),
-- pero no existe ninguna tabla clinicas/sedes en este esquema — en todo
-- lo construido hasta ahora un tenant_id ES una única clínica. Por eso
-- estas tablas NO llevan clinica_id: usan tenant_id directo, mismo
-- patrón que medicamentos/recetas. "sala" sigue existiendo como
-- concepto (una clínica puede tener varias salas de examen), pero no
-- implica una sede distinta. Soporte real multi-sede queda fuera de
-- este MVP, sería un cambio de modelo de datos deliberado a futuro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- salas — salas de examen/cirugía/dental de la clínica del tenant.
-- ---------------------------------------------------------------------
CREATE TABLE salas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  tipo       TEXT,
  activa     BOOLEAN NOT NULL DEFAULT true,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- horarios_configuracion — turnos semanales por médico, un row por
-- (medico_id, dia_semana). "bloques" es el array de franjas del día
-- (disponible/almuerzo/bloqueado, con etiqueta opcional) tal como lo
-- edita la pantalla de Configuración de Horarios.
-- ---------------------------------------------------------------------
CREATE TABLE horarios_configuracion (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  medico_id                   UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  dia_semana                  SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  bloques                     JSONB NOT NULL DEFAULT '[]',
  activo                      BOOLEAN NOT NULL DEFAULT true,
  max_citas_dia               INTEGER,
  duracion_default_minutos    INTEGER NOT NULL DEFAULT 30,
  buffer_minutos              INTEGER NOT NULL DEFAULT 0,
  acepta_emergencias          BOOLEAN NOT NULL DEFAULT true,
  creado_en                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medico_id, dia_semana)
);

-- ---------------------------------------------------------------------
-- citas
-- propietario_id NO se guarda acá a propósito — pacientes.propietario_id
-- ya existe (NOT NULL) y se deriva vía JOIN, mismo criterio que casos
-- (que tampoco duplica propietario_id). Evita que quede desincronizado
-- si el paciente cambia de propietario.
-- ---------------------------------------------------------------------
CREATE TABLE citas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sala_id            UUID REFERENCES salas(id),
  paciente_id        UUID NOT NULL REFERENCES pacientes(id),
  medico_id          UUID NOT NULL REFERENCES personas(id),
  fecha              DATE NOT NULL,
  hora_inicio        TIME NOT NULL,
  hora_fin           TIME NOT NULL,
  duracion_minutos   INTEGER NOT NULL,
  prioridad          VARCHAR(20) NOT NULL DEFAULT 'normal'
                     CHECK (prioridad IN ('baja', 'normal', 'alta', 'emergencia')),
  motivo_consulta    TEXT,
  estado             VARCHAR(20) NOT NULL DEFAULT 'programada'
                     CHECK (estado IN
                       ('programada', 'confirmada', 'registrada', 'en_consulta',
                        'completada', 'cancelada', 'no_show')),
  motivo_cancelacion TEXT,
  caso_id            UUID REFERENCES casos(id),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- lista_espera
-- cita_id se completa recién cuando POST /lista-espera/:id/agendar crea
-- la cita real y vincula este ítem — no está en la lista de columnas
-- del prompt original pero Fase D pide explícitamente "vinculándolo a
-- la cita creada", así que hace falta la columna para guardar ese link.
-- ---------------------------------------------------------------------
CREATE TABLE lista_espera (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id         UUID NOT NULL REFERENCES pacientes(id),
  medico_preferido_id UUID REFERENCES personas(id),
  motivo              TEXT NOT NULL,
  prioridad           VARCHAR(10) NOT NULL DEFAULT 'media'
                      CHECK (prioridad IN ('baja', 'media', 'alta')),
  fecha_solicitud     DATE NOT NULL DEFAULT CURRENT_DATE,
  estado              VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'agendada', 'cancelada')),
  cita_id             UUID REFERENCES citas(id),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- RLS — mismo patrón exacto que el resto del esquema.
-- ---------------------------------------------------------------------
ALTER TABLE salas ENABLE ROW LEVEL SECURITY;
CREATE POLICY salas_isolation ON salas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE horarios_configuracion ENABLE ROW LEVEL SECURITY;
CREATE POLICY horarios_configuracion_isolation ON horarios_configuracion
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE citas ENABLE ROW LEVEL SECURITY;
CREATE POLICY citas_isolation ON citas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE lista_espera ENABLE ROW LEVEL SECURITY;
CREATE POLICY lista_espera_isolation ON lista_espera
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE INDEX idx_salas_tenant ON salas(tenant_id);
CREATE INDEX idx_horarios_configuracion_medico ON horarios_configuracion(medico_id);
CREATE INDEX idx_citas_tenant_fecha ON citas(tenant_id, fecha);
CREATE INDEX idx_citas_medico_fecha ON citas(medico_id, fecha);
CREATE INDEX idx_citas_sala_fecha ON citas(sala_id, fecha);
CREATE INDEX idx_citas_paciente ON citas(paciente_id);
CREATE INDEX idx_lista_espera_tenant_estado ON lista_espera(tenant_id, estado);
