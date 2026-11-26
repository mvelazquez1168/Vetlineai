-- ---------------------------------------------------------------------
-- 100 — El receptor de la factura no es necesariamente el dueño
--
-- Sección 3 bis del prompt 08 y la regla nueva de la sección 3 de la
-- guía rectora. El dueño de la mascota y el receptor de la factura son
-- dos cosas distintas: la factura sale a nombre de la empresa del
-- dueño, de la fundación que paga la atención o de un familiar.
--
-- TRES DECISIONES DE MODELO, con su motivo:
--
-- 1. TABLA PROPIA, NO UNA FILA EN `propietarios`. La guía rectora dice
--    que el cliente es `propietarios` y que no hay una segunda tabla de
--    clientes en ningún módulo. Un perfil de facturación NO es un
--    cliente: no tiene mascotas, no tiene expediente, no recibe
--    recordatorios y no aparece en el CRM. Meterlo en `propietarios`
--    con un flag lo haría aparecer en la búsqueda de clientes, en los
--    listados y en las campañas, y habría que excluirlo en cada lugar.
--
-- 2. RELACIÓN DE MUCHOS A MUCHOS con los clientes. Una empresa paga por
--    varios empleados y una fundación por varios rescatados, así que un
--    perfil se liga a varios clientes; y un perfil puede no estar
--    ligado a ninguno (una factura que se emitió una vez a nombre de
--    alguien de paso).
--
-- 3. EL CRÉDITO PASA A SER DEL DEUDOR, que es el receptor. Hoy
--    `vta_credito_cliente` tiene `propietario_id` como clave primaria.
--    Si la factura sale a nombre de la empresa, la cuenta por cobrar es
--    de la empresa: cobrarle al dueño sería cobrarle a quien no debe.
--    La tabla pasa a tener un deudor que es UNO de los dos, con un
--    CHECK que lo impone.
--
-- LO QUE NO CAMBIA: la cuenta, la atención y el gasto del cliente en el
-- CRM siguen siendo del DUEÑO. Y el comprobante ya guardaba la copia
-- congelada de los datos del receptor desde la migración 091 —
-- `receptor_nombre`, `receptor_tipo_identificacion`, la ubicación, el
-- teléfono—, así que un cambio posterior en el perfil no altera una
-- factura emitida. Acá solo se agrega de QUÉ perfil salió.
-- ---------------------------------------------------------------------

CREATE TABLE fact_perfiles_facturacion (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Nombre o razón social. Mismo largo que `fact_comprobantes.receptor_nombre`
  -- (XSD v4.4: `Nombre` de 1 a 100), porque es exactamente ese campo.
  nombre         VARCHAR(100) NOT NULL,
  nombre_comercial VARCHAR(80),
  tipo_identificacion   VARCHAR(2) NOT NULL REFERENCES fact_cat_tipo_identificacion(codigo),
  numero_identificacion VARCHAR(20) NOT NULL,
  -- La dirección, con la codificación oficial que cargó el facturador.
  -- Sin FK a los catálogos de ubicación: la 093 las creó NOT VALID
  -- porque los catálogos se cargan después del esquema, y acá vale el
  -- mismo criterio. La validación la hace `exigirUbicacionValida`.
  ubicacion_provincia   VARCHAR(1),
  ubicacion_canton      VARCHAR(2),
  ubicacion_distrito    VARCHAR(2),
  ubicacion_barrio      VARCHAR(50),
  ubicacion_otras_senas VARCHAR(250),
  correo         VARCHAR(160),
  telefono_codigo_pais VARCHAR(3),
  telefono_numero      VARCHAR(20),
  -- Para el receptor, Hacienda admite la actividad económica (opcional).
  codigo_actividad VARCHAR(6) CHECK (codigo_actividad IS NULL OR codigo_actividad ~ '^[0-9]{6}$'),
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_por     UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- La identificación es la identidad fiscal: dos perfiles con la misma
  -- cédula en la misma clínica son el mismo perfil cargado dos veces, y
  -- después nadie sabe cuál está bien.
  UNIQUE (tenant_id, tipo_identificacion, numero_identificacion),
  CONSTRAINT fact_perfiles_identificacion_con_forma
    CHECK (numero_identificacion ~ '^[0-9]{9,20}$'),
  -- La ubicación va completa o no va: media ubicación no sirve para el
  -- XML (el Anexo 4.4 exige los tres niveles juntos cuando hay
  -- dirección) y tampoco para imprimir.
  CONSTRAINT fact_perfiles_ubicacion_completa
    CHECK (
      (ubicacion_provincia IS NULL AND ubicacion_canton IS NULL AND ubicacion_distrito IS NULL)
      OR (ubicacion_provincia IS NOT NULL AND ubicacion_canton IS NOT NULL
          AND ubicacion_distrito IS NOT NULL)
    )
);

CREATE INDEX idx_fact_perfiles_nombre ON fact_perfiles_facturacion (tenant_id, nombre);

ALTER TABLE fact_perfiles_facturacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_perfiles_facturacion FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_perfiles_facturacion_isolation ON fact_perfiles_facturacion
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- A qué clientes sirve cada perfil.
CREATE TABLE fact_perfil_clientes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  perfil_id      UUID NOT NULL REFERENCES fact_perfiles_facturacion(id) ON DELETE CASCADE,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
  -- El que la caja propone primero para ese cliente. Uno por cliente:
  -- dos "predeterminados" obligarían a elegir igual, que es lo que el
  -- predeterminado viene a evitar.
  es_predeterminado BOOLEAN NOT NULL DEFAULT false,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (perfil_id, propietario_id)
);

CREATE UNIQUE INDEX idx_fact_perfil_predeterminado
  ON fact_perfil_clientes (propietario_id) WHERE es_predeterminado;

CREATE INDEX idx_fact_perfil_clientes_propietario
  ON fact_perfil_clientes (propietario_id);

ALTER TABLE fact_perfil_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_perfil_clientes FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_perfil_clientes_isolation ON fact_perfil_clientes
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- De qué perfil salió un comprobante. La COPIA de los datos ya está en
-- las columnas `receptor_*` desde la 091; esto es la trazabilidad.
ALTER TABLE fact_comprobantes
  ADD COLUMN IF NOT EXISTS receptor_perfil_id UUID
    REFERENCES fact_perfiles_facturacion(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN fact_comprobantes.receptor_perfil_id IS
  'De qué perfil de facturación salió el receptor. Los datos emitidos están congelados en las columnas receptor_*: esta referencia es para saber de dónde vinieron, no para leerlos.';

-- ---------------------------------------------------------------------
-- El crédito es del DEUDOR
-- ---------------------------------------------------------------------
--
-- Se migra la tabla en vez de agregarle una columna al costado porque
-- `propietario_id` era la CLAVE PRIMARIA: dejarla obligatoria haría que
-- el crédito de una empresa necesitara un dueño inventado.
ALTER TABLE vta_credito_cliente
  ADD COLUMN IF NOT EXISTS perfil_id UUID
    REFERENCES fact_perfiles_facturacion(id) ON DELETE CASCADE;

ALTER TABLE vta_credito_cliente DROP CONSTRAINT IF EXISTS vta_credito_cliente_pkey;
ALTER TABLE vta_credito_cliente ALTER COLUMN propietario_id DROP NOT NULL;
ALTER TABLE vta_credito_cliente
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE vta_credito_cliente ADD PRIMARY KEY (id);

-- Uno de los dos, nunca los dos ni ninguno.
ALTER TABLE vta_credito_cliente DROP CONSTRAINT IF EXISTS vta_credito_un_deudor;
ALTER TABLE vta_credito_cliente
  ADD CONSTRAINT vta_credito_un_deudor
  CHECK ((propietario_id IS NOT NULL) <> (perfil_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_credito_propietario
  ON vta_credito_cliente (propietario_id) WHERE propietario_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_credito_perfil
  ON vta_credito_cliente (perfil_id) WHERE perfil_id IS NOT NULL;

-- Los abonos y los anticipos los hace el DEUDOR, por el mismo motivo:
-- si la factura es de la empresa, la empresa es la que abona.
ALTER TABLE vta_abonos
  ADD COLUMN IF NOT EXISTS perfil_id UUID
    REFERENCES fact_perfiles_facturacion(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE vta_abonos ALTER COLUMN propietario_id DROP NOT NULL;
ALTER TABLE vta_abonos DROP CONSTRAINT IF EXISTS vta_abonos_un_deudor;
ALTER TABLE vta_abonos
  ADD CONSTRAINT vta_abonos_un_deudor
  CHECK ((propietario_id IS NOT NULL) <> (perfil_id IS NOT NULL));

ALTER TABLE vta_anticipos
  ADD COLUMN IF NOT EXISTS perfil_id UUID
    REFERENCES fact_perfiles_facturacion(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE vta_anticipos ALTER COLUMN propietario_id DROP NOT NULL;
ALTER TABLE vta_anticipos DROP CONSTRAINT IF EXISTS vta_anticipos_un_deudor;
ALTER TABLE vta_anticipos
  ADD CONSTRAINT vta_anticipos_un_deudor
  CHECK ((propietario_id IS NOT NULL) <> (perfil_id IS NOT NULL));

COMMENT ON TABLE fact_perfiles_facturacion IS
  'A nombre de quién se emite una factura cuando no es el dueño de la mascota: la empresa del dueño, una fundación, un familiar. NO es un cliente: no tiene mascotas, ni expediente, ni recordatorios, ni aparece en el CRM.';
