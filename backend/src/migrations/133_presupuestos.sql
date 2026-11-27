-- ---------------------------------------------------------------------
-- 133 — PRESUPUESTOS (proformas) — prompt 08b, A1
--
-- Lo que resuelve: el médico cotiza una cirugía antes de hacerla, el
-- dueño se lo lleva para decidir, y cuando acepta eso se convierte en
-- los cargos de su cuenta sin volver a escribir nada. Hoy no existe
-- nada: la clínica cotiza por WhatsApp y después transcribe.
--
-- NO ES UN COMPROBANTE ELECTRÓNICO. No afecta inventario, no afecta
-- caja y no se le manda a Hacienda. Es un documento de la clínica, y la
-- diferencia se dice en el PDF y en el manual para que nadie lo archive
-- como una factura.
--
-- POR QUÉ UN CONSECUTIVO PROPIO Y NO EL DE LA CUENTA: el presupuesto
-- existe antes de que haya cuenta, y la mitad de los presupuestos nunca
-- llega a tener una. Numerarlos con el consecutivo de cuentas dejaría
-- huecos en la numeración de caja.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vta_presupuestos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  numero         INTEGER NOT NULL,
  propietario_id UUID REFERENCES propietarios(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  /* El nombre congelado: un presupuesto impreso tiene que seguir
     diciendo a quién se le cotizó aunque la ficha cambie de nombre. */
  cliente_nombre VARCHAR(200),
  /* Opcional: se cotiza una cirugía DE una mascota, pero también se
     cotiza «un plan de vacunación» sin paciente todavía. */
  paciente_id    UUID REFERENCES pacientes(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  /* De qué atención salió, cuando lo cotizó el médico en la consulta.
     Es el caso típico del prompt. */
  atencion_id    UUID REFERENCES atenciones(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  estado         VARCHAR(20) NOT NULL DEFAULT 'borrador',
  observaciones  TEXT,
  /* Cuántos días vale. Se copia del parámetro de la clínica al crear:
     si la clínica lo cambia después, los presupuestos ya emitidos
     conservan la vigencia con la que se entregaron. */
  vigencia_dias  SMALLINT NOT NULL DEFAULT 15 CHECK (vigencia_dias > 0),
  vence_el       DATE,
  /* Quién lo armó y quién registró la respuesta del cliente. */
  creado_por     UUID REFERENCES personas(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  enviado_en     TIMESTAMPTZ,
  /* La aprobación la registra el personal: «aceptado por teléfono»,
     «por WhatsApp», «en persona». El prompt es explícito en que NO se
     construye una aprobación en línea del cliente. */
  respondido_en  TIMESTAMPTZ,
  respondido_como VARCHAR(30),
  respuesta_nota TEXT,
  registrado_por UUID REFERENCES personas(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  /* A qué cuenta se convirtió. */
  cuenta_id      UUID REFERENCES vta_cuentas(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  convertido_en  TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vta_presupuestos_estado_check CHECK (
    estado IN ('borrador', 'enviado', 'aceptado', 'rechazado', 'vencido', 'convertido')
  ),
  /* Cómo contestó el cliente, cuando contestó. */
  CONSTRAINT vta_presupuestos_respuesta_check CHECK (
    respondido_como IS NULL OR respondido_como IN ('telefono', 'whatsapp', 'correo', 'en_persona')
  ),
  /* UN CONVERTIDO TIENE CUENTA, y una cuenta implica convertido. Sin
     esto, un presupuesto podría quedar «convertido» sin que exista la
     cuenta con los cargos, que es la única prueba de que se convirtió. */
  CONSTRAINT vta_presupuestos_convertido_check CHECK (
    (estado = 'convertido') = (cuenta_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vta_presupuestos_numero
  ON vta_presupuestos (tenant_id, numero);
CREATE INDEX IF NOT EXISTS idx_vta_presupuestos_cliente
  ON vta_presupuestos (propietario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_vta_presupuestos_estado
  ON vta_presupuestos (tenant_id, estado, vence_el);
CREATE INDEX IF NOT EXISTS idx_vta_presupuestos_atencion
  ON vta_presupuestos (atencion_id) WHERE atencion_id IS NOT NULL;

ALTER TABLE vta_presupuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_presupuestos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vta_presupuestos_tenant ON vta_presupuestos;
CREATE POLICY vta_presupuestos_tenant ON vta_presupuestos
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE vta_presupuestos IS
  'Cotizaciones. No son comprobantes electrónicos y no afectan inventario ni caja (prompt 08b, A1).';
COMMENT ON COLUMN vta_presupuestos.vigencia_dias IS
  'Días que vale. Se copia del parámetro de la clínica al crear, para que un presupuesto entregado conserve la vigencia con la que salió.';

-- ---------------------------------------------------------------------
-- LAS LÍNEAS.
--
-- Misma forma que `vta_cargos` —producto o servicio del catálogo, o
-- texto libre— porque al convertir cada línea se vuelve un cargo. Lo que
-- NO se copia es el movimiento de inventario: un presupuesto no descarga
-- stock.
--
-- EL PRECIO SE CONGELA EN LA LÍNEA. Es el precio que el cliente leyó en
-- el papel, y es lo que el prompt pide respetar dentro de la vigencia.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vta_presupuesto_lineas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  presupuesto_id UUID NOT NULL REFERENCES vta_presupuestos(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  orden          SMALLINT NOT NULL DEFAULT 0,
  presentacion_id UUID REFERENCES inv_presentaciones(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  servicio_id    UUID REFERENCES inv_servicios(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  descripcion    VARCHAR(300) NOT NULL,
  cantidad       NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(14,5) NOT NULL CHECK (precio_unitario >= 0),
  descuento      NUMERIC(14,5) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  /* Los datos fiscales se guardan congelados igual que el precio: el
     CABYS de un producto puede cambiar en el catálogo y la cotización
     tiene que poder convertirse con lo que se cotizó. */
  codigo_cabys   VARCHAR(13),
  codigo_tarifa_iva VARCHAR(2),
  unidad_medida  VARCHAR(15),
  linea_negocio  VARCHAR(40),
  /* La nota por línea que pide el prompt: «incluye la anestesia», «el
     precio no incluye el collar isabelino». */
  nota           TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vta_presupuesto_lineas_presupuesto
  ON vta_presupuesto_lineas (presupuesto_id, orden);

ALTER TABLE vta_presupuesto_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_presupuesto_lineas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vta_presupuesto_lineas_tenant ON vta_presupuesto_lineas;
CREATE POLICY vta_presupuesto_lineas_tenant ON vta_presupuesto_lineas
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- EL ANTICIPO SOBRE UN PRESUPUESTO.
--
-- `vta_anticipos` ya existe desde el 08 y ya se aplica al cobrar. Lo
-- único que falta es poder decir sobre QUÉ presupuesto se recibió: es el
-- caso que motiva la función —«dejame el 50 % de la cirugía»— y sin el
-- vínculo, al convertir hay que buscar el anticipo a mano.
-- ---------------------------------------------------------------------
ALTER TABLE vta_anticipos
  ADD COLUMN IF NOT EXISTS presupuesto_id UUID
    REFERENCES vta_presupuestos(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_vta_anticipos_presupuesto
  ON vta_anticipos(presupuesto_id) WHERE presupuesto_id IS NOT NULL;

-- La vigencia por omisión de la clínica.
ALTER TABLE vta_parametros
  ADD COLUMN IF NOT EXISTS presupuesto_vigencia_dias SMALLINT NOT NULL DEFAULT 15
    CHECK (presupuesto_vigencia_dias > 0);

-- El evento en la línea de tiempo del cliente y del paciente.
INSERT INTO crm_tipos_evento (codigo, etiqueta, modulo, clinico, orden)
SELECT * FROM (VALUES
  ('presupuesto_emitido',   'Presupuesto entregado',  'ventas', false, 40),
  ('presupuesto_respondido','Respuesta al presupuesto','ventas', false, 41)
) AS v(codigo, etiqueta, modulo, clinico, orden)
WHERE NOT EXISTS (SELECT 1 FROM crm_tipos_evento t WHERE t.codigo = v.codigo);
