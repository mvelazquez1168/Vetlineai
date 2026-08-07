-- =====================================================================
-- VetPlatform — Migración 018
-- Historial versionado de Informes Clínicos (CR-001) generados por
-- caso — a diferencia del Dashboard (un único snapshot que se
-- sobreescribe, ver migración 015), cada informe generado es un
-- documento formal fechado y se conserva para siempre: siempre INSERT,
-- nunca UPDATE ni DELETE. Sin infraestructura de storage de objetos
-- aparte — el .docx completo se guarda como bytea, volumen razonable
-- para una clínica individual.
-- =====================================================================

CREATE TABLE informes_generados (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  caso_id         UUID NOT NULL REFERENCES casos(id),
  medico_id       UUID NOT NULL REFERENCES personas(id),
  tipo_reporte    TEXT NOT NULL DEFAULT 'CR-001',
  contenido_docx  BYTEA NOT NULL,
  nombre_archivo  TEXT NOT NULL,
  generado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE informes_generados ENABLE ROW LEVEL SECURITY;
CREATE POLICY informes_generados_isolation ON informes_generados
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Para el listado (GET /:id/informes, ordenado por generado_en DESC) y
-- para no traer el bytea al hacer ese listado (SELECT explícito sin
-- contenido_docx en esa consulta, no depende de este índice, pero
-- igual ayuda al ORDER BY).
CREATE INDEX idx_informes_generados_caso ON informes_generados(caso_id, generado_en DESC);
