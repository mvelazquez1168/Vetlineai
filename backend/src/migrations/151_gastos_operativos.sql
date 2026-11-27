-- ---------------------------------------------------------------------
-- 151 — LOS GASTOS DE OPERACIÓN (prompt 10a, §3)
--
-- Lo que no es inventario: el alquiler, la luz, el internet, la
-- planilla, la publicidad, el laboratorio externo.
--
-- MISMA REGLA: no se retipea nada. Un recibo de electricidad que ya está
-- en la bandeja del 09b se clasifica como gasto **desde ahí**, y el
-- gasto guarda el vínculo al comprobante. Lo que se escribe a mano es
-- solo lo que no tiene comprobante electrónico, y queda marcado para que
-- el contador sepa cuáles no tienen soporte fiscal.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fin_categorias_gasto (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  codigo    VARCHAR(40) NOT NULL,
  nombre    VARCHAR(80) NOT NULL,
  activo    BOOLEAN NOT NULL DEFAULT true,
  orden     SMALLINT NOT NULL DEFAULT 100,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_categorias_gasto
  ON fin_categorias_gasto (tenant_id, codigo);

ALTER TABLE fin_categorias_gasto ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_categorias_gasto FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_categorias_gasto_tenant ON fin_categorias_gasto;
CREATE POLICY fin_categorias_gasto_tenant ON fin_categorias_gasto
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- LOS GASTOS RECURRENTES.
--
-- El alquiler de cada mes. Genera su gasto pendiente con el monto
-- estimado, y cuando llega el comprobante real se **concilia** con ese
-- pendiente en vez de duplicarlo. Sin eso, el alquiler aparece dos veces
-- todos los meses y el total del mes miente.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_gastos_recurrentes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  categoria_id UUID NOT NULL REFERENCES fin_categorias_gasto(id) ON DELETE RESTRICT
              DEFERRABLE INITIALLY DEFERRED,
  proveedor_id UUID REFERENCES inv_proveedores(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  descripcion VARCHAR(120) NOT NULL,
  monto_estimado NUMERIC(14,2) NOT NULL CHECK (monto_estimado > 0),
  moneda    VARCHAR(3) NOT NULL DEFAULT 'CRC' CHECK (moneda IN ('CRC', 'USD')),
  /* Qué día del mes se espera. 1 a 28 para que exista en febrero: el 31
     de febrero es la clase de fecha que rompe un job una vez al año. */
  dia_del_mes SMALLINT NOT NULL DEFAULT 1 CHECK (dia_del_mes BETWEEN 1 AND 28),
  linea_negocio VARCHAR(40) REFERENCES lineas_negocio(codigo)
              DEFERRABLE INITIALLY DEFERRED,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fin_gastos_recurrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_gastos_recurrentes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_gastos_recurrentes_tenant ON fin_gastos_recurrentes;
CREATE POLICY fin_gastos_recurrentes_tenant ON fin_gastos_recurrentes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- LOS GASTOS.
--
-- `estado` distingue el gasto **estimado** que generó una recurrencia
-- del gasto **real**. Es lo que hace posible conciliar en vez de
-- duplicar: el estimado se completa con los datos del comprobante
-- cuando llega, y no nace un segundo gasto.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_gastos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  fecha     DATE NOT NULL,
  categoria_id UUID NOT NULL REFERENCES fin_categorias_gasto(id) ON DELETE RESTRICT
              DEFERRABLE INITIALLY DEFERRED,
  proveedor_id UUID REFERENCES inv_proveedores(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  descripcion VARCHAR(200) NOT NULL,
  moneda    VARCHAR(3) NOT NULL DEFAULT 'CRC' CHECK (moneda IN ('CRC', 'USD')),
  monto     NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  /* Directo a una línea, o general. El 10b usa esta asignación para el
     estado de resultados por línea; acá solo se guarda. */
  linea_negocio VARCHAR(40) REFERENCES lineas_negocio(codigo)
              DEFERRABLE INITIALLY DEFERRED,
  /* El comprobante del que salió, cuando salió de uno. */
  recibido_id UUID REFERENCES fact_recibidos(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  /* La cuenta por pagar que generó, cuando no vino pagado. */
  cuenta_pagar_id UUID REFERENCES fin_cuentas_pagar(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  recurrente_id UUID REFERENCES fin_gastos_recurrentes(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  /* Sin soporte fiscal: la planilla, el pago a una persona física sin
     factura. El contador necesita saber cuáles son. */
  sin_comprobante BOOLEAN NOT NULL DEFAULT false,
  respaldo_url TEXT,
  estado    VARCHAR(12) NOT NULL DEFAULT 'real'
              CHECK (estado IN ('estimado', 'real', 'anulado')),
  anulado_motivo VARCHAR(200),
  creado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* Un gasto que salió de un comprobante no puede estar marcado «sin
     comprobante»: sería mentirle al contador en la columna que existe
     justamente para él. */
  CONSTRAINT fin_gastos_soporte_check CHECK (
    NOT (sin_comprobante AND recibido_id IS NOT NULL)
  )
);

-- Un comprobante recibido genera UN gasto. La misma regla que las
-- cuentas por pagar, por el mismo motivo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_gastos_recibido
  ON fin_gastos (recibido_id) WHERE recibido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fin_gastos_fecha ON fin_gastos (tenant_id, fecha);

ALTER TABLE fin_gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_gastos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_gastos_tenant ON fin_gastos;
CREATE POLICY fin_gastos_tenant ON fin_gastos
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- LAS CATEGORÍAS INICIALES, por disparador y por respaldo.
--
-- Las trece del prompt. Va con disparador sobre `tenants` desde el
-- principio: la lección de la 145 es que una semilla escrita como
-- `INSERT … SELECT FROM tenants` corre una sola vez y la clínica que se
-- registre mañana nace vacía.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_categorias_iniciales(p_tenant UUID) RETURNS void AS $$
  INSERT INTO fin_categorias_gasto (tenant_id, codigo, nombre, orden)
  SELECT p_tenant, v.codigo, v.nombre, v.orden
    FROM (VALUES
      ('alquiler',              'Alquiler',                 10),
      ('electricidad',          'Electricidad',             20),
      ('agua',                  'Agua',                     30),
      ('internet_telefono',     'Internet y teléfono',      40),
      ('planilla',              'Planilla',                 50),
      ('cargas_sociales',       'Cargas sociales',          60),
      ('mantenimiento',         'Mantenimiento',            70),
      ('limpieza',              'Limpieza',                 80),
      ('publicidad',            'Publicidad',               90),
      ('servicios_profesionales','Servicios profesionales', 100),
      ('laboratorio_externo',   'Laboratorio externo',     110),
      ('comisiones_bancarias',  'Comisiones bancarias',    120),
      ('otros',                 'Otros',                   130)
    ) AS v(codigo, nombre, orden)
  ON CONFLICT (tenant_id, codigo) DO NOTHING;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION fin_categorias_al_crear_clinica() RETURNS TRIGGER AS $$
BEGIN
  PERFORM fin_categorias_iniciales(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fin_categorias_iniciales ON tenants;
CREATE TRIGGER trg_fin_categorias_iniciales
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION fin_categorias_al_crear_clinica();

-- Y las clínicas que ya existen.
SELECT fin_categorias_iniciales(t.id) FROM tenants t;
