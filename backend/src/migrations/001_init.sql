-- =====================================================================
-- VetPlatform — Migración inicial (Fase 1)
-- 15 tablas: 14 con lógica de negocio + staff_plataforma, con Row-Level
-- Security activa en todas las tablas que llevan tenant_id, directo o
-- heredado a través de una tabla padre.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. tenants — cada clínica veterinaria
-- ---------------------------------------------------------------------
CREATE TABLE tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       VARCHAR(200) NOT NULL,
  pais         VARCHAR(100) NOT NULL,
  ciudad       VARCHAR(100),
  idioma       VARCHAR(20) NOT NULL DEFAULT 'es',
  plan         VARCHAR(50) NOT NULL DEFAULT 'profesional',
  logo_url     TEXT,
  telefono     VARCHAR(50),
  email        VARCHAR(200),
  direccion    VARCHAR(300),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. agentes — catálogo global de agentes de IA (no pertenece a un tenant)
-- ---------------------------------------------------------------------
CREATE TABLE agentes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       VARCHAR(150) NOT NULL,
  slug         VARCHAR(100) NOT NULL UNIQUE,
  descripcion  TEXT,
  icono        VARCHAR(50),
  estado_catalogo VARCHAR(20) NOT NULL DEFAULT 'disponible'
               CHECK (estado_catalogo IN ('disponible', 'proximamente')),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. tenant_agentes — habilitación de un agente para un tenant
-- ---------------------------------------------------------------------
CREATE TABLE tenant_agentes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agente_id    UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  estado       VARCHAR(30) NOT NULL DEFAULT 'habilitado'
               CHECK (estado IN ('habilitado', 'deshabilitado', 'solicitud_pendiente')),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agente_id)
);

-- ---------------------------------------------------------------------
-- 4. personas — usuarios de una clínica (médicos y/o admins de clínica)
-- ---------------------------------------------------------------------
CREATE TABLE personas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre           VARCHAR(200) NOT NULL,
  email            VARCHAR(200) NOT NULL UNIQUE,
  password_hash    VARCHAR(200) NOT NULL,
  es_admin_clinica BOOLEAN NOT NULL DEFAULT false,
  colegiatura      VARCHAR(50),
  estado           VARCHAR(20) NOT NULL DEFAULT 'activo'
                   CHECK (estado IN ('activo', 'inactivo')),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. medico_agente — especialidades habilitadas para un médico
--    (un médico puede tener más de una fila: valida multi-especialidad)
-- ---------------------------------------------------------------------
CREATE TABLE medico_agente (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id   UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  agente_id    UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  rol          VARCHAR(30) NOT NULL DEFAULT 'general'
               CHECK (rol IN ('general', 'especialista')),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (persona_id, agente_id)
);

-- ---------------------------------------------------------------------
-- 6. propietarios — dueños de mascotas
-- ---------------------------------------------------------------------
CREATE TABLE propietarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre       VARCHAR(200) NOT NULL,
  telefono     VARCHAR(50),
  email        VARCHAR(200),
  direccion    VARCHAR(300),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 7. pacientes — mascotas
-- ---------------------------------------------------------------------
CREATE TABLE pacientes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
  nombre         VARCHAR(150) NOT NULL,
  especie        VARCHAR(50) NOT NULL,
  raza           VARCHAR(100),
  sexo           VARCHAR(20),
  edad_anios     NUMERIC(4,1),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 8. casos — casos clínicos
-- ---------------------------------------------------------------------
CREATE TABLE casos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id            UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  agente_id              UUID NOT NULL REFERENCES agentes(id),
  medico_id              UUID NOT NULL REFERENCES personas(id),
  motivo                 TEXT NOT NULL,
  estado                 VARCHAR(30) NOT NULL DEFAULT 'triage'
                         CHECK (estado IN ('triage', 'en_curso', 'completado')),
  severidad              VARCHAR(30) NOT NULL DEFAULT 'estable'
                         CHECK (severidad IN
                           ('estable', 'en_observacion', 'investigacion_en_curso',
                            'requiere_derivacion', 'critico')),
  confianza_diagnostica  NUMERIC(5,2),
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 9. mensajes — mensajería del caso (médico <-> agente IA)
-- ---------------------------------------------------------------------
CREATE TABLE mensajes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id      UUID NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  remitente    VARCHAR(20) NOT NULL CHECK (remitente IN ('medico', 'ai')),
  contenido    TEXT NOT NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 10. archivos — adjuntos de un caso o de un mensaje puntual
-- ---------------------------------------------------------------------
CREATE TABLE archivos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id        UUID NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  mensaje_id     UUID REFERENCES mensajes(id) ON DELETE SET NULL,
  nombre_archivo VARCHAR(300) NOT NULL,
  tipo           VARCHAR(50),
  url            TEXT NOT NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 11. derivaciones — alertas de derivación a especialidad
-- ---------------------------------------------------------------------
CREATE TABLE derivaciones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id               UUID NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  especialidad_sugerida VARCHAR(150) NOT NULL,
  prioridad             VARCHAR(20) NOT NULL DEFAULT 'media'
                        CHECK (prioridad IN ('baja', 'media', 'alta')),
  motivo                TEXT,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 12. informes — reportes generados a partir de un caso
-- ---------------------------------------------------------------------
CREATE TABLE informes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id      UUID NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  tipo         VARCHAR(30) NOT NULL DEFAULT 'informe_consulta'
               CHECK (tipo IN
                 ('informe_consulta', 'reporte_seguimiento', 'segunda_opinion',
                  'informe_derivacion')),
  contenido    TEXT,
  generado_por UUID REFERENCES personas(id),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 13. solicitudes_activacion — solicitudes de habilitación de un agente
-- ---------------------------------------------------------------------
CREATE TABLE solicitudes_activacion (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agente_id        UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  estado           VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  motivo_rechazo   TEXT,
  solicitado_por   UUID REFERENCES personas(id),
  revisado_por     UUID, -- FK lógica a staff_plataforma (definida más abajo)
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revisado_en      TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- 14. bitacora_auditoria — log de auditoría de toda la plataforma
--     (tenant_id nullable: acciones de staff_plataforma no tienen tenant)
-- ---------------------------------------------------------------------
CREATE TABLE bitacora_auditoria (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id   UUID REFERENCES personas(id),
  staff_id     UUID, -- FK lógica a staff_plataforma (definida más abajo)
  accion       VARCHAR(100) NOT NULL,
  entidad      VARCHAR(100) NOT NULL,
  entidad_id   UUID,
  detalle      JSONB,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 15. staff_plataforma — equipo interno de VetPlatform (sin tenant)
-- ---------------------------------------------------------------------
CREATE TABLE staff_plataforma (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(200) NOT NULL,
  email          VARCHAR(200) NOT NULL UNIQUE,
  password_hash  VARCHAR(200) NOT NULL,
  rol            VARCHAR(30) NOT NULL DEFAULT 'soporte'
                 CHECK (rol IN ('super_admin', 'soporte')),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FKs lógicas hacia staff_plataforma (se agregan después de crearla)
ALTER TABLE solicitudes_activacion
  ADD CONSTRAINT fk_solicitudes_revisado_por
  FOREIGN KEY (revisado_por) REFERENCES staff_plataforma(id);

ALTER TABLE bitacora_auditoria
  ADD CONSTRAINT fk_bitacora_staff_id
  FOREIGN KEY (staff_id) REFERENCES staff_plataforma(id);

-- =====================================================================
-- ROW-LEVEL SECURITY
-- Convención: app.tenant_id se setea por request en el middleware de
-- autenticación (SET LOCAL). Tablas con tenant_id directo comparan la
-- columna; tablas que heredan el tenant vía FK usan un EXISTS contra el
-- padre. Staff de plataforma NO setea app.tenant_id — sus rutas no
-- pasan por RLS de tenant (acceden vía el pool sin este filtro, o bien
-- app.tenant_id queda '' y ninguna fila matchea, por lo que staff debe
-- usar sus propias queries administrativas explícitas, no depender de RLS).
-- =====================================================================

-- --- Tablas con tenant_id directo ---
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
  USING (id::text = current_setting('app.tenant_id', true));

ALTER TABLE tenant_agentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_agentes_isolation ON tenant_agentes
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY personas_isolation ON personas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE propietarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY propietarios_isolation ON propietarios
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE pacientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY pacientes_isolation ON pacientes
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE casos ENABLE ROW LEVEL SECURITY;
CREATE POLICY casos_isolation ON casos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE solicitudes_activacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY solicitudes_activacion_isolation ON solicitudes_activacion
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE bitacora_auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY bitacora_auditoria_isolation ON bitacora_auditoria
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

-- --- Tablas con tenant_id heredado vía FK ---
ALTER TABLE medico_agente ENABLE ROW LEVEL SECURITY;
CREATE POLICY medico_agente_isolation ON medico_agente
  USING (
    EXISTS (
      SELECT 1 FROM personas p
      WHERE p.id = medico_agente.persona_id
        AND p.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE mensajes ENABLE ROW LEVEL SECURITY;
CREATE POLICY mensajes_isolation ON mensajes
  USING (
    EXISTS (
      SELECT 1 FROM casos c
      WHERE c.id = mensajes.caso_id
        AND c.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE archivos ENABLE ROW LEVEL SECURITY;
CREATE POLICY archivos_isolation ON archivos
  USING (
    EXISTS (
      SELECT 1 FROM casos c
      WHERE c.id = archivos.caso_id
        AND c.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE derivaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY derivaciones_isolation ON derivaciones
  USING (
    EXISTS (
      SELECT 1 FROM casos c
      WHERE c.id = derivaciones.caso_id
        AND c.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE informes ENABLE ROW LEVEL SECURITY;
CREATE POLICY informes_isolation ON informes
  USING (
    EXISTS (
      SELECT 1 FROM casos c
      WHERE c.id = informes.caso_id
        AND c.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

-- --- Tablas SIN tenant_id (no llevan RLS de tenant) ---
-- agentes: catálogo global, visible para todos los tenants.
-- staff_plataforma: solo accedida por rutas de staff (sin filtro de tenant).

-- =====================================================================
-- Índices de soporte
-- =====================================================================
CREATE INDEX idx_personas_tenant ON personas(tenant_id);
CREATE INDEX idx_pacientes_tenant ON pacientes(tenant_id);
CREATE INDEX idx_casos_tenant ON casos(tenant_id);
CREATE INDEX idx_casos_paciente ON casos(paciente_id);
CREATE INDEX idx_mensajes_caso ON mensajes(caso_id);
CREATE INDEX idx_medico_agente_persona ON medico_agente(persona_id);
CREATE INDEX idx_solicitudes_tenant ON solicitudes_activacion(tenant_id);
CREATE INDEX idx_bitacora_tenant ON bitacora_auditoria(tenant_id);
