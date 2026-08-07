-- =====================================================================
-- VetPlatform — Migración 008
-- Flujo "Nuevo Caso": vincula cada caso al medico_agente activo (además
-- de agente_id/medico_id, que ya existían) para poder atribuir consumo
-- y contexto por especialidad del médico, no solo por médico + agente
-- por separado.
-- =====================================================================

ALTER TABLE casos ADD COLUMN medico_agente_id UUID REFERENCES medico_agente(id);
