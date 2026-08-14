-- =====================================================================
-- VetPlatform — Migración 071
-- Catálogo de fármacos de plataforma. medicamentos pasa de ser 100% por
-- clínica a modelo mixto: tenant_id NULL = fila de plataforma
-- (compartida, sembrada desde backend/src/seed/plataforma/farmacos.json),
-- tenant_id con valor = fármaco propio de esa clínica (preparado
-- magistral, producto local, etc.). Sin tabla de habilitación por
-- clínica como agentes/tenant_agentes — acá no hay nada que facturar
-- por clínica, un fármaco de plataforma está disponible para todas.
-- =====================================================================

ALTER TABLE medicamentos ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE medicamentos ADD COLUMN clase TEXT;

-- La política única "isolation" ya no alcanza: SELECT necesita ver
-- plataforma + lo propio, pero INSERT/UPDATE/DELETE nunca deben poder
-- tocar una fila de plataforma (tenant_id NULL) desde una conexión de
-- clínica — con una sola USING permisiva, cualquier clínica podría
-- editar o desactivar el catálogo compartido de todas. Se separa por
-- comando: SELECT ve plataforma+mío, INSERT/UPDATE/DELETE solo tocan
-- lo mío (tenant_id NULL nunca matchea current_setting, que siempre
-- resuelve al tenant real de la sesión).
DROP POLICY medicamentos_isolation ON medicamentos;

CREATE POLICY medicamentos_select ON medicamentos
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));

CREATE POLICY medicamentos_insert ON medicamentos
  FOR INSERT
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

CREATE POLICY medicamentos_update ON medicamentos
  FOR UPDATE
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

CREATE POLICY medicamentos_delete ON medicamentos
  FOR DELETE
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- medicamento_dosis_especie — rangos de dosis por especie, separados de
-- medicamentos porque un fármaco puede tener 0, 1 o 2 filas (dosis
-- distinta para canino/felino, o solo aplica a una especie). Queda
-- vacía por diseño en este sembrado: ninguna dosis fue inventada ni
-- estimada — se puebla más adelante cuando el veterinario aporte los
-- rangos desde una fuente clínica confiable. Sin RLS propia por
-- comando (nada escribe acá desde una conexión de clínica todavía):
-- visible exactamente donde el medicamento al que pertenece es visible
-- (plataforma o mío), mismo patrón que receta_items con recetas.
-- ---------------------------------------------------------------------
CREATE TABLE medicamento_dosis_especie (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicamento_id UUID NOT NULL REFERENCES medicamentos(id) ON DELETE CASCADE,
  especie        VARCHAR(10) NOT NULL CHECK (especie IN ('canino', 'felino')),
  dosis_min      NUMERIC,
  dosis_max      NUMERIC,
  unidad         TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medicamento_id, especie)
);

ALTER TABLE medicamento_dosis_especie ENABLE ROW LEVEL SECURITY;
CREATE POLICY medicamento_dosis_especie_isolation ON medicamento_dosis_especie
  USING (
    EXISTS (
      SELECT 1 FROM medicamentos m
      WHERE m.id = medicamento_dosis_especie.medicamento_id
        AND (m.tenant_id IS NULL OR m.tenant_id::text = current_setting('app.tenant_id', true))
    )
  );

CREATE INDEX idx_medicamento_dosis_especie_medicamento ON medicamento_dosis_especie(medicamento_id);
