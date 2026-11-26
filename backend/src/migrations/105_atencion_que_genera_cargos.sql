-- ---------------------------------------------------------------------
-- 105 — La atención que genera cargos (prompt 07, bloque B)
--
-- El bloque A dejó el expediente como una VISTA sobre las tablas que ya
-- son dueñas de cada hecho. Este bloque agrega lo que pasa DURANTE la
-- visita, y sigue el mismo criterio: nada que ya exista se vuelve a
-- guardar acá.
--
--   * el dinero vive en `vta_cargos`, por `agregarCargo`;
--   * el stock vive en `inv_movimientos`, por `registrarMovimiento`;
--   * el preventivo vive en `cuidados_preventivos`, que es lo que el job
--     diario lee para avisar;
--   * el control recomendado vive en `citas`, por `crearCita`, que ya
--     dispara su propio recordatorio.
--
-- Lo que no existía en ninguna parte es el REGISTRO CLÍNICO de la visita
-- —el SOAP, el examen por sistemas, los diagnósticos— y, sobre todo, la
-- lista de LO QUE SE VA A COBRAR mientras la atención está en borrador.
-- Eso último no puede ser un cargo todavía: un cargo es plata en la cuenta
-- de un cliente, y mientras el médico está escribiendo todavía no hay
-- nada cobrable. De ahí `exp_atencion_items`: lo elegido del catálogo,
-- con su precio, que al cerrar se convierte en cargo UNA sola vez.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- EL SOAP, en la atención que ya existe
--
-- Cuatro campos de texto y los signos, en `atenciones`: es una fila por
-- visita y una tabla aparte solo agregaría un JOIN. El examen por
-- sistemas sí va aparte, porque son muchas filas por visita.
-- ---------------------------------------------------------------------

ALTER TABLE atenciones
  ADD COLUMN IF NOT EXISTS tipo_consulta      VARCHAR(40),
  ADD COLUMN IF NOT EXISTS plantilla_id       UUID,
  /* S — lo que cuenta quien trae al paciente */
  ADD COLUMN IF NOT EXISTS motivo_consulta    TEXT,
  ADD COLUMN IF NOT EXISTS anamnesis          TEXT,
  /* O — los signos. El peso y la temperatura ya estaban. */
  ADD COLUMN IF NOT EXISTS frecuencia_cardiaca     INTEGER,
  ADD COLUMN IF NOT EXISTS frecuencia_respiratoria INTEGER,
  ADD COLUMN IF NOT EXISTS condicion_corporal      SMALLINT,
  ADD COLUMN IF NOT EXISTS mucosas            VARCHAR(40),
  ADD COLUMN IF NOT EXISTS tiempo_llenado_capilar  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS hidratacion        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS examen_general     TEXT,
  /* A — la evaluación */
  ADD COLUMN IF NOT EXISTS evaluacion         TEXT,
  /* P — el plan */
  ADD COLUMN IF NOT EXISTS plan_tratamiento   TEXT,
  ADD COLUMN IF NOT EXISTS indicaciones_cliente TEXT,
  ADD COLUMN IF NOT EXISTS control_fecha      DATE,
  ADD COLUMN IF NOT EXISTS control_motivo     VARCHAR(200),
  /* La cita del control, cuando el cierre la creó: así se sabe que ya
     está programada y un segundo cierre no la duplica. */
  ADD COLUMN IF NOT EXISTS control_cita_id    UUID,
  /* La cuenta a la que fueron los cargos. Es la prueba de que esta
     atención ya se cobró —o está esperando en la caja— y lo que impide
     que un segundo cierre cargue todo de nuevo. */
  ADD COLUMN IF NOT EXISTS cuenta_id          UUID;

/* La condición corporal es la escala de 9 puntos (WSAVA). Un 12 ahí no
   es un dato raro: es un dato equivocado. */
ALTER TABLE atenciones DROP CONSTRAINT IF EXISTS atenciones_condicion_corporal_check;
ALTER TABLE atenciones
  ADD CONSTRAINT atenciones_condicion_corporal_check
  CHECK (condicion_corporal IS NULL OR condicion_corporal BETWEEN 1 AND 9);

COMMENT ON COLUMN atenciones.cuenta_id IS
  'La cuenta de venta a la que el cierre mandó los cargos. NULL mientras la atención está en borrador. Es el candado contra el doble cobro: si ya tiene cuenta, el cierre no vuelve a cargar.';

-- ---------------------------------------------------------------------
-- LAS PLANTILLAS POR TIPO DE CONSULTA
--
-- Configurables por la clínica: una clínica de felinos no examina lo
-- mismo que una de equinos. Las de la plataforma (tenant_id NULL) son el
-- punto de partida y no se editan; una clínica puede crear las suyas.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exp_plantillas_atencion (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* NULL = plantilla de la plataforma, visible para todas las clínicas. */
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE
                  DEFERRABLE INITIALLY DEFERRED,
  tipo_consulta VARCHAR(40) NOT NULL,
  nombre        VARCHAR(120) NOT NULL,
  /* Qué sistemas se examinan en este tipo de consulta, en orden. */
  sistemas      TEXT[] NOT NULL DEFAULT '{}',
  /* Texto con el que arranca cada sección, para no escribir de cero. */
  motivo_sugerido      TEXT,
  anamnesis_sugerida   TEXT,
  plan_sugerido        TEXT,
  indicaciones_sugeridas TEXT,
  /* Servicios que casi siempre se cobran en este tipo de consulta: se
     ofrecen, no se agregan solos. Un cargo que aparece sin que nadie lo
     pida es un cargo que alguien va a tener que explicar. */
  servicios_sugeridos  UUID[] NOT NULL DEFAULT '{}',
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plantillas_atencion_tenant
  ON exp_plantillas_atencion (tenant_id, activo);

-- ---------------------------------------------------------------------
-- EL EXAMEN FÍSICO POR SISTEMAS
--
-- `estado` normal/anormal/no_evaluado, y la nota SOLO tiene sentido en
-- lo anormal: un examen con once «normal» y una nota en el que no lo
-- está es exactamente lo que el médico quiere escribir en consulta.
--
-- «no evaluado» existe y no es lo mismo que «normal»: no haber mirado
-- los oídos no es haberlos encontrado bien.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exp_examen_sistemas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                DEFERRABLE INITIALLY DEFERRED,
  atencion_id UUID NOT NULL REFERENCES atenciones(id) ON DELETE CASCADE
                DEFERRABLE INITIALLY DEFERRED,
  sistema     VARCHAR(60) NOT NULL,
  estado      VARCHAR(20) NOT NULL
                CHECK (estado IN ('normal', 'anormal', 'no_evaluado')),
  nota        TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (atencion_id, sistema)
);

-- ---------------------------------------------------------------------
-- LOS DIAGNÓSTICOS
--
-- Presuntivo o definitivo, y con `problema_id` cuando el médico decidió
-- que esto no es de esta visita sino del paciente: ahí el diagnóstico
-- pasa a la lista de problemas del bloque A y queda uno solo, no una
-- copia en cada lado.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exp_diagnosticos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                DEFERRABLE INITIALLY DEFERRED,
  atencion_id UUID NOT NULL REFERENCES atenciones(id) ON DELETE CASCADE
                DEFERRABLE INITIALLY DEFERRED,
  tipo        VARCHAR(20) NOT NULL CHECK (tipo IN ('presuntivo', 'definitivo')),
  descripcion VARCHAR(300) NOT NULL,
  /* El problema del expediente que este diagnóstico abrió, si lo abrió. */
  problema_id UUID REFERENCES exp_problemas(id) ON DELETE SET NULL
                DEFERRABLE INITIALLY DEFERRED,
  creado_por  UUID REFERENCES personas(id) ON DELETE SET NULL
                DEFERRABLE INITIALLY DEFERRED,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnosticos_atencion ON exp_diagnosticos (atencion_id);

-- ---------------------------------------------------------------------
-- LO REALIZADO: la lista de lo que se eligió del catálogo
--
-- Todo lo que se hace en la visita entra acá, elegido del catálogo y
-- nunca escrito a mano: un servicio, una vacuna con su lote, un producto
-- aplicado, un ítem de receta dispensado en la clínica.
--
-- `precio_unitario` se CONGELA al agregar el ítem. El médico ve un total
-- mientras trabaja, y ese total no puede cambiar porque alguien editó el
-- catálogo a mitad de la consulta.
--
-- `cargo_id` es el puente al dinero: NULL mientras la atención está
-- en borrador, con el id del cargo después del cierre. Un ítem con cargo no
-- se vuelve a cobrar nunca, y es así como «un cargo no llega dos veces»
-- se cumple por el modelo y no por cuidado de quien llama.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exp_atencion_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  atencion_id    UUID NOT NULL REFERENCES atenciones(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  tipo           VARCHAR(20) NOT NULL
                   CHECK (tipo IN ('servicio', 'producto', 'vacuna',
                                   'desparasitacion', 'receta')),
  /* De dónde salió. Uno de los dos, según el tipo. */
  servicio_id    UUID REFERENCES inv_servicios(id) ON DELETE RESTRICT
                   DEFERRABLE INITIALLY DEFERRED,
  presentacion_id UUID REFERENCES inv_presentaciones(id) ON DELETE RESTRICT
                   DEFERRABLE INITIALLY DEFERRED,
  /* El lote, cuando el médico eligió uno (una vacuna se registra con su
     lote). Sin lote, la salida la resuelve FEFO como cualquier venta. */
  lote_id        UUID REFERENCES inv_lotes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  descripcion    VARCHAR(300) NOT NULL,
  cantidad       NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(14,5) NOT NULL CHECK (precio_unitario >= 0),
  descuento      NUMERIC(14,5) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  lista_precio_id UUID REFERENCES inv_listas_precio(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  linea_negocio  VARCHAR(40),
  especialidad   VARCHAR(60),
  /* Quién lo hizo: puede no ser quien registra la atención (el servicio
     de laboratorio lo hace otra persona). */
  realizado_por  UUID REFERENCES personas(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  /* Para una vacuna o una desparasitación: lo que hace falta para el
     preventivo, que se crea al cerrar. */
  preventivo_tipo       VARCHAR(20)
                   CHECK (preventivo_tipo IS NULL OR
                          preventivo_tipo IN ('vacunacion', 'desparasitacion')),
  preventivo_nombre     VARCHAR(120),
  preventivo_subtipo    VARCHAR(20),
  preventivo_proxima    DATE,
  /* Para un ítem de receta: si se dispensa acá o se compra afuera. Lo de
     afuera NO descarga inventario ni se cobra. */
  dispensado_aqui BOOLEAN NOT NULL DEFAULT true,
  /* El puente al dinero y al stock, después del cierre. */
  cargo_id       UUID REFERENCES vta_cargos(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  movimiento_id  UUID REFERENCES inv_movimientos(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  creado_por     UUID REFERENCES personas(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

  /* Un ítem sale del catálogo: servicio o presentación, nunca ninguno.
     El texto libre es justamente lo que el prompt no quiere. */
  CONSTRAINT item_sale_del_catalogo
    CHECK ((servicio_id IS NOT NULL) <> (presentacion_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_atencion_items_atencion ON exp_atencion_items (atencion_id);
CREATE INDEX IF NOT EXISTS idx_atencion_items_sin_cargo
  ON exp_atencion_items (atencion_id) WHERE cargo_id IS NULL;

COMMENT ON COLUMN exp_atencion_items.precio_unitario IS
  'Congelado al agregar el ítem. El total que el médico ve en la cuenta viva no puede cambiar porque alguien editó el catálogo a mitad de la consulta.';

-- ---------------------------------------------------------------------
-- RLS — el criterio estándar de este repo, y FORCE para que ni el dueño
-- de la tabla se lo saltee.
-- ---------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['exp_examen_sistemas', 'exp_diagnosticos', 'exp_atencion_items']
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

-- Las plantillas son el caso especial: cada clínica ve las suyas Y las
-- de la plataforma (tenant_id NULL), pero solo puede escribir las suyas.
-- Mismo patrón que ya se usó para los catálogos compartidos.
ALTER TABLE exp_plantillas_atencion ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_plantillas_atencion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exp_plantillas_atencion_tenant ON exp_plantillas_atencion;
CREATE POLICY exp_plantillas_atencion_tenant ON exp_plantillas_atencion
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- INMUTABILIDAD: una atención cerrada no se edita
--
-- El bloque A ya lo impuso sobre `atenciones`. Lo mismo vale para lo que
-- cuelga de ella: cambiar el examen o quitar un ítem de una atención
-- firmada es reescribir la historia. La corrección es una adenda.
--
-- `fact_es_operacion_directa()` deja pasar el borrado en cascada de una
-- clínica purgada — misma razón que la migración 102.
-- ---------------------------------------------------------------------

/* Limpieza de una versión anterior de esta misma migración, que llamaba
   'abierta' al estado que el bloque A llama 'borrador'. Sin esto, un
   disparador viejo con el nombre viejo seguiría rechazando TODA
   escritura, incluso con la atención en borrador. */
DROP TRIGGER IF EXISTS trg_examen_solo_abierta ON exp_examen_sistemas;
DROP TRIGGER IF EXISTS trg_diagnosticos_solo_abierta ON exp_diagnosticos;
DROP FUNCTION IF EXISTS exp_atencion_abierta();

CREATE OR REPLACE FUNCTION exp_atencion_en_borrador() RETURNS TRIGGER AS $$
DECLARE
  v_estado TEXT;
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT estado INTO v_estado FROM atenciones
   WHERE id = COALESCE(NEW.atencion_id, OLD.atencion_id);
  IF v_estado IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION
      'La atención está en estado %, y lo que ya se firmó no se edita: la corrección es una adenda.',
      COALESCE(v_estado, 'en un estado desconocido');
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_examen_solo_borrador ON exp_examen_sistemas;
CREATE TRIGGER trg_examen_solo_borrador
  BEFORE UPDATE OR DELETE ON exp_examen_sistemas
  FOR EACH ROW EXECUTE FUNCTION exp_atencion_en_borrador();

DROP TRIGGER IF EXISTS trg_diagnosticos_solo_borrador ON exp_diagnosticos;
CREATE TRIGGER trg_diagnosticos_solo_borrador
  BEFORE UPDATE OR DELETE ON exp_diagnosticos
  FOR EACH ROW EXECUTE FUNCTION exp_atencion_en_borrador();

/* Los ítems son la excepción parcial: el cierre MISMO les escribe
   `cargo_id` y `movimiento_id` cuando la atención ya pasó a cerrada. El
   disparador solo frena el borrado y el cambio de lo clínico. */
CREATE OR REPLACE FUNCTION exp_item_no_se_borra_cerrado() RETURNS TRIGGER AS $$
DECLARE
  v_estado TEXT;
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN OLD;
  END IF;
  SELECT estado INTO v_estado FROM atenciones WHERE id = OLD.atencion_id;
  IF v_estado IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION
      'La atención está en estado %: un ítem ya cobrado no se borra. Se anula el cargo desde la caja.',
      COALESCE(v_estado, 'en un estado desconocido');
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_no_se_borran_cerrado ON exp_atencion_items;
CREATE TRIGGER trg_items_no_se_borran_cerrado
  BEFORE DELETE ON exp_atencion_items
  FOR EACH ROW EXECUTE FUNCTION exp_item_no_se_borra_cerrado();

-- ---------------------------------------------------------------------
-- LAS PLANTILLAS DE LA PLATAFORMA
--
-- Seis tipos de consulta con los sistemas que de verdad se examinan en
-- cada uno. Son el punto de partida: una clínica las copia y las ajusta.
-- ---------------------------------------------------------------------

INSERT INTO exp_plantillas_atencion
  (tenant_id, tipo_consulta, nombre, sistemas, motivo_sugerido, plan_sugerido, indicaciones_sugeridas)
SELECT NULL, v.tipo, v.nombre, v.sistemas, v.motivo, v.plan, v.indicaciones
FROM (VALUES
  ('consulta_general', 'Consulta general',
   ARRAY['Actitud y estado general','Piel y pelaje','Ojos','Oídos','Cavidad oral y dientes',
         'Ganglios linfáticos','Cardiovascular','Respiratorio','Abdomen','Musculoesquelético',
         'Neurológico','Urogenital'],
   NULL, NULL, NULL),
  ('vacunacion', 'Vacunación',
   ARRAY['Actitud y estado general','Temperatura y mucosas','Piel en el sitio de aplicación',
         'Ganglios linfáticos'],
   'Vacunación programada.',
   'Aplicación de la vacuna correspondiente al calendario.',
   'Puede tener algo de somnolencia o dolor en el sitio de aplicación durante 24 a 48 horas. Si aparece hinchazón de la cara, vómito o dificultad para respirar, consultar de inmediato.'),
  ('control', 'Control',
   ARRAY['Actitud y estado general','Evolución del problema en seguimiento','Peso',
         'Sitio quirúrgico o lesión'],
   'Control de evolución.', NULL, NULL),
  ('urgencia', 'Urgencia',
   ARRAY['Estado de conciencia','Mucosas y tiempo de llenado capilar','Cardiovascular',
         'Respiratorio','Abdomen','Temperatura','Hidratación','Dolor'],
   NULL, NULL, NULL),
  ('cirugia', 'Cirugía',
   ARRAY['Riesgo anestésico','Cardiovascular','Respiratorio','Hidratación',
         'Cavidad oral y dientes','Sitio quirúrgico'],
   NULL, NULL,
   'Ayuno según indicación, reposo, no mojar la herida y volver al control en la fecha indicada. Si hay sangrado, mal olor o el paciente se lame la herida, consultar.'),
  ('dermatologia', 'Dermatología',
   ARRAY['Piel y pelaje','Distribución de las lesiones','Oídos','Uñas y almohadillas',
         'Prurito','Ganglios linfáticos'],
   NULL, NULL, NULL)
) AS v(tipo, nombre, sistemas, motivo, plan, indicaciones)
WHERE NOT EXISTS (
  SELECT 1 FROM exp_plantillas_atencion p
   WHERE p.tenant_id IS NULL AND p.tipo_consulta = v.tipo
);
