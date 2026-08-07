-- =====================================================================
-- VetPlatform — Migración 013
-- Documenta agentes.system_prompt: la columna ya existía en la base real
-- (se agregó a mano por SQL en una fase anterior, fuera de las
-- migraciones versionadas) — esta migración no la crea de cero, solo dejó
-- registro para que un entorno nuevo levantado desde cero también la
-- tenga. IF NOT EXISTS porque en la base real ya está.
-- =====================================================================

ALTER TABLE agentes ADD COLUMN IF NOT EXISTS system_prompt TEXT;
