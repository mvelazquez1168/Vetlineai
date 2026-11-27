-- ---------------------------------------------------------------------
-- 166 — AGENDA CON RECURSOS Y CALENDARIO EXTERNO (prompt 05)
--
-- Tres cosas, en este orden de importancia:
--
--   1. LOS RECURSOS. Hoy una cita ocupa un médico y una sala. Medicavet
--      también ocupa EQUIPOS —el endoscopio, la máquina de anestesia—, y
--      dos cirugías a la misma hora con un solo endoscopio es una cita
--      que no se puede cumplir. El motor de disponibilidad del §1 los
--      necesita para poder impedirlo.
--   2. EL MARGEN ENTRE CITAS, por tipo: limpiar el consultorio entre una
--      consulta y la siguiente lleva diez minutos, y agendarlas pegadas
--      hace que la clínica arranque el día con retraso.
--   3. EL CALENDARIO EXTERNO, por médico y opcional: la conexión, el
--      mapeo cita↔evento, los bloques ocupados que vienen de afuera, la
--      cola de sincronización y su bitácora.
--
-- RLS FORZADA Y `ON DELETE CASCADE` en toda tabla de clínica, que es la
-- regla de la guía §2 y lo que hizo falta para que la purga funcione
-- (D-006).
--
-- LOS TOKENS DE GOOGLE NO SE GUARDAN EN CLARO. La columna es `BYTEA` y
-- lo que entra está cifrado por la aplicación: una base que se filtra no
-- puede entregar el acceso al calendario de nadie.
-- ---------------------------------------------------------------------

-- =====================================================================
-- 1. RECURSOS: equipos que una cita ocupa
-- =====================================================================

CREATE TABLE IF NOT EXISTS agenda_equipos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      VARCHAR(120) NOT NULL,
  /* Para agrupar en la pantalla: «quirófano», «imagen», «laboratorio». */
  categoria   VARCHAR(60),
  /* Cuántos hay. Dos máquinas de anestesia admiten dos cirugías a la
     vez; una, no. Es lo que convierte el choque en un cálculo y no en
     una regla escrita a mano. */
  cantidad    INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nombre)
);

-- Qué equipos pide un tipo de cita. Es la sugerencia: la cita concreta
-- puede agregar o quitar.
CREATE TABLE IF NOT EXISTS tipo_cita_equipos (
  tipo_cita_id UUID NOT NULL REFERENCES tipos_cita(id) ON DELETE CASCADE,
  equipo_id    UUID NOT NULL REFERENCES agenda_equipos(id) ON DELETE CASCADE,
  PRIMARY KEY (tipo_cita_id, equipo_id)
);

-- Qué equipos ocupa una cita concreta.
CREATE TABLE IF NOT EXISTS cita_equipos (
  cita_id   UUID NOT NULL REFERENCES citas(id) ON DELETE CASCADE,
  equipo_id UUID NOT NULL REFERENCES agenda_equipos(id) ON DELETE CASCADE,
  PRIMARY KEY (cita_id, equipo_id)
);

CREATE INDEX IF NOT EXISTS idx_cita_equipos_equipo ON cita_equipos (equipo_id);

-- El margen por tipo de cita, en minutos.
ALTER TABLE tipos_cita
  ADD COLUMN IF NOT EXISTS margen_minutos INTEGER NOT NULL DEFAULT 0
    CHECK (margen_minutos >= 0 AND margen_minutos <= 240);

COMMENT ON COLUMN tipos_cita.margen_minutos IS
  'Minutos que quedan ocupados DESPUÉS de la cita (limpieza, preparación). El motor de disponibilidad los cuenta como ocupados, pero la cita sigue durando duracion_minutos.';

-- =====================================================================
-- 2. CALENDARIO EXTERNO
-- =====================================================================

-- La conexión de UNA persona con UN calendario. Nadie conecta la cuenta
-- de otro: la clave única es por persona y proveedor.
CREATE TABLE IF NOT EXISTS cal_conexiones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id     UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  /* `simulado` en desarrollo y en los verificadores; `google` en
     producción. La interfaz es la misma, así que sumar `microsoft` no
     toca la agenda. */
  proveedor      VARCHAR(20) NOT NULL DEFAULT 'simulado'
    CHECK (proveedor IN ('simulado', 'google', 'microsoft')),
  /* La cuenta conectada, para que la persona vea cuál es. */
  cuenta         VARCHAR(200),
  /* En qué calendario de esa cuenta aparecen las citas. */
  calendario_id  VARCHAR(200),
  /* CIFRADOS por la aplicación. Nunca en claro. */
  token_acceso   BYTEA,
  token_refresco BYTEA,
  token_expira   TIMESTAMPTZ,
  /* El token de sincronización incremental de Google: con él se piden
     solo los cambios desde la última vez, en vez del calendario entero. */
  sync_token     TEXT,
  /* El canal de notificaciones push y cuándo vence (Google los caduca). */
  canal_id       VARCHAR(120),
  canal_recurso  VARCHAR(200),
  canal_expira   TIMESTAMPTZ,
  estado         VARCHAR(20) NOT NULL DEFAULT 'conectado'
    CHECK (estado IN ('conectado', 'con_errores', 'desconectado')),
  ultimo_error   TEXT,
  ultima_sync_en TIMESTAMPTZ,
  /* La política de la clínica: ¿el nombre del cliente va en el evento?
     Apagada por omisión — el calendario personal del médico puede estar
     compartido con su familia. */
  incluir_cliente BOOLEAN NOT NULL DEFAULT false,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (persona_id, proveedor)
);

CREATE INDEX IF NOT EXISTS idx_cal_conexiones_tenant ON cal_conexiones (tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_cal_conexiones_canal ON cal_conexiones (canal_id)
  WHERE canal_id IS NOT NULL;

-- El mapeo cita ↔ evento externo. Es lo que permite saber que un evento
-- que cambió en Google ES una cita de Vetline, y no un evento propio.
CREATE TABLE IF NOT EXISTS cal_eventos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conexion_id  UUID NOT NULL REFERENCES cal_conexiones(id) ON DELETE CASCADE,
  cita_id      UUID NOT NULL REFERENCES citas(id) ON DELETE CASCADE,
  evento_id    VARCHAR(200) NOT NULL,
  /* La última versión que mandamos, para no reaccionar a nuestro propio
     cambio: sin esto, cada escritura en Google rebota como un cambio
     entrante y la cita se sincroniza en círculos. */
  huella       VARCHAR(80),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conexion_id, evento_id),
  UNIQUE (cita_id, conexion_id)
);

-- Los eventos PROPIOS del médico: solo inicio, fin y «ocupado». Sin
-- título ni descripción, que es lo que el §4 exige: el dentista del
-- médico no es asunto de la clínica, pero su hora sí.
CREATE TABLE IF NOT EXISTS cal_bloques_ocupados (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conexion_id UUID NOT NULL REFERENCES cal_conexiones(id) ON DELETE CASCADE,
  persona_id  UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  evento_id   VARCHAR(200) NOT NULL,
  desde       TIMESTAMPTZ NOT NULL,
  hasta       TIMESTAMPTZ NOT NULL CHECK (hasta > desde),
  /* Un evento de todo el día bloquea el día completo. */
  todo_el_dia BOOLEAN NOT NULL DEFAULT false,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conexion_id, evento_id)
);

CREATE INDEX IF NOT EXISTS idx_cal_bloques_persona
  ON cal_bloques_ocupados (tenant_id, persona_id, desde, hasta);

-- La cola de sincronización hacia afuera. FUERA DE LA TRANSACCIÓN DE LA
-- CITA: si Google no responde, la cita en Vetline queda igual y esto se
-- reintenta. Es el mismo patrón de la cola de Hacienda.
CREATE TABLE IF NOT EXISTS cal_cola (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conexion_id   UUID NOT NULL REFERENCES cal_conexiones(id) ON DELETE CASCADE,
  cita_id       UUID REFERENCES citas(id) ON DELETE CASCADE,
  /* Qué hay que hacer en el calendario externo. */
  accion        VARCHAR(20) NOT NULL CHECK (accion IN ('crear', 'actualizar', 'borrar')),
  /* Para `borrar`, el evento ya no se puede leer de `cal_eventos`
     —la cita se borró—, así que el id viaja en la fila. */
  evento_id     VARCHAR(200),
  estado        VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'hecho', 'error')),
  intentos      INTEGER NOT NULL DEFAULT 0,
  proximo_intento_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_error  TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cal_cola_pendiente
  ON cal_cola (proximo_intento_en)
  WHERE estado = 'pendiente';

-- La bitácora de la reconciliación: qué diferencia se encontró y qué se
-- hizo. Sin esto, una sincronización que corrige sola es una
-- sincronización que nadie puede auditar.
CREATE TABLE IF NOT EXISTS cal_bitacora (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conexion_id UUID REFERENCES cal_conexiones(id) ON DELETE CASCADE,
  cita_id     UUID REFERENCES citas(id) ON DELETE SET NULL,
  tipo        VARCHAR(40) NOT NULL,
  detalle     TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cal_bitacora_tenant ON cal_bitacora (tenant_id, creado_en DESC);

-- =====================================================================
-- 3. LOS FILTROS DE LA AGENDA, GUARDADOS POR USUARIO (§2)
-- =====================================================================
CREATE TABLE IF NOT EXISTS agenda_preferencias (
  persona_id UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /* La vista y los filtros: por médico o por sala, diaria o semanal, y
     qué médicos, salas, tipos y estados. Un jsonb y no doce columnas
     porque la pantalla va a sumar filtros y no queremos una migración
     por filtro. */
  filtros    JSONB NOT NULL DEFAULT '{}'::jsonb,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 4. PERMISOS (§5)
-- =====================================================================

-- `agenda.fuera_de_horario` SE RENOMBRA a `agenda.sobrecarga`, no se
-- duplica: el prompt lo permite explícitamente y dos permisos para lo
-- mismo es cómo se llega a que uno esté concedido y el otro no.
-- EL ORDEN IMPORTA: `rol_permisos.permiso` y `tenant_rol_permiso.permiso`
-- tienen FK contra `permisos.codigo`, así que renombrar el padre primero
-- choca con los hijos. Se inserta el nuevo, se mueven los hijos, y
-- recién entonces se borra el viejo.
INSERT INTO permisos (codigo, nombre, modulo, configurable, orden)
SELECT 'agenda.sobrecarga',
       'Sobrecargar la agenda (citar fuera de horario, en un bloqueo o con un recurso ocupado)',
       modulo, configurable, orden
  FROM permisos WHERE codigo = 'agenda.fuera_de_horario'
ON CONFLICT (codigo) DO NOTHING;

UPDATE rol_permisos SET permiso = 'agenda.sobrecarga'
 WHERE permiso = 'agenda.fuera_de_horario'
   AND NOT EXISTS (SELECT 1 FROM rol_permisos rp2
                    WHERE rp2.rol = rol_permisos.rol AND rp2.permiso = 'agenda.sobrecarga');
DELETE FROM rol_permisos WHERE permiso = 'agenda.fuera_de_horario';

UPDATE tenant_rol_permiso SET permiso = 'agenda.sobrecarga'
 WHERE permiso = 'agenda.fuera_de_horario'
   AND NOT EXISTS (SELECT 1 FROM tenant_rol_permiso t2
                    WHERE t2.tenant_id = tenant_rol_permiso.tenant_id
                      AND t2.rol = tenant_rol_permiso.rol
                      AND t2.permiso = 'agenda.sobrecarga');
DELETE FROM tenant_rol_permiso WHERE permiso = 'agenda.fuera_de_horario';

DELETE FROM permisos WHERE codigo = 'agenda.fuera_de_horario';

INSERT INTO permisos (codigo, nombre, modulo, configurable, orden) VALUES
  ('agenda.recursos.configurar', 'Configurar salas y equipos de la agenda', 'agenda', true, 40),
  ('calendario.conectar_propio', 'Conectar su propio calendario externo', 'agenda', true, 50),
  ('calendario.ver_estado', 'Ver el estado de los calendarios conectados', 'agenda', true, 60)
ON CONFLICT (codigo) DO NOTHING;

-- Quién los tiene de fábrica. `calendario.conectar_propio` es de cada
-- persona sobre su propia cuenta, así que lo tiene todo el personal
-- clínico y de administración; `ver_estado` y `recursos` son de quien
-- administra.
INSERT INTO rol_permisos (rol, permiso)
SELECT r.codigo, p.permiso
  FROM (VALUES
    ('medico', 'calendario.conectar_propio'),
    ('admin_clinica', 'calendario.conectar_propio'),
    ('admin_clinica', 'calendario.ver_estado'),
    ('admin_clinica', 'agenda.recursos.configurar'),
    ('recepcion', 'calendario.conectar_propio')
  ) AS p(rol, permiso)
  JOIN roles r ON r.codigo = p.rol
ON CONFLICT DO NOTHING;

-- =====================================================================
-- 5. RLS FORZADA en todo lo nuevo que es de una clínica
-- =====================================================================
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agenda_equipos', 'cal_conexiones', 'cal_eventos', 'cal_bloques_ocupados',
    'cal_cola', 'cal_bitacora', 'agenda_preferencias'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t || '_tenant', t
    );
  END LOOP;
END $$;

-- `tipo_cita_equipos` y `cita_equipos` no llevan `tenant_id`: cuelgan de
-- un tipo de cita y de una cita, que ya están aisladas. Poner un
-- `tenant_id` redundante sería un dato que se puede desincronizar del
-- padre, y eso es peor que no tenerlo. Se protegen por la FK y por la
-- RLS de su padre, igual que `receta_items`.
