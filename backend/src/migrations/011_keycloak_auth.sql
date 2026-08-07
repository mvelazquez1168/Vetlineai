-- =====================================================================
-- VetPlatform — Migración 011
-- Autenticación real vía Keycloak: cada persona/staff se vincula a su
-- usuario de Keycloak por `sub` (keycloak_user_id). password_hash queda
-- sin uso pero no se borra todavía (fuera de alcance de esta fase).
-- =====================================================================

ALTER TABLE personas ADD COLUMN keycloak_user_id VARCHAR UNIQUE;
ALTER TABLE staff_plataforma ADD COLUMN keycloak_user_id VARCHAR UNIQUE;
