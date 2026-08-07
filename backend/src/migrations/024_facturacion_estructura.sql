-- =====================================================================
-- Migración 024 — Rediseño del modelo de facturación
-- Vetline Ai
--
-- Contrastada contra el esquema real. Cubre estructura únicamente;
-- el backfill de datos existentes va en la migración 025.
--
-- Hallazgos que resuelve:
--   * metodos_pago no existía: sin token no hay cobro recurrente
--   * cobros no distinguía concepto ni llevaba número de intento
--   * paises existía pero sin configuración fiscal ni de habilitación
--   * tenant_agentes conservaba el estado 'solicitud_pendiente'
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. MEDIOS DE PAGO  (faltante de la migración 022)
-- ---------------------------------------------------------------------

CREATE TABLE metodos_pago (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    proveedor          text NOT NULL DEFAULT 'tilopay',
    referencia_externa text NOT NULL,              -- token de la tarjeta
    marca              varchar(30),
    ultimos4           char(4),
    vencimiento_mes    smallint,
    vencimiento_anio   smallint,
    predeterminado     boolean NOT NULL DEFAULT false,
    estado             varchar(20) NOT NULL DEFAULT 'activo'
                       CHECK (estado IN ('activo','vencido','eliminado')),
    creado_en          timestamptz NOT NULL DEFAULT now(),
    actualizado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX metodo_pago_predeterminado_unico
    ON metodos_pago (tenant_id)
    WHERE predeterminado = true AND estado = 'activo';

CREATE INDEX idx_metodos_pago_tenant ON metodos_pago (tenant_id);

ALTER TABLE metodos_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE metodos_pago FORCE ROW LEVEL SECURITY;
CREATE POLICY metodos_pago_isolation ON metodos_pago
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));


-- ---------------------------------------------------------------------
-- 2. COBROS — concepto e intentos
-- ---------------------------------------------------------------------

ALTER TABLE cobros ADD COLUMN tipo varchar(30) NOT NULL DEFAULT 'suscripcion'
                   CHECK (tipo IN ('suscripcion','recarga','prorrateo_upgrade','ajuste'));
ALTER TABLE cobros ADD COLUMN intento_numero  smallint NOT NULL DEFAULT 1;
ALTER TABLE cobros ADD COLUMN metodo_pago_id  uuid REFERENCES metodos_pago(id);
ALTER TABLE cobros ADD COLUMN suscripcion_id  uuid;   -- FK se agrega tras crear suscripciones
ALTER TABLE cobros ADD COLUMN neto_usd        numeric(12,2);
ALTER TABLE cobros ADD COLUMN impuesto_usd    numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE cobros ADD COLUMN periodo_inicio  timestamptz;
ALTER TABLE cobros ADD COLUMN periodo_fin     timestamptz;


-- ---------------------------------------------------------------------
-- 3. PAÍSES — configuración fiscal y de habilitación
--    (la tabla ya existe: se extiende, no se crea)
-- ---------------------------------------------------------------------

ALTER TABLE paises ADD COLUMN estado varchar(20) NOT NULL DEFAULT 'no_disponible'
                   CHECK (estado IN ('no_disponible','lista_espera','habilitado'));
ALTER TABLE paises ADD COLUMN moneda_cotizacion     char(3) NOT NULL DEFAULT 'USD';
ALTER TABLE paises ADD COLUMN moneda_liquidacion    char(3);
ALTER TABLE paises ADD COLUMN pasarela_codigo       varchar(30);
ALTER TABLE paises ADD COLUMN proveedor_facturacion varchar(30);
ALTER TABLE paises ADD COLUMN actualizado_en        timestamptz NOT NULL DEFAULT now();

CREATE TABLE impuestos_pais (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pais_codigo   char(2) NOT NULL REFERENCES paises(codigo_iso),
    nombre        varchar(40) NOT NULL,          -- IVA, ITBMS, ITBIS, ISV
    tasa          numeric(6,4) NOT NULL,         -- 0.1300 = 13 %
    vigente_desde date NOT NULL,
    vigente_hasta date,
    creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX impuesto_vigente_por_pais
    ON impuestos_pais (pais_codigo)
    WHERE vigente_hasta IS NULL;

CREATE TABLE tipos_identificacion (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pais_codigo             char(2) NOT NULL REFERENCES paises(codigo_iso),
    codigo                  varchar(30) NOT NULL,
    etiqueta                varchar(80) NOT NULL,
    aplica_persona_fisica   boolean NOT NULL DEFAULT false,
    aplica_persona_juridica boolean NOT NULL DEFAULT false,
    formato_regex           varchar(200),
    orden                   int NOT NULL DEFAULT 0,
    activo                  boolean NOT NULL DEFAULT true,
    UNIQUE (pais_codigo, codigo)
);

CREATE TABLE lista_espera_paises (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    correo      varchar(200) NOT NULL,
    pais_codigo char(2),
    nombre      varchar(200),
    mensaje     text,
    creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lista_espera_pais ON lista_espera_paises (pais_codigo);


-- ---------------------------------------------------------------------
-- 4. PLANES — nueva estructura de cupos y precios
-- ---------------------------------------------------------------------

ALTER TABLE planes ADD COLUMN codigo                  varchar(30);
ALTER TABLE planes ADD COLUMN orden                   int NOT NULL DEFAULT 0;
ALTER TABLE planes ADD COLUMN agentes_incluidos       int;          -- NULL = todos
ALTER TABLE planes ADD COLUMN medicos_incluidos       int NOT NULL DEFAULT 1;
ALTER TABLE planes ADD COLUMN credito_ia_usd          numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE planes ADD COLUMN precio_anual_usd        numeric(10,2);
ALTER TABLE planes ADD COLUMN precio_agente_extra_usd numeric(10,2);
ALTER TABLE planes ADD COLUMN precio_medico_extra_usd numeric(10,2);
ALTER TABLE planes ADD COLUMN permite_agentes_extra   boolean NOT NULL DEFAULT false;
ALTER TABLE planes ADD COLUMN activo                  boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX planes_codigo_unico ON planes (codigo) WHERE codigo IS NOT NULL;

-- Columnas del modelo anterior. Se conservan hasta completar el backfill (025)
-- y se eliminan en la migración 026:
--   planes.cupos_agente_medico
--   planes.presupuesto_usd_incluido   -> credito_ia_usd
--   planes.precio_cupo_extra_usd
--   planes.stripe_price_id


-- ---------------------------------------------------------------------
-- 5. SUSCRIPCIONES
-- ---------------------------------------------------------------------

CREATE TABLE suscripciones (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id              uuid NOT NULL REFERENCES planes(id),
    periodicidad         varchar(20) NOT NULL DEFAULT 'mensual'
                         CHECK (periodicidad IN ('mensual','anual')),

    precio_pactado_usd   numeric(10,2) NOT NULL,
    credito_pactado_usd  numeric(10,2) NOT NULL,

    agentes_contratados  int,                    -- NULL = todos
    medicos_contratados  int NOT NULL,
    agentes_extra        int NOT NULL DEFAULT 0,
    medicos_extra        int NOT NULL DEFAULT 0,

    estado               varchar(30) NOT NULL
                         CHECK (estado IN ('prueba','activa','morosa','suspendida',
                                           'ventana_purga','cancelada','finalizada')),

    periodo_inicio       timestamptz NOT NULL,
    periodo_fin          timestamptz NOT NULL,
    proximo_cobro_en     timestamptz,

    creada_en            timestamptz NOT NULL DEFAULT now(),
    finalizada_en        timestamptz
);

CREATE UNIQUE INDEX suscripcion_vigente_por_tenant
    ON suscripciones (tenant_id)
    WHERE estado NOT IN ('cancelada','finalizada');

CREATE INDEX idx_suscripciones_cobro ON suscripciones (proximo_cobro_en)
    WHERE estado IN ('activa','morosa');

ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE suscripciones FORCE ROW LEVEL SECURITY;
CREATE POLICY suscripciones_isolation ON suscripciones
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));

ALTER TABLE cobros ADD CONSTRAINT cobros_suscripcion_fkey
    FOREIGN KEY (suscripcion_id) REFERENCES suscripciones(id);

ALTER TABLE tenants ADD COLUMN suscripcion_id uuid REFERENCES suscripciones(id);


-- Cambios de plan: upgrade ejecutado, downgrade programado, cancelación

CREATE TABLE cambios_suscripcion (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    suscripcion_id          uuid NOT NULL REFERENCES suscripciones(id) ON DELETE CASCADE,
    tipo                    varchar(20) NOT NULL
                            CHECK (tipo IN ('upgrade','downgrade','cancelacion')),
    plan_destino_id         uuid REFERENCES planes(id),
    periodicidad_destino    varchar(20),
    agentes_destino         int,
    medicos_destino         int,

    estado                  varchar(30) NOT NULL DEFAULT 'programado'
                            CHECK (estado IN ('programado','ejecutado','cancelado','requiere_atencion')),
    efectivo_en             timestamptz NOT NULL,

    cobro_id                uuid REFERENCES cobros(id),
    monto_prorrateado_usd   numeric(10,2),
    credito_prorrateado_usd numeric(10,2),

    solicitado_por          uuid REFERENCES personas(id),
    solicitado_en           timestamptz NOT NULL DEFAULT now(),
    ejecutado_en            timestamptz,
    motivo_atencion         text
);

CREATE INDEX idx_cambios_pendientes ON cambios_suscripcion (efectivo_en)
    WHERE estado = 'programado';

CREATE TABLE cambio_agentes_conservados (
    cambio_id uuid NOT NULL REFERENCES cambios_suscripcion(id) ON DELETE CASCADE,
    agente_id uuid NOT NULL REFERENCES agentes(id),
    PRIMARY KEY (cambio_id, agente_id)
);

CREATE TABLE cambio_medicos_conservados (
    cambio_id  uuid NOT NULL REFERENCES cambios_suscripcion(id) ON DELETE CASCADE,
    persona_id uuid NOT NULL REFERENCES personas(id),
    PRIMARY KEY (cambio_id, persona_id)
);


-- ---------------------------------------------------------------------
-- 6. CRÉDITO DE IA — saldo, libro mayor y recargas
-- ---------------------------------------------------------------------

CREATE TABLE saldos_ia (
    tenant_id            uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    credito_plan_usd     numeric(12,4) NOT NULL DEFAULT 0,   -- expira al cierre del período
    credito_comprado_usd numeric(12,4) NOT NULL DEFAULT 0,   -- no expira
    colchon_usado_usd    numeric(12,4) NOT NULL DEFAULT 0,
    actualizado_en       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saldos_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_ia FORCE ROW LEVEL SECURITY;
CREATE POLICY saldos_ia_isolation ON saldos_ia
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));


CREATE TABLE movimientos_credito (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tipo                varchar(30) NOT NULL
                        CHECK (tipo IN ('otorgamiento_plan','expiracion_plan','recarga',
                                        'consumo','colchon','cortesia','ajuste_admin',
                                        'credito_prueba','prorrateo_upgrade')),
    bolsa               varchar(20) NOT NULL
                        CHECK (bolsa IN ('plan','comprado','colchon')),
    monto_usd           numeric(12,4) NOT NULL,   -- negativo en consumos y expiraciones
    referencia_tabla    varchar(40),
    referencia_id       uuid,
    saldo_plan_post     numeric(12,4) NOT NULL,
    saldo_comprado_post numeric(12,4) NOT NULL,
    descripcion         text,
    creado_por          uuid REFERENCES personas(id),   -- NULL cuando lo genera el sistema
    creado_en           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimientos_tenant_fecha ON movimientos_credito (tenant_id, creado_en DESC);

ALTER TABLE movimientos_credito ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_credito FORCE ROW LEVEL SECURITY;
CREATE POLICY movimientos_credito_isolation ON movimientos_credito
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));


CREATE TABLE paquetes_recarga (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                 varchar(60) NOT NULL,
    monto_pagado_usd       numeric(10,2) NOT NULL,
    credito_acreditado_usd numeric(10,2) NOT NULL,
    es_minimo              boolean NOT NULL DEFAULT false,
    activo                 boolean NOT NULL DEFAULT true,
    orden                  int NOT NULL DEFAULT 0
);

CREATE TABLE recargas (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    paquete_id             uuid REFERENCES paquetes_recarga(id),
    origen                 varchar(20) NOT NULL CHECK (origen IN ('manual','automatica')),
    monto_pagado_usd       numeric(10,2) NOT NULL,
    credito_acreditado_usd numeric(10,2) NOT NULL,
    cobro_id               uuid REFERENCES cobros(id),
    estado                 varchar(20) NOT NULL DEFAULT 'pendiente'
                           CHECK (estado IN ('pendiente','acreditada','fallida')),
    solicitada_por         uuid REFERENCES personas(id),
    creada_en              timestamptz NOT NULL DEFAULT now(),
    acreditada_en          timestamptz
);

CREATE INDEX idx_recargas_tenant_fecha ON recargas (tenant_id, creada_en DESC);

ALTER TABLE recargas ENABLE ROW LEVEL SECURITY;
ALTER TABLE recargas FORCE ROW LEVEL SECURITY;
CREATE POLICY recargas_isolation ON recargas
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));


CREATE TABLE config_recarga (
    tenant_id                 uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    autorecarga_activa        boolean NOT NULL DEFAULT true,
    umbral_usd                numeric(10,2) NOT NULL DEFAULT 5,
    paquete_id                uuid REFERENCES paquetes_recarga(id),
    tope_mensual_recargas_usd numeric(10,2),        -- NULL = sin tope
    actualizado_en            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE config_recarga ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_recarga FORCE ROW LEVEL SECURITY;
CREATE POLICY config_recarga_isolation ON config_recarga
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));


-- ---------------------------------------------------------------------
-- 7. TARIFAS Y REGISTRO DE CONSUMO
-- ---------------------------------------------------------------------

CREATE TABLE tarifas_modelo (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modelo                varchar(80) NOT NULL,
    tipo_token            varchar(20) NOT NULL
                          CHECK (tipo_token IN ('entrada','salida','cache_escritura','cache_lectura')),
    precio_usd_por_millon numeric(12,6) NOT NULL,
    vigente_desde         timestamptz NOT NULL DEFAULT now(),
    vigente_hasta         timestamptz,
    creado_por            uuid,
    creado_en             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tarifa_vigente_por_modelo
    ON tarifas_modelo (modelo, tipo_token)
    WHERE vigente_hasta IS NULL;


ALTER TABLE uso_api ADD COLUMN tipo_consumo varchar(20) NOT NULL DEFAULT 'clinico'
                    CHECK (tipo_consumo IN ('clinico','regeneracion','operativo','cortesia'));
ALTER TABLE uso_api ADD COLUMN disparado_por varchar(20) NOT NULL DEFAULT 'usuario'
                    CHECK (disparado_por IN ('usuario','sistema'));
ALTER TABLE uso_api ADD COLUMN cobrable       boolean NOT NULL DEFAULT true;
ALTER TABLE uso_api ADD COLUMN bolsa_afectada varchar(20)
                    CHECK (bolsa_afectada IN ('plan','comprado','colchon','ninguna'));
ALTER TABLE uso_api ADD COLUMN persona_id     uuid REFERENCES personas(id);

-- Trazabilidad de tarifa: una referencia por tipo de token
ALTER TABLE uso_api ADD COLUMN tarifa_entrada_id         uuid REFERENCES tarifas_modelo(id);
ALTER TABLE uso_api ADD COLUMN tarifa_salida_id          uuid REFERENCES tarifas_modelo(id);
ALTER TABLE uso_api ADD COLUMN tarifa_cache_escritura_id uuid REFERENCES tarifas_modelo(id);
ALTER TABLE uso_api ADD COLUMN tarifa_cache_lectura_id   uuid REFERENCES tarifas_modelo(id);

CREATE INDEX idx_uso_api_tenant_tipo ON uso_api (tenant_id, tipo_consumo, "timestamp" DESC);


-- ---------------------------------------------------------------------
-- 8. IDENTIDAD FISCAL DEL CLIENTE
-- ---------------------------------------------------------------------

ALTER TABLE tenants ADD COLUMN tipo_persona varchar(20)
                    CHECK (tipo_persona IN ('fisica','juridica'));
ALTER TABLE tenants ADD COLUMN tipo_identificacion_id uuid REFERENCES tipos_identificacion(id);
ALTER TABLE tenants ADD COLUMN numero_identificacion  varchar(60);
ALTER TABLE tenants ADD COLUMN nombre_fiscal          varchar(200);


-- ---------------------------------------------------------------------
-- 9. DOCUMENTOS FISCALES
-- ---------------------------------------------------------------------

CREATE TABLE documentos_fiscales (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    cobro_id              uuid REFERENCES cobros(id),
    tipo                  varchar(20) NOT NULL CHECK (tipo IN ('factura','nota_credito')),
    numero_interno        varchar(40) NOT NULL UNIQUE,
    pais_codigo           char(2) NOT NULL REFERENCES paises(codigo_iso),

    -- copiados al emitir, no referenciados
    nombre_fiscal         varchar(200) NOT NULL,
    tipo_identificacion   varchar(80),
    numero_identificacion varchar(60),

    neto_usd              numeric(12,2) NOT NULL,
    impuesto_nombre       varchar(40),
    impuesto_tasa         numeric(6,4),
    impuesto_usd          numeric(12,2) NOT NULL DEFAULT 0,
    total_usd             numeric(12,2) NOT NULL,
    moneda                char(3) NOT NULL DEFAULT 'USD',

    estado_externo        varchar(20) NOT NULL DEFAULT 'no_aplica'
                          CHECK (estado_externo IN ('no_aplica','pendiente','emitido','rechazado')),
    proveedor             varchar(40),
    referencia_externa    varchar(120),
    mensaje_error         text,
    emitido_en            timestamptz,
    creado_en             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_documentos_fiscales_tenant ON documentos_fiscales (tenant_id, creado_en DESC);

ALTER TABLE documentos_fiscales ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_fiscales FORCE ROW LEVEL SECURITY;
CREATE POLICY documentos_fiscales_isolation ON documentos_fiscales
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));

CREATE TABLE documento_fiscal_detalle (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    documento_id    uuid NOT NULL REFERENCES documentos_fiscales(id) ON DELETE CASCADE,
    concepto        varchar(200) NOT NULL,
    cantidad        numeric(10,2) NOT NULL DEFAULT 1,
    precio_unitario numeric(12,2) NOT NULL,
    subtotal        numeric(12,2) NOT NULL,
    orden           int NOT NULL DEFAULT 0
);


-- ---------------------------------------------------------------------
-- 10. ENTITLEMENTS DE AGENTES
--
-- No hace falta UPDATE previo: al momento de aplicar esta migración no
-- quedaba ninguna fila en tenant_agentes con estado 'solicitud_pendiente'
-- (verificado contra la base real).
-- ---------------------------------------------------------------------

-- Se elimina 'solicitud_pendiente': la solicitud de agentes se deprecia
ALTER TABLE tenant_agentes DROP CONSTRAINT tenant_agentes_estado_check;
ALTER TABLE tenant_agentes ADD CONSTRAINT tenant_agentes_estado_check
    CHECK (estado IN ('habilitado','deshabilitado'));

ALTER TABLE tenant_agentes ADD COLUMN habilitado_en   timestamptz;
ALTER TABLE tenant_agentes ADD COLUMN deshabilitado_en timestamptz;
ALTER TABLE tenant_agentes ADD COLUMN periodo_ultimo_cambio timestamptz;   -- freno anti-rotación


-- ---------------------------------------------------------------------
-- 11. PERSONAS Y ROLES
-- ---------------------------------------------------------------------

ALTER TABLE personas ADD COLUMN es_medico boolean NOT NULL DEFAULT true;

-- Un colegiado no puede ser administrador de dos clínicas
CREATE UNIQUE INDEX colegiatura_admin_unica
    ON personas (colegiatura)
    WHERE es_admin_clinica = true AND colegiatura IS NOT NULL;


-- ---------------------------------------------------------------------
-- 12. PURGA Y EXPORTACIÓN
-- ---------------------------------------------------------------------

ALTER TABLE tenants ADD COLUMN purga_programada_para timestamptz;
ALTER TABLE tenants ADD COLUMN purga_aviso_en        timestamptz;
ALTER TABLE tenants ADD COLUMN purga_recordatorio_en timestamptz;
ALTER TABLE tenants ADD COLUMN purgado_en            timestamptz;

CREATE TABLE exportaciones (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    solicitada_por  uuid REFERENCES personas(id),
    estado          varchar(20) NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','generando','lista','descargada','fallida')),
    archivo_ref     varchar(300),
    casos_incluidos int,
    creada_en       timestamptz NOT NULL DEFAULT now(),
    lista_en        timestamptz,
    descargada_en   timestamptz,
    expira_en       timestamptz
);

ALTER TABLE exportaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY exportaciones_isolation ON exportaciones
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));


-- ---------------------------------------------------------------------
-- 13. NOTIFICACIONES DE USO — umbrales del nuevo modelo
--
-- No hace falta UPDATE previo: el único valor heredado ('limite_propio')
-- ya se migró a mano a 'tope_recargas' antes de aplicar esta migración
-- (verificado contra la base real).
-- ---------------------------------------------------------------------

ALTER TABLE notificaciones_uso DROP CONSTRAINT notificaciones_uso_umbral_check;
ALTER TABLE notificaciones_uso ADD CONSTRAINT notificaciones_uso_umbral_check
    CHECK (umbral IN ('saldo_bajo','saldo_agotado','colchon_agotado',
                      'tope_recargas','trial_80','trial_agotado',
                      'autorecarga_fallida'));


-- ---------------------------------------------------------------------
-- 14. PARÁMETROS DE PLATAFORMA
-- ---------------------------------------------------------------------

CREATE TABLE parametros_plataforma (
    clave           varchar(80) PRIMARY KEY,
    valor           text NOT NULL,
    tipo            varchar(20) NOT NULL CHECK (tipo IN ('numero','texto','booleano','json')),
    descripcion     text,
    actualizado_por uuid,
    actualizado_en  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO parametros_plataforma (clave, valor, tipo, descripcion) VALUES
 ('trial.credito_usd',              '2',  'numero',  'Crédito en USD asignado a la prueba gratuita'),
 ('trial.duracion_dias',            '5',  'numero',  'Duración máxima de la prueba en días'),
 ('trial.tope_global_mensual_usd',  '500','numero',  'Techo de consumo agregado de pruebas por mes'),
 ('saldo.umbral_aviso_usd',         '5',  'numero',  'Saldo que dispara el aviso de saldo bajo'),
 ('saldo.colchon_gracia_usd',       '3',  'numero',  'Margen para terminar el caso en curso'),
 ('purga.plazo_dias',               '15', 'numero',  'Días entre el fin de la prueba y la eliminación'),
 ('purga.recordatorio_dias_antes',  '3',  'numero',  'Anticipación del recordatorio de purga'),
 ('recarga.minimo_usd',             '25', 'numero',  'Monto mínimo de recarga'),
 ('agentes.cambios_por_ciclo',      '1',  'numero',  'Cambios de agente permitidos por ciclo');


-- ---------------------------------------------------------------------
-- 15. ESTADO DE SUSCRIPCIÓN EN TENANTS
--
-- A diferencia de los bloques 10 y 13, acá SÍ hace falta migrar datos
-- antes del ADD CONSTRAINT: verificado contra la base real, 5 tenants
-- seguían en 'trial' (0 en 'trial_expirado'). Orden correcto: DROP
-- primero, UPDATE con la restricción ya fuera, ADD al final.
-- ---------------------------------------------------------------------

ALTER TABLE tenants DROP CONSTRAINT tenants_estado_suscripcion_check;

UPDATE tenants SET estado_suscripcion = 'prueba'
 WHERE estado_suscripcion = 'trial';
UPDATE tenants SET estado_suscripcion = 'ventana_purga'
 WHERE estado_suscripcion = 'trial_expirado';

ALTER TABLE tenants ADD CONSTRAINT tenants_estado_suscripcion_check
    CHECK (estado_suscripcion IN ('pendiente_pago','prueba','activa','morosa',
                                  'suspendida','ventana_purga','cancelada','finalizada'));

COMMIT;


-- =====================================================================
-- PENDIENTE — no incluido en esta migración
--
--  * Migración 025: backfill de tenants existentes hacia suscripciones,
--    poblado del catálogo de planes, países habilitados, impuestos,
--    tipos de identificación, paquetes de recarga y tarifas por token.
--    Requiere confirmar la escalera de precios y el estado de los
--    tenants actuales.
--
--  * Migración 026: baja de solicitudes_activacion y de las columnas
--    heredadas (stripe_* en tenants, cupos_agente_medico y
--    presupuesto_usd_incluido en planes, tenants.plan varchar).
--    Ejecutar sólo tras verificar que ningún código las referencia.
--
--  * Corrección previa a producción: resolución de tenant_id desde
--    personas en lugar del claim del proveedor de identidad, y conexión
--    de la aplicación con un rol sin BYPASSRLS. Todas las tablas de esta
--    migración llevan políticas de aislamiento que hoy no se aplican.
-- =====================================================================
