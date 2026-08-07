-- Prompt agentes_paises_v2 — Paso 1: estados del catálogo de agentes
-- (activo/discontinuado/mantenimiento) + auditoría de inactivación de
-- países. estado_catalogo (disponible/proximamente) no se toca: sigue
-- siendo "¿está ofrecido en el catálogo?", este `estado` nuevo es
-- ortogonal — "¿sigue operativo?".

ALTER TABLE agentes
  ADD COLUMN estado varchar(20) NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo', 'discontinuado', 'mantenimiento')),
  ADD COLUMN motivo_mantenimiento text,
  ADD COLUMN retorno_estimado date,
  ADD COLUMN estado_actualizado_en timestamptz,
  ADD COLUMN estado_actualizado_por uuid;

ALTER TABLE paises
  ADD COLUMN motivo_inactivacion text;
