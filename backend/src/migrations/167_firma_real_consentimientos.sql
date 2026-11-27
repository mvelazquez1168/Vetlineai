-- ---------------------------------------------------------------------
-- 167 — LA FIRMA DEL CONSENTIMIENTO TIENE QUE SER UNA FIRMA
--
-- DEFECTO GRAVE, reportado el 2026-11-27: la pantalla mandaba como
-- firma **un PNG fijo de 1×1 píxel transparente** —el mismo para todos—
-- en lugar del trazo del cliente. El resultado es peor que no tener
-- firma: cada consentimiento del expediente dice «firmado», muestra un
-- nombre y una fecha, y **no respalda nada**. Un consentimiento que
-- parece firmado y no lo está es exactamente el documento que no se
-- puede presentar el día que hace falta.
--
-- Esta migración hace tres cosas:
--
--   1. GUARDA LA EVIDENCIA de quién firmó, cómo y desde dónde. Una
--      firma sin evidencia es un dibujo;
--   2. GUARDA EL HASH del texto exacto más la firma, para poder decir
--      «esto es lo que se firmó» y detectar si alguien lo tocó;
--   3. MARCA LOS EXISTENTES. No se borran —son el registro de que ese
--      día hubo una conversación con el cliente— pero quedan señalados
--      como **sin firma válida**, y la pantalla los muestra así.
--
-- Y agrega la tabla de la firma a distancia: un enlace de un solo uso,
-- con vencimiento y código de verificación.
-- ---------------------------------------------------------------------

-- =====================================================================
-- 1. LA EVIDENCIA
-- =====================================================================
ALTER TABLE exp_consentimientos
  /* La relación del firmante con el paciente: casi siempre el
     propietario, a veces alguien autorizado por él —el hijo que trae al
     perro, el cuidador—. Sin esto, «Juan Pérez» no dice si podía
     firmar. */
  ADD COLUMN IF NOT EXISTS firmante_relacion VARCHAR(30)
    CHECK (firmante_relacion IN ('propietario', 'autorizado')),
  ADD COLUMN IF NOT EXISTS firmante_autorizado_por VARCHAR(160),
  /* El dispositivo y la IP desde donde se firmó. */
  ADD COLUMN IF NOT EXISTS firma_dispositivo TEXT,
  ADD COLUMN IF NOT EXISTS firma_ip INET,
  /* SHA-256 del texto exacto + la firma. Es lo que permite decir
     «esto es lo que se firmó» y detectar un cambio posterior. */
  ADD COLUMN IF NOT EXISTS huella CHAR(64),
  /* Las medidas del trazo, para poder afirmar que hubo uno. */
  ADD COLUMN IF NOT EXISTS firma_ancho INTEGER,
  ADD COLUMN IF NOT EXISTS firma_alto INTEGER,
  /* Cuándo se firmó, según el reloj del SERVIDOR. `firmado_en` ya
     existía con `DEFAULT now()`; esto lo deja dicho. */
  ADD COLUMN IF NOT EXISTS firmado_a_distancia BOOLEAN NOT NULL DEFAULT false,
  /* Qué pasa con los que se firmaron con la imagen de relleno. */
  ADD COLUMN IF NOT EXISTS firma_valida BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS firma_invalida_motivo TEXT;

COMMENT ON COLUMN exp_consentimientos.firma_valida IS
  'false cuando el consentimiento no tiene una firma real (los firmados antes del 2026-11-27 con la imagen de relleno de 1x1 px). No se borran: la conversación con el cliente existió. La pantalla los muestra como «sin firma válida».';

COMMENT ON COLUMN exp_consentimientos.huella IS
  'SHA-256 de titulo + texto + firma_png. Se calcula al firmar y se verifica al mostrar: si no coincide, alguien tocó el registro.';

-- =====================================================================
-- 2. LOS EXISTENTES, MARCADOS
-- =====================================================================
--
-- El PNG de relleno es siempre el mismo: un 1×1 transparente de 68
-- caracteres en base64. Se marca por su contenido exacto y, además,
-- cualquier firma sospechosamente corta (menos de 400 caracteres de
-- base64 no alcanza para un trazo real).
UPDATE exp_consentimientos
   SET firma_valida = false,
       firma_invalida_motivo =
         'Firmado antes del 2026-11-27, cuando la pantalla enviaba una imagen de relleno de 1x1 px en lugar del trazo del cliente. El consentimiento quedó registrado pero NO tiene una firma real.'
 WHERE firma_png IS NULL
    OR length(firma_png) < 400
    OR firma_png LIKE '%iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ%';

-- =====================================================================
-- 3. LA FIRMA A DISTANCIA
-- =====================================================================
--
-- Un enlace de un solo uso que se abre SIN iniciar sesión. Por eso
-- lleva todo lo que hace falta para que sea seguro: vence, se usa una
-- vez, y antes de firmar pide un código que se envía al mismo canal.
CREATE TABLE IF NOT EXISTS exp_firmas_remotas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id    UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  propietario_id UUID REFERENCES propietarios(id) ON DELETE SET NULL,
  plantilla_id   UUID REFERENCES exp_plantillas_consentimiento(id) ON DELETE SET NULL,
  atencion_id    UUID REFERENCES atenciones(id) ON DELETE SET NULL,
  /* El texto YA RESUELTO: lo que el cliente va a ver y firmar. Se
     congela acá y no se vuelve a armar al abrir el enlace, porque si la
     plantilla cambia en el medio, lo que firmó el cliente tiene que
     seguir siendo lo que leyó. */
  titulo         VARCHAR(200) NOT NULL,
  texto          TEXT NOT NULL,
  /* El token del enlace: se guarda su HASH, no el token. Una base
     filtrada no entrega enlaces de firma usables. */
  token_hash     CHAR(64) NOT NULL UNIQUE,
  /* El código que se manda al mismo canal, también en hash. */
  codigo_hash    CHAR(64) NOT NULL,
  codigo_intentos INTEGER NOT NULL DEFAULT 0,
  canal          VARCHAR(20) NOT NULL CHECK (canal IN ('whatsapp', 'correo')),
  destino        VARCHAR(200) NOT NULL,
  vence_en       TIMESTAMPTZ NOT NULL,
  /* Una sola vez: cuando se usa, se sella. */
  usado_en       TIMESTAMPTZ,
  consentimiento_id UUID REFERENCES exp_consentimientos(id) ON DELETE SET NULL,
  /* Quién lo mandó. */
  solicitado_por UUID REFERENCES personas(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exp_firmas_remotas_pendientes
  ON exp_firmas_remotas (tenant_id, vence_en)
  WHERE usado_en IS NULL;

-- =====================================================================
-- 4. EL CATÁLOGO DE TIPOS DE DOCUMENTO (el otro pedido del mismo día)
-- =====================================================================
--
-- La pestaña «Imágenes y documentos» pasa a permitir cargar. El tipo es
-- un catálogo POR CLÍNICA con una semilla: una clínica que hace
-- ecografías y otra que no, no tienen la misma lista.
CREATE TABLE IF NOT EXISTS exp_tipos_documento (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo    VARCHAR(40) NOT NULL,
  nombre    VARCHAR(80) NOT NULL,
  /* Si la recepción puede subir este tipo. Una radiografía la sube el
     médico; un historial previo que trae el cliente, la recepción. */
  administrativo BOOLEAN NOT NULL DEFAULT false,
  orden     INTEGER NOT NULL DEFAULT 0,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

-- La semilla, para las clínicas que ya existen y para las que vengan
-- (el trigger de configuración inicial de la 145 las agrega).
INSERT INTO exp_tipos_documento (tenant_id, codigo, nombre, administrativo, orden)
SELECT t.id, v.codigo, v.nombre, v.administrativo, v.orden
  FROM tenants t
  CROSS JOIN (VALUES
    ('radiografia',     'Radiografía',     false, 10),
    ('ecografia',       'Ecografía',       false, 20),
    ('foto_clinica',    'Foto clínica',    false, 30),
    ('informe_externo', 'Informe externo', true,  40),
    ('historial_previo','Historial previo',true,  50),
    ('certificado',     'Certificado',     true,  60),
    ('otro',            'Otro',            false, 70)
  ) AS v(codigo, nombre, administrativo, orden)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- Lo que un archivo del expediente necesita y hoy no tiene.
ALTER TABLE archivos
  /* El tipo, del catálogo de arriba. */
  ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(40),
  /* La fecha DEL DOCUMENTO, que puede ser muy anterior a la de la
     carga: un historial previo es de hace tres años. Sin esto, la
     galería ordena por cuándo alguien lo escaneó. */
  ADD COLUMN IF NOT EXISTS fecha_documento DATE,
  ADD COLUMN IF NOT EXISTS paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS atencion_id UUID REFERENCES atenciones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_archivos_paciente
  ON archivos (paciente_id, fecha_documento DESC)
  WHERE paciente_id IS NOT NULL;

-- =====================================================================
-- 5. RLS
-- =====================================================================
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['exp_firmas_remotas', 'exp_tipos_documento'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t || '_tenant', t
    );
  END LOOP;
END $$;
