-- ---------------------------------------------------------------------
-- 150 — LO QUE LA CLÍNICA DEBE, Y LO QUE PAGA (prompt 10a, §1 y §2)
--
-- REGLA CENTRAL DEL 10a: **finanzas consolida, no recaptura.** Una
-- cuenta por pagar no se escribe a mano con los datos de una factura que
-- el sistema ya tiene: nace del comprobante recibido (09b) o de la
-- compra (06), y guarda el vínculo. Lo único propio de la cuenta es
-- **cuándo vence** y **qué se pagó**.
--
-- POR ESO LOS DOS VÍNCULOS SON ÚNICOS: un comprobante recibido no puede
-- estar en dos cuentas y una compra tampoco. Es la forma de que «no se
-- registra dos veces» sea una regla de la base y no una intención.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- LA CONDICIÓN DE CRÉDITO DEL PROVEEDOR, en días.
--
-- `inv_proveedores.condiciones_pago` existe desde el 06 y es texto
-- libre: el único valor cargado en toda la base es «30 días». Con texto
-- no se puede calcular un vencimiento, y un vencimiento mal calculado es
-- una factura que se paga tarde.
--
-- Se agrega `dias_credito` y se migra lo que había. La columna de texto
-- NO se borra —hay dos pantallas que la escriben— y queda documentada
-- como nota libre: lo que se calcula sale de `dias_credito`.
-- ---------------------------------------------------------------------
ALTER TABLE inv_proveedores
  ADD COLUMN IF NOT EXISTS dias_credito SMALLINT NOT NULL DEFAULT 0
    CHECK (dias_credito >= 0 AND dias_credito <= 365);

COMMENT ON COLUMN inv_proveedores.dias_credito IS
  'Días de crédito del proveedor. 0 = contado. De acá sale el vencimiento de cada cuenta por pagar (prompt 10a).';
COMMENT ON COLUMN inv_proveedores.condiciones_pago IS
  'Nota libre del proveedor, del prompt 06. Lo que se CALCULA sale de dias_credito: este texto no se interpreta.';

-- Lo que se pueda leer del texto. «30 días» → 30. Lo que no se entienda
-- queda en 0 (contado), que es lo más conservador: una cuenta que vence
-- hoy se ve en la lista, una que vence en 60 días que en realidad era
-- contado se descubre cuando el proveedor llama.
UPDATE inv_proveedores
   SET dias_credito = LEAST(365, (regexp_match(condiciones_pago, '(\d+)'))[1]::int)
 WHERE condiciones_pago ~ '\d'
   AND dias_credito = 0;

-- ---------------------------------------------------------------------
-- LAS CUENTAS BANCARIAS DE LA CLÍNICA.
--
-- Un catálogo simple: de dónde sale la plata. No es contabilidad —no hay
-- saldo acá— y por eso no se guarda ningún saldo: el saldo del banco lo
-- dice el banco.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_cuentas_banco (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nombre    VARCHAR(80) NOT NULL,
  banco     VARCHAR(80),
  /* Los últimos cuatro dígitos y nada más: el número completo de una
     cuenta bancaria no hace falta para elegirla en un selector, y
     guardarlo es guardar un dato sensible sin necesidad. */
  terminacion VARCHAR(8),
  moneda    VARCHAR(3) NOT NULL DEFAULT 'CRC' CHECK (moneda IN ('CRC', 'USD')),
  activa    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fin_cuentas_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_cuentas_banco FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_cuentas_banco_tenant ON fin_cuentas_banco;
CREATE POLICY fin_cuentas_banco_tenant ON fin_cuentas_banco
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- LAS CUENTAS POR PAGAR.
--
-- `monto` es lo que dice el documento y `exigible` es lo que la clínica
-- reconoce: cuando el 09b acepta un comprobante **parcialmente**, lo
-- exigible es menos que el total, y es sobre eso que se paga. Son dos
-- datos distintos y por eso son dos columnas: pisar el total del
-- documento con lo aceptado haría que la cuenta ya no se pueda comparar
-- con el papel del proveedor.
--
-- EL SALDO NO SE GUARDA. Se calcula: exigible − pagos aplicados − notas
-- de crédito. Es la misma decisión que tomó el 08 para el saldo del
-- cliente, con el mismo motivo: un saldo guardado y un saldo calculado
-- que difieren es el defecto que no rompe nada visible.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_cuentas_pagar (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  proveedor_id UUID NOT NULL REFERENCES inv_proveedores(id) ON DELETE RESTRICT
              DEFERRABLE INITIALLY DEFERRED,
  /* De dónde nació. Uno de los dos, o ninguno (un gasto sin comprobante
     electrónico: la planilla, el pago a una persona física). */
  recibido_id UUID REFERENCES fact_recibidos(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  compra_id UUID REFERENCES inv_ordenes_compra(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  /* El número del documento del proveedor, para poder buscarla como la
     busca él cuando llama. */
  documento VARCHAR(60),
  fecha     DATE NOT NULL,
  vencimiento DATE NOT NULL,
  moneda    VARCHAR(3) NOT NULL DEFAULT 'CRC' CHECK (moneda IN ('CRC', 'USD')),
  monto     NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  exigible  NUMERIC(14,2) NOT NULL CHECK (exigible > 0),
  /* Nace de una compra sin comprobante electrónico todavía. Se concilia
     cuando el comprobante llega, y entonces esto pasa a false. */
  sin_comprobante BOOLEAN NOT NULL DEFAULT false,
  /* Una nota de crédito del proveedor REDUCE la cuenta a la que se
     refiere. Se guarda como una cuenta propia apuntando a la original,
     con monto negativo prohibido: lo que la hace restar es esta columna
     y no un signo, que es cómo se termina sumando lo que había que
     restar. */
  reduce_a_cuenta_id UUID REFERENCES fin_cuentas_pagar(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nota      TEXT,
  creado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fin_cuentas_pagar_exigible_no_mayor CHECK (exigible <= monto),
  CONSTRAINT fin_cuentas_pagar_vence_despues CHECK (vencimiento >= fecha)
);

-- NO SE REGISTRA DOS VECES: el vínculo es único.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_cuentas_pagar_recibido
  ON fin_cuentas_pagar (recibido_id) WHERE recibido_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_cuentas_pagar_compra
  ON fin_cuentas_pagar (compra_id) WHERE compra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fin_cuentas_pagar_vencimiento
  ON fin_cuentas_pagar (tenant_id, vencimiento);

ALTER TABLE fin_cuentas_pagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_cuentas_pagar FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_cuentas_pagar_tenant ON fin_cuentas_pagar;
CREATE POLICY fin_cuentas_pagar_tenant ON fin_cuentas_pagar
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- LOS PAGOS.
--
-- Un pago es UN movimiento de plata que puede cubrir VARIAS cuentas del
-- mismo proveedor —es lo que pasa de verdad: una transferencia por tres
-- facturas—. De ahí la tabla de aplicaciones.
--
-- EL EFECTIVO NO SE REGISTRA EN DOS LUGARES: un pago en efectivo desde
-- la caja abierta guarda el id de su movimiento de caja, y es ese
-- movimiento el que el arqueo descuenta. Sin esa columna, el efectivo
-- saldría de la caja sin que el arqueo lo supiera, o saldría dos veces.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_pagos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  proveedor_id UUID NOT NULL REFERENCES inv_proveedores(id) ON DELETE RESTRICT
              DEFERRABLE INITIALLY DEFERRED,
  fecha     DATE NOT NULL,
  medio     VARCHAR(20) NOT NULL CHECK (
              medio IN ('transferencia', 'sinpe', 'cheque', 'efectivo', 'tarjeta')
            ),
  cuenta_banco_id UUID REFERENCES fin_cuentas_banco(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  referencia VARCHAR(80),
  respaldo_url TEXT,
  moneda    VARCHAR(3) NOT NULL DEFAULT 'CRC' CHECK (moneda IN ('CRC', 'USD')),
  monto     NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  /* Con qué tipo de cambio se pagó. Para una cuenta en dólares, es lo
     que permite que el contador vea la diferencia cambiaria: la cuenta
     nació a un tipo y se pagó a otro. */
  tipo_cambio NUMERIC(12,5) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0),
  /* El movimiento de caja, cuando el pago fue en efectivo desde la caja
     abierta. */
  movimiento_efectivo_id UUID REFERENCES vta_movimientos_efectivo(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  estado    VARCHAR(12) NOT NULL DEFAULT 'registrado'
              CHECK (estado IN ('registrado', 'anulado')),
  anulado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  anulado_en TIMESTAMPTZ,
  anulado_motivo VARCHAR(200),
  creado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* Anular exige motivo. Sin esto, «anulado» sin explicación es lo que
     el contador encuentra tres meses después y nadie recuerda. */
  CONSTRAINT fin_pagos_anulado_check CHECK (
    estado <> 'anulado' OR (anulado_motivo IS NOT NULL AND anulado_en IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fin_pagos_proveedor ON fin_pagos (tenant_id, proveedor_id, fecha);

ALTER TABLE fin_pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_pagos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_pagos_tenant ON fin_pagos;
CREATE POLICY fin_pagos_tenant ON fin_pagos
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS fin_pago_aplicaciones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  pago_id   UUID NOT NULL REFERENCES fin_pagos(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  cuenta_id UUID NOT NULL REFERENCES fin_cuentas_pagar(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* En la moneda de la cuenta. */
  monto     NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  UNIQUE (pago_id, cuenta_id)
);

ALTER TABLE fin_pago_aplicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_pago_aplicaciones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_pago_aplicaciones_tenant ON fin_pago_aplicaciones;
CREATE POLICY fin_pago_aplicaciones_tenant ON fin_pago_aplicaciones
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- EL SALDO DE UNA CUENTA, Y LA INVARIANTE QUE LA BASE IMPONE.
--
-- Las dos reglas de dinero del prompt, impuestas acá y no en el código:
--
--   1. una cuenta **no se puede pagar por encima de su saldo**;
--   2. un saldo **nunca queda negativo**.
--
-- Son la misma regla mirada de dos lados, y van en un trigger porque un
-- CHECK no puede sumar otra tabla. Los pagos anulados no cuentan: anular
-- devuelve el saldo, que es justo lo que el prompt pide.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_saldo_cuenta(p_cuenta UUID) RETURNS NUMERIC AS $$
  SELECT c.exigible
         - COALESCE((SELECT sum(a.monto) FROM fin_pago_aplicaciones a
                      JOIN fin_pagos p ON p.id = a.pago_id
                     WHERE a.cuenta_id = c.id AND p.estado = 'registrado'), 0)
         - COALESCE((SELECT sum(nc.exigible) FROM fin_cuentas_pagar nc
                     WHERE nc.reduce_a_cuenta_id = c.id), 0)
    FROM fin_cuentas_pagar c
   WHERE c.id = p_cuenta;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fin_saldo_cuenta(UUID) IS
  'Lo que falta pagar de una cuenta: exigible menos pagos registrados menos notas de crédito. No se guarda, se calcula (prompt 10a).';

CREATE OR REPLACE FUNCTION fin_aplicacion_no_excede_saldo() RETURNS TRIGGER AS $$
DECLARE
  v_saldo NUMERIC;
  v_doc TEXT;
BEGIN
  -- El saldo YA incluye esta aplicación, porque el trigger es AFTER: si
  -- quedó negativo, esta fila es la que lo rompió.
  SELECT fin_saldo_cuenta(NEW.cuenta_id) INTO v_saldo;
  IF v_saldo < -0.001 THEN
    SELECT COALESCE(documento, 'sin número') INTO v_doc
      FROM fin_cuentas_pagar WHERE id = NEW.cuenta_id;
    RAISE EXCEPTION
      'El pago excede el saldo de la cuenta % en %. Una cuenta no se puede pagar por encima de lo que se debe.',
      v_doc, abs(v_saldo)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fin_aplicacion_no_excede ON fin_pago_aplicaciones;
CREATE TRIGGER trg_fin_aplicacion_no_excede
  AFTER INSERT OR UPDATE ON fin_pago_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION fin_aplicacion_no_excede_saldo();

-- Y la nota de crédito tampoco puede dejar la cuenta en negativo: un
-- proveedor que acredita más de lo que facturó es un error de carga.
CREATE OR REPLACE FUNCTION fin_nota_credito_no_excede() RETURNS TRIGGER AS $$
DECLARE
  v_saldo NUMERIC;
BEGIN
  IF NEW.reduce_a_cuenta_id IS NULL THEN RETURN NULL; END IF;
  SELECT fin_saldo_cuenta(NEW.reduce_a_cuenta_id) INTO v_saldo;
  IF v_saldo < -0.001 THEN
    RAISE EXCEPTION
      'La nota de crédito deja la cuenta en % a favor. Revisá a qué factura corresponde.',
      abs(v_saldo)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fin_nota_credito_no_excede ON fin_cuentas_pagar;
CREATE TRIGGER trg_fin_nota_credito_no_excede
  AFTER INSERT OR UPDATE ON fin_cuentas_pagar
  FOR EACH ROW EXECUTE FUNCTION fin_nota_credito_no_excede();

-- ---------------------------------------------------------------------
-- UN PAGO EN EFECTIVO SALE DE LA CAJA, Y EL ARQUEO LO DESCUENTA.
--
-- `vta_movimientos_efectivo.tipo` tiene tres valores y ninguno es «le
-- pagué al proveedor». Se agrega el cuarto: usar `gasto_caja_chica`
-- habría mezclado en el arqueo el pago de una factura con la compra del
-- café, que son dos cosas distintas cuando hay que explicar una
-- diferencia.
-- ---------------------------------------------------------------------
ALTER TABLE vta_movimientos_efectivo DROP CONSTRAINT IF EXISTS vta_movimientos_efectivo_tipo_check;
ALTER TABLE vta_movimientos_efectivo
  ADD CONSTRAINT vta_movimientos_efectivo_tipo_check CHECK (
    tipo IN ('retiro_caja_fuerte', 'ingreso_cambio', 'gasto_caja_chica', 'pago_proveedor')
  );
