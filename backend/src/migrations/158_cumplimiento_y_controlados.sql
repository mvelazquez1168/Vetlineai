-- ---------------------------------------------------------------------
-- 158 — CUMPLIMIENTO, CONTROLADOS Y DESECHOS (prompt 11, §4)
--
-- SOBRE LAS FUENTES OFICIALES, y esto es importante: el prompt pide que
-- los permisos que exige la ley se confirmen contra la fuente oficial
-- —Ministerio de Salud, SENASA, Colegio de Médicos Veterinarios— y que
-- **no se presente como obligación legal lo que no esté confirmado**.
--
-- Este entorno no tiene acceso a esas fuentes. Por eso:
--
--   * la lista que se siembra está marcada `sugerido = true` y la
--     pantalla la muestra como **sugerida, no como obligación**;
--   * `fuente_confirmada` arranca en NULL y existe para que, cuando
--     alguien confirme contra la fuente, quede dicho **cuál** y
--     **cuándo**;
--   * el informe lista qué quedó sin confirmar.
--
-- Inventar que algo es obligatorio por ley es peor que no listarlo: una
-- clínica que gasta en un trámite que no necesitaba por algo que dijo
-- este sistema tiene un problema con este sistema.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cmp_permisos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nombre    VARCHAR(120) NOT NULL,
  /* Quién lo exige, según lo que la clínica sepa. Texto y no catálogo:
     cambia por país y no se puede cerrar desde acá. */
  organismo VARCHAR(80),
  numero    VARCHAR(60),
  emitido_el DATE,
  vence_el  DATE,
  dias_aviso SMALLINT NOT NULL DEFAULT 30 CHECK (dias_aviso BETWEEN 1 AND 365),
  responsable_id UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  archivo_clave TEXT,
  /* Lo sembró el sistema como sugerencia, no lo cargó la clínica. */
  sugerido  BOOLEAN NOT NULL DEFAULT false,
  /* Contra qué fuente oficial se confirmó que esto se exige, y cuándo.
     NULL = nadie lo confirmó todavía. */
  fuente_confirmada VARCHAR(200),
  fuente_confirmada_en DATE,
  avisado_en TIMESTAMPTZ,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmp_permisos_vence
  ON cmp_permisos (tenant_id, vence_el) WHERE activo;

COMMENT ON COLUMN cmp_permisos.sugerido IS
  'true = lo sembró el sistema como sugerencia. La pantalla no lo presenta como obligación legal mientras fuente_confirmada esté en NULL (prompt 11, §4).';

-- ---------------------------------------------------------------------
-- EL LIBRO DE MEDICAMENTOS CONTROLADOS.
--
-- NO ES UNA TABLA DE MOVIMIENTOS. El libro se **arma** desde
-- `inv_movimientos`, que ya guarda la entrada (la compra), la salida
-- (por paciente y por atención) y el lote. Un segundo registro de lo
-- mismo es un segundo registro que un día no coincide, y en un libro de
-- controlados eso es un problema con el regente.
--
-- Lo único propio es el CIERRE: el hecho de que el regente mire el saldo
-- de un período, lo compare con lo que hay en el estante y firme. Eso no
-- está en ninguna parte.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cmp_controlados_cierres (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  desde     DATE NOT NULL,
  hasta     DATE NOT NULL,
  /* El regente que firma. Lleva su propio permiso
     (`controlados.firmar_cierre`), que no es el de registrar. */
  firmado_por UUID NOT NULL REFERENCES personas(id) ON DELETE RESTRICT
              DEFERRABLE INITIALLY DEFERRED,
  firmado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* El saldo por producto y lote tal como estaba al firmar, congelado.
     Es el sentido de la firma: esto es lo que el regente vio. */
  saldos    JSONB NOT NULL,
  /* Lo que el regente contó en el estante, cuando difiere. */
  observaciones TEXT,
  CONSTRAINT cmp_cierres_periodo CHECK (hasta >= desde)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmp_cierres_periodo
  ON cmp_controlados_cierres (tenant_id, desde, hasta);

-- SOLO DE AGREGAR. Un cierre firmado no se edita ni se borra: un error
-- se corrige con un cierre nuevo que lo explique, igual que un asiento
-- inverso. Es el mismo trigger que ya protege el historial de políticas
-- y las interacciones del CRM.
CREATE OR REPLACE FUNCTION cmp_cierres_solo_agregar() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'El cierre del libro de controlados no se edita ni se borra: está firmado. Un error se corrige con un cierre nuevo que lo explique.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cmp_cierres_solo_agregar ON cmp_controlados_cierres;
CREATE TRIGGER trg_cmp_cierres_solo_agregar
  BEFORE UPDATE OR DELETE ON cmp_controlados_cierres
  FOR EACH ROW EXECUTE FUNCTION cmp_cierres_solo_agregar();

-- ---------------------------------------------------------------------
-- LOS DESECHOS BIOINFECCIOSOS.
--
-- Fecha, tipo, cuánto, quién se los llevó y el comprobante. Es lo que
-- una inspección pide ver.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cmp_desechos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  fecha     DATE NOT NULL,
  tipo      VARCHAR(40) NOT NULL,
  peso_kg   NUMERIC(10,2) CHECK (peso_kg IS NULL OR peso_kg > 0),
  volumen_l NUMERIC(10,2) CHECK (volumen_l IS NULL OR volumen_l > 0),
  /* El gestor autorizado que los retira. */
  gestor    VARCHAR(120) NOT NULL,
  gestor_autorizacion VARCHAR(60),
  /* El manifiesto o comprobante de retiro. */
  archivo_clave TEXT,
  registrado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* Peso o volumen: alguno de los dos. Un retiro sin cantidad no sirve
     para nada. */
  CONSTRAINT cmp_desechos_cantidad CHECK (peso_kg IS NOT NULL OR volumen_l IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cmp_desechos_fecha ON cmp_desechos (tenant_id, fecha);

-- ---------------------------------------------------------------------
-- LA LISTA SUGERIDA, por disparador y por respaldo.
--
-- TODOS NACEN `sugerido = true` Y SIN FECHA. La clínica confirma cuáles
-- le aplican y les pone su vencimiento; los que no, los desactiva.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cmp_permisos_sugeridos(p_tenant UUID) RETURNS void AS $$
  INSERT INTO cmp_permisos (tenant_id, nombre, organismo, sugerido, dias_aviso)
  SELECT p_tenant, v.nombre, v.organismo, true, v.dias
    FROM (VALUES
      ('Permiso sanitario de funcionamiento', 'Ministerio de Salud', 60),
      ('Certificado veterinario de operación', 'SENASA', 60),
      ('Patente municipal', 'Municipalidad', 30),
      ('Regencia veterinaria', 'Colegio de Médicos Veterinarios', 60),
      ('Póliza de riesgos del trabajo', 'INS', 30),
      ('Revisión del equipo de rayos X', 'Ministerio de Salud', 30),
      ('Calibración de equipos de laboratorio', 'Proveedor del equipo', 30),
      ('Contrato con gestor de desechos bioinfecciosos', 'Gestor autorizado', 30)
    ) AS v(nombre, organismo, dias)
  WHERE NOT EXISTS (
    SELECT 1 FROM cmp_permisos c WHERE c.tenant_id = p_tenant AND c.nombre = v.nombre
  );
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION cmp_sugeridos_al_crear_clinica() RETURNS TRIGGER AS $$
BEGIN
  PERFORM cmp_permisos_sugeridos(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cmp_sugeridos ON tenants;
CREATE TRIGGER trg_cmp_sugeridos
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION cmp_sugeridos_al_crear_clinica();

SELECT cmp_permisos_sugeridos(t.id) FROM tenants t;

SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cmp_permisos', 'cmp_controlados_cierres', 'cmp_desechos'] LOOP
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
