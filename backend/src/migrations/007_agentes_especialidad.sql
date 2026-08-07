-- =====================================================================
-- VetPlatform — Migración 007
-- Gestión completa del catálogo de agentes (edición desde Platform Admin).
--
-- NOTA IMPORTANTE: el prompt de esta fase pedía agregar descripcion,
-- icono y estado a `agentes`, asumiendo que no existían. Los tres YA
-- existían desde 001_init.sql (estado_catalogo cumple exactamente el rol
-- de "estado", mismos valores 'disponible'/'proximamente', ya poblado
-- con los mismos textos que pedía el seed de esta fase). No se re-agregan
-- para no duplicar columnas — el backend de esta fase mapea el campo
-- "estado" del API a la columna existente estado_catalogo.
--
-- Lo único que genuinamente faltaba era `especialidad` (una etiqueta
-- corta, distinta de la descripción larga) — eso es lo que agrega esta
-- migración.
-- =====================================================================

ALTER TABLE agentes ADD COLUMN especialidad VARCHAR;

UPDATE agentes SET especialidad = 'Diagnóstico General' WHERE slug = 'medicina-general-triage';
UPDATE agentes SET especialidad = 'Tracto Gastrointestinal' WHERE slug = 'gastroenterologia';
UPDATE agentes SET especialidad = 'Patologías Cutáneas' WHERE slug = 'dermatologia';
UPDATE agentes SET especialidad = 'Estudios Cardíacos' WHERE slug = 'cardiologia';
UPDATE agentes SET especialidad = 'Evaluación Oncológica' WHERE slug = 'oncologia';
-- 'neuro' no vino de ningún seed de esta conversación (creado por el
-- usuario explorando la app) — se le asigna un valor razonable igual.
UPDATE agentes SET especialidad = 'Evaluación Neurológica' WHERE slug = 'neuro';
