-- =====================================================================
-- VetPlatform — Migración 012
-- Facturación de Platform Admin: log de eventos (pagos, cancelaciones,
-- facturas manuales, excedente aplicado) + el período real de Stripe en
-- el propio tenant para poder programar el job diario de excedente sin
-- pegarle a Stripe por cada uno todos los días.
-- =====================================================================

CREATE TABLE eventos_facturacion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    tipo                VARCHAR NOT NULL
                            CHECK (tipo IN ('pago_exitoso', 'pago_fallido',
                                             'cancelacion', 'factura_manual',
                                             'excedente_aplicado')),
    monto_usd           NUMERIC(10,2),
    stripe_invoice_id   VARCHAR,
    detalle             VARCHAR,
    fecha               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE eventos_facturacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY eventos_facturacion_isolation ON eventos_facturacion
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE INDEX idx_eventos_facturacion_tenant ON eventos_facturacion(tenant_id);
CREATE INDEX idx_eventos_facturacion_fecha ON eventos_facturacion(fecha);
CREATE INDEX idx_eventos_facturacion_tipo ON eventos_facturacion(tipo);
CREATE INDEX idx_eventos_facturacion_stripe_invoice ON eventos_facturacion(stripe_invoice_id);

ALTER TABLE tenants ADD COLUMN stripe_periodo_actual_fin TIMESTAMPTZ;

-- No estaba en el pedido original, pero sin esto la columna "Fecha de
-- solicitud" del tab Cancelaciones no tiene de dónde salir (tenants nunca
-- guardó CUÁNDO se pidió la cancelación, solo cuándo se hace efectiva) —
-- se completa en PUT /admin/cancelar-suscripcion y se limpia en
-- /admin/revertir-cancelacion.
ALTER TABLE tenants ADD COLUMN cancelacion_solicitada_en TIMESTAMPTZ;
