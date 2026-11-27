-- ---------------------------------------------------------------------
-- 152 — EL CIERRE DIARIO CONSOLIDADO (prompt 10a, §5)
--
-- La caja ya se cuenta y se cierra sesión por sesión (08 y 08b). Lo que
-- falta es la vista del DÍA de la clínica: todas las sesiones juntas, el
-- datáfono, los cobros por SINPE marcados uno por uno contra lo que de
-- verdad llegó a la cuenta, y los depósitos de efectivo al banco.
--
-- POR QUÉ SINPE SE MARCA UNO POR UNO y no se compara un total: un cobro
-- por SINPE que el cliente dijo que hizo y no hizo deja un total que
-- cuadra con la caja y no con el banco. Lo que se concilia es el cobro,
-- no la suma.
--
-- LA CARGA AUTOMÁTICA DEL ESTADO DE CUENTA NO SE CONSTRUYE —así lo dice
-- el prompt— y esta tabla está preparada para ella: cuando exista, lo
-- que hará es llenar estas mismas filas.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fin_conciliaciones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  tipo      VARCHAR(20) NOT NULL CHECK (tipo IN ('sinpe', 'deposito')),
  fecha     DATE NOT NULL,
  /* Para un SINPE: el medio de cobro que se está marcando. Es el dato
     que ata la conciliación al cobro real y no a un monto suelto. */
  cobro_medio_id UUID REFERENCES vta_cobro_medios(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  monto     NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  moneda    VARCHAR(3) NOT NULL DEFAULT 'CRC' CHECK (moneda IN ('CRC', 'USD')),
  cuenta_banco_id UUID REFERENCES fin_cuentas_banco(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  referencia VARCHAR(80),
  respaldo_url TEXT,
  conciliado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  conciliado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* Un depósito necesita su cuenta; un SINPE, su cobro. */
  CONSTRAINT fin_conciliaciones_coherente CHECK (
    (tipo = 'sinpe' AND cobro_medio_id IS NOT NULL)
    OR (tipo = 'deposito' AND cobro_medio_id IS NULL)
  )
);

-- UN COBRO POR SINPE SE CONCILIA UNA SOLA VEZ. Sin esto, dos personas
-- marcando la misma lista el mismo día lo cuentan dos veces y el día
-- cuadra por un error doble.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_conciliaciones_cobro
  ON fin_conciliaciones (cobro_medio_id) WHERE cobro_medio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fin_conciliaciones_fecha
  ON fin_conciliaciones (tenant_id, fecha);

ALTER TABLE fin_conciliaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_conciliaciones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_conciliaciones_tenant ON fin_conciliaciones;
CREATE POLICY fin_conciliaciones_tenant ON fin_conciliaciones
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- EL DÍA CERRADO.
--
-- Una fila por fecha. `diferencia` es lo que no cuadró, y si no es cero
-- hace falta justificación: es la misma regla del arqueo del 08b, y por
-- el mismo motivo —una diferencia sin explicación es una diferencia que
-- nadie va a poder investigar el mes que viene—.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_cierre_dia (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  fecha     DATE NOT NULL,
  /* Lo que el cierre vio, congelado: el día se cierra con los números
     que había. Que una anulación posterior cambie el total no puede
     reescribir lo que se cerró. */
  total_ventas NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_efectivo NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_tarjeta NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_sinpe NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_conciliado NUMERIC(14,2) NOT NULL DEFAULT 0,
  diferencia NUMERIC(14,2) NOT NULL DEFAULT 0,
  justificacion VARCHAR(300),
  cerrado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  cerrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fin_cierre_dia_justifica CHECK (
    diferencia = 0 OR justificacion IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_cierre_dia
  ON fin_cierre_dia (tenant_id, fecha);

ALTER TABLE fin_cierre_dia ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_cierre_dia FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_cierre_dia_tenant ON fin_cierre_dia;
CREATE POLICY fin_cierre_dia_tenant ON fin_cierre_dia
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- LOS RECORDATORIOS DE SALDO, para poder respetar la política.
--
-- Cada cuántos días se le puede volver a recordar a un deudor sale de
-- `cobranza.dias_entre_recordatorios` (migración 149), y para aplicarla
-- hace falta saber cuándo fue el último. No se deriva de
-- `correos_enviados`: el recordatorio puede salir por WhatsApp, y
-- entonces no hay correo que mirar.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_recordatorios_saldo (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* Cuánto debía cuando se le recordó: el monto cambia, el recordatorio
     queda. */
  saldo NUMERIC(14,2) NOT NULL,
  canal VARCHAR(20) NOT NULL,
  notificacion_id UUID REFERENCES notificaciones(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  enviado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_recordatorios_saldo
  ON fin_recordatorios_saldo (tenant_id, propietario_id, enviado_en DESC);

ALTER TABLE fin_recordatorios_saldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_recordatorios_saldo FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_recordatorios_saldo_tenant ON fin_recordatorios_saldo;
CREATE POLICY fin_recordatorios_saldo_tenant ON fin_recordatorios_saldo
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
