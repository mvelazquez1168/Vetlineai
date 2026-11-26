-- =====================================================================
-- Vetline Clinic 06 — Catálogo, inventario y compras. Módulo `inventario`.
--
-- LA REGLA CENTRAL, de la que se deriva casi todo el modelo:
-- **todo el stock vive en UNIDAD BASE**, la más chica en que el producto
-- se mueve (tableta, ml, g, unidad, dosis). Nunca se guarda stock en
-- cajas ni en litros.
--
-- Por qué: en farmacia se compra en una unidad y se vende en otra. Si el
-- stock se guardara en cajas, vender 3 tabletas de una caja de 20 daría
-- 0,85 cajas, y después de veinte ventas el inventario estaría
-- descuadrado por redondeo sin que nadie pueda decir dónde. Guardando
-- tabletas, vender 3 resta 3 y la cuenta cierra siempre.
--
-- La PRESENTACIÓN es la forma de comprar, vender o consumir, con su
-- factor de conversión a la unidad base: la caja = 20 tabletas, la dosis
-- de alcohol = 100 ml, el kilo de algodón = 1000 g. Mover una
-- presentación mueve `cantidad × factor` en unidad base de la MISMA
-- existencia.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. DOS EJES QUE NO SON DE INVENTARIO, y por eso NO llevan prefijo
--    `inv_`: la línea de negocio y la especialidad.
--
-- La guía rectora (sección 3) las define como las dimensiones de TODO
-- ingreso y TODA salida —ventas, facturación, dashboards y CRM las van
-- a usar igual—, así que nacen como catálogo compartido y no como una
-- columna de texto dentro de productos. Una columna de texto daría
-- "Farmacia", "farmacia" y "FARMACIA" como tres líneas distintas en el
-- primer dashboard.
--
-- Sin `tenant_id`: son la misma lista para todas las clínicas, igual
-- que los `fact_cat_*`. Si una clínica necesita una propia, eso es una
-- decisión de producto que merece su migración, no una fila suelta.
-- ---------------------------------------------------------------------
CREATE TABLE lineas_negocio (
  codigo VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL,
  orden  INTEGER NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE lineas_negocio IS
  'Las líneas de negocio de la guía rectora §3. El COLOR de cada una no está acá: vive en la paleta de datos del frontend, mapeado por este mismo código. Una sola lista, un solo mapa de color.';

INSERT INTO lineas_negocio (codigo, nombre, orden) VALUES
  ('consulta',        'Consulta',         10),
  ('cirugia',         'Cirugía',          20),
  ('hospitalizacion', 'Hospitalización',  30),
  ('laboratorio',     'Laboratorio',      40),
  ('imagen',          'Imagen',           50),
  ('farmacia',        'Farmacia',         60),
  ('pet_shop',        'Pet shop',         70),
  ('grooming',        'Grooming',         80),
  ('hotel',           'Hotel',            90),
  ('vacunacion',      'Vacunación',      100);

CREATE TABLE especialidades (
  codigo VARCHAR(30) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  orden  INTEGER NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO especialidades (codigo, nombre, orden) VALUES
  ('medicina_general',  'Medicina general',             10),
  ('gastroenterologia', 'Gastroenterología y endoscopia', 20),
  ('cardiologia',       'Cardiología',                  30),
  ('dermatologia',      'Dermatología',                 40),
  ('ortopedia',         'Ortopedia',                    50),
  ('oftalmologia',      'Oftalmología',                 60),
  ('odontologia',       'Odontología',                  70),
  ('oncologia',         'Oncología',                    80),
  ('neurologia',        'Neurología',                   90),
  ('anestesiologia',    'Anestesiología',              100);

-- ---------------------------------------------------------------------
-- 1. BODEGAS
-- ---------------------------------------------------------------------
CREATE TABLE inv_bodegas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo    VARCHAR(20) NOT NULL,
  nombre    VARCHAR(80) NOT NULL,
  es_default BOOLEAN NOT NULL DEFAULT false,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

-- Una sola bodega por clínica puede ser la predeterminada. El índice
-- parcial lo impone; sin esto, dos bodegas marcadas por defecto harían
-- que "¿de dónde sale?" dependa del orden de la consulta.
CREATE UNIQUE INDEX idx_inv_bodegas_una_default
  ON inv_bodegas (tenant_id) WHERE es_default;

ALTER TABLE inv_bodegas ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_bodegas FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_bodegas_isolation ON inv_bodegas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 2. PROVEEDORES
-- ---------------------------------------------------------------------
CREATE TABLE inv_proveedores (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre                 VARCHAR(160) NOT NULL,
  tipo_identificacion    VARCHAR(2),
  numero_identificacion  VARCHAR(20),
  contacto_nombre        VARCHAR(120),
  contacto_telefono      VARCHAR(30),
  contacto_email         VARCHAR(160),
  condiciones_pago       VARCHAR(120),
  -- Cuánto tarda en entregar. Entra en el cálculo de la orden
  -- sugerida: sin esto no se puede saber cuánto stock hace falta para
  -- cubrir el tiempo que el pedido está en camino.
  dias_entrega           INTEGER NOT NULL DEFAULT 3 CHECK (dias_entrega >= 0),
  activo                 BOOLEAN NOT NULL DEFAULT true,
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inv_proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_proveedores FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_proveedores_isolation ON inv_proveedores
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 3. PRODUCTOS
--
-- `medicamento_id` VINCULA con el catálogo de Vetline Ai en vez de
-- duplicarlo: un producto de farmacia apunta al medicamento que
-- representa, y así una receta puede saber qué producto del inventario
-- se dispensa. Es NULL para lo que no es medicamento (alimento,
-- accesorios, insumos).
--
-- `unidad_base` es texto libre corto y NO una FK al catálogo de
-- unidades de Hacienda: las unidades fiscales (Nota 15) son las de la
-- FACTURA, y la unidad en que se guarda el stock es una decisión
-- interna. "tableta" no está en la Nota 15 y es exactamente la unidad
-- base correcta de una caja de 20. La unidad fiscal vive en la
-- presentación, que es lo que se factura.
-- ---------------------------------------------------------------------
CREATE TABLE inv_productos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo         VARCHAR(40) NOT NULL,
  nombre         VARCHAR(160) NOT NULL,
  principio_activo VARCHAR(160),
  concentracion  VARCHAR(80),
  medicamento_id UUID REFERENCES medicamentos(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  categoria      VARCHAR(60),
  linea_negocio  VARCHAR(20) NOT NULL REFERENCES lineas_negocio(codigo),
  codigo_cabys   VARCHAR(13) CHECK (codigo_cabys IS NULL OR codigo_cabys ~ '^[0-9]{13}$'),
  codigo_tarifa_iva VARCHAR(2) REFERENCES fact_cat_tarifa_iva(codigo),
  unidad_base    VARCHAR(20) NOT NULL,
  requiere_receta        BOOLEAN NOT NULL DEFAULT false,
  es_controlado          BOOLEAN NOT NULL DEFAULT false,
  requiere_refrigeracion BOOLEAN NOT NULL DEFAULT false,
  -- Días que dura el envase después de abierto (multidosis, alcohol,
  -- soluciones). NULL = no aplica.
  vida_util_apertura_dias INTEGER CHECK (vida_util_apertura_dias IS NULL OR vida_util_apertura_dias > 0),
  -- Por defecto NO. Un stock negativo es casi siempre un error de
  -- registro; permitirlo es la excepción y tiene que ser una decisión.
  permite_stock_negativo BOOLEAN NOT NULL DEFAULT false,
  minimo         NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (minimo >= 0),
  punto_reorden  NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (punto_reorden >= 0),
  proveedor_preferido_id UUID REFERENCES inv_proveedores(id) ON DELETE SET NULL
                           DEFERRABLE INITIALLY DEFERRED,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

COMMENT ON COLUMN inv_productos.minimo IS
  'En UNIDAD BASE, como todo el stock. Un mínimo en cajas y un stock en tabletas no se pueden comparar sin convertir, y esa conversión escrita en dos lugares es de donde salen las alertas que no disparan.';

CREATE INDEX idx_inv_productos_tenant ON inv_productos (tenant_id);
CREATE INDEX idx_inv_productos_medicamento ON inv_productos (medicamento_id)
  WHERE medicamento_id IS NOT NULL;
CREATE INDEX idx_inv_productos_busqueda
  ON inv_productos USING gin (inmutable_unaccent(lower(nombre)) gin_trgm_ops);

ALTER TABLE inv_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_productos FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_productos_isolation ON inv_productos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 4. PRESENTACIONES
--
-- `factor` es a cuántas unidades base equivale UNA de esta
-- presentación. La caja de 20 tabletas: factor 20. La tableta suelta:
-- factor 1. La dosis de 100 ml: factor 100. El kilo de algodón: 1000.
-- ---------------------------------------------------------------------
CREATE TABLE inv_presentaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id    UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE,
  codigo_interno VARCHAR(40) NOT NULL,
  codigo_barras  VARCHAR(60),
  nombre         VARCHAR(80) NOT NULL,
  factor         NUMERIC(14,4) NOT NULL CHECK (factor > 0),
  -- La unidad de medida FISCAL, del catálogo de Hacienda (Nota 15): es
  -- la que viaja en la línea del comprobante cuando se vende esta
  -- presentación.
  unidad_medida  VARCHAR(20) NOT NULL REFERENCES fact_cat_unidad_medida(codigo),
  precio_venta   NUMERIC(14,4) CHECK (precio_venta IS NULL OR precio_venta >= 0),
  para_compra    BOOLEAN NOT NULL DEFAULT false,
  para_venta     BOOLEAN NOT NULL DEFAULT false,
  para_consumo   BOOLEAN NOT NULL DEFAULT false,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo_interno),
  -- Una presentación que no sirve para nada no es una presentación.
  CONSTRAINT inv_presentaciones_sirve_para_algo
    CHECK (para_compra OR para_venta OR para_consumo)
);

CREATE INDEX idx_inv_presentaciones_producto ON inv_presentaciones (producto_id);
CREATE UNIQUE INDEX idx_inv_presentaciones_barras
  ON inv_presentaciones (tenant_id, codigo_barras) WHERE codigo_barras IS NOT NULL;

ALTER TABLE inv_presentaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_presentaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_presentaciones_isolation ON inv_presentaciones
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 5. LOTES — donde vive la existencia
--
-- La existencia NO tiene tabla propia: vive en el lote, porque el lote
-- ya es "este producto, en esta bodega, de esta tanda". Una tabla
-- `inv_existencias` aparte tendría exactamente las mismas tres claves y
-- habría que mantener las dos en acuerdo.
--
-- `vencimiento_efectivo` es una columna GENERADA: el menor entre el
-- vencimiento del lote y el de la apertura. Generada y no calculada en
-- el código porque la alerta de "por vencer", el FEFO y la pantalla
-- tienen que leer el MISMO número, y tres lugares que lo calculan son
-- tres lugares donde puede quedar distinto.
-- ---------------------------------------------------------------------
CREATE TABLE inv_lotes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id    UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE,
  bodega_id      UUID NOT NULL REFERENCES inv_bodegas(id) ON DELETE CASCADE,
  numero         VARCHAR(60) NOT NULL,
  vencimiento    DATE,
  costo_unitario NUMERIC(14,6) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  cantidad       NUMERIC(14,4) NOT NULL DEFAULT 0,
  fecha_apertura DATE,
  vencimiento_apertura DATE,
  vencimiento_efectivo DATE GENERATED ALWAYS AS (
    CASE
      WHEN vencimiento IS NULL THEN vencimiento_apertura
      WHEN vencimiento_apertura IS NULL THEN vencimiento
      ELSE LEAST(vencimiento, vencimiento_apertura)
    END
  ) STORED,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (producto_id, bodega_id, numero)
);

COMMENT ON COLUMN inv_lotes.costo_unitario IS
  'Costo de UNA unidad base. Es lo que hace que el margen de vender por tableta salga bien: el costo de la caja dividido entre 20. Una bonificación de compra (12 por el precio de 10) lo baja al recibir.';

CREATE INDEX idx_inv_lotes_fefo
  ON inv_lotes (producto_id, bodega_id, vencimiento_efectivo NULLS LAST)
  WHERE cantidad > 0;
CREATE INDEX idx_inv_lotes_por_vencer
  ON inv_lotes (tenant_id, vencimiento_efectivo) WHERE cantidad > 0;

ALTER TABLE inv_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_lotes FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_lotes_isolation ON inv_lotes
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 6. TIPOS DE MOVIMIENTO — con su dirección FIJA, en un catálogo único
--
-- Los trece, con la dirección en la BASE y no repartida por el código.
-- El motivo es concreto: si la dirección viviera en un `switch` de
-- TypeScript, un tipo nuevo agregado en la tabla y olvidado en el
-- switch entraría al sistema sumando donde debía restar, y el
-- inventario quedaría mal sin que nada falle.
-- ---------------------------------------------------------------------
CREATE TABLE inv_tipos_movimiento (
  codigo        VARCHAR(30) PRIMARY KEY,
  nombre        VARCHAR(60) NOT NULL,
  direccion     VARCHAR(7) NOT NULL CHECK (direccion IN ('entrada', 'salida')),
  origen_tipico VARCHAR(120) NOT NULL,
  orden         INTEGER NOT NULL DEFAULT 0,
  activo        BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO inv_tipos_movimiento (codigo, nombre, direccion, origen_tipico, orden) VALUES
  ('inventario_inicial',    'Inventario inicial',     'entrada', 'Importación o carga inicial',           10),
  ('compra',                'Compra',                 'entrada', 'Recepción de una orden de compra',      20),
  ('devolucion_cliente',    'Devolución de cliente',  'entrada', 'Nota de crédito de una venta; vuelve al lote original', 30),
  ('ajuste_positivo',       'Ajuste positivo',        'entrada', 'Conteo físico o corrección, con motivo', 40),
  ('traslado_entrante',     'Traslado entrante',      'entrada', 'Desde otra bodega',                     50),
  ('venta',                 'Venta',                  'salida',  'Caja o venta de mostrador',             60),
  ('atencion',              'Atención',               'salida',  'Producto dispensado o aplicado a un paciente', 70),
  ('consumo_interno',       'Consumo interno',        'salida',  'Receta de insumos de un servicio o uso general', 80),
  ('merma',                 'Merma',                  'salida',  'Rotura, derrame, pérdida, con motivo',  90),
  ('vencimiento',           'Vencimiento',            'salida',  'Baja de un lote vencido',              100),
  ('ajuste_negativo',       'Ajuste negativo',        'salida',  'Conteo físico o corrección, con motivo', 110),
  ('traslado_saliente',     'Traslado saliente',      'salida',  'Hacia otra bodega',                    120),
  ('devolucion_proveedor',  'Devolución a proveedor', 'salida',  'Producto devuelto al proveedor',       130);

-- Motivos de ajuste y de merma, de catálogo y no de texto libre: un
-- motivo escrito a mano no se puede agrupar en un dashboard.
CREATE TABLE inv_motivos (
  codigo        VARCHAR(30) PRIMARY KEY,
  nombre        VARCHAR(80) NOT NULL,
  exige_detalle BOOLEAN NOT NULL DEFAULT false,
  orden         INTEGER NOT NULL DEFAULT 0,
  activo        BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO inv_motivos (codigo, nombre, exige_detalle, orden) VALUES
  ('diferencia_conteo', 'Diferencia de conteo', false, 10),
  ('error_registro',    'Error de registro',    false, 20),
  ('producto_encontrado','Producto encontrado', false, 30),
  ('rotura',            'Rotura',               false, 40),
  ('derrame',           'Derrame',              false, 50),
  ('perdida',           'Pérdida',              false, 60),
  ('vencido',           'Vencido',              false, 70),
  ('otro',              'Otro',                 true,  99);

-- ---------------------------------------------------------------------
-- 7. AJUSTES CON APROBACIÓN
--
-- Un ajuste cuyo valor supera un umbral configurable no se aplica hasta
-- que un administrador lo aprueba. La tabla existe antes que los
-- movimientos porque un movimiento de ajuste apunta a ella.
-- ---------------------------------------------------------------------
CREATE TABLE inv_ajustes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo           VARCHAR(8) NOT NULL CHECK (tipo IN ('positivo', 'negativo')),
  estado         VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'aplicado')),
  motivo         VARCHAR(30) NOT NULL REFERENCES inv_motivos(codigo),
  motivo_detalle VARCHAR(200),
  -- El valor en dinero de lo que se ajusta. Es lo que se compara con el
  -- umbral: ajustar 1000 gasas baratas no es lo mismo que ajustar una
  -- ampolla cara, y contar unidades no distinguiría los dos casos.
  valor          NUMERIC(14,4) NOT NULL DEFAULT 0,
  solicitado_por UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  solicitado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  aprobado_por   UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  aprobado_en    TIMESTAMPTZ,
  aplicado_en    TIMESTAMPTZ,
  conteo_id      UUID,
  CONSTRAINT inv_ajustes_aprobado_tiene_quien
    CHECK (estado <> 'aprobado' OR (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL))
);

CREATE INDEX idx_inv_ajustes_pendientes
  ON inv_ajustes (tenant_id, solicitado_en) WHERE estado = 'pendiente';

ALTER TABLE inv_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_ajustes FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_ajustes_isolation ON inv_ajustes
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE inv_ajuste_lineas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ajuste_id   UUID NOT NULL REFERENCES inv_ajustes(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE,
  bodega_id   UUID NOT NULL REFERENCES inv_bodegas(id) ON DELETE CASCADE,
  lote_id     UUID REFERENCES inv_lotes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  cantidad_base NUMERIC(14,4) NOT NULL CHECK (cantidad_base > 0)
);

ALTER TABLE inv_ajuste_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_ajuste_lineas FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_ajuste_lineas_isolation ON inv_ajuste_lineas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 8. MOVIMIENTOS — SOLO SE AGREGAN
--
-- Cada entrada y cada salida es una fila. Un error se corrige con un
-- movimiento inverso, nunca editando ni borrando: el kardex es la
-- historia de lo que pasó, y una historia que se puede reescribir no
-- sirve para cuadrar un inventario ni para una auditoría.
--
-- `cantidad_base` es SIEMPRE POSITIVA. El signo lo pone la dirección
-- del tipo, que está en el catálogo. Guardar cantidades con signo
-- dejaría que una "merma de -5" sume, que es exactamente el error que
-- la dirección fija viene a impedir.
-- ---------------------------------------------------------------------
CREATE TABLE inv_movimientos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo          VARCHAR(30) NOT NULL REFERENCES inv_tipos_movimiento(codigo),
  producto_id   UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE,
  bodega_id     UUID NOT NULL REFERENCES inv_bodegas(id) ON DELETE CASCADE,
  lote_id       UUID REFERENCES inv_lotes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  cantidad_base NUMERIC(14,4) NOT NULL CHECK (cantidad_base > 0),
  -- Con qué presentación se registró, y cuántas. Se guarda además de la
  -- cantidad base para poder decir "vendió 1 caja" en vez de "vendió 20
  -- tabletas", que es lo que la persona hizo.
  presentacion_id UUID REFERENCES inv_presentaciones(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  cantidad_presentacion NUMERIC(14,4) CHECK (cantidad_presentacion IS NULL OR cantidad_presentacion > 0),
  costo_unitario NUMERIC(14,6) NOT NULL DEFAULT 0,
  motivo        VARCHAR(30) REFERENCES inv_motivos(codigo),
  motivo_detalle VARCHAR(200),
  persona_id    UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  -- Los cuatro vínculos OPCIONALES. Que un movimiento no tenga paciente
  -- es NORMAL (guía rectora §3): la venta de mostrador, la merma y el
  -- consumo del quirófano no lo tienen.
  paciente_id   UUID REFERENCES pacientes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  atencion_id   UUID REFERENCES atenciones(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  comprobante_id UUID REFERENCES fact_comprobantes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  compra_id     UUID,
  ajuste_id     UUID REFERENCES inv_ajustes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  -- El otro movimiento del par, para un traslado. Los dos lados quedan
  -- ligados: sin esto, un traslado se vería como una merma en una
  -- bodega y una aparición en la otra.
  movimiento_par_id UUID REFERENCES inv_movimientos(id) ON DELETE SET NULL
                      DEFERRABLE INITIALLY DEFERRED,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_movimientos_kardex
  ON inv_movimientos (tenant_id, producto_id, creado_en DESC);
CREATE INDEX idx_inv_movimientos_paciente
  ON inv_movimientos (tenant_id, paciente_id) WHERE paciente_id IS NOT NULL;
CREATE INDEX idx_inv_movimientos_atencion
  ON inv_movimientos (atencion_id) WHERE atencion_id IS NOT NULL;
CREATE INDEX idx_inv_movimientos_compra
  ON inv_movimientos (compra_id) WHERE compra_id IS NOT NULL;

ALTER TABLE inv_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_movimientos FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_movimientos_isolation ON inv_movimientos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

COMMENT ON TABLE inv_movimientos IS
  'Kardex. Solo se agrega: un trigger impide UPDATE y DELETE fuera de la purga. Un error se corrige con un movimiento inverso.';

-- ---------------------------------------------------------------------
-- 9. SERVICIOS Y SU RECETA DE INSUMOS
-- ---------------------------------------------------------------------
CREATE TABLE inv_servicios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo        VARCHAR(40) NOT NULL,
  nombre        VARCHAR(160) NOT NULL,
  linea_negocio VARCHAR(20) NOT NULL REFERENCES lineas_negocio(codigo),
  especialidad  VARCHAR(30) REFERENCES especialidades(codigo),
  codigo_cabys  VARCHAR(13) CHECK (codigo_cabys IS NULL OR codigo_cabys ~ '^[0-9]{13}$'),
  codigo_tarifa_iva VARCHAR(2) REFERENCES fact_cat_tarifa_iva(codigo),
  precio        NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  duracion_min  INTEGER CHECK (duracion_min IS NULL OR duracion_min > 0),
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

ALTER TABLE inv_servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_servicios FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_servicios_isolation ON inv_servicios
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Qué consume el servicio cada vez que se realiza. Lo va a usar la
-- atención para descargar insumos sola (prompt 07).
CREATE TABLE inv_servicio_insumos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  servicio_id     UUID NOT NULL REFERENCES inv_servicios(id) ON DELETE CASCADE,
  presentacion_id UUID NOT NULL REFERENCES inv_presentaciones(id) ON DELETE CASCADE,
  cantidad        NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
  UNIQUE (servicio_id, presentacion_id)
);

ALTER TABLE inv_servicio_insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_servicio_insumos FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_servicio_insumos_isolation ON inv_servicio_insumos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 10. LISTAS DE PRECIO
--
-- El precio BASE vive en la presentación y en el servicio. Una lista es
-- un REEMPLAZO opcional para un período o un convenio; no duplica el
-- catálogo, solo los precios que cambian.
-- ---------------------------------------------------------------------
CREATE TABLE inv_listas_precio (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo     VARCHAR(40) NOT NULL,
  nombre     VARCHAR(80) NOT NULL,
  vigente_desde DATE,
  vigente_hasta DATE,
  activo     BOOLEAN NOT NULL DEFAULT true,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo),
  CONSTRAINT inv_listas_precio_vigencia
    CHECK (vigente_hasta IS NULL OR vigente_desde IS NULL OR vigente_hasta >= vigente_desde)
);

ALTER TABLE inv_listas_precio ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_listas_precio FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_listas_precio_isolation ON inv_listas_precio
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE inv_lista_precio_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lista_id        UUID NOT NULL REFERENCES inv_listas_precio(id) ON DELETE CASCADE,
  presentacion_id UUID REFERENCES inv_presentaciones(id) ON DELETE CASCADE,
  servicio_id     UUID REFERENCES inv_servicios(id) ON DELETE CASCADE,
  precio          NUMERIC(14,4) NOT NULL CHECK (precio >= 0),
  -- O una presentación o un servicio, nunca los dos ni ninguno.
  CONSTRAINT inv_lista_precio_items_uno_u_otro
    CHECK ((presentacion_id IS NOT NULL) <> (servicio_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_inv_lista_precio_presentacion
  ON inv_lista_precio_items (lista_id, presentacion_id) WHERE presentacion_id IS NOT NULL;
CREATE UNIQUE INDEX idx_inv_lista_precio_servicio
  ON inv_lista_precio_items (lista_id, servicio_id) WHERE servicio_id IS NOT NULL;

ALTER TABLE inv_lista_precio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_lista_precio_items FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_lista_precio_items_isolation ON inv_lista_precio_items
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 11. COMPRAS
-- ---------------------------------------------------------------------
CREATE TABLE inv_proveedor_productos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id     UUID NOT NULL REFERENCES inv_proveedores(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE,
  presentacion_compra_id UUID NOT NULL REFERENCES inv_presentaciones(id) ON DELETE CASCADE,
  ultimo_costo     NUMERIC(14,6) CHECK (ultimo_costo IS NULL OR ultimo_costo >= 0),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proveedor_id, producto_id)
);

ALTER TABLE inv_proveedor_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_proveedor_productos FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_proveedor_productos_isolation ON inv_proveedor_productos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE inv_ordenes_compra (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero        INTEGER NOT NULL,
  proveedor_id  UUID NOT NULL REFERENCES inv_proveedores(id) ON DELETE CASCADE,
  bodega_id     UUID NOT NULL REFERENCES inv_bodegas(id) ON DELETE CASCADE,
  estado        VARCHAR(16) NOT NULL DEFAULT 'sugerida'
                  CHECK (estado IN ('sugerida','aprobada','enviada','recibida_parcial','recibida','cancelada')),
  -- La factura del proveedor. La conciliación automática contra el
  -- comprobante recibido del facturador es del prompt de finanzas; acá
  -- se guarda el número para poder hacerla a mano.
  factura_proveedor VARCHAR(60),
  creado_por    UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviada_en    TIMESTAMPTZ,
  recibida_en   TIMESTAMPTZ,
  UNIQUE (tenant_id, numero)
);

CREATE INDEX idx_inv_ordenes_estado ON inv_ordenes_compra (tenant_id, estado);

ALTER TABLE inv_ordenes_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_ordenes_compra FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_ordenes_compra_isolation ON inv_ordenes_compra
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE inv_orden_compra_lineas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  orden_id        UUID NOT NULL REFERENCES inv_ordenes_compra(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE,
  presentacion_id UUID NOT NULL REFERENCES inv_presentaciones(id) ON DELETE CASCADE,
  cantidad_pedida NUMERIC(14,4) NOT NULL CHECK (cantidad_pedida > 0),
  -- En unidad base, como todo. Se compara con la pedida × factor.
  cantidad_recibida_base NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (cantidad_recibida_base >= 0),
  costo_unitario  NUMERIC(14,6) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  -- Por qué se pidió esa cantidad, en palabras. La orden sugerida tiene
  -- que poder explicarse ("consumo de 46 tabletas al mes, entrega en 3
  -- días"), o nadie la aprueba con confianza.
  explicacion     VARCHAR(300),
  UNIQUE (orden_id, presentacion_id)
);

ALTER TABLE inv_orden_compra_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_orden_compra_lineas FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_orden_compra_lineas_isolation ON inv_orden_compra_lineas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE inv_movimientos
  ADD CONSTRAINT inv_movimientos_compra_fkey
  FOREIGN KEY (compra_id) REFERENCES inv_ordenes_compra(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------
-- 12. CONTEOS FÍSICOS
-- ---------------------------------------------------------------------
CREATE TABLE inv_conteos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bodega_id   UUID NOT NULL REFERENCES inv_bodegas(id) ON DELETE CASCADE,
  tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('total', 'ciclico')),
  -- Para el conteo cíclico: qué clasificación ABC se cuenta.
  clasificacion VARCHAR(1) CHECK (clasificacion IS NULL OR clasificacion IN ('A','B','C')),
  estado      VARCHAR(12) NOT NULL DEFAULT 'abierto'
                CHECK (estado IN ('abierto', 'cerrado', 'cancelado')),
  creado_por  UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_en  TIMESTAMPTZ
);

ALTER TABLE inv_conteos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_conteos FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_conteos_isolation ON inv_conteos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE inv_ajustes
  ADD CONSTRAINT inv_ajustes_conteo_fkey
  FOREIGN KEY (conteo_id) REFERENCES inv_conteos(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE inv_conteo_lineas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conteo_id       UUID NOT NULL REFERENCES inv_conteos(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE,
  lote_id         UUID REFERENCES inv_lotes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  -- Lo que el sistema creía que había cuando se abrió el conteo.
  cantidad_sistema NUMERIC(14,4) NOT NULL,
  -- Lo contado, capturado EN LA PRESENTACIÓN en que se contó.
  presentacion_id UUID REFERENCES inv_presentaciones(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  cantidad_contada_presentacion NUMERIC(14,4),
  cantidad_contada_base NUMERIC(14,4),
  UNIQUE (conteo_id, producto_id, lote_id)
);

ALTER TABLE inv_conteo_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_conteo_lineas FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_conteo_lineas_isolation ON inv_conteo_lineas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 13. PARÁMETROS DEL MÓDULO POR CLÍNICA
-- ---------------------------------------------------------------------
CREATE TABLE inv_parametros (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Sobre este valor (en dinero) un ajuste necesita aprobación.
  umbral_aprobacion_ajuste NUMERIC(14,4) NOT NULL DEFAULT 10000
    CHECK (umbral_aprobacion_ajuste >= 0),
  -- Días de stock de seguridad para la orden sugerida.
  dias_stock_seguridad INTEGER NOT NULL DEFAULT 7 CHECK (dias_stock_seguridad >= 0),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inv_parametros ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_parametros FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_parametros_isolation ON inv_parametros
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- =====================================================================
-- REGLAS EN LA BASE
-- =====================================================================

-- ---------------------------------------------------------------------
-- REGLA 1: los movimientos SOLO SE AGREGAN.
--
-- Mismo mecanismo que la inmutabilidad del facturador: se usa
-- `fact_es_operacion_directa()` —que ya distingue una operación normal
-- de la cascada de la purga— en vez de escribir un segundo detector
-- que diga lo mismo con otro nombre.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv_movimientos_solo_agregar()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- LA ÚNICA excepción, y es acotada: ligar los dos lados de un
    -- traslado. Los dos movimientos se insertan uno después del otro y
    -- cada uno necesita el id del otro, así que el segundo enlace no
    -- puede existir al INSERT. Se permite pasar de NULL a un valor una
    -- sola vez —misma regla que ya rige para `clave` y `xml_firmado`
    -- en el facturador— y nada más: cualquier otra columna que cambie,
    -- o un par que ya estaba puesto, sigue siendo un error.
    IF OLD.movimiento_par_id IS NULL
       AND NEW.movimiento_par_id IS NOT NULL
       AND to_jsonb(NEW) - 'movimiento_par_id' = to_jsonb(OLD) - 'movimiento_par_id' THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Un movimiento de inventario no se modifica (movimiento %). Un error se corrige con un movimiento inverso, que deja las dos filas en el kardex.',
      OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE EXCEPTION
    'Un movimiento de inventario no se borra (movimiento %). Un error se corrige con un movimiento inverso.',
    OLD.id USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER inv_movimientos_inmutables
  BEFORE UPDATE OR DELETE ON inv_movimientos
  FOR EACH ROW EXECUTE FUNCTION inv_movimientos_solo_agregar();

-- ---------------------------------------------------------------------
-- REGLA 2: la existencia de un lote nunca queda negativa, salvo que el
-- producto lo permita explícitamente.
--
-- Va en la BASE y no solo en el código porque es la última línea: dos
-- salidas simultáneas de la última unidad pueden pasar las dos
-- validaciones de aplicación —cada una lee 1 antes de que la otra
-- escriba— y solo la base ve las dos.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv_lote_no_negativo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  permite BOOLEAN;
BEGIN
  IF NEW.cantidad >= 0 THEN
    RETURN NEW;
  END IF;

  SELECT p.permite_stock_negativo INTO permite
    FROM inv_productos p WHERE p.id = NEW.producto_id;

  IF COALESCE(permite, false) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'La existencia del lote % quedaría en % y el producto no admite stock negativo. Si la salida es correcta, primero hay que registrar la entrada que falta.',
    NEW.numero, NEW.cantidad USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER inv_lotes_no_negativo
  BEFORE INSERT OR UPDATE OF cantidad ON inv_lotes
  FOR EACH ROW EXECUTE FUNCTION inv_lote_no_negativo();

-- ---------------------------------------------------------------------
-- REGLA 3: la dirección del movimiento manda sobre la existencia.
--
-- El movimiento no toca `inv_lotes` desde el código: lo hace este
-- trigger, leyendo la dirección del catálogo. Así es IMPOSIBLE que un
-- tipo de salida sume: no hay un camino donde el código elija el signo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv_aplicar_movimiento_a_lote()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  dir TEXT;
BEGIN
  IF NEW.lote_id IS NULL THEN
    RAISE EXCEPTION
      'El movimiento % no indica lote. Todo movimiento de stock sale de un lote o entra a uno.',
      NEW.id USING ERRCODE = 'not_null_violation';
  END IF;

  SELECT direccion INTO dir FROM inv_tipos_movimiento WHERE codigo = NEW.tipo;
  IF dir IS NULL THEN
    RAISE EXCEPTION 'El tipo de movimiento "%" no está en el catálogo.', NEW.tipo
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  UPDATE inv_lotes
     SET cantidad = cantidad + CASE WHEN dir = 'entrada' THEN NEW.cantidad_base
                                    ELSE -NEW.cantidad_base END
   WHERE id = NEW.lote_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER inv_movimientos_aplican_al_lote
  AFTER INSERT ON inv_movimientos
  FOR EACH ROW EXECUTE FUNCTION inv_aplicar_movimiento_a_lote();

COMMENT ON FUNCTION inv_aplicar_movimiento_a_lote() IS
  'La existencia la mueve la BASE, leyendo la dirección del catálogo de tipos. El código nunca elige el signo, así que un tipo de salida no puede sumar.';
