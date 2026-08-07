-- =====================================================================
-- VetPlatform — Migración 015
-- Cache del Dashboard GCIS por caso (AD-DASH-01 revisado: pasa de "nunca
-- persiste" a "persiste como snapshot fechado, solo la última versión,
-- se regenera bajo demanda"). Ambas columnas nullable — un caso sin
-- Dashboard generado todavía las tiene en null; no aplica a ICIS (ese
-- endpoint sigue devolviendo el stub sin tocar estas columnas).
-- =====================================================================

ALTER TABLE casos ADD COLUMN IF NOT EXISTS dashboard_cache jsonb;
ALTER TABLE casos ADD COLUMN IF NOT EXISTS dashboard_generado_en timestamptz;
