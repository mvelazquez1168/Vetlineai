-- =====================================================================
-- VetPlatform — Migración 023
-- eventos_facturacion.stripe_invoice_id era una columna atada por nombre
-- a Stripe, pero la tabla ya necesita registrar pagos de cualquier
-- proveedor (Tilopay incluido). La reemplaza referencia_externa, mismo
-- nombre que ya usa cobros.referencia_externa (migración 022) para el
-- mismo concepto. Se backfillea desde la columna vieja antes de
-- eliminarla para no perder la relación que platform-admin usa para
-- derivar "pagada"/"pendiente" en facturas manuales y excedentes.
-- =====================================================================

ALTER TABLE eventos_facturacion ADD COLUMN referencia_externa TEXT;

UPDATE eventos_facturacion
SET referencia_externa = stripe_invoice_id
WHERE stripe_invoice_id IS NOT NULL;

DROP INDEX idx_eventos_facturacion_stripe_invoice;
CREATE INDEX idx_eventos_facturacion_referencia_externa ON eventos_facturacion(referencia_externa);

ALTER TABLE eventos_facturacion DROP COLUMN stripe_invoice_id;
