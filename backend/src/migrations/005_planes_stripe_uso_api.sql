-- =====================================================================
-- VetPlatform — Migración 005
-- Modelo de negocio completo: catálogo de planes con cupos híbridos,
-- integración con Stripe (customer/payment method/subscription por
-- tenant), y seguimiento de uso de la API de IA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogo de planes
-- ---------------------------------------------------------------------
CREATE TABLE planes (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                      VARCHAR NOT NULL,
    cupos_agente_medico         INT NOT NULL,
    presupuesto_usd_incluido    NUMERIC(10,2) NOT NULL,
    precio_mensual_usd          NUMERIC(10,2) NOT NULL,
    precio_cupo_extra_usd       NUMERIC(10,2) NOT NULL,
    es_plan_prueba              BOOLEAN NOT NULL DEFAULT false,
    stripe_price_id             VARCHAR
);

-- precio_cupo_extra_usd no vino especificado en el spec de esta fase para
-- ningún plan (columna NOT NULL sin valores dados) — se infiere $5/cupo
-- para los 4 planes, consistente con el copy ya usado en la pantalla de
-- Uso y Facturación desde la fase anterior ("los cupos adicionales se
-- facturan a $5 c/u"). stripe_price_id queda NULL: son IDs reales de
-- Stripe Price que el usuario todavía no creó en su cuenta — no se
-- inventan acá, se completan manualmente cuando existan.
INSERT INTO planes (nombre, cupos_agente_medico, presupuesto_usd_incluido, precio_mensual_usd, precio_cupo_extra_usd, es_plan_prueba) VALUES
  ('Prueba Gratuita', 2,  10.00,  0.00, 5.00, true),
  ('Starter',         5,  25.00, 49.00, 5.00, false),
  ('Profesional',     15, 75.00, 149.00, 5.00, false),
  ('Enterprise',      50, 300.00, 499.00, 5.00, false);

-- ---------------------------------------------------------------------
-- 2. Suscripción del tenant
-- ---------------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN plan_id UUID REFERENCES planes(id);
ALTER TABLE tenants ADD COLUMN stripe_customer_id VARCHAR;
ALTER TABLE tenants ADD COLUMN stripe_payment_method_id VARCHAR;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id VARCHAR;
ALTER TABLE tenants ADD COLUMN stripe_cupos_item_id VARCHAR;
ALTER TABLE tenants ADD COLUMN trial_termina_en TIMESTAMPTZ;

-- Amplía el CHECK de estado_suscripcion (antes solo 'activa'/'cancelada',
-- de la fase de cancelación) a los 5 estados del modelo de negocio
-- completo. Los tenants existentes (creados por staff, no por
-- autoservicio) quedan tal cual están — ya son 'activa', no pasan por
-- trial retroactivamente.
ALTER TABLE tenants DROP CONSTRAINT tenants_estado_suscripcion_check;
ALTER TABLE tenants ALTER COLUMN estado_suscripcion SET DEFAULT 'trial';
ALTER TABLE tenants ADD CONSTRAINT tenants_estado_suscripcion_check
  CHECK (estado_suscripcion IN ('trial', 'activa', 'trial_expirado', 'suspendida', 'cancelada'));

-- Backfill: los tenants ya existentes tenían un plan de texto libre
-- (columna `plan`, que se mantiene sin cambios) — les asignamos el
-- plan_id correspondiente por nombre para que Uso y Facturación tenga de
-- dónde leer cupos/presupuesto real en vez de mock.
UPDATE tenants t
SET plan_id = p.id
FROM planes p
WHERE lower(p.nombre) = lower(t.plan)
  AND t.plan_id IS NULL;

-- ---------------------------------------------------------------------
-- 3. Seguimiento de uso de la API de IA
-- ---------------------------------------------------------------------
CREATE TABLE uso_api (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id),
    caso_id                 UUID REFERENCES casos(id),
    medico_agente_id        UUID REFERENCES medico_agente(id),
    tokens_entrada          INT NOT NULL,
    tokens_salida           INT NOT NULL,
    tokens_cache_lectura    INT NOT NULL DEFAULT 0,
    tokens_cache_escritura  INT NOT NULL DEFAULT 0,
    costo_usd_calculado     NUMERIC(10,4) NOT NULL,
    modelo                  VARCHAR NOT NULL,
    "timestamp"              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE uso_api ENABLE ROW LEVEL SECURITY;
CREATE POLICY uso_api_isolation ON uso_api
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE INDEX idx_uso_api_tenant ON uso_api(tenant_id);
CREATE INDEX idx_uso_api_timestamp ON uso_api("timestamp");
