-- ---------------------------------------------------------------------
-- 130 — QUIÉN LO HIZO, QUÉ DENOMINACIONES HAY, CUÁNTO DESCUENTO SE
--       PUEDE DAR Y CUÁNTO CUESTA COBRAR CON TARJETA
--       (prompt 08b, puntos A2, A3, A4 y A5)
--
-- Cuatro cosas en una migración porque las cuatro son de la caja y
-- ninguna tiene sentido sola: el ejecutor sin la comisión no calcula un
-- honorario, y el tope sin el motivo no sale en el comprobante.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- A5. QUIÉN REALIZÓ EL SERVICIO Y QUIÉN REFIRIÓ EL CASO
--
-- `vta_cargos` tenía `creado_por`, que es **quien lo registró en el
-- sistema**: la recepcionista que arma la cuenta. Eso no sirve para
-- liquidar un honorario, y usar esa columna para las dos cosas sería el
-- defecto de nombre que ya apareció tres veces en este sistema.
--
-- Las dos columnas se llenan ahora y el cálculo es del prompt 11. Se
-- construyen igual, porque las comisiones se liquidan **sobre la
-- historia**: si el dato empieza a existir el día que se construya la
-- regla, el primer mes liquidado está vacío.
--
-- `exp_atencion_items.realizado_por` ya existía (migración 105): el
-- cargo lo hereda cuando nace de una atención.
-- ---------------------------------------------------------------------
ALTER TABLE vta_cargos
  ADD COLUMN IF NOT EXISTS realizado_por UUID REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS referido_por UUID REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_vta_cargos_realizado_por
  ON vta_cargos(realizado_por) WHERE realizado_por IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vta_cargos_referido_por
  ON vta_cargos(referido_por) WHERE referido_por IS NOT NULL;

COMMENT ON COLUMN vta_cargos.creado_por IS
  'Quién lo registró en el sistema. NO es quién lo hizo: para eso está realizado_por (prompt 08b, A5).';
COMMENT ON COLUMN vta_cargos.realizado_por IS
  'Quién realizó el servicio o la venta. Lo que el honorario del prompt 11 va a liquidar (prompt 08b, A5).';
COMMENT ON COLUMN vta_cargos.referido_por IS
  'Qué médico o funcionario derivó el caso. Opcional (prompt 08b, A5).';

-- ---------------------------------------------------------------------
-- A2. EL CATÁLOGO DE DENOMINACIONES
--
-- Estaba como una constante en el frontend (`CajaDelDia.tsx`), con el
-- argumento de que «son un hecho del país y no una configuración de la
-- clínica». El argumento se cae por dos lados: el prompt pide que la
-- clínica pueda editarlas, y una clínica que no recibe billetes de
-- ₡20 000 no quiere la línea en su planilla de conteo.
--
-- Mismo molde que `crm_fuentes_referencia`: `tenant_id` NULL es de la
-- plataforma y lo ve todo el mundo; la clínica agrega o desactiva las
-- suyas. Las de la plataforma salen de la emisión vigente del BCCR.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vta_denominaciones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* NULL = de la plataforma, para todas las clínicas. */
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  moneda    CHAR(3) NOT NULL,
  valor     NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  /* 'billete' o 'moneda'. Se cuentan en dos pilas distintas y la
     planilla de conteo las separa. */
  especie   VARCHAR(10) NOT NULL DEFAULT 'billete',
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vta_denominaciones_especie_check CHECK (especie IN ('billete', 'moneda'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_denominaciones_plataforma
  ON vta_denominaciones (moneda, valor) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_denominaciones_tenant
  ON vta_denominaciones (tenant_id, moneda, valor) WHERE tenant_id IS NOT NULL;

ALTER TABLE vta_denominaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_denominaciones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vta_denominaciones_tenant ON vta_denominaciones;
CREATE POLICY vta_denominaciones_tenant ON vta_denominaciones
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE vta_denominaciones IS
  'Billetes y monedas que se cuentan en el arqueo. Semilla de plataforma (BCCR) más lo que agregue la clínica (prompt 08b, A2).';

-- Colones: emisión vigente del BCCR (billetes de ₡1 000 a ₡20 000 y
-- monedas de ₡5 a ₡500). Dólares: los billetes que una clínica recibe.
INSERT INTO vta_denominaciones (tenant_id, moneda, valor, especie)
SELECT * FROM (VALUES
  (NULL::uuid, 'CRC', 20000, 'billete'),
  (NULL::uuid, 'CRC', 10000, 'billete'),
  (NULL::uuid, 'CRC',  5000, 'billete'),
  (NULL::uuid, 'CRC',  2000, 'billete'),
  (NULL::uuid, 'CRC',  1000, 'billete'),
  (NULL::uuid, 'CRC',   500, 'moneda'),
  (NULL::uuid, 'CRC',   100, 'moneda'),
  (NULL::uuid, 'CRC',    50, 'moneda'),
  (NULL::uuid, 'CRC',    25, 'moneda'),
  (NULL::uuid, 'CRC',    10, 'moneda'),
  (NULL::uuid, 'CRC',     5, 'moneda'),
  (NULL::uuid, 'USD',   100, 'billete'),
  (NULL::uuid, 'USD',    50, 'billete'),
  (NULL::uuid, 'USD',    20, 'billete'),
  (NULL::uuid, 'USD',    10, 'billete'),
  (NULL::uuid, 'USD',     5, 'billete'),
  (NULL::uuid, 'USD',     1, 'billete')
) AS v(tenant_id, moneda, valor, especie)
WHERE NOT EXISTS (
  SELECT 1 FROM vta_denominaciones d
   WHERE d.tenant_id IS NULL AND d.moneda = v.moneda AND d.valor = v.valor
);

-- Cuál es el modo predeterminado de conteo, por clínica.
ALTER TABLE vta_parametros
  ADD COLUMN IF NOT EXISTS arqueo_por_denominacion BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN vta_parametros.arqueo_por_denominacion IS
  'Si el cierre de caja abre contando por denominación. Contar solo el total sigue permitido (prompt 08b, A2).';

-- ---------------------------------------------------------------------
-- A2. EL VALE DE CAJA: QUIÉN RECIBE
--
-- `persona_id` es quien lo REGISTRA. En el caso que motiva el vale —el
-- adelanto a un empleado, el pago de la mensajería— quien recibe la
-- plata es otra persona, y es el dato por el que se firma el vale.
-- ---------------------------------------------------------------------
ALTER TABLE vta_movimientos_efectivo
  ADD COLUMN IF NOT EXISTS recibido_por UUID REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  /* Cuando quien recibe no es del personal: la mensajería, el ferretero. */
  ADD COLUMN IF NOT EXISTS recibido_por_nombre VARCHAR(120);

COMMENT ON COLUMN vta_movimientos_efectivo.persona_id IS
  'Quién lo registró en el sistema. Quién recibió la plata está en recibido_por (prompt 08b, A2).';
COMMENT ON COLUMN vta_movimientos_efectivo.recibido_por IS
  'Quién recibió el efectivo, cuando es del personal de la clínica (prompt 08b, A2).';
COMMENT ON COLUMN vta_movimientos_efectivo.recibido_por_nombre IS
  'Quién recibió el efectivo cuando no es del personal: la mensajería, un proveedor (prompt 08b, A2).';

-- ---------------------------------------------------------------------
-- A3. TOPES DE DESCUENTO Y MOTIVOS
--
-- Tres niveles, y vale el MENOR de los que apliquen:
--
--   1. el del producto o servicio (`descuento_maximo_pct` en su fila);
--   2. el del rol de quien lo aplica (`vta_topes_descuento`);
--   3. el general de la clínica, que ya existía en `vta_parametros`.
--
-- EL ROL ES TEXTO Y NO UNA FK, a propósito: hoy los roles de una clínica
-- son dos columnas booleanas de `personas` (`es_medico`,
-- `es_admin_clinica`) y no una tabla. El prompt 04 va a crear el rol de
-- recepción; cuando lo haga, se le agrega su fila acá y no hay que
-- rediseñar nada.
-- ---------------------------------------------------------------------
ALTER TABLE inv_productos
  ADD COLUMN IF NOT EXISTS descuento_maximo_pct NUMERIC(5,2)
    CHECK (descuento_maximo_pct IS NULL OR (descuento_maximo_pct >= 0 AND descuento_maximo_pct <= 100));
ALTER TABLE inv_servicios
  ADD COLUMN IF NOT EXISTS descuento_maximo_pct NUMERIC(5,2)
    CHECK (descuento_maximo_pct IS NULL OR (descuento_maximo_pct >= 0 AND descuento_maximo_pct <= 100));

COMMENT ON COLUMN inv_productos.descuento_maximo_pct IS
  'Descuento máximo de este producto. NULL = sin tope propio, rige el del rol y el de la clínica (prompt 08b, A3).';

CREATE TABLE IF NOT EXISTS vta_topes_descuento (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* 'medico', 'admin_clinica', 'recepcion'… El rol efectivo, en texto. */
  rol       VARCHAR(40) NOT NULL,
  /* NULL = sin tope (es lo que hace al administrador «sin tope»). */
  tope_pct  NUMERIC(5,2) CHECK (tope_pct IS NULL OR (tope_pct >= 0 AND tope_pct <= 100)),
  /* Quién puede AUTORIZAR por encima del tope de otro. */
  puede_autorizar BOOLEAN NOT NULL DEFAULT false,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_topes_descuento_rol
  ON vta_topes_descuento (tenant_id, rol);

ALTER TABLE vta_topes_descuento ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_topes_descuento FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vta_topes_descuento_tenant ON vta_topes_descuento;
CREATE POLICY vta_topes_descuento_tenant ON vta_topes_descuento
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE vta_topes_descuento IS
  'Hasta cuánto descuento puede dar cada rol, y quién puede autorizar por encima (prompt 08b, A3).';

-- ---------------------------------------------------------------------
-- EL MOTIVO DEL DESCUENTO, MAPEADO AL CÓDIGO DE HACIENDA.
--
-- El cajero elige «Cliente frecuente» y el comprobante sale con el
-- código que la estructura v4.4 exige en `CodigoDescuento`. Sin esta
-- tabla, alguien tendría que conocer los códigos de Hacienda para
-- cobrar, y los pondría todos en «99 — Otros», que es lo que hace que
-- el dato no sirva para nada después.
--
-- `codigo_hacienda` se valida contra `CodigoDescuentoType` del XSD con
-- el verificador de catálogos que ya existe: no se inventa acá.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vta_motivos_descuento (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  etiqueta  VARCHAR(80) NOT NULL,
  /* El valor que va en CodigoDescuento del comprobante (v4.4). */
  codigo_hacienda VARCHAR(2) NOT NULL,
  /* Cuando el código es '99' (Otros), Hacienda pide además el texto. */
  codigo_hacienda_otro VARCHAR(100),
  /* Si exige autorización siempre, pase lo que pase con el tope: una
     cortesía al 100 % no la da el cajero porque le alcance el tope. */
  exige_autorizacion BOOLEAN NOT NULL DEFAULT false,
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_motivos_descuento_plataforma
  ON vta_motivos_descuento (etiqueta) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_motivos_descuento_tenant
  ON vta_motivos_descuento (tenant_id, etiqueta) WHERE tenant_id IS NOT NULL;

ALTER TABLE vta_motivos_descuento ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_motivos_descuento FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vta_motivos_descuento_tenant ON vta_motivos_descuento;
CREATE POLICY vta_motivos_descuento_tenant ON vta_motivos_descuento
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE vta_motivos_descuento IS
  'Por qué se dio un descuento, con el código que el comprobante necesita. El cajero elige la etiqueta, no el código (prompt 08b, A3).';

-- El cargo guarda a qué motivo del catálogo corresponde, además del
-- código que ya guardaba: el código es lo que va al XML y el motivo es
-- lo que la clínica va a querer agrupar después.
ALTER TABLE vta_cargos
  ADD COLUMN IF NOT EXISTS motivo_descuento_id UUID
    REFERENCES vta_motivos_descuento(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------
-- A4. LO QUE CUESTA COBRAR CON TARJETA
--
-- La comisión del datáfono es un costo financiero real que hoy no se
-- registra en ninguna parte: la clínica cobra ₡50 000 y recibe ₡48 500,
-- y la diferencia aparece como un faltante inexplicable cuando alguien
-- concilia contra el banco. La rentabilidad del 10 lo necesita.
--
-- VIGENCIA DESDE UNA FECHA, no un valor único: cuando el banco cambia
-- la comisión, los cobros viejos tienen que seguir explicando su neto
-- con la comisión que les aplicaba.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vta_comisiones_tarjeta (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* El banco del datáfono: 'BAC', 'BN', 'Promerica'… Texto porque es el
     nombre del contrato, no una entidad del sistema. */
  banco     VARCHAR(60) NOT NULL,
  /* 'debito' o 'credito'. */
  tipo_tarjeta VARCHAR(20) NOT NULL,
  /* Opcional: 'Visa', 'Mastercard', 'AmEx'. NULL = cualquiera. */
  marca     VARCHAR(30),
  comision_pct NUMERIC(6,3) NOT NULL CHECK (comision_pct >= 0 AND comision_pct <= 100),
  /* Algunos contratos suman un fijo por transacción. */
  comision_fija NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (comision_fija >= 0),
  vigente_desde DATE NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vta_comisiones_tipo_check CHECK (tipo_tarjeta IN ('debito', 'credito'))
);

-- Una sola comisión por banco, tipo, marca y fecha de vigencia. La
-- marca NULL participa de la unicidad como un valor más: para eso va el
-- COALESCE, porque en un índice único dos NULL no chocan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_comisiones_vigencia
  ON vta_comisiones_tarjeta (tenant_id, banco, tipo_tarjeta, COALESCE(marca, ''), vigente_desde);

ALTER TABLE vta_comisiones_tarjeta ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_comisiones_tarjeta FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vta_comisiones_tarjeta_tenant ON vta_comisiones_tarjeta;
CREATE POLICY vta_comisiones_tarjeta_tenant ON vta_comisiones_tarjeta
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE vta_comisiones_tarjeta IS
  'Comisión del datáfono por banco, tipo de tarjeta y marca, con vigencia desde una fecha (prompt 08b, A4).';

-- Cada medio de cobro con tarjeta guarda lo que le costó.
ALTER TABLE vta_cobro_medios
  ADD COLUMN IF NOT EXISTS banco VARCHAR(60),
  ADD COLUMN IF NOT EXISTS tipo_tarjeta VARCHAR(20),
  ADD COLUMN IF NOT EXISTS marca_tarjeta VARCHAR(30),
  /* Lo que se espera que el banco se quede, calculado al cobrar. */
  ADD COLUMN IF NOT EXISTS comision_estimada NUMERIC(14,2),
  /* Lo que se espera recibir: monto - comisión. Se guarda calculado
     porque la comisión vigente puede cambiar después del cobro. */
  ADD COLUMN IF NOT EXISTS neto_esperado NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS comision_id UUID
    REFERENCES vta_comisiones_tarjeta(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN vta_cobro_medios.comision_estimada IS
  'Lo que el banco se queda de este cobro, con la comisión vigente al cobrarlo. Es el costo financiero de la rentabilidad (prompt 08b, A4).';

-- ---------------------------------------------------------------------
-- A4. EL LOTE DEL DATÁFONO
--
-- `vta_arqueo_lineas` ya compara el total de tarjetas contra lo
-- declarado. Lo que falta es el detalle del lote: el datáfono imprime
-- «VISA crédito: 12 transacciones, ₡340 000» y esa es la línea contra la
-- que se busca la diferencia.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vta_lote_datafono (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  sesion_id UUID NOT NULL REFERENCES vta_sesiones_caja(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  banco     VARCHAR(60) NOT NULL,
  tipo_tarjeta VARCHAR(20) NOT NULL,
  marca     VARCHAR(30),
  cantidad  INTEGER NOT NULL CHECK (cantidad >= 0),
  monto     NUMERIC(14,2) NOT NULL CHECK (monto >= 0),
  moneda    CHAR(3) NOT NULL DEFAULT 'CRC',
  /* El número de lote que imprime el datáfono, para buscarlo después. */
  numero_lote VARCHAR(40),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vta_lote_datafono_sesion
  ON vta_lote_datafono(sesion_id);

ALTER TABLE vta_lote_datafono ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_lote_datafono FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vta_lote_datafono_tenant ON vta_lote_datafono;
CREATE POLICY vta_lote_datafono_tenant ON vta_lote_datafono
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE vta_lote_datafono IS
  'Los totales del lote que imprime el datáfono al cerrar, por banco y tipo de tarjeta (prompt 08b, A4).';
