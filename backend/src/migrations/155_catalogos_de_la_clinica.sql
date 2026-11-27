-- ---------------------------------------------------------------------
-- 155 — LOS CATÁLOGOS QUE FALTABAN (prompt 11, §1)
--
-- Digital Vet tiene un menú «Mantenimientos» con los catálogos de la
-- clínica. En Vetline la mayoría ya existen —especies, razas, protocolos,
-- bodegas, servicios, tipos de cita, los trece catálogos clínicos del
-- anexo 07-03— y lo que falta es lo de abajo. El relevamiento completo,
-- catálogo por catálogo, está en
-- `docs/relevamientos/administracion-completa-antes.md`.
--
-- NINGÚN CATÁLOGO QUE YA EXISTE SE DUPLICA: la pantalla de Catálogos es
-- un punto de entrada que **enlaza** al módulo donde vive cada uno.
-- Copiar la pantalla de bodegas a Catálogos dejaría dos lugares donde
-- editar lo mismo.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- LA CLASIFICACIÓN DE PRODUCTOS: familia, subfamilia, marca y ubicación.
--
-- Hoy es `inv_productos.categoria`, TEXTO LIBRE, con tres valores en toda
-- la base. Con texto libre no hay filtro que se pueda confiar: «Antibiót.»
-- y «Antibióticos» son dos categorías distintas para la base y la misma
-- para la clínica.
--
-- LA SUBFAMILIA ES LA MISMA TABLA, por autorreferencia. Dos tablas
-- —familias y subfamilias— obligarían a elegir de antemano cuántos
-- niveles hay, y Digital Vet ya tiene clínicas con dos y con uno.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_familias (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nombre    VARCHAR(80) NOT NULL,
  /* La familia madre, cuando esto es una subfamilia. */
  padre_id  UUID REFERENCES inv_familias(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_familias_nombre
  ON inv_familias (tenant_id, nombre);

CREATE TABLE IF NOT EXISTS inv_marcas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nombre    VARCHAR(80) NOT NULL,
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_marcas_nombre
  ON inv_marcas (tenant_id, nombre);

-- La ubicación FÍSICA dentro de la clínica: «estante 3», «refrigerador
-- de vacunas». No es la bodega —esa ya existe y es contable—: es dónde
-- hay que ir a buscarlo.
CREATE TABLE IF NOT EXISTS inv_ubicaciones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nombre    VARCHAR(80) NOT NULL,
  bodega_id UUID REFERENCES inv_bodegas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_ubicaciones_nombre
  ON inv_ubicaciones (tenant_id, nombre);

-- La unidad BASE del producto, editable. Las de Hacienda
-- (`fact_cat_unidad_medida`) no se tocan: son suyas.
CREATE TABLE IF NOT EXISTS inv_unidades (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  codigo    VARCHAR(20) NOT NULL,
  nombre    VARCHAR(60) NOT NULL,
  /* A qué unidad de Hacienda corresponde, para el comprobante. */
  unidad_hacienda VARCHAR(20),
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_unidades_codigo
  ON inv_unidades (tenant_id, codigo);

ALTER TABLE inv_productos
  ADD COLUMN IF NOT EXISTS familia_id UUID REFERENCES inv_familias(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS marca_id UUID REFERENCES inv_marcas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS ubicacion_id UUID REFERENCES inv_ubicaciones(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN inv_productos.categoria IS
  'Texto libre del prompt 06, reemplazado por familia_id en el 11. Se conserva como respaldo de la migración: no se usa para filtrar.';

-- LO CARGADO NO SE PIERDE: cada texto distinto se vuelve una familia de
-- esa clínica, y el producto queda apuntando a ella.
INSERT INTO inv_familias (tenant_id, nombre)
SELECT DISTINCT p.tenant_id, trim(p.categoria)
  FROM inv_productos p
 WHERE p.categoria IS NOT NULL AND trim(p.categoria) <> ''
ON CONFLICT (tenant_id, nombre) DO NOTHING;

UPDATE inv_productos p
   SET familia_id = f.id
  FROM inv_familias f
 WHERE f.tenant_id = p.tenant_id
   AND f.nombre = trim(p.categoria)
   AND p.familia_id IS NULL;

-- ---------------------------------------------------------------------
-- LOS PRODUCTOS COMPUESTOS (KITS).
--
-- Un kit de cirugía o un paquete de vacunas: un producto que al venderse
-- descuenta OTROS. El componente es una **presentación** y no un
-- producto, porque lo que se descuenta tiene unidad: «2 jeringas de
-- 5 ml», no «2 jeringas».
--
-- EL KIT NO TIENE EXISTENCIAS PROPIAS. Si las tuviera habría dos
-- verdades sobre lo mismo: las del kit y las de sus componentes. Lo que
-- se puede vender es lo que alcanza en los componentes, y eso se calcula.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_producto_componentes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* El kit. */
  producto_id UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  /* Qué lleva, y cuánto. */
  componente_presentacion_id UUID NOT NULL REFERENCES inv_presentaciones(id) ON DELETE RESTRICT
              DEFERRABLE INITIALLY DEFERRED,
  cantidad  NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  UNIQUE (producto_id, componente_presentacion_id)
);

-- UN KIT NO PUEDE CONTENERSE A SÍ MISMO, ni directa ni indirectamente.
-- Un ciclo haría que vender un kit intente descontar infinito.
CREATE OR REPLACE FUNCTION inv_kit_sin_ciclos() RETURNS TRIGGER AS $$
DECLARE
  v_producto_componente UUID;
  v_hay_ciclo BOOLEAN;
BEGIN
  SELECT pr.producto_id INTO v_producto_componente
    FROM inv_presentaciones pr WHERE pr.id = NEW.componente_presentacion_id;

  IF v_producto_componente = NEW.producto_id THEN
    RAISE EXCEPTION 'Un kit no puede contenerse a sí mismo.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Y el ciclo largo: A lleva B, B lleva A.
  WITH RECURSIVE baja AS (
    SELECT pr.producto_id
      FROM inv_producto_componentes c
      JOIN inv_presentaciones pr ON pr.id = c.componente_presentacion_id
     WHERE c.producto_id = v_producto_componente
    UNION
    SELECT pr.producto_id
      FROM baja b
      JOIN inv_producto_componentes c ON c.producto_id = b.producto_id
      JOIN inv_presentaciones pr ON pr.id = c.componente_presentacion_id
  )
  SELECT EXISTS (SELECT 1 FROM baja WHERE producto_id = NEW.producto_id) INTO v_hay_ciclo;

  IF v_hay_ciclo THEN
    RAISE EXCEPTION 'Ese componente lleva, a su vez, a este kit: sería un ciclo.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inv_kit_sin_ciclos ON inv_producto_componentes;
CREATE TRIGGER trg_inv_kit_sin_ciclos
  AFTER INSERT OR UPDATE ON inv_producto_componentes
  FOR EACH ROW EXECUTE FUNCTION inv_kit_sin_ciclos();

-- ---------------------------------------------------------------------
-- LAS IMÁGENES DE PRODUCTO.
--
-- Sobre el almacenamiento que ya existe: se guarda la CLAVE del objeto,
-- igual que el logo de la clínica y los archivos del expediente. El
-- archivo no se duplica en la base.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_producto_imagenes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  producto_id UUID NOT NULL REFERENCES inv_productos(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  clave     TEXT NOT NULL,
  nombre_original VARCHAR(200),
  orden     SMALLINT NOT NULL DEFAULT 100,
  /* La que se muestra en la venta de mostrador y en la búsqueda. */
  principal BOOLEAN NOT NULL DEFAULT false,
  subido_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  subido_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_producto_imagenes
  ON inv_producto_imagenes (producto_id, orden);

-- UNA SOLA PRINCIPAL POR PRODUCTO. Con dos, la venta de mostrador
-- mostraría una distinta según el orden en que la base devuelva las
-- filas, que es la clase de inconsistencia que nadie reproduce.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_producto_imagen_principal
  ON inv_producto_imagenes (producto_id) WHERE principal;

-- ---------------------------------------------------------------------
-- TIPO DE CLIENTE Y ZONA (Mantenimientos › Clientes de Digital Vet).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_tipos_cliente (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nombre    VARCHAR(60) NOT NULL,
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tipos_cliente
  ON crm_tipos_cliente (tenant_id, nombre);

CREATE TABLE IF NOT EXISTS crm_zonas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  nombre    VARCHAR(60) NOT NULL,
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_zonas
  ON crm_zonas (tenant_id, nombre);

ALTER TABLE propietarios
  ADD COLUMN IF NOT EXISTS tipo_cliente_id UUID REFERENCES crm_tipos_cliente(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS zona_id UUID REFERENCES crm_zonas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------
-- LOS TRES CATÁLOGOS CLÍNICOS QUE FALTABAN.
--
-- Van en `exp_catalogos_clinicos`, que ya tiene trece tipos por clínica
-- desde el anexo 07-03. Tres tablas nuevas para tres listas de palabras
-- sería el error que ese anexo ya evitó.
-- ---------------------------------------------------------------------
ALTER TABLE exp_catalogos_clinicos DROP CONSTRAINT IF EXISTS exp_catalogos_clinicos_tipo_check;
ALTER TABLE exp_catalogos_clinicos
  ADD CONSTRAINT exp_catalogos_clinicos_tipo_check CHECK (
    tipo IN (
      'mucosas', 'hidratacion', 'actitud', 'dolor', 'sistema_examen',
      'via_administracion', 'frecuencia', 'unidad_dosis', 'caracter',
      'habitat', 'tipo_dieta', 'pelaje', 'motivo_baja',
      -- Prompt 11:
      'motivo_consulta', 'duracion_receta', 'corte_grooming'
    )
  );

-- La semilla, por clínica y por disparador: la lección de la 145 es que
-- un INSERT … SELECT FROM tenants corre una sola vez.
CREATE OR REPLACE FUNCTION exp_catalogos_11(p_tenant UUID) RETURNS void AS $$
  INSERT INTO exp_catalogos_clinicos (tenant_id, tipo, codigo, etiqueta, orden)
  SELECT p_tenant, v.tipo, v.codigo, v.etiqueta, v.orden
    FROM (VALUES
      ('motivo_consulta', 'control',        'Control',                      10),
      ('motivo_consulta', 'vacunacion',     'Vacunación',                   20),
      ('motivo_consulta', 'desparasitacion','Desparasitación',              30),
      ('motivo_consulta', 'enfermedad',     'Enfermedad o malestar',        40),
      ('motivo_consulta', 'herida',         'Herida o traumatismo',         50),
      ('motivo_consulta', 'cirugia',        'Cirugía programada',           60),
      ('motivo_consulta', 'emergencia',     'Emergencia',                   70),
      ('motivo_consulta', 'certificado',    'Certificado o trámite',        80),
      ('motivo_consulta', 'grooming',       'Estética',                     90),
      ('duracion_receta', '3_dias',         '3 días',                       10),
      ('duracion_receta', '5_dias',         '5 días',                       20),
      ('duracion_receta', '7_dias',         '7 días',                       30),
      ('duracion_receta', '10_dias',        '10 días',                      40),
      ('duracion_receta', '14_dias',        '14 días',                      50),
      ('duracion_receta', '21_dias',        '21 días',                      60),
      ('duracion_receta', '1_mes',          '1 mes',                        70),
      ('duracion_receta', 'permanente',     'Permanente',                   80),
      ('corte_grooming',  'higienico',      'Corte higiénico',              10),
      ('corte_grooming',  'raza',           'Corte de raza',                20),
      ('corte_grooming',  'verano',         'Corte de verano',              30),
      ('corte_grooming',  'tijera',         'Corte a tijera',               40),
      ('corte_grooming',  'bano_cepillado', 'Baño y cepillado, sin corte',  50)
    ) AS v(tipo, codigo, etiqueta, orden)
  -- El índice único de esa tabla es PARCIAL (solo donde tenant_id no es
  -- nulo, porque hay catálogos de plataforma con tenant_id nulo), así
  -- que el ON CONFLICT tiene que repetir su predicado.
  ON CONFLICT (tenant_id, tipo, codigo) WHERE tenant_id IS NOT NULL DO NOTHING;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION catalogos_11_al_crear_clinica() RETURNS TRIGGER AS $$
BEGIN
  PERFORM exp_catalogos_11(NEW.id);
  -- Tipos de cliente y zonas: dos valores de arranque y nada más. Las
  -- zonas son del barrio de cada clínica y adivinarlas sería basura.
  INSERT INTO crm_tipos_cliente (tenant_id, nombre, orden)
  VALUES (NEW.id, 'Particular', 10), (NEW.id, 'Criador', 20),
         (NEW.id, 'Albergue o rescate', 30), (NEW.id, 'Empresa', 40)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
  INSERT INTO inv_unidades (tenant_id, codigo, nombre, unidad_hacienda, orden)
  VALUES (NEW.id, 'unidad', 'Unidad', 'Unid', 10),
         (NEW.id, 'ml', 'Mililitro', 'ml', 20),
         (NEW.id, 'mg', 'Miligramo', 'mg', 30),
         (NEW.id, 'g', 'Gramo', 'g', 40),
         (NEW.id, 'kg', 'Kilogramo', 'kg', 50),
         (NEW.id, 'tableta', 'Tableta', 'Unid', 60),
         (NEW.id, 'dosis', 'Dosis', 'Unid', 70)
  ON CONFLICT (tenant_id, codigo) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_catalogos_11 ON tenants;
CREATE TRIGGER trg_catalogos_11
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION catalogos_11_al_crear_clinica();

-- Y las clínicas que ya existen.
SELECT exp_catalogos_11(t.id) FROM tenants t;
INSERT INTO crm_tipos_cliente (tenant_id, nombre, orden)
SELECT t.id, v.nombre, v.orden FROM tenants t
  CROSS JOIN (VALUES ('Particular', 10), ('Criador', 20),
                     ('Albergue o rescate', 30), ('Empresa', 40)) AS v(nombre, orden)
ON CONFLICT (tenant_id, nombre) DO NOTHING;
INSERT INTO inv_unidades (tenant_id, codigo, nombre, unidad_hacienda, orden)
SELECT t.id, v.codigo, v.nombre, v.uh, v.orden FROM tenants t
  CROSS JOIN (VALUES ('unidad','Unidad','Unid',10), ('ml','Mililitro','ml',20),
                     ('mg','Miligramo','mg',30), ('g','Gramo','g',40),
                     ('kg','Kilogramo','kg',50), ('tableta','Tableta','Unid',60),
                     ('dosis','Dosis','Unid',70)) AS v(codigo, nombre, uh, orden)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- ---------------------------------------------------------------------
-- RLS en todo lo nuevo.
--
-- `SET CONSTRAINTS ALL IMMEDIATE` antes del ALTER: las FK de este
-- esquema son DEFERRABLE INITIALLY DEFERRED, así que los INSERT de más
-- arriba dejan eventos de trigger pendientes en esta transacción, y
-- Postgres se niega a hacer ALTER TABLE sobre una tabla con eventos
-- pendientes. Esto los fuerza a verificarse ya —si alguno estuviera mal,
-- la migración falla acá, que es donde corresponde—.
-- ---------------------------------------------------------------------
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inv_familias', 'inv_marcas', 'inv_ubicaciones', 'inv_unidades',
    'inv_producto_componentes', 'inv_producto_imagenes',
    'crm_tipos_cliente', 'crm_zonas'
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
