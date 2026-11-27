-- ---------------------------------------------------------------------
-- 157 — HONORARIOS Y COMISIONES (prompt 11, §3)
--
-- Lo que se le paga a cada uno por lo que hizo. La base ya está puesta
-- desde el 08b y nadie la leía: `vta_cargos.realizado_por` y
-- `.referido_por` dicen **quién hizo cada cosa y quién la refirió**.
--
-- GANA LA REGLA MÁS ESPECÍFICA. Una clínica configura «10 % de cirugías
-- para la Dra. Mora» y «5 % de cirugías para todos»: la de ella manda.
-- El orden de especificidad está escrito en `comisiones.ts` y se verifica.
--
-- POR OMISIÓN SE CALCULA SOBRE LO COBRADO, no sobre lo facturado: una
-- comisión pagada sobre una factura que el cliente nunca pagó es plata
-- que la clínica puso. Es configurable porque hay clínicas que trabajan
-- al revés.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS com_reglas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* A quién. NULL = a todos: es la regla general de la clínica. */
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* Sobre qué. Los tres son opcionales y se combinan: de lo más
     específico (un servicio) a lo más general (una línea de negocio). */
  servicio_id UUID REFERENCES inv_servicios(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  familia_id UUID REFERENCES inv_familias(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  linea_negocio VARCHAR(40) REFERENCES lineas_negocio(codigo)
              DEFERRABLE INITIALLY DEFERRED,
  /* Por hacerlo o por referirlo: son dos comisiones distintas sobre el
     mismo cargo, y las dos pueden existir. */
  rol_en_el_cargo VARCHAR(12) NOT NULL DEFAULT 'realizado'
              CHECK (rol_en_el_cargo IN ('realizado', 'referido')),
  tipo      VARCHAR(12) NOT NULL CHECK (tipo IN ('porcentaje', 'monto')),
  valor     NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
  /* Sobre lo cobrado (por omisión) o sobre lo facturado. */
  base      VARCHAR(12) NOT NULL DEFAULT 'cobrado'
              CHECK (base IN ('cobrado', 'facturado')),
  /* El IVA nunca es del médico: siempre se descuenta. Lo que es
     opcional es descontar además el costo de los insumos. */
  descontar_insumos BOOLEAN NOT NULL DEFAULT false,
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* Un porcentaje mayor que 100 es un dedo que se resbaló. */
  CONSTRAINT com_reglas_porcentaje CHECK (tipo <> 'porcentaje' OR valor <= 100)
);

CREATE INDEX IF NOT EXISTS idx_com_reglas_persona
  ON com_reglas (tenant_id, persona_id) WHERE activo;

-- ---------------------------------------------------------------------
-- LAS LIQUIDACIONES.
--
-- Un borrador que el administrador revisa, ajusta con un motivo y
-- aprueba. **La liquidación aprobada nunca se edita**: lo que pasa
-- después —una anulación, una devolución— genera un ajuste en la
-- siguiente. Eso es lo que hace que un recibo de pago firmado siga
-- significando algo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS com_liquidaciones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE RESTRICT
              DEFERRABLE INITIALLY DEFERRED,
  desde     DATE NOT NULL,
  hasta     DATE NOT NULL,
  estado    VARCHAR(12) NOT NULL DEFAULT 'borrador'
              CHECK (estado IN ('borrador', 'aprobada')),
  total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  aprobado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  aprobado_en TIMESTAMPTZ,
  creado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT com_liquidaciones_periodo CHECK (hasta >= desde),
  CONSTRAINT com_liquidaciones_aprobada CHECK (
    estado <> 'aprobada' OR (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL)
  )
);

-- Una persona tiene UNA liquidación por período: dos serían dos pagos
-- por lo mismo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_com_liquidaciones_periodo
  ON com_liquidaciones (persona_id, desde, hasta);

CREATE TABLE IF NOT EXISTS com_liquidacion_lineas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  liquidacion_id UUID NOT NULL REFERENCES com_liquidaciones(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* El cargo que la origina. NULL solo en los ajustes manuales. */
  cargo_id  UUID REFERENCES vta_cargos(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  regla_id  UUID REFERENCES com_reglas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  descripcion VARCHAR(200) NOT NULL,
  /* Sobre cuánto se calculó, y cuánto da. Se guardan los dos: el
     porcentaje de la regla puede cambiar mañana, y esta línea tiene que
     seguir explicando de dónde salió su monto. */
  base      NUMERIC(14,2) NOT NULL DEFAULT 0,
  porcentaje NUMERIC(6,2),
  monto     NUMERIC(14,2) NOT NULL,
  /* Un ajuste: negativo por una anulación posterior, o manual con su
     motivo. */
  es_ajuste BOOLEAN NOT NULL DEFAULT false,
  motivo    VARCHAR(200),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* Un ajuste sin motivo es un número que nadie va a poder explicar. */
  CONSTRAINT com_lineas_ajuste_motivo CHECK (NOT es_ajuste OR motivo IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_com_lineas_liquidacion
  ON com_liquidacion_lineas (liquidacion_id);

-- UN CARGO NO SE LIQUIDA DOS VECES por el mismo concepto. Es la
-- invariante de dinero de este bloque: sin ella, recalcular un borrador
-- después de haber aprobado el anterior paga dos veces la misma cirugía.
CREATE UNIQUE INDEX IF NOT EXISTS idx_com_lineas_cargo_unico
  ON com_liquidacion_lineas (cargo_id, es_ajuste)
  WHERE cargo_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- UNA LIQUIDACIÓN APROBADA NO SE TOCA.
--
-- Ni sus líneas ni su total. El trigger lo impone en la base porque es
-- plata ya pagada: lo que venga después es un ajuste en la siguiente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION com_liquidacion_aprobada_es_inmutable() RETURNS TRIGGER AS $$
DECLARE
  v_estado TEXT;
BEGIN
  SELECT estado INTO v_estado FROM com_liquidaciones
   WHERE id = COALESCE(NEW.liquidacion_id, OLD.liquidacion_id);
  IF v_estado = 'aprobada' THEN
    RAISE EXCEPTION
      'Esa liquidación ya está aprobada y no se edita. Lo que haya cambiado se ajusta en la siguiente.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_com_lineas_inmutables ON com_liquidacion_lineas;
CREATE TRIGGER trg_com_lineas_inmutables
  AFTER INSERT OR UPDATE OR DELETE ON com_liquidacion_lineas
  FOR EACH ROW EXECUTE FUNCTION com_liquidacion_aprobada_es_inmutable();

CREATE OR REPLACE FUNCTION com_liquidacion_no_vuelve_a_borrador() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado = 'aprobada' AND NEW.estado <> 'aprobada' THEN
    RAISE EXCEPTION 'Una liquidación aprobada no vuelve a borrador.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado = 'aprobada' AND NEW.total <> OLD.total THEN
    RAISE EXCEPTION 'El total de una liquidación aprobada no cambia.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_com_liquidacion_estado ON com_liquidaciones;
CREATE TRIGGER trg_com_liquidacion_estado
  AFTER UPDATE ON com_liquidaciones
  FOR EACH ROW EXECUTE FUNCTION com_liquidacion_no_vuelve_a_borrador();

SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_reglas', 'com_liquidaciones', 'com_liquidacion_lineas'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t || '_tenant', t
    );
  END LOOP;
END $$;
