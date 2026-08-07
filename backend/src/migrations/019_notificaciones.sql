-- =====================================================================
-- VetPlatform — Migración 019
-- Módulo de Notificaciones (mock). Común a cualquier agente clínico y a
-- cualquier tenant, sin lógica específica de GCIS/ICIS. El envío real
-- (Resend) queda para una fase posterior: por ahora "notificaciones" es
-- solo el registro de lo que se habría enviado (estado siempre
-- 'simulada' en esta fase).
-- =====================================================================

-- ---------------------------------------------------------------------
-- cuidados_preventivos — historial de cuidados preventivos del paciente.
-- tipo restringido a 'desparasitacion' a propósito por ahora: agregar
-- 'vacunacion' después es un ALTER TABLE de una línea sobre el CHECK, no
-- un rediseño.
-- ---------------------------------------------------------------------
CREATE TABLE cuidados_preventivos (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id              UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  tipo                     VARCHAR(30) NOT NULL DEFAULT 'desparasitacion'
                           CHECK (tipo IN ('desparasitacion')),
  fecha_aplicacion         DATE NOT NULL,
  fecha_proxima_recomendada DATE NOT NULL,
  registrado_por           UUID NOT NULL REFERENCES personas(id),
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- configuracion_notificaciones — un registro por clínica. Umbral de días
-- configurable desde esta primera versión (nunca hardcodeado en el
-- código), aunque todavía no exista una pantalla para editarlo.
-- ---------------------------------------------------------------------
CREATE TABLE configuracion_notificaciones (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  dias_aviso_desparasitacion  INTEGER NOT NULL DEFAULT 7
);

-- ---------------------------------------------------------------------
-- notificaciones — el mock del envío. destinatario_id es genérico
-- (propietarios.id o personas.id según destinatario_tipo, sin FK directa
-- porque puede apuntar a cualquiera de las dos tablas). cita_id y
-- cuidado_preventivo_id son nullable y existen solo para poder deduplicar
-- de forma confiable (una notificación de recordatorio por cita, y no
-- reavisar la misma desparasitación todos los días) sin tener que
-- parsear el texto de "contenido".
-- ---------------------------------------------------------------------
CREATE TABLE notificaciones (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo                   VARCHAR(30) NOT NULL
                         CHECK (tipo IN ('recordatorio_cita', 'desparasitacion_proxima', 'seguimiento_faltante')),
  destinatario_tipo      VARCHAR(20) NOT NULL CHECK (destinatario_tipo IN ('propietario', 'medico')),
  destinatario_id        UUID NOT NULL,
  caso_id                UUID REFERENCES casos(id),
  paciente_id            UUID REFERENCES pacientes(id),
  cita_id                UUID REFERENCES citas(id),
  cuidado_preventivo_id  UUID REFERENCES cuidados_preventivos(id),
  asunto                 TEXT NOT NULL,
  contenido              TEXT NOT NULL,
  estado                 VARCHAR(20) NOT NULL DEFAULT 'simulada'
                         CHECK (estado IN ('simulada', 'enviada', 'fallida')),
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garantiza a nivel de base "una sola notificación de recordatorio por
-- cita, nunca duplicada" incluso si el job corriera dos veces en
-- paralelo — el INSERT del job usa ON CONFLICT DO NOTHING sobre este
-- índice.
CREATE UNIQUE INDEX idx_notificaciones_recordatorio_unico
  ON notificaciones(cita_id)
  WHERE tipo = 'recordatorio_cita' AND cita_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- RLS — mismo patrón exacto que el resto del esquema.
-- ---------------------------------------------------------------------
ALTER TABLE cuidados_preventivos ENABLE ROW LEVEL SECURITY;
CREATE POLICY cuidados_preventivos_isolation ON cuidados_preventivos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE configuracion_notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY configuracion_notificaciones_isolation ON configuracion_notificaciones
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY notificaciones_isolation ON notificaciones
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE INDEX idx_cuidados_preventivos_paciente ON cuidados_preventivos(paciente_id);
CREATE INDEX idx_cuidados_preventivos_tenant_fecha_proxima ON cuidados_preventivos(tenant_id, fecha_proxima_recomendada);
CREATE INDEX idx_notificaciones_tenant_creado ON notificaciones(tenant_id, creado_en DESC);
CREATE INDEX idx_notificaciones_tenant_tipo ON notificaciones(tenant_id, tipo);
CREATE INDEX idx_notificaciones_cuidado_preventivo ON notificaciones(cuidado_preventivo_id);
CREATE INDEX idx_notificaciones_caso ON notificaciones(caso_id);
