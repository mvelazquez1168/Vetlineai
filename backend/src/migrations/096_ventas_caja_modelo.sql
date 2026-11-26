-- =====================================================================
-- Vetline Clinic 08 — Caja, ventas y cobros. Módulo `ventas`.
--
-- DOS REGLAS DE DINERO, de las que se deriva casi todo (guía rectora §2):
--
--   1. **Un cargo se cobra UNA vez.** Lo impone la base, no el código:
--      la suma de lo aplicado a una cuenta nunca puede superar su total.
--   2. **Un cierre de caja es inmutable.** Una vez arqueada y cerrada,
--      la sesión no se edita ni se borra. Si el arqueo estuvo mal, eso
--      es un hecho y se corrige con un movimiento posterior, no
--      reescribiendo el pasado.
--
-- LO FISCAL, con su fuente:
--
--   * El **Recibo Electrónico de Pago (REP)** es, según el Reglamento de
--     Comprobantes Electrónicos (definición 23), el comprobante que
--     "respalda el pago parcial por la venta de bienes y la prestación
--     de servicios a crédito con pago diferido conforme lo dictan los
--     artículos 3 inciso 8 y 27 de la Ley del IVA". Y el Anexo 4.4 dice
--     que en el REP los ÚNICOS códigos de condición de venta permitidos
--     son el 09 y el 11. Por eso un abono a una venta a crédito emite
--     un REP y no otra cosa.
--
--   * **Los anticipos NO tienen tratamiento en las fuentes oficiales.**
--     Se buscó "anticipo", "adelanto" y "pago anticipado" en los SIETE
--     documentos descargados (Anexos 4.4 y su actualización, el
--     Reglamento, la resolución DGT-R-000-2024, Generalidades, Código
--     de moneda y la Guía IdP): CERO menciones. Así que se implementa
--     la opción conservadora —el anticipo NO emite comprobante al
--     recibirse; es un saldo a favor, y el hecho fiscal ocurre con la
--     factura final, donde el anticipo entra como medio de pago— y se
--     deja la columna `comprobante_id` lista para el caso contrario,
--     por si el contador define que hay que facturar al recibir.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CAJAS Y SESIONES
-- ---------------------------------------------------------------------
CREATE TABLE vta_cajas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      VARCHAR(80) NOT NULL,
  -- De qué bodega descuenta lo que vende.
  bodega_id   UUID NOT NULL REFERENCES inv_bodegas(id) ON DELETE RESTRICT
                DEFERRABLE INITIALLY DEFERRED,
  -- La terminal de Hacienda que usa para el consecutivo. Dos cajas con
  -- la misma terminal se pelearían por la numeración.
  terminal    VARCHAR(5) NOT NULL DEFAULT '00001' CHECK (terminal ~ '^[0-9]{5}$'),
  sucursal    VARCHAR(3) NOT NULL DEFAULT '001' CHECK (sucursal ~ '^[0-9]{3}$'),
  imprime_tiquete BOOLEAN NOT NULL DEFAULT true,
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nombre),
  UNIQUE (tenant_id, sucursal, terminal)
);

ALTER TABLE vta_cajas ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_cajas FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_cajas_isolation ON vta_cajas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE vta_sesiones_caja (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  caja_id      UUID NOT NULL REFERENCES vta_cajas(id) ON DELETE CASCADE,
  estado       VARCHAR(10) NOT NULL DEFAULT 'abierta'
                 CHECK (estado IN ('abierta', 'cerrada')),
  abierta_por  UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  abierta_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  fondo_crc    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (fondo_crc >= 0),
  fondo_usd    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (fondo_usd >= 0),
  cerrada_por  UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  cerrada_en   TIMESTAMPTZ,
  -- Quién autorizó cerrar con una diferencia sobre el umbral.
  diferencia_aprobada_por UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT vta_sesiones_cerrada_tiene_datos
    CHECK (estado <> 'cerrada' OR (cerrada_en IS NOT NULL AND cerrada_por IS NOT NULL))
);

-- UNA sola sesión abierta por caja. Dos sesiones abiertas a la vez
-- harían que "¿a qué sesión entra este cobro?" dependa del orden de la
-- consulta, y el arqueo de las dos quedaría mal.
CREATE UNIQUE INDEX idx_vta_sesiones_una_abierta
  ON vta_sesiones_caja (caja_id) WHERE estado = 'abierta';

ALTER TABLE vta_sesiones_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_sesiones_caja FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_sesiones_caja_isolation ON vta_sesiones_caja
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- El arqueo: una fila por medio de pago, con lo esperado y lo declarado.
CREATE TABLE vta_arqueo_lineas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_id   UUID NOT NULL REFERENCES vta_sesiones_caja(id) ON DELETE CASCADE,
  medio       VARCHAR(20) NOT NULL,
  moneda      VARCHAR(3) NOT NULL DEFAULT 'CRC',
  -- Lo que el sistema calculó. Se guarda, no se recalcula al mirar: el
  -- arqueo es la foto de ese momento, y recalcularlo después daría otro
  -- número en cuanto entre un cobro nuevo.
  esperado    NUMERIC(14,2) NOT NULL,
  declarado   NUMERIC(14,2) NOT NULL,
  diferencia  NUMERIC(14,2) GENERATED ALWAYS AS (declarado - esperado) STORED,
  justificacion VARCHAR(300),
  UNIQUE (sesion_id, medio, moneda)
);

ALTER TABLE vta_arqueo_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_arqueo_lineas FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_arqueo_lineas_isolation ON vta_arqueo_lineas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Conteo por denominación, opcional.
CREATE TABLE vta_arqueo_denominaciones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_id  UUID NOT NULL REFERENCES vta_sesiones_caja(id) ON DELETE CASCADE,
  moneda     VARCHAR(3) NOT NULL,
  valor      NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  cantidad   INTEGER NOT NULL CHECK (cantidad >= 0),
  UNIQUE (sesion_id, moneda, valor)
);

ALTER TABLE vta_arqueo_denominaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_arqueo_denominaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_arqueo_denominaciones_isolation ON vta_arqueo_denominaciones
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Movimientos de efectivo que NO son ventas.
CREATE TABLE vta_movimientos_efectivo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_id   UUID NOT NULL REFERENCES vta_sesiones_caja(id) ON DELETE CASCADE,
  tipo        VARCHAR(20) NOT NULL
                CHECK (tipo IN ('retiro_caja_fuerte', 'ingreso_cambio', 'gasto_caja_chica')),
  moneda      VARCHAR(3) NOT NULL DEFAULT 'CRC',
  -- SIEMPRE positivo. La dirección la da el tipo, igual que en los
  -- movimientos de inventario: guardar el signo dejaría que un retiro
  -- de -500 sume.
  monto       NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  categoria_gasto VARCHAR(60),
  motivo      VARCHAR(300) NOT NULL,
  respaldo_url VARCHAR(500),
  persona_id  UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN vta_movimientos_efectivo.tipo IS
  'retiro_caja_fuerte e gasto_caja_chica SACAN efectivo; ingreso_cambio lo METE. La dirección vive acá, no en un signo.';

ALTER TABLE vta_movimientos_efectivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_movimientos_efectivo FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_movimientos_efectivo_isolation ON vta_movimientos_efectivo
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 2. TIPO DE CAMBIO DEL DÍA
--
-- Lo registra un administrador. Una tabla y no una constante porque
-- cambia todos los días y porque un cobro viejo tiene que poder decir a
-- qué tipo se convirtió, aunque hoy sea otro.
-- ---------------------------------------------------------------------
CREATE TABLE vta_tipos_cambio (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fecha      DATE NOT NULL,
  moneda     VARCHAR(3) NOT NULL DEFAULT 'USD',
  valor      NUMERIC(14,5) NOT NULL CHECK (valor > 0),
  fuente     VARCHAR(60) NOT NULL DEFAULT 'manual',
  registrado_por UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, fecha, moneda)
);

ALTER TABLE vta_tipos_cambio ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_tipos_cambio FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_tipos_cambio_isolation ON vta_tipos_cambio
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 3. CRÉDITO DEL CLIENTE Y SU SALDO A FAVOR
--
-- Cuelgan de `propietarios`, que es la única tabla de clientes.
-- ---------------------------------------------------------------------
CREATE TABLE vta_credito_cliente (
  propietario_id UUID PRIMARY KEY REFERENCES propietarios(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  habilitado     BOOLEAN NOT NULL DEFAULT false,
  limite         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (limite >= 0),
  plazo_dias     INTEGER NOT NULL DEFAULT 30 CHECK (plazo_dias >= 0),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vta_credito_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_credito_cliente FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_credito_cliente_isolation ON vta_credito_cliente
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 4. CUENTAS Y CARGOS
--
-- Una cuenta agrupa cargos de un cliente y puede quedar abierta varios
-- días (una hospitalización). Un cliente con varias mascotas se cobra
-- en UNA cuenta, y cada línea dice a qué mascota corresponde.
-- ---------------------------------------------------------------------
CREATE TABLE vta_cuentas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero         INTEGER NOT NULL,
  propietario_id UUID REFERENCES propietarios(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  -- Copia del nombre, por el mismo motivo que en el facturador: una
  -- cuenta vieja no cambia porque alguien corrija la ficha.
  cliente_nombre VARCHAR(200),
  estado         VARCHAR(12) NOT NULL DEFAULT 'abierta'
                   CHECK (estado IN ('abierta', 'cobrada', 'anulada')),
  sesion_id      UUID REFERENCES vta_sesiones_caja(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  abierta_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrada_en     TIMESTAMPTZ,
  UNIQUE (tenant_id, numero)
);

CREATE INDEX idx_vta_cuentas_abiertas ON vta_cuentas (tenant_id, estado)
  WHERE estado = 'abierta';
CREATE INDEX idx_vta_cuentas_cliente ON vta_cuentas (propietario_id)
  WHERE propietario_id IS NOT NULL;

ALTER TABLE vta_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_cuentas FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_cuentas_isolation ON vta_cuentas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Los cargos. EL PUNTO ÚNICO de entrada es `agregarCargo`; esta tabla
-- guarda de dónde vino cada uno para que la atención (prompt 07) los
-- agregue sin tocar la caja.
CREATE TABLE vta_cargos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cuenta_id       UUID NOT NULL REFERENCES vta_cuentas(id) ON DELETE CASCADE,
  -- De dónde salió. `manual` y `mostrador` hoy; `atencion` lo usará el
  -- prompt 07 sin cambiar nada de acá.
  origen          VARCHAR(20) NOT NULL
                    CHECK (origen IN ('mostrador', 'manual', 'atencion', 'encargo')),
  origen_id       UUID,
  -- Qué se cobra: una presentación del inventario, un servicio, o texto
  -- libre para un cargo manual.
  presentacion_id UUID REFERENCES inv_presentaciones(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  servicio_id     UUID REFERENCES inv_servicios(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  descripcion     VARCHAR(200) NOT NULL,
  -- A qué mascota corresponde la línea. Opcional: un alimento comprado
  -- en el mostrador no es de ninguna.
  paciente_id     UUID REFERENCES pacientes(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  cantidad        NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(14,4) NOT NULL CHECK (precio_unitario >= 0),
  descuento       NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  descuento_codigo VARCHAR(2),
  descuento_naturaleza VARCHAR(80),
  descuento_autorizado_por UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  codigo_cabys    VARCHAR(13),
  codigo_tarifa_iva VARCHAR(2) REFERENCES fact_cat_tarifa_iva(codigo),
  unidad_medida   VARCHAR(20) REFERENCES fact_cat_unidad_medida(codigo),
  linea_negocio   VARCHAR(20) REFERENCES lineas_negocio(codigo),
  -- Si el cargo ya descargó inventario, cuál fue el movimiento. Así una
  -- devolución sabe qué revertir.
  movimiento_id   UUID REFERENCES inv_movimientos(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  creado_por      UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_en      TIMESTAMPTZ,
  CONSTRAINT vta_cargos_descuento_con_naturaleza
    CHECK (descuento = 0 OR descuento_codigo IS NOT NULL)
);

CREATE INDEX idx_vta_cargos_cuenta ON vta_cargos (cuenta_id);
CREATE INDEX idx_vta_cargos_paciente ON vta_cargos (paciente_id)
  WHERE paciente_id IS NOT NULL;

ALTER TABLE vta_cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_cargos FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_cargos_isolation ON vta_cargos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 5. COBROS
--
-- Un cobro paga una cuenta, total o parcialmente, y puede combinar
-- varios medios (pago mixto). El comprobante electrónico lo emite el
-- facturador y acá queda su referencia.
-- ---------------------------------------------------------------------
CREATE TABLE vta_cobros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cuenta_id     UUID REFERENCES vta_cuentas(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  sesion_id     UUID NOT NULL REFERENCES vta_sesiones_caja(id) ON DELETE CASCADE,
  -- QUIÉN cobró. Una sesión compartida la operan varias personas y cada
  -- cobro tiene su responsable.
  cobrado_por   UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  total         NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  vuelto_crc    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vuelto_crc >= 0),
  comprobante_id UUID REFERENCES fact_comprobantes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  estado        VARCHAR(10) NOT NULL DEFAULT 'aplicado'
                  CHECK (estado IN ('aplicado', 'anulado')),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_en    TIMESTAMPTZ
);

CREATE INDEX idx_vta_cobros_sesion ON vta_cobros (sesion_id);
CREATE INDEX idx_vta_cobros_cuenta ON vta_cobros (cuenta_id);

ALTER TABLE vta_cobros ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_cobros FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_cobros_isolation ON vta_cobros
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE vta_cobro_medios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cobro_id    UUID NOT NULL REFERENCES vta_cobros(id) ON DELETE CASCADE,
  -- El código de medio de pago de Hacienda (Nota 6), más `anticipo` y
  -- `credito`, que NO son medios de Hacienda sino formas internas de
  -- saldar. Se distinguen por `es_fiscal`.
  medio       VARCHAR(20) NOT NULL,
  es_fiscal   BOOLEAN NOT NULL DEFAULT true,
  moneda      VARCHAR(3) NOT NULL DEFAULT 'CRC',
  -- Lo que entregó el cliente, en SU moneda.
  monto       NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  tipo_cambio NUMERIC(14,5) NOT NULL DEFAULT 1 CHECK (tipo_cambio > 0),
  -- Lo mismo, convertido a colones. Se guarda calculado para que el
  -- arqueo no tenga que volver a convertir con el tipo de hoy.
  monto_crc   NUMERIC(14,2) NOT NULL CHECK (monto_crc > 0),
  -- Tarjeta: el número de autorización que el cajero digita del
  -- datáfono. SINPE: la referencia.
  referencia  VARCHAR(60)
);

ALTER TABLE vta_cobro_medios ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_cobro_medios FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_cobro_medios_isolation ON vta_cobro_medios
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 6. ANTICIPOS Y SALDO A FAVOR
--
-- Ver la nota larga del encabezado: el anticipo NO emite comprobante al
-- recibirse (opción conservadora, porque las fuentes oficiales no dicen
-- nada del tema), y `comprobante_id` queda listo por si el contador
-- define lo contrario.
-- ---------------------------------------------------------------------
CREATE TABLE vta_anticipos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
  sesion_id      UUID REFERENCES vta_sesiones_caja(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  motivo         VARCHAR(200) NOT NULL,
  monto          NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  aplicado       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (aplicado >= 0),
  estado         VARCHAR(12) NOT NULL DEFAULT 'disponible'
                   CHECK (estado IN ('disponible', 'aplicado', 'devuelto')),
  encargo_id     UUID,
  comprobante_id UUID REFERENCES fact_comprobantes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  recibido_por   UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vta_anticipos_no_sobreaplica CHECK (aplicado <= monto)
);

COMMENT ON COLUMN vta_anticipos.comprobante_id IS
  'Queda NULL con el criterio conservador actual (el anticipo no emite comprobante al recibirse). Existe para el caso de que el contador defina que sí hay que facturarlo — ver el reporte del prompt 08.';

ALTER TABLE vta_anticipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_anticipos FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_anticipos_isolation ON vta_anticipos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 7. ABONOS A VENTAS A CRÉDITO
--
-- Un abono se aplica a UNA O VARIAS facturas y emite el REP que exige
-- Hacienda. `vta_abono_aplicaciones` es la que dice cuánto fue a cada
-- factura; sin ella, "abonó 50 000 a tres facturas" no se podría
-- repartir.
-- ---------------------------------------------------------------------
CREATE TABLE vta_abonos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
  sesion_id      UUID REFERENCES vta_sesiones_caja(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  monto          NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  -- El Recibo Electrónico de Pago que respalda el abono.
  rep_id         UUID REFERENCES fact_comprobantes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  recibido_por   UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vta_abonos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_abonos FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_abonos_isolation ON vta_abonos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE vta_abono_aplicaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  abono_id       UUID NOT NULL REFERENCES vta_abonos(id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES fact_comprobantes(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  monto          NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  UNIQUE (abono_id, comprobante_id)
);

ALTER TABLE vta_abono_aplicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_abono_aplicaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_abono_aplicaciones_isolation ON vta_abono_aplicaciones
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 8. ENCARGOS ESPECIALES
-- ---------------------------------------------------------------------
CREATE TABLE vta_encargos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
  producto_id    UUID REFERENCES inv_productos(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  descripcion    VARCHAR(200) NOT NULL,
  cantidad       NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
  estado         VARCHAR(16) NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','pedido','recibido','avisado','entregado','cancelado')),
  orden_compra_id UUID REFERENCES inv_ordenes_compra(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  -- Al recibirlo se reserva del stock para que no se le venda a otro.
  lote_reservado_id UUID REFERENCES inv_lotes(id) ON DELETE SET NULL
                      DEFERRABLE INITIALLY DEFERRED,
  cantidad_reservada NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (cantidad_reservada >= 0),
  avisado_en     TIMESTAMPTZ,
  entregado_en   TIMESTAMPTZ,
  creado_por     UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vta_anticipos
  ADD CONSTRAINT vta_anticipos_encargo_fkey
  FOREIGN KEY (encargo_id) REFERENCES vta_encargos(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE vta_encargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_encargos FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_encargos_isolation ON vta_encargos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 9. APROBACIONES
--
-- UNA tabla para las cuatro cosas que necesitan que un administrador
-- diga que sí: anular un cobro, anular un comprobante, devolver
-- producto, y pasarse del límite de crédito o del descuento máximo.
--
-- Una tabla y no cuatro: las cuatro tienen exactamente los mismos
-- campos (quién pide, qué, por qué, quién resuelve, cuándo), y cuatro
-- tablas iguales significan cuatro pantallas de aprobación que divergen.
-- ---------------------------------------------------------------------
CREATE TABLE vta_aprobaciones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo         VARCHAR(24) NOT NULL
                 CHECK (tipo IN ('anular_cobro','anular_comprobante','devolucion',
                                 'exceso_credito','descuento','diferencia_arqueo')),
  estado       VARCHAR(10) NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente','aprobada','rechazada')),
  -- A qué se refiere. Genérico a propósito: el tipo dice qué tabla es.
  referencia_id UUID,
  monto        NUMERIC(14,2),
  motivo       VARCHAR(300) NOT NULL,
  solicitada_por UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  solicitada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelta_por   UUID REFERENCES personas(id) DEFERRABLE INITIALLY DEFERRED,
  resuelta_en    TIMESTAMPTZ,
  nota_resolucion VARCHAR(300),
  CONSTRAINT vta_aprobaciones_resuelta_tiene_quien
    CHECK (estado = 'pendiente' OR (resuelta_por IS NOT NULL AND resuelta_en IS NOT NULL))
);

CREATE INDEX idx_vta_aprobaciones_pendientes
  ON vta_aprobaciones (tenant_id, solicitada_en) WHERE estado = 'pendiente';

ALTER TABLE vta_aprobaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_aprobaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_aprobaciones_isolation ON vta_aprobaciones
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 10. CONTINGENCIA: TALONARIO DE PROVISIONALES
-- ---------------------------------------------------------------------
CREATE TABLE vta_provisionales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  caja_id       UUID REFERENCES vta_cajas(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  numero        INTEGER NOT NULL,
  estado        VARCHAR(14) NOT NULL DEFAULT 'disponible'
                  CHECK (estado IN ('disponible','usado','regularizado','anulado')),
  -- Cuándo ocurrió la venta DE VERDAD, que no es cuándo se regularizó.
  fecha_venta   TIMESTAMPTZ,
  cuenta_id     UUID REFERENCES vta_cuentas(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  comprobante_id UUID REFERENCES fact_comprobantes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  regularizado_en TIMESTAMPTZ,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero)
);

ALTER TABLE vta_provisionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_provisionales FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_provisionales_isolation ON vta_provisionales
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 11. PARÁMETROS DEL MÓDULO
-- ---------------------------------------------------------------------
CREATE TABLE vta_parametros (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Sobre esta diferencia (en colones, en valor absoluto) un cierre
  -- necesita aprobación.
  umbral_diferencia_arqueo NUMERIC(14,2) NOT NULL DEFAULT 2000
    CHECK (umbral_diferencia_arqueo >= 0),
  -- Descuento máximo que un cajero aplica sin pedir permiso.
  descuento_maximo_pct NUMERIC(5,2) NOT NULL DEFAULT 10
    CHECK (descuento_maximo_pct >= 0 AND descuento_maximo_pct <= 100),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vta_parametros ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_parametros FORCE ROW LEVEL SECURITY;
CREATE POLICY vta_parametros_isolation ON vta_parametros
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- =====================================================================
-- REGLAS DE DINERO EN LA BASE
-- =====================================================================

-- ---------------------------------------------------------------------
-- REGLA 1: una cuenta no se cobra dos veces.
--
-- La suma de los cobros aplicados a una cuenta nunca supera su total.
-- Va en la BASE y no solo en el código porque dos cobros simultáneos de
-- la misma cuenta —dos cajeros, dos pestañas— pueden pasar los dos la
-- validación de aplicación antes de que cualquiera escriba.
--
-- El total de la cuenta se calcula de sus cargos no anulados. Se
-- permite 1 colón de tolerancia por el redondeo del impuesto: el
-- comprobante redondea a dos decimales y la suma de cargos puede dar
-- un céntimo distinto.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vta_no_sobrecobrar()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  total_cuenta NUMERIC(14,2);
  ya_cobrado   NUMERIC(14,2);
BEGIN
  IF NEW.cuenta_id IS NULL OR NEW.estado <> 'aplicado' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(
           (c.cantidad * c.precio_unitario - c.descuento)
           * (1 + COALESCE(t.tarifa, 0) / 100)
         ), 0)
    INTO total_cuenta
    FROM vta_cargos c
    LEFT JOIN fact_cat_tarifa_iva t ON t.codigo = c.codigo_tarifa_iva
   WHERE c.cuenta_id = NEW.cuenta_id AND c.anulado_en IS NULL;

  SELECT COALESCE(sum(co.total), 0) INTO ya_cobrado
    FROM vta_cobros co
   WHERE co.cuenta_id = NEW.cuenta_id
     AND co.estado = 'aplicado'
     AND co.id <> NEW.id;

  IF ya_cobrado + NEW.total > total_cuenta + 1 THEN
    RAISE EXCEPTION
      'La cuenta suma % y ya tiene cobrado %; este cobro de % la pasaría. Un cargo no se cobra dos veces.',
      total_cuenta, ya_cobrado, NEW.total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER vta_cobros_no_sobrecobrar
  BEFORE INSERT OR UPDATE ON vta_cobros
  FOR EACH ROW EXECUTE FUNCTION vta_no_sobrecobrar();

-- ---------------------------------------------------------------------
-- REGLA 2: un cierre de caja es inmutable.
--
-- Una sesión cerrada no se reabre, no se edita y no se borra; su arqueo
-- tampoco. Si el arqueo estuvo mal, eso ya es un hecho: se corrige con
-- un movimiento posterior, no reescribiendo el pasado. Es la misma
-- lógica que la inmutabilidad del comprobante enviado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vta_sesion_cerrada_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'cerrada' THEN
      RAISE EXCEPTION
        'La sesión de caja % está cerrada y no se borra: su arqueo es el registro de lo que había.',
        OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.estado = 'cerrada' THEN
    RAISE EXCEPTION
      'La sesión de caja % ya está cerrada y no se modifica. Una corrección va como movimiento posterior, no reescribiendo el arqueo.',
      OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER vta_sesiones_inmutables
  BEFORE UPDATE OR DELETE ON vta_sesiones_caja
  FOR EACH ROW EXECUTE FUNCTION vta_sesion_cerrada_inmutable();

CREATE OR REPLACE FUNCTION vta_arqueo_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  estado_sesion TEXT;
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT s.estado INTO estado_sesion
    FROM vta_sesiones_caja s
   WHERE s.id = COALESCE(NEW.sesion_id, OLD.sesion_id);

  IF estado_sesion = 'cerrada' THEN
    RAISE EXCEPTION
      'El arqueo de una sesión cerrada no se toca.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER vta_arqueo_lineas_inmutables
  BEFORE INSERT OR UPDATE OR DELETE ON vta_arqueo_lineas
  FOR EACH ROW EXECUTE FUNCTION vta_arqueo_inmutable();

-- ---------------------------------------------------------------------
-- REGLA 3: nada entra a una sesión cerrada.
--
-- Un cobro o un movimiento de efectivo con fecha posterior al cierre
-- descuadraría un arqueo que ya está firmado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vta_sesion_abierta_para_escribir()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  estado_sesion TEXT;
BEGIN
  SELECT s.estado INTO estado_sesion FROM vta_sesiones_caja s WHERE s.id = NEW.sesion_id;
  IF estado_sesion <> 'abierta' THEN
    RAISE EXCEPTION
      'La sesión de caja ya está cerrada: no se le pueden agregar movimientos. Abrí una sesión nueva.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vta_cobros_sesion_abierta
  BEFORE INSERT ON vta_cobros
  FOR EACH ROW EXECUTE FUNCTION vta_sesion_abierta_para_escribir();

CREATE TRIGGER vta_movimientos_efectivo_sesion_abierta
  BEFORE INSERT ON vta_movimientos_efectivo
  FOR EACH ROW EXECUTE FUNCTION vta_sesion_abierta_para_escribir();
