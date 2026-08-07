-- =====================================================================
-- VetPlatform — Migración 021
-- Rebranding a "Vetline Ai": actualiza las menciones de "VetPlatform" en
-- el contenido de los documentos legales (migración 006) y en los
-- system_prompt de agentes, si los hubiera. No toca nombres técnicos
-- (realm de Keycloak, claves de localStorage, etc.) — solo texto
-- orientado al usuario.
-- =====================================================================

UPDATE documentos_legales
SET contenido = REPLACE(contenido, 'VetPlatform', 'Vetline Ai')
WHERE contenido LIKE '%VetPlatform%';

UPDATE agentes
SET system_prompt = REPLACE(system_prompt, 'VetPlatform', 'Vetline Ai')
WHERE system_prompt LIKE '%VetPlatform%';
