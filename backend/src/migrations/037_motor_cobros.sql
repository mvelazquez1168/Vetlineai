-- =====================================================================
-- VetPlatform — Migración 037
-- Motor de cobros. Credenciales de pasarela NO viven acá (van por
-- variable de entorno, resueltas por país — ver
-- backend/src/pagos/credencialesPasarela.ts) — esta migración solo
-- ajusta el modelo de datos que ya empezó a existir en 022/024/025.
-- =====================================================================

-- El token de tarjeta queda ligado a la afiliación (país) con la que se
-- generó — uno emitido bajo Costa Rica no sirve contra la de Panamá.
ALTER TABLE metodos_pago ADD COLUMN pais_codigo varchar(2);

-- motivo_falla estructurado (separado de mensaje_error, que es el texto
-- para humanos) — es lo que permite, más adelante, distinguir motivos
-- que admiten reintento de los que no, cuando el proveedor informe sus
-- códigos de rechazo reales.
ALTER TABLE cobros ADD COLUMN motivo_falla varchar(30);

-- Previstos para conciliar contra depósitos bancarios en países donde la
-- liquidación no es en dólares — no se pueblan todavía (el proveedor
-- simulado no los conoce), pero el campo tiene que existir desde ahora:
-- agregarlo después productivo obligaría a resolver cobros_liquidacion
-- retroactivamente sin poder saber la moneda real de cada uno.
ALTER TABLE cobros ADD COLUMN moneda_liquidada char(3);
ALTER TABLE cobros ADD COLUMN monto_liquidado numeric(12,2);

ALTER TABLE cobros DROP CONSTRAINT cobros_tipo_check;
ALTER TABLE cobros ADD CONSTRAINT cobros_tipo_check
    CHECK (tipo IN ('suscripcion', 'recarga', 'prorrateo_upgrade', 'conversion_prueba', 'ajuste'));

-- La conversión de prueba reutiliza cambios_suscripcion (mismo shape que
-- upgrade/downgrade: un plan destino, un cobro asociado) en vez de una
-- tabla nueva — y cambio_agentes_conservados para los agentes elegidos
-- al convertir, mismo mecanismo que ya usa el downgrade.
ALTER TABLE cambios_suscripcion DROP CONSTRAINT cambios_suscripcion_tipo_check;
ALTER TABLE cambios_suscripcion ADD CONSTRAINT cambios_suscripcion_tipo_check
    CHECK (tipo IN ('upgrade', 'downgrade', 'cancelacion', 'conversion_prueba'));

-- Referencia FIJA de "desde cuándo se está intentando cobrar este
-- período" — deliberadamente separada de suscripciones.periodo_fin, que
-- el motor de CRÉDITO (bloque 5, ciclo.job.ts) sigue avanzando todos los
-- meses sin importar si el cobro está resuelto (una clínica morosa
-- conserva su crédito). La política de reintentos de este motor de
-- cobros (0/3/7/10 días) cuenta desde acá, nunca desde periodo_fin — así
-- los dos ciclos (crédito y cobro) quedan realmente desacoplados, tal
-- como pide el prompt. Se limpia (vuelve a NULL) apenas el cobro tiene
-- éxito.
ALTER TABLE suscripciones ADD COLUMN cobro_intento_desde timestamptz;

-- El upgrade y la conversión de prueba ahora crean su fila de
-- cambios_suscripcion ANTES del cobro (estado 'programado', a la espera
-- del callback) y necesitan un estado terminal para cuando el cobro
-- falla — sin esto, un cobro fallido dejaba la fila en 'programado' para
-- siempre, indistinguible de "todavía esperando".
ALTER TABLE cambios_suscripcion DROP CONSTRAINT cambios_suscripcion_estado_check;
ALTER TABLE cambios_suscripcion ADD CONSTRAINT cambios_suscripcion_estado_check
    CHECK (estado IN ('programado', 'ejecutado', 'cancelado', 'requiere_atencion', 'fallido'));

ALTER TABLE movimientos_credito DROP CONSTRAINT movimientos_credito_tipo_check;
ALTER TABLE movimientos_credito ADD CONSTRAINT movimientos_credito_tipo_check
    CHECK (tipo IN ('otorgamiento_plan', 'expiracion_plan', 'recarga', 'consumo', 'colchon',
                    'cortesia', 'ajuste_admin', 'credito_prueba', 'prorrateo_upgrade', 'conversion_prueba'));

-- ---------------------------------------------------------------------
-- notificaciones_callback — Paso 5: "REGISTRA SIEMPRE". Toda notificación
-- entrante se persiste ACÁ antes de intentar resolverla contra cobros,
-- exista o no el order_number. Separada de `cobros` a propósito: un
-- payload que no matchea ningún cobro (huérfano) igual tiene que quedar
-- rastreado, y una tabla que dependiera de la FK a cobros no podría
-- guardarlo.
-- ---------------------------------------------------------------------
CREATE TABLE notificaciones_callback (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number        text,
    cobro_id            uuid REFERENCES cobros(id),
    payload             jsonb NOT NULL,
    resultado_atribuido varchar(20) NOT NULL DEFAULT 'pendiente'
                        CHECK (resultado_atribuido IN ('pendiente', 'atribuido', 'huerfano', 'duplicado', 'error')),
    error               text,
    recibido_en         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notificaciones_callback_order ON notificaciones_callback(order_number);

INSERT INTO parametros_plataforma (clave, valor, tipo, descripcion) VALUES
 ('cobro.reintentos_dias', '0,3,7,10', 'texto',
  'Días desde el vencimiento del período en que se reintenta un cobro fallido — el último es el intento que, de fallar, suspende la suscripción'),
 ('cobro.plazo_pendiente_horas', '24', 'numero',
  'Horas que un cobro puede quedar en pendiente antes de considerarse un callback perdido (trabajo de reconciliación)')
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE notificaciones_uso DROP CONSTRAINT notificaciones_uso_umbral_check;
ALTER TABLE notificaciones_uso ADD CONSTRAINT notificaciones_uso_umbral_check
    CHECK (umbral IN ('saldo_bajo', 'saldo_agotado', 'colchon_agotado',
                      'tope_recargas', 'trial_80', 'trial_agotado',
                      'autorecarga_fallida', 'cobro_fallido', 'suscripcion_suspendida'));
