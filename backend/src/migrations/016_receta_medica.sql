-- =====================================================================
-- VetPlatform — Migración 016
-- Módulo de Prescripción Médica — transversal a cualquier agente clínico
-- (GCIS, ICIS, u otros a futuro). Ninguna de estas tablas referencia un
-- agente específico: el vínculo "qué agente llevaba el caso" ya existe
-- indirectamente vía recetas.caso_id -> casos.medico_agente_id.
-- =====================================================================

-- ---------------------------------------------------------------------
-- medicamentos — catálogo propio de cada clínica (no global)
-- ---------------------------------------------------------------------
CREATE TABLE medicamentos (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre                      TEXT NOT NULL,
  principio_activo            TEXT,
  presentacion                TEXT,
  concentracion               TEXT,
  via_administracion_default  TEXT,
  dosis_min                   NUMERIC,
  dosis_max                   NUMERIC,
  unidad_dosis                TEXT,
  activo                      BOOLEAN NOT NULL DEFAULT true,
  creado_en                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- recetas — cabecera. caso_id ya conecta indirectamente con
-- casos.medico_agente_id, no hace falta duplicar el agente acá.
-- ---------------------------------------------------------------------
CREATE TABLE recetas (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  caso_id                   UUID NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  paciente_id               UUID NOT NULL REFERENCES pacientes(id),
  medico_id                 UUID NOT NULL REFERENCES personas(id),
  estado                    VARCHAR(20) NOT NULL DEFAULT 'borrador'
                            CHECK (estado IN ('borrador', 'validada', 'emitida')),
  instrucciones_generales   TEXT,
  instrucciones_propietario TEXT,
  validacion_ia             JSONB,
  validado_en               TIMESTAMPTZ,
  emitido_en                TIMESTAMPTZ,
  creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- receta_items — líneas de la receta. Sin tenant_id propio: se hereda
-- de recetas vía receta_id (mismo patrón que mensajes/archivos).
-- ---------------------------------------------------------------------
CREATE TABLE receta_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_id           UUID NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  medicamento_id      UUID NOT NULL REFERENCES medicamentos(id),
  dosis               TEXT NOT NULL,
  frecuencia          TEXT NOT NULL,
  duracion            TEXT NOT NULL,
  via_administracion  TEXT NOT NULL,
  observaciones       TEXT,
  orden               INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- RLS — mismo patrón exacto que el resto del esquema (ver 001_init.sql):
-- tenant_id directo para medicamentos/recetas, heredado vía EXISTS para
-- receta_items.
-- ---------------------------------------------------------------------
ALTER TABLE medicamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY medicamentos_isolation ON medicamentos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE recetas ENABLE ROW LEVEL SECURITY;
CREATE POLICY recetas_isolation ON recetas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE receta_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY receta_items_isolation ON receta_items
  USING (
    EXISTS (
      SELECT 1 FROM recetas r
      WHERE r.id = receta_items.receta_id
        AND r.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

CREATE INDEX idx_medicamentos_tenant ON medicamentos(tenant_id);
CREATE INDEX idx_recetas_caso ON recetas(caso_id);
CREATE INDEX idx_recetas_paciente ON recetas(paciente_id);
CREATE INDEX idx_receta_items_receta ON receta_items(receta_id);
CREATE INDEX idx_receta_items_medicamento ON receta_items(medicamento_id);
