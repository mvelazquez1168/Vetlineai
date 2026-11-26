-- ---------------------------------------------------------------------
-- 108 — Base del CRM: la línea de tiempo y el permiso para escribirle
--       a un cliente (prompt 03)
--
-- Dos piezas que todos los módulos necesitan:
--
--   1. UNA LÍNEA DE TIEMPO DE INTERACCIONES. Todo lo que le pasa a un
--      cliente o a su mascota queda como un evento con una REFERENCIA a
--      su origen. Es el pegamento entre módulos.
--
--   2. EL PUNTO ÚNICO ANTES DE ENVIAR. Consentimiento por canal y
--      finalidad, preferencias, franja horaria y topes. Todo envío lo
--      consulta.
--
-- LA REGLA QUE MANDA EN LA TABLA DE EVENTOS: **nunca copia el contenido
-- del origen**. Guarda qué pasó, cuándo, y dónde está el registro que lo
-- cuenta. Un evento que copiara la nota médica tendría la nota en dos
-- lugares, y el día que alguien corrige la nota el evento seguiría
-- diciendo la versión vieja. La pantalla resuelve el detalle leyendo el
-- origen; si el origen ya no está, el evento lo dice.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- EL CATÁLOGO DE TIPOS DE EVENTO
--
-- Una tabla y no un CHECK: un módulo nuevo agrega su tipo con un INSERT
-- en su propia migración, sin reescribir una restricción de cien
-- valores. `modulo` y `etiqueta` viven acá para que la pantalla no tenga
-- su propio diccionario.
--
-- `clinico` marca los tipos cuyo DETALLE es clínico: el tipo, la fecha y
-- el enlace los ve todo el personal —la recepción necesita saber que
-- hubo una visita—, pero el contenido solo quien tiene permiso. Es la
-- privacidad dentro de la clínica que pide el prompt.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_tipos_evento (
  codigo    VARCHAR(40) PRIMARY KEY,
  etiqueta  VARCHAR(80) NOT NULL,
  modulo    VARCHAR(30) NOT NULL,
  clinico   BOOLEAN NOT NULL DEFAULT false,
  orden     SMALLINT NOT NULL DEFAULT 100
);

INSERT INTO crm_tipos_evento (codigo, etiqueta, modulo, clinico, orden) VALUES
  ('cliente_registrado',     'Cliente registrado',          'clientes',    false, 10),
  ('mascota_registrada',     'Mascota registrada',          'clientes',    false, 20),
  ('cita_agendada',          'Cita agendada',               'agenda',      false, 30),
  ('cita_confirmada',        'Cita confirmada',             'agenda',      false, 31),
  ('cita_reprogramada',      'Cita reprogramada',           'agenda',      false, 32),
  ('cita_cancelada',         'Cita cancelada',              'agenda',      false, 33),
  ('cita_no_presentada',     'No se presentó',              'agenda',      false, 34),
  ('cita_completada',        'Cita completada',             'agenda',      false, 35),
  ('llegada',                'Llegada a la clínica',        'agenda',      false, 36),
  ('atencion_cerrada',       'Atención registrada',         'expediente',  true,  40),
  ('vacuna_aplicada',        'Vacuna aplicada',             'expediente',  true,  41),
  ('desparasitacion',        'Desparasitación',             'expediente',  true,  42),
  ('receta_emitida',         'Receta emitida',              'expediente',  true,  43),
  ('estudio_laboratorio',    'Estudio de laboratorio',      'expediente',  true,  44),
  ('grooming',               'Visita de grooming',          'expediente',  false, 45),
  ('consentimiento_firmado', 'Consentimiento firmado',      'expediente',  false, 46),
  ('caso_abierto',           'Caso de Vetline Ai abierto',  'vetline_ai',  true,  50),
  ('caso_cerrado',           'Caso de Vetline Ai cerrado',  'vetline_ai',  true,  51),
  ('comprobante_emitido',    'Comprobante emitido',         'facturacion', false, 60),
  ('comprobante_aceptado',   'Comprobante aceptado',        'facturacion', false, 61),
  ('comprobante_rechazado',  'Comprobante rechazado',       'facturacion', false, 62),
  ('cobro',                  'Cobro',                       'caja',        false, 70),
  ('anticipo',               'Anticipo recibido',           'caja',        false, 71),
  ('abono',                  'Abono a cuenta',              'caja',        false, 72),
  ('encargo_creado',         'Encargo creado',              'caja',        false, 73),
  ('encargo_recibido',       'Encargo recibido',            'caja',        false, 74),
  ('encargo_entregado',      'Encargo entregado',           'caja',        false, 75),
  ('mensaje_enviado',        'Mensaje enviado',             'crm',         false, 80),
  ('mensaje_respondido',     'Respuesta del cliente',       'crm',         false, 81),
  ('consentimiento_cambiado','Consentimiento cambiado',     'crm',         false, 82),
  ('nota_manual',            'Nota',                        'crm',         false, 90)
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta,
      modulo = EXCLUDED.modulo,
      clinico = EXCLUDED.clinico,
      orden = EXCLUDED.orden;

-- ---------------------------------------------------------------------
-- LA LÍNEA DE TIEMPO
--
-- Solo se agrega: no hay UPDATE ni DELETE (el disparador de abajo lo
-- impone). Una interacción es un hecho que pasó; corregir el pasado no
-- es editar el evento.
--
-- `ocurrido_en` es CUÁNDO PASÓ, no cuándo se registró. La
-- reconstrucción del historial depende de esta distinción: un evento
-- reconstruido de una cita de marzo tiene la fecha de marzo.
--
-- UNICIDAD POR TIPO Y REFERENCIA: un mismo origen no genera dos eventos
-- del mismo tipo. Es lo que hace que la reconstrucción se pueda correr
-- dos veces y que un reintento no duplique.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_interacciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                  DEFERRABLE INITIALLY DEFERRED,
  propietario_id UUID REFERENCES propietarios(id) ON DELETE CASCADE
                  DEFERRABLE INITIALLY DEFERRED,
  paciente_id   UUID REFERENCES pacientes(id) ON DELETE CASCADE
                  DEFERRABLE INITIALLY DEFERRED,
  tipo          VARCHAR(40) NOT NULL REFERENCES crm_tipos_evento(codigo),
  /* Cuándo pasó. */
  ocurrido_en   TIMESTAMPTZ NOT NULL,
  /* Dónde está el registro que lo cuenta. */
  origen_tabla  VARCHAR(60) NOT NULL,
  origen_id     UUID,
  /* Quién lo originó, si fue una persona de la clínica. */
  persona_id    UUID REFERENCES personas(id) ON DELETE SET NULL
                  DEFERRABLE INITIALLY DEFERRED,
  /* Lo mínimo para listar sin ir al origen: un título corto. NO es el
     contenido del origen; es cómo se nombra el evento en la lista. */
  resumen       VARCHAR(200),
  /* Datos de la propia interacción que no viven en ningún otro lado:
     el canal y la finalidad de un mensaje, el texto de una nota manual. */
  canal         VARCHAR(20),
  finalidad     VARCHAR(20),
  nota          TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

  /* Un evento es de alguien: de un cliente, de una mascota, o de los
     dos. Un evento sin ninguno de los dos no aparecería en ninguna
     línea de tiempo. */
  CONSTRAINT interaccion_es_de_alguien
    CHECK (propietario_id IS NOT NULL OR paciente_id IS NOT NULL)
);

/* UN ORIGEN, UN EVENTO POR TIPO. Índice parcial porque `origen_id` es
   nulo en los eventos que no tienen registro propio (una nota manual
   ES el registro). */
CREATE UNIQUE INDEX IF NOT EXISTS idx_interaccion_una_por_origen
  ON crm_interacciones (tipo, origen_tabla, origen_id)
  WHERE origen_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interaccion_cliente
  ON crm_interacciones (propietario_id, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS idx_interaccion_paciente
  ON crm_interacciones (paciente_id, ocurrido_en DESC);

CREATE OR REPLACE FUNCTION crm_interaccion_solo_se_agrega() RETURNS TRIGGER AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'La línea de tiempo solo se agrega: una interacción es un hecho que pasó. Para corregir, se agrega otro evento.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_interaccion_solo_se_agrega ON crm_interacciones;
CREATE TRIGGER trg_interaccion_solo_se_agrega
  BEFORE UPDATE OR DELETE ON crm_interacciones
  FOR EACH ROW EXECUTE FUNCTION crm_interaccion_solo_se_agrega();

-- ---------------------------------------------------------------------
-- CONSENTIMIENTOS: por cliente, por canal y por finalidad
--
-- Una fila por combinación, con su valor actual. El historial de cómo
-- se llegó a ese valor va aparte y es lo que sirve de prueba.
--
-- LAS DOS FINALIDADES NO SE MEZCLAN: «salud y servicio» es lo que la
-- clínica le debe al cliente (su cita, su vacuna, su comprobante);
-- «promociones» es lo que la clínica quiere venderle. Un cliente puede
-- querer lo primero y no lo segundo, y el día que se confundan la
-- clínica le va a estar mandando ofertas a alguien que solo pidió el
-- recordatorio de la vacuna.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_consentimientos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  canal          VARCHAR(20) NOT NULL CHECK (canal IN ('correo', 'whatsapp')),
  finalidad      VARCHAR(20) NOT NULL CHECK (finalidad IN ('salud', 'promociones')),
  otorgado       BOOLEAN NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (propietario_id, canal, finalidad)
);

CREATE TABLE IF NOT EXISTS crm_consentimiento_historial (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  canal          VARCHAR(20) NOT NULL,
  finalidad      VARCHAR(20) NOT NULL,
  otorgado       BOOLEAN NOT NULL,
  /* De dónde salió este cambio. Es la prueba. */
  fuente         VARCHAR(30) NOT NULL
                   CHECK (fuente IN ('registro', 'recepcion', 'respuesta_cliente',
                                     'importacion', 'existente_al_habilitar')),
  registrado_por UUID REFERENCES personas(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  nota           TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consentimiento_historial_cliente
  ON crm_consentimiento_historial (propietario_id, creado_en DESC);

/* El historial tampoco se edita: es lo que se le muestra a un cliente
   que pregunta «¿cuándo di yo permiso para esto?». */
CREATE OR REPLACE FUNCTION crm_historial_solo_se_agrega() RETURNS TRIGGER AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'El historial de consentimientos solo se agrega: es la prueba de qué autorizó el cliente y cuándo.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historial_solo_se_agrega ON crm_consentimiento_historial;
CREATE TRIGGER trg_historial_solo_se_agrega
  BEFORE UPDATE OR DELETE ON crm_consentimiento_historial
  FOR EACH ROW EXECUTE FUNCTION crm_historial_solo_se_agrega();

-- ---------------------------------------------------------------------
-- PREFERENCIAS DE CONTACTO del cliente
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_preferencias_contacto (
  propietario_id UUID PRIMARY KEY REFERENCES propietarios(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  canal_preferido VARCHAR(20) CHECK (canal_preferido IN ('correo', 'whatsapp')),
  /* La franja en que este cliente acepta mensajes. NULL = la de la
     clínica. */
  hora_desde     TIME,
  hora_hasta     TIME,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- POLÍTICAS DE LA CLÍNICA
--
-- El mecanismo mínimo que el prompt pide: una fila por clínica con los
-- parámetros que las reglas de envío consultan. El prompt de
-- administración base lo va a extender; está hecho para agregarle
-- columnas, no para reemplazarlo.
--
-- La franja por defecto —8:00 a 20:00— no es un capricho: es la que el
-- prompt fija, y se guarda explícita para que una clínica la pueda
-- cambiar sin tocar código.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_politicas (
  tenant_id            UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE
                         DEFERRABLE INITIALLY DEFERRED,
  hora_desde           TIME NOT NULL DEFAULT '08:00',
  hora_hasta           TIME NOT NULL DEFAULT '20:00',
  /* Mensajes PROMOCIONALES por cliente y por mes. Los de salud y
     servicio no cuentan: son los que la clínica le debe al cliente. */
  tope_promociones_mes SMALLINT NOT NULL DEFAULT 4,
  /* Ventana en la que el mismo tipo de mensaje sobre la misma mascota
     no se repite. */
  ventana_duplicado_horas SMALLINT NOT NULL DEFAULT 48,
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT franja_coherente CHECK (hora_desde < hora_hasta),
  CONSTRAINT tope_no_negativo CHECK (tope_promociones_mes >= 0)
);

-- ---------------------------------------------------------------------
-- MENSAJES: el registro de lo que se le mandó al cliente y lo que
-- contestó
--
-- `correos_enviados` ya guarda los correos, con su proveedor y su
-- estado. Esta tabla NO lo reemplaza: guarda el mensaje como DECISIÓN
-- del CRM —a quién, por qué canal, con qué finalidad, si se pudo o no y
-- por qué— y apunta al correo cuando el canal fue el correo. Así el
-- tope de promociones y la ventana de duplicados tienen una sola tabla
-- que contar, sea el canal cual sea.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_mensajes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  propietario_id UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  paciente_id    UUID REFERENCES pacientes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  canal          VARCHAR(20) NOT NULL CHECK (canal IN ('correo', 'whatsapp')),
  finalidad      VARCHAR(20) NOT NULL CHECK (finalidad IN ('salud', 'promociones')),
  /* El tipo de mensaje, para la ventana de duplicados: dos
     «recordatorio_cita» de la misma mascota no salen dos veces. */
  tipo           VARCHAR(60) NOT NULL,
  estado         VARCHAR(20) NOT NULL
                   CHECK (estado IN ('enviado', 'fallido', 'bloqueado', 'reprogramado')),
  /* Por qué se bloqueó o se reprogramó. Vacío si salió. */
  motivo         VARCHAR(200),
  /* Cuándo se reprogramó, si fue por la franja horaria. */
  reprogramado_para TIMESTAMPTZ,
  /* El correo, cuando el canal fue correo: el contenido vive ahí. */
  correo_enviado_id UUID REFERENCES correos_enviados(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  /* El identificador del proveedor de mensajería, cuando hubo uno. */
  proveedor_mensaje_id VARCHAR(120),
  contenido      TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_tope
  ON crm_mensajes (propietario_id, finalidad, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_mensajes_duplicado
  ON crm_mensajes (paciente_id, tipo, creado_en DESC);

CREATE TABLE IF NOT EXISTS crm_respuestas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  propietario_id UUID REFERENCES propietarios(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  canal          VARCHAR(20) NOT NULL,
  /* De dónde vino: el teléfono o el correo que contestó. */
  remitente      VARCHAR(120) NOT NULL,
  texto          TEXT NOT NULL,
  /* El mensaje que se estaba respondiendo, si se pudo saber. */
  mensaje_id     UUID REFERENCES crm_mensajes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  /* Qué se hizo con la respuesta: 'baja' retiró el consentimiento. */
  accion         VARCHAR(20),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- LAS PALABRAS DE BAJA, configurables
--
-- «BAJA» es la de Costa Rica; una clínica puede querer «STOP» o
-- «CANCELAR». Van en una tabla y no en el código porque el día que un
-- cliente escriba otra palabra, la clínica tiene que poder agregarla sin
-- un despliegue.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_palabras_baja (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* NULL = de la plataforma, para todas las clínicas. */
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  palabra   VARCHAR(40) NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_palabras_baja_plataforma
  ON crm_palabras_baja (palabra) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_palabras_baja_tenant
  ON crm_palabras_baja (tenant_id, palabra) WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- RLS — el criterio estándar del repo, con FORCE.
-- ---------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_interacciones', 'crm_consentimientos',
                           'crm_consentimiento_historial', 'crm_preferencias_contacto',
                           'crm_politicas', 'crm_mensajes', 'crm_respuestas']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t || '_tenant', t
    );
  END LOOP;
END $$;

/* Las palabras de baja son catálogo compartido: cada clínica ve las
   suyas y las de la plataforma, y solo escribe las suyas. Mismo patrón
   que las plantillas de atención. */
ALTER TABLE crm_palabras_baja ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_palabras_baja FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_palabras_baja_tenant ON crm_palabras_baja;
CREATE POLICY crm_palabras_baja_tenant ON crm_palabras_baja
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

/* `crm_tipos_evento` es catálogo de plataforma sin tenant: se lee desde
   cualquier clínica y no se escribe desde la aplicación. */
ALTER TABLE crm_tipos_evento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_tipos_evento_lectura ON crm_tipos_evento;
CREATE POLICY crm_tipos_evento_lectura ON crm_tipos_evento FOR SELECT USING (true);

COMMENT ON TABLE crm_interacciones IS
  'Línea de tiempo de interacciones. Solo se agrega y NUNCA copia el contenido del origen: guarda qué pasó, cuándo y la referencia al registro que lo cuenta.';
COMMENT ON COLUMN crm_interacciones.ocurrido_en IS
  'Cuándo PASÓ, no cuándo se registró. La reconstrucción del historial depende de esta distinción.';

-- ---------------------------------------------------------------------
-- Las palabras de baja de la plataforma, AL FINAL
--
-- Después de todos los ALTER TABLE a propósito: la FK diferida de este
-- INSERT deja eventos de disparador pendientes, y Postgres rechaza un
-- ALTER TABLE sobre una tabla que los tiene. Se descubrió corriendo la
-- migración.
-- ---------------------------------------------------------------------

INSERT INTO crm_palabras_baja (tenant_id, palabra)
SELECT NULL, p FROM (VALUES ('baja'), ('stop'), ('cancelar'), ('no mas'), ('salir')) AS v(p)
WHERE NOT EXISTS (
  SELECT 1 FROM crm_palabras_baja b WHERE b.tenant_id IS NULL AND b.palabra = v.p
);
