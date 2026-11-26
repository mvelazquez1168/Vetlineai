-- ---------------------------------------------------------------------
-- 119 — EL DICTADO DE LA CONSULTA COMPLETA (prompt 07d, fase 2).
--
-- La fase 1 no necesitó base: el navegador escucha y el texto va al
-- campo. La fase 2 sí, porque el audio se transcribe en el servidor, un
-- modelo lo ordena, y eso cuesta dinero y deja un borrador que el
-- médico tiene que poder revisar, aceptar o tirar.
--
-- Cuatro cosas:
--
--   1. El interruptor por clínica, en la misma tabla donde ya viven los
--      demás servicios que la clínica enciende y apaga.
--   2. `exp_dictados` — el dictado: lo que se dijo (texto literal), lo
--      que la IA propuso (el borrador) y qué se hizo con él.
--   3. `tarifas_transcripcion` — el precio POR MINUTO del proveedor.
--      Tabla nueva y no una fila de `tarifas_modelo` porque esa cobra
--      por millón de tokens: meter minutos en una columna que se llama
--      `precio_usd_por_millon` sería una columna que miente.
--   4. `uso_transcripcion` — el consumo medido, hermano de `uso_api`.
--      El descuento del saldo es el mismo (misma `saldos_ia`, mismo
--      `movimientos_credito`); lo que cambia es la unidad.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. EL INTERRUPTOR DE LA CLÍNICA
--
-- Va en `configuracion_notificaciones` —que a esta altura es la
-- configuración de servicios de la clínica, no solo de avisos— porque
-- es la fila única por tenant que la pantalla de Administración ya lee
-- y escribe. El 04 va a reubicar los servicios de IA; cuando lo haga,
-- esto se mueve con él, no se duplica.
--
-- `dictado_retencion_audio_horas = 0` significa NO GUARDAR EL AUDIO, y
-- es el valor por omisión a propósito: la clínica que quiera guardarlo
-- tiene que decirlo. 720 horas (30 días) es el techo.
-- ---------------------------------------------------------------------
ALTER TABLE configuracion_notificaciones
  ADD COLUMN IF NOT EXISTS dictado_ia_activo             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dictado_retencion_audio_horas INTEGER NOT NULL DEFAULT 0;

ALTER TABLE configuracion_notificaciones
  DROP CONSTRAINT IF EXISTS configuracion_notificaciones_retencion_audio_check;
ALTER TABLE configuracion_notificaciones
  ADD CONSTRAINT configuracion_notificaciones_retencion_audio_check
  CHECK (dictado_retencion_audio_horas BETWEEN 0 AND 720);

COMMENT ON COLUMN configuracion_notificaciones.dictado_ia_activo IS
  'Dictado de la consulta completa ordenado por IA (prompt 07d fase 2). Apagado por omisión: consume crédito de IA.';
COMMENT ON COLUMN configuracion_notificaciones.dictado_retencion_audio_horas IS
  'Horas que se guarda el audio después de transcribirlo. 0 = no se guarda (omisión).';

-- ---------------------------------------------------------------------
-- 2. EL DICTADO
--
-- `texto_transcrito` es lo que el médico dijo, literal, y se conserva:
-- es el respaldo contra el que se compara el borrador cuando algo salió
-- mal. No se borra al aplicar.
--
-- `borrador` es jsonb y no columnas porque es una PROPUESTA, no un
-- registro: su forma la define la herramienta que el modelo llena
-- (`dictadoBorrador.ts`), y cambiarla no puede costar una migración.
-- Lo que se registra de verdad son las tablas del expediente, cuando el
-- médico acepta.
--
-- `estado`:
--   transcrito  — hay texto, todavía no se ordenó (o el ordenamiento falló)
--   ordenado    — hay borrador esperando al médico
--   aplicado    — el médico aceptó al menos un campo
--   descartado  — el médico lo tiró
--
-- FK a `atenciones` DIFERIDA, como todo lo que cuelga de la atención
-- (migración 092): la purga borra por tablas y no por orden topológico.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exp_dictados (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  atencion_id             UUID NOT NULL REFERENCES atenciones(id) ON DELETE CASCADE
                            DEFERRABLE INITIALLY DEFERRED,
  persona_id              UUID REFERENCES personas(id) ON DELETE SET NULL
                            DEFERRABLE INITIALLY DEFERRED,
  proveedor               VARCHAR(40) NOT NULL,
  segundos_audio          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (segundos_audio >= 0),
  texto_transcrito        TEXT NOT NULL,
  borrador                JSONB,
  campos_aplicados        TEXT[] NOT NULL DEFAULT '{}',
  estado                  VARCHAR(20) NOT NULL DEFAULT 'transcrito'
                            CHECK (estado IN ('transcrito','ordenado','aplicado','descartado')),
  modelo_ordenamiento     VARCHAR(80),
  audio_archivo_id        UUID REFERENCES archivos(id) ON DELETE SET NULL
                            DEFERRABLE INITIALLY DEFERRED,
  audio_borrar_despues_de TIMESTAMPTZ,
  aplicado_en             TIMESTAMPTZ,
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exp_dictados_atencion ON exp_dictados(atencion_id, creado_en DESC);
-- Para el barrido que borra el audio vencido: solo las filas que todavía
-- tienen audio guardado, que son la minoría (la omisión es no guardarlo).
CREATE INDEX IF NOT EXISTS idx_exp_dictados_audio_por_vencer
  ON exp_dictados(audio_borrar_despues_de)
  WHERE audio_archivo_id IS NOT NULL;

ALTER TABLE exp_dictados ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_dictados FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exp_dictados_tenant ON exp_dictados;
CREATE POLICY exp_dictados_tenant ON exp_dictados
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE exp_dictados IS
  'Dictado de la consulta: el texto literal que dijo el médico y el borrador que la IA propuso a partir de él (prompt 07d fase 2).';
COMMENT ON COLUMN exp_dictados.texto_transcrito IS
  'Lo que el médico dijo, literal. Se conserva aunque el borrador se aplique: es el respaldo.';
COMMENT ON COLUMN exp_dictados.campos_aplicados IS
  'Qué campos del borrador aceptó el médico. Aceptar es campo por campo, no todo o nada.';

-- ---------------------------------------------------------------------
-- 3. LA TARIFA POR MINUTO
--
-- Misma forma que `tarifas_modelo`: vigencia por fecha en vez de UPDATE
-- sobre la fila, para que un consumo viejo se pueda reconstruir con la
-- tarifa que tenía ese día. Sin RLS: es catálogo de plataforma, igual
-- que `tarifas_modelo`.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tarifas_transcripcion (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor               VARCHAR(40) NOT NULL,
  precio_usd_por_minuto   NUMERIC(10,6) NOT NULL CHECK (precio_usd_por_minuto >= 0),
  vigente_desde           DATE NOT NULL,
  vigente_hasta           DATE,
  facturable              BOOLEAN NOT NULL DEFAULT true,
  nota                    TEXT,
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una sola tarifa vigente por proveedor a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tarifas_transcripcion_vigente
  ON tarifas_transcripcion(proveedor) WHERE vigente_hasta IS NULL;

COMMENT ON TABLE tarifas_transcripcion IS
  'Precio por minuto de audio de cada proveedor de transcripción. Tabla propia y no una fila de tarifas_modelo porque esa cobra por millón de tokens.';

INSERT INTO tarifas_transcripcion (proveedor, precio_usd_por_minuto, vigente_desde, facturable, nota)
SELECT 'simulado', 0, CURRENT_DATE, false,
       'Proveedor de desarrollo: no transcribe nada real, no cuesta nada y no es facturable. Existe para poder recorrer el flujo completo sin credenciales.'
WHERE NOT EXISTS (SELECT 1 FROM tarifas_transcripcion WHERE proveedor = 'simulado');

INSERT INTO tarifas_transcripcion (proveedor, precio_usd_por_minuto, vigente_desde, facturable, nota)
SELECT 'deepgram-nova-2', 0.0043, CURRENT_DATE, true,
       'Precio de lista de Deepgram nova-2 pre-recorded (USD 0,0043/min) al 26/11/2026. Verificar contra la factura real antes de confiar en el costo medido.'
WHERE NOT EXISTS (SELECT 1 FROM tarifas_transcripcion WHERE proveedor = 'deepgram-nova-2');

-- ---------------------------------------------------------------------
-- 4. EL CONSUMO MEDIDO
--
-- Hermano de `uso_api`, no una fila más de ella: `uso_api` tiene cuatro
-- columnas de tokens NOT NULL y cuatro FK a `tarifas_modelo`. Un minuto
-- de audio no es un token, y escribir ceros en esas ocho columnas para
-- que quepa sería exactamente el tipo de dato que después nadie sabe
-- leer.
--
-- Lo que SÍ se comparte es el descuento: `saldos_ia` y
-- `movimientos_credito` son los mismos (ver `tarifas.ts`), con
-- `referencia_tabla = 'uso_transcripcion'`.
--
-- FK a `tenants` SIN cascada, igual que `uso_api` y por el mismo motivo:
-- es rastro de consumo y borrarlo tiene que ser un acto explícito. Por
-- eso va en TABLAS_BORRADO_MANUAL_EN_PURGA (ver tablasTenant.ts).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uso_transcripcion (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  persona_id            UUID REFERENCES personas(id) ON DELETE SET NULL
                          DEFERRABLE INITIALLY DEFERRED,
  dictado_id            UUID REFERENCES exp_dictados(id) ON DELETE SET NULL
                          DEFERRABLE INITIALLY DEFERRED,
  proveedor             VARCHAR(40) NOT NULL,
  segundos              NUMERIC(10,2) NOT NULL CHECK (segundos >= 0),
  costo_usd_calculado   NUMERIC(12,6) NOT NULL,
  tarifa_id             UUID REFERENCES tarifas_transcripcion(id),
  cobrable              BOOLEAN NOT NULL DEFAULT true,
  bolsa_afectada        VARCHAR(20) CHECK (bolsa_afectada IN ('plan','comprado','colchon','ninguna')),
  timestamp             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uso_transcripcion_tenant ON uso_transcripcion(tenant_id, timestamp DESC);

ALTER TABLE uso_transcripcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE uso_transcripcion FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS uso_transcripcion_tenant ON uso_transcripcion;
CREATE POLICY uso_transcripcion_tenant ON uso_transcripcion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE uso_transcripcion IS
  'Minutos de audio transcritos y lo que costaron. Descuenta del mismo saldo_ia que uso_api; la unidad es el minuto, no el token.';
