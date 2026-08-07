-- =====================================================================
-- VetPlatform — Migración 020
-- Campanita de notificaciones personales (médico) — agrega el estado de
-- lectura a la tabla notificaciones ya existente (migración 019).
-- =====================================================================

ALTER TABLE notificaciones ADD COLUMN leida boolean NOT NULL DEFAULT false;
ALTER TABLE notificaciones ADD COLUMN leida_en timestamptz;
