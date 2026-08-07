-- =====================================================================
-- VetPlatform — Migración 010
-- Límite de uso de IA configurable por clínica (además del presupuesto
-- del plan) y sistema de notificaciones in-app para avisos de umbral.
-- =====================================================================

ALTER TABLE tenants ADD COLUMN limite_usd_configurado NUMERIC(10,2);
ALTER TABLE tenants ADD COLUMN limite_accion VARCHAR NOT NULL
  DEFAULT 'solo_notificar' CHECK (limite_accion IN ('solo_notificar', 'bloquear'));

CREATE TABLE notificaciones_uso (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    umbral      VARCHAR NOT NULL CHECK (umbral IN ('80_plan', '100_plan', 'limite_propio')),
    mensaje     VARCHAR NOT NULL,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
    leida       BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE notificaciones_uso ENABLE ROW LEVEL SECURITY;
CREATE POLICY notificaciones_uso_isolation ON notificaciones_uso
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE INDEX idx_notificaciones_uso_tenant ON notificaciones_uso(tenant_id);
CREATE INDEX idx_notificaciones_uso_fecha ON notificaciones_uso(fecha);
