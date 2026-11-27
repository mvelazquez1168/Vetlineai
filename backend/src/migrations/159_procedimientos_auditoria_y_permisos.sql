-- ---------------------------------------------------------------------
-- 159 — PROCEDIMIENTOS, LA HISTORIA DE PRECIOS Y LOS PERMISOS DEL 11
--       (prompt 11, §5 y §6)
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- LOS PROCEDIMIENTOS DE LA CLÍNICA.
--
-- El protocolo de limpieza del quirófano, el de emergencias, el de
-- manejo de controlados. Con categoría, versión y vigencia.
--
-- POR QUÉ NO VAN EN `documentos_conocimiento`: esa tabla es de
-- PLATAFORMA —la comparten todos los tenants, su ámbito es por país y
-- por agente— y el protocolo del quirófano de una clínica no puede vivir
-- ahí. El agente de ayuda (16a) va a leer esta tabla, con el alcance de
-- la clínica que pregunta.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinica_procedimientos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  categoria VARCHAR(60) NOT NULL,
  titulo    VARCHAR(160) NOT NULL,
  /* El texto, para que el agente de ayuda pueda citarlo. Si lo que hay
     es un PDF, va la clave del archivo y el texto queda vacío. */
  contenido TEXT,
  archivo_clave TEXT,
  version   VARCHAR(20) NOT NULL DEFAULT '1',
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  /* Para qué roles es. Vacío = para todos. */
  roles     VARCHAR(30)[] NOT NULL DEFAULT '{}',
  /* Si la clínica quiere que cada persona confirme que lo leyó. */
  exige_lectura BOOLEAN NOT NULL DEFAULT false,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* Algo tiene que decir: o el texto o el archivo. */
  CONSTRAINT clinica_procedimientos_contenido CHECK (
    contenido IS NOT NULL OR archivo_clave IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_clinica_procedimientos
  ON clinica_procedimientos (tenant_id, categoria) WHERE activo;

CREATE TABLE IF NOT EXISTS clinica_procedimiento_lecturas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  procedimiento_id UUID NOT NULL REFERENCES clinica_procedimientos(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* La versión que leyó: si el procedimiento cambia, la confirmación
     vieja no vale para la nueva. Guardar solo la fecha haría que un
     cambio de protocolo quede «leído» por todos sin que nadie lo lea. */
  version   VARCHAR(20) NOT NULL,
  leido_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procedimiento_id, persona_id, version)
);

-- ---------------------------------------------------------------------
-- LA HISTORIA DE PRECIOS, que no existía.
--
-- HALLAZGO DEL RELEVAMIENTO: `inv_lista_precio_items.precio` se cambia
-- —a mano o con la aplicación masiva del 06— y **no deja ningún
-- rastro**. El §5 pide ver los cambios de precio en la auditoría, y no
-- se puede mostrar lo que nadie guardó.
--
-- VA CON TRIGGER Y NO EN EL CÓDIGO: es la única forma de que no se pueda
-- cambiar un precio sin dejar rastro. Un `INSERT` en el historial dentro
-- de cada función que toca precios deja afuera a la próxima función que
-- alguien escriba.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_precios_historial (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  lista_id  UUID,
  presentacion_id UUID,
  servicio_id UUID,
  precio_anterior NUMERIC(14,2),
  precio_nuevo NUMERIC(14,2),
  /* Quién lo cambió. Sale de `app.persona_id`, que el alcance de tenant
     ya pone en la sesión: un trigger no recibe parámetros. */
  cambiado_por UUID,
  cambiado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_inv_precios_historial
  ON inv_precios_historial (tenant_id, cambiado_en DESC);

CREATE OR REPLACE FUNCTION inv_precio_cambio() RETURNS TRIGGER AS $$
DECLARE
  v_persona UUID;
BEGIN
  BEGIN
    v_persona := NULLIF(current_setting('app.persona_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_persona := NULL;
  END;

  IF TG_OP = 'UPDATE' AND NEW.precio IS NOT DISTINCT FROM OLD.precio THEN
    RETURN NULL;
  END IF;

  INSERT INTO inv_precios_historial
    (tenant_id, lista_id, presentacion_id, servicio_id,
     precio_anterior, precio_nuevo, cambiado_por)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    COALESCE(NEW.lista_id, OLD.lista_id),
    COALESCE(NEW.presentacion_id, OLD.presentacion_id),
    COALESCE(NEW.servicio_id, OLD.servicio_id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.precio END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.precio END,
    v_persona
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inv_precio_cambio ON inv_lista_precio_items;
CREATE TRIGGER trg_inv_precio_cambio
  AFTER INSERT OR UPDATE OR DELETE ON inv_lista_precio_items
  FOR EACH ROW EXECUTE FUNCTION inv_precio_cambio();

-- ---------------------------------------------------------------------
-- LOS PERMISOS DEL 11.
--
-- `controlados.firmar_cierre` es el único que NO se le da a nadie por
-- omisión: el regente es una persona concreta de la clínica y el sistema
-- no sabe quién es. La clínica se lo asigna desde Roles y permisos.
-- ---------------------------------------------------------------------
INSERT INTO permisos (codigo, nombre, modulo, configurable, orden)
SELECT * FROM (VALUES
  ('catalogos.editar',          'Editar los catálogos de la clínica',        'admin', false, 90),
  ('personal.gestionar',        'Turnos, ausencias y credenciales',          'admin', false, 91),
  ('comisiones.ver_propias',    'Ver sus propias comisiones',                'admin', false, 92),
  ('comisiones.ver_todas',      'Ver las comisiones de todo el personal',    'admin', false, 93),
  ('comisiones.aprobar',        'Aprobar una liquidación de comisiones',     'admin', false, 94),
  ('cumplimiento.gestionar',    'Permisos, vencimientos y desechos',         'admin', false, 95),
  ('controlados.registrar',     'Registrar en el libro de controlados',      'admin', false, 96),
  ('controlados.firmar_cierre', 'Firmar el cierre del libro de controlados', 'admin', true,  97),
  ('auditoria.ver',             'Ver la auditoría del sistema',              'admin', false, 98),
  ('procedimientos.editar',     'Editar los procedimientos de la clínica',   'admin', false, 99)
) AS v(codigo, nombre, modulo, configurable, orden)
WHERE NOT EXISTS (SELECT 1 FROM permisos p WHERE p.codigo = v.codigo);

INSERT INTO rol_permisos (rol, permiso)
SELECT * FROM (VALUES
  -- El administrador, todos menos firmar el cierre de controlados: eso
  -- es del regente, y puede no ser la misma persona.
  ('admin_clinica', 'catalogos.editar'),
  ('admin_clinica', 'personal.gestionar'),
  ('admin_clinica', 'comisiones.ver_propias'),
  ('admin_clinica', 'comisiones.ver_todas'),
  ('admin_clinica', 'comisiones.aprobar'),
  ('admin_clinica', 'cumplimiento.gestionar'),
  ('admin_clinica', 'controlados.registrar'),
  ('admin_clinica', 'auditoria.ver'),
  ('admin_clinica', 'procedimientos.editar'),
  -- Cada médico ve LO SUYO. Es lo que el prompt pide, y es lo que evita
  -- que el administrador tenga que mandarle su comisión por mensaje.
  ('medico', 'comisiones.ver_propias'),
  -- El médico registra salidas de controlados: es quien las indica.
  ('medico', 'controlados.registrar'),
  -- Farmacia también: las entradas por compra pasan por ahí.
  ('farmacia', 'controlados.registrar'),
  ('farmacia', 'catalogos.editar'),
  -- El contador ve las comisiones de todos porque las paga, y la
  -- auditoría porque es su trabajo revisarla.
  ('contador', 'comisiones.ver_todas'),
  ('contador', 'auditoria.ver')
) AS v(rol, permiso)
WHERE NOT EXISTS (
  SELECT 1 FROM rol_permisos rp WHERE rp.rol = v.rol AND rp.permiso = v.permiso
);

SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clinica_procedimientos', 'clinica_procedimiento_lecturas', 'inv_precios_historial'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t || '_tenant', t
    );
  END LOOP;
END $$;
