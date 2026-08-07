-- =====================================================================
-- VetPlatform — Migración 004
-- Cancelación de suscripción activa (sin integración real de Stripe
-- todavía). También agrega la columna estado_suscripcion, que no existía
-- — es un prerequisito mínimo indispensable para poder distinguir
-- "activa" de "cancelada" y no estaba cubierto por ninguna migración
-- anterior.
-- =====================================================================

ALTER TABLE tenants ADD COLUMN estado_suscripcion VARCHAR NOT NULL DEFAULT 'activa'
    CHECK (estado_suscripcion IN ('activa', 'cancelada'));

ALTER TABLE tenants ADD COLUMN cancelacion_solicitada BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tenants ADD COLUMN cancelacion_efectiva_en TIMESTAMPTZ;
