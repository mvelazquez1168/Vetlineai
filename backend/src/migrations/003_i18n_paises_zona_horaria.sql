-- =====================================================================
-- VetPlatform — Migración 003 (internacionalización, alcance acotado)
-- Tres cambios:
--   1. Terminología clínica localizada por país en documentos_conocimiento.
--   2. Equivalencias comerciales de fármacos por país (tabla nueva).
--   3. Zona horaria del tenant.
-- Explícitamente fuera de alcance en esta fase (ver conversación): validación
-- de colegiatura, fármacos controlados/regulados, residencia de datos,
-- moneda/facturación.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Terminología clínica localizada por país
-- ---------------------------------------------------------------------
ALTER TABLE documentos_conocimiento ADD COLUMN pais_codigo CHAR(2) REFERENCES paises(codigo_iso);
-- NULL = el documento aplica a todos los países (comportamiento actual sin
-- cambios). Puede combinarse con agente_id: un documento puede ser a la vez
-- específico de un agente Y de un país.

CREATE INDEX idx_documentos_conocimiento_pais ON documentos_conocimiento(pais_codigo);

-- ---------------------------------------------------------------------
-- 2. Equivalencias de fármacos por país
-- ---------------------------------------------------------------------
CREATE TABLE farmacos_equivalencias (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principio_activo    VARCHAR NOT NULL,
    pais_codigo         CHAR(2) REFERENCES paises(codigo_iso),
    nombre_comercial    VARCHAR NOT NULL
);

CREATE INDEX idx_farmacos_equivalencias_pais ON farmacos_equivalencias(pais_codigo);
CREATE INDEX idx_farmacos_equivalencias_principio ON farmacos_equivalencias(principio_activo);

INSERT INTO farmacos_equivalencias (principio_activo, pais_codigo, nombre_comercial) VALUES
  ('Ácido ursodesoxicólico', 'CR', 'Ursovet'),
  ('Meloxicam', 'CR', 'Metacam'),
  ('Enrofloxacina', 'CR', 'Baytril'),
  ('Maropitant', 'CR', 'Cerenia');

-- ---------------------------------------------------------------------
-- 3. Zona horaria del tenant
-- ---------------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN zona_horaria VARCHAR NOT NULL DEFAULT 'America/Costa_Rica';

UPDATE tenants SET zona_horaria = 'America/Argentina/Buenos_Aires' WHERE pais_codigo = 'AR';
