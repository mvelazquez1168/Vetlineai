-- =====================================================================
-- VetPlatform — Migración 022
-- Cobro inmediato vía Tilopay para el registro público. Sin período de
-- prueba (por decisión de producto: el pago se hace en el momento) y sin
-- guardar tarjeta (la tokenización de Tilopay solo está disponible en su
-- ambiente de producción, no se puede validar en sandbox — ver
-- capa-pagos-tilopay.md). La recurrencia real de cobro queda fuera de
-- alcance de esta fase, se resuelve en producción.
--
-- No se toca nada de Stripe todavía (columnas, webhook, jobs de trial) —
-- solo dejan de usarse para clínicas nuevas a partir de este cambio en
-- registro.routes.ts. El resto del código de facturación existente sigue
-- funcionando para los tenants que ya estaban bajo ese modelo.
-- =====================================================================

ALTER TABLE tenants DROP CONSTRAINT tenants_estado_suscripcion_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_estado_suscripcion_check
  CHECK (estado_suscripcion IN ('pendiente_pago', 'trial', 'activa', 'trial_expirado', 'suspendida', 'cancelada'));

-- ---------------------------------------------------------------------
-- cobros — histórico de intentos de cobro vía Tilopay. tenant_id
-- referencia tenants aunque el cobro sea el que ACTIVA al tenant (fase 1
-- del registro ya lo crea en estado 'pendiente_pago'), por eso no hay
-- FK ON DELETE CASCADE hacia atrás en el otro sentido: el tenant siempre
-- existe antes que su primer cobro.
-- ---------------------------------------------------------------------
CREATE TABLE cobros (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor          TEXT NOT NULL DEFAULT 'tilopay',
  referencia_externa TEXT,                      -- tilopay-transaction
  order_number       TEXT NOT NULL,              -- orderNumber enviado a Tilopay
  monto              NUMERIC(12,2) NOT NULL,
  moneda             CHAR(3) NOT NULL DEFAULT 'USD',
  estado             TEXT NOT NULL
                     CHECK (estado IN ('pendiente', 'exitoso', 'fallido')),
  mensaje_error      TEXT,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cobros_order_number_unico ON cobros (order_number);
CREATE INDEX cobros_tenant_fecha ON cobros (tenant_id, creado_en DESC);

ALTER TABLE cobros ENABLE ROW LEVEL SECURITY;
CREATE POLICY cobros_isolation ON cobros
  USING (tenant_id::text = current_setting('app.tenant_id', true));
