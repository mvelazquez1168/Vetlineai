-- =====================================================================
-- VetPlatform — Migración 069
-- prompt_code_registro_atencion.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 2 — atenciones. Siempre sobre una cita (UNIQUE cita_id: una cita
-- es una visita, una visita es una atención — si hace falta corregir lo
-- escrito, se edita la misma fila, no se crea otra). Todo opcional salvo
-- nota_medica: un veterinario que solo vacuna no debe completar peso ni
-- temperatura para guardar.
-- ---------------------------------------------------------------------
CREATE TABLE atenciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cita_id       UUID NOT NULL UNIQUE REFERENCES citas(id),
  paciente_id   UUID NOT NULL REFERENCES pacientes(id),
  medico_id     UUID NOT NULL REFERENCES personas(id),
  nota_medica   TEXT,
  peso          NUMERIC,
  temperatura   NUMERIC,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atenciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY atenciones_isolation ON atenciones
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE INDEX idx_atenciones_paciente ON atenciones(paciente_id);
CREATE INDEX idx_atenciones_medico ON atenciones(medico_id);

-- ---------------------------------------------------------------------
-- PASO 3 — recetas sin caso. Una receta es un acto del médico sobre un
-- paciente; el caso es opcional. Se conserva paciente_id/medico_id (ya
-- existían, nunca fueron el problema) y se agrega atencion_id como el
-- vínculo estructural nuevo — caso_id pasa a ser el vínculo legado,
-- todavía poblado cuando la cita de la atención está ligada a un caso
-- (así el contexto de IA y la cronología del caso, que filtran por
-- caso_id, siguen funcionando sin tocarlos).
-- ---------------------------------------------------------------------
ALTER TABLE recetas ALTER COLUMN caso_id DROP NOT NULL;
ALTER TABLE recetas ADD COLUMN atencion_id UUID REFERENCES atenciones(id);
CREATE INDEX idx_recetas_atencion ON recetas(atencion_id);

-- ---------------------------------------------------------------------
-- PASO 4 — cuidados preventivos ganan atencion_id opcional (paciente_id
-- se conserva: es lo que ya usa GET /pacientes/:id/cuidados-preventivos
-- y el historial). Enfermedades cubiertas por vacuna: catálogo de
-- plataforma, sembrado acá mismo, no editable por las clínicas — mismo
-- patrón que razas/países. Relación M:N con cuidados_preventivos porque
-- una vacuna multivalente cubre varias enfermedades a la vez.
-- ---------------------------------------------------------------------
ALTER TABLE cuidados_preventivos ADD COLUMN atencion_id UUID REFERENCES atenciones(id);
CREATE INDEX idx_cuidados_preventivos_atencion ON cuidados_preventivos(atencion_id);

CREATE TABLE enfermedades_vacuna (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  especie VARCHAR(10) NOT NULL CHECK (especie IN ('canino', 'felino')),
  nombre  TEXT NOT NULL
);

CREATE TABLE cuidado_preventivo_enfermedades (
  cuidado_preventivo_id UUID NOT NULL REFERENCES cuidados_preventivos(id) ON DELETE CASCADE,
  enfermedad_id          UUID NOT NULL REFERENCES enfermedades_vacuna(id),
  PRIMARY KEY (cuidado_preventivo_id, enfermedad_id)
);

ALTER TABLE cuidado_preventivo_enfermedades ENABLE ROW LEVEL SECURITY;
CREATE POLICY cuidado_preventivo_enfermedades_isolation ON cuidado_preventivo_enfermedades
  USING (
    EXISTS (
      SELECT 1 FROM cuidados_preventivos cp
      WHERE cp.id = cuidado_preventivo_enfermedades.cuidado_preventivo_id
        AND cp.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

-- Catálogo confirmado con el usuario — canino núcleo + coronavirus
-- canino (frecuente en vacunas óctuple/décuple regionales, no en las de
-- EE.UU./Europa); felino núcleo + clamidiosis felina (Chlamydophila
-- felis, presente en varias vacunas felinas regionales).
INSERT INTO enfermedades_vacuna (especie, nombre) VALUES
  ('canino', 'Parvovirosis'),
  ('canino', 'Moquillo'),
  ('canino', 'Hepatitis infecciosa canina'),
  ('canino', 'Parainfluenza'),
  ('canino', 'Leptospirosis'),
  ('canino', 'Rabia'),
  ('canino', 'Traqueobronquitis infecciosa (Bordetella)'),
  ('canino', 'Coronavirus canino'),
  ('felino', 'Panleucopenia felina'),
  ('felino', 'Calicivirosis felina'),
  ('felino', 'Rinotraqueítis felina'),
  ('felino', 'Leucemia felina'),
  ('felino', 'Rabia'),
  ('felino', 'Clamidiosis felina');
