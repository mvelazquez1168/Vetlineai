-- ---------------------------------------------------------------------
-- 164 — DASHBOARDS (prompt 12)
--
-- No crea tablas de métricas. Los números salen de las fuentes
-- —comprobantes, cargos, atenciones, citas, movimientos— y eso es a
-- propósito: una tabla de métricas es una copia, y una copia que se
-- desincroniza no rompe nada visible hasta que la dueña compara el
-- dashboard con la caja del día.
--
-- Lo que sí hace:
--
--   1. LOS ÍNDICES QUE LAS CONSULTAS NUEVAS NECESITAN. Los dashboards
--      filtran por tenant + rango de fechas, y tres de las cuatro
--      tablas grandes no tenían ese índice: el kardex indexa
--      (tenant, producto, fecha) pero no (tenant, fecha), y los cargos
--      no tenían nada por fecha.
--   2. LA MARCA DE CLÍNICA DE DEMOSTRACIÓN, que el generador de
--      historial del §11 exige antes de escribir una sola fila.
-- ---------------------------------------------------------------------

-- 1. Índices para los rangos de fecha por clínica -------------------

-- Los ingresos, el ticket y la serie filtran por (tenant, fecha) y el
-- índice que había es (tenant, fecha_emision DESC) — sirve igual, así
-- que acá solo falta el que distingue los tipos de comprobante, que es
-- lo que separa una factura de una nota de crédito en la misma suma.
CREATE INDEX IF NOT EXISTS idx_fact_comprobantes_dashboard
  ON fact_comprobantes (tenant_id, fecha_emision, tipo_comprobante)
  WHERE estado IN ('aceptado', 'aceptado_parcial', 'enviado', 'en_cola');

-- Los cargos son la fuente del margen, del top de ítems, de la fuga y
-- de la facturación atribuida. Todas filtran por fecha y ninguna tenía
-- índice: hasta hoy era un recorrido secuencial de la tabla entera.
CREATE INDEX IF NOT EXISTS idx_vta_cargos_tenant_fecha
  ON vta_cargos (tenant_id, creado_en)
  WHERE anulado_en IS NULL;

-- Las atenciones se cuentan por fecha de CIERRE, no de creación.
CREATE INDEX IF NOT EXISTS idx_atenciones_cerradas
  ON atenciones (tenant_id, cerrada_en)
  WHERE estado = 'cerrada';

-- Los cobros por medio de pago.
CREATE INDEX IF NOT EXISTS idx_vta_cobros_tenant_fecha
  ON vta_cobros (tenant_id, creado_en)
  WHERE anulado_en IS NULL;

-- Las cuentas cobradas: el denominador del ticket promedio.
CREATE INDEX IF NOT EXISTS idx_vta_cuentas_cobradas
  ON vta_cuentas (tenant_id, cerrada_en)
  WHERE estado = 'cobrada';

-- La trazabilidad por lote (§6): «el fabricante retiró el lote X».
CREATE INDEX IF NOT EXISTS idx_inv_movimientos_lote
  ON inv_movimientos (tenant_id, lote_id)
  WHERE lote_id IS NOT NULL;

-- El consumo del producto recorre las salidas del período.
CREATE INDEX IF NOT EXISTS idx_inv_movimientos_tenant_fecha
  ON inv_movimientos (tenant_id, creado_en);

-- 2. La clínica de demostración -------------------------------------
--
-- POR QUÉ ES UNA COLUMNA Y NO UN NOMBRE QUE EMPIECE CON «Demo»:
-- el generador de historial del §11 escribe doce meses de citas,
-- atenciones, cobros y mermas. Correrlo contra una clínica real sería
-- irreversible —no hay forma de distinguir después lo inventado de lo
-- que la clínica registró—, así que la guarda no puede depender de una
-- convención de nombres que cualquiera cambia desde la pantalla de
-- configuración. Es un dato del producto: la plataforma necesita saber
-- qué clínicas son demos para no contarlas en sus propias métricas.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS es_demostracion BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.es_demostracion IS
  'Clínica de demostración: admite datos inventados. El generador de historial del prompt 12 se niega a escribir si es false.';
