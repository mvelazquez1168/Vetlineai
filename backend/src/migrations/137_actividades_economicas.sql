-- ---------------------------------------------------------------------
-- 137 — VARIAS ACTIVIDADES ECONÓMICAS POR EMISOR (prompt 09b, B1)
--
-- Medicavet tiene dos actividades inscritas: venta al por mayor de
-- productos farmacéuticos y veterinarios, y actividades veterinarias.
-- `fact_emisores` guardaba UNA sola (`codigo_actividad_economica`), así
-- que todos sus comprobantes salían con la misma, y eso es declarar la
-- venta de alimento como si fuera un servicio clínico.
--
-- LO QUE DICE LA FUENTE OFICIAL, leído del XSD v4.4:
--
--   `CodigoActividadEmisor` es UN elemento de seis caracteres,
--   obligatorio y NO repetible: «se debe de indicar el código de la
--   actividad económica inscrita a la cual corresponde el comprobante
--   que se está generando».
--
-- O sea: **un comprobante, una actividad.** No hay forma de declarar
-- dos. Eso no es una limitación nuestra y por eso el sistema la hace
-- cumplir: cuando una cuenta mezcla líneas de dos actividades, avisa y
-- propone separarla en dos comprobantes, que es lo único que la
-- estructura permite.
--
-- (El XSD también tiene `CodigoActividadReceptor`, opcional, para el
-- crédito fiscal del receptor. No se construye ahora y queda anotado.)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fact_emisor_actividades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                DEFERRABLE INITIALLY DEFERRED,
  emisor_id   UUID NOT NULL REFERENCES fact_emisores(id) ON DELETE CASCADE
                DEFERRABLE INITIALLY DEFERRED,
  /* Seis caracteres exactos: lo impone el XSD y un código de cinco hace
     que Hacienda rechace el comprobante entero. */
  codigo      VARCHAR(6) NOT NULL,
  descripcion VARCHAR(200),
  /* La que se usa cuando ninguna regla aplica. */
  es_predeterminada BOOLEAN NOT NULL DEFAULT false,
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fact_emisor_actividades_codigo_check CHECK (length(codigo) = 6)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_emisor_actividades_codigo
  ON fact_emisor_actividades (emisor_id, codigo);
-- UNA SOLA PREDETERMINADA por emisor: dos serían dos respuestas a la
-- misma pregunta y la emisión tendría que elegir al azar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_emisor_actividades_predeterminada
  ON fact_emisor_actividades (emisor_id) WHERE es_predeterminada;

ALTER TABLE fact_emisor_actividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_emisor_actividades FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fact_emisor_actividades_tenant ON fact_emisor_actividades;
CREATE POLICY fact_emisor_actividades_tenant ON fact_emisor_actividades
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE fact_emisor_actividades IS
  'Las actividades económicas inscritas del emisor. Un comprobante declara UNA (CodigoActividadEmisor del XSD v4.4) (prompt 09b, B1).';

-- ---------------------------------------------------------------------
-- QUÉ ACTIVIDAD LE CORRESPONDE A CADA LÍNEA DE NEGOCIO.
--
-- Es la regla que el prompt pide: farmacia y alimentos usan la de
-- venta; los servicios clínicos y el grooming, la veterinaria. Se
-- configura por clínica porque las actividades inscritas son de cada
-- contribuyente.
--
-- La FK a `lineas_negocio` hace que una regla no pueda apuntar a una
-- línea que no existe, que es el error que después aparece como «mi
-- factura salió con la actividad equivocada».
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_actividad_por_linea (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                  DEFERRABLE INITIALLY DEFERRED,
  linea_negocio VARCHAR(40) NOT NULL REFERENCES lineas_negocio(codigo)
                  DEFERRABLE INITIALLY DEFERRED,
  actividad_id  UUID NOT NULL REFERENCES fact_emisor_actividades(id) ON DELETE CASCADE
                  DEFERRABLE INITIALLY DEFERRED,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_actividad_por_linea
  ON fact_actividad_por_linea (tenant_id, linea_negocio);

ALTER TABLE fact_actividad_por_linea ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_actividad_por_linea FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fact_actividad_por_linea_tenant ON fact_actividad_por_linea;
CREATE POLICY fact_actividad_por_linea_tenant ON fact_actividad_por_linea
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE fact_actividad_por_linea IS
  'Qué actividad económica le corresponde a cada línea de negocio al emitir (prompt 09b, B1).';

-- ---------------------------------------------------------------------
-- LA QUE YA ESTABA SE CONSERVA.
--
-- `fact_emisores.codigo_actividad_economica` no se borra: pasa a ser la
-- actividad predeterminada y queda como respaldo del emisor que no
-- cargue la tabla nueva. Borrarla dejaría sin actividad a todos los
-- emisores ya configurados, y un comprobante sin
-- `CodigoActividadEmisor` no se puede emitir.
--
-- Los emisores que ya existen nacen con su actividad actual como la
-- predeterminada de la tabla nueva: así el comportamiento no cambia
-- hasta que alguien configure la segunda.
-- ---------------------------------------------------------------------
INSERT INTO fact_emisor_actividades (tenant_id, emisor_id, codigo, descripcion, es_predeterminada)
SELECT e.tenant_id, e.id, e.codigo_actividad_economica,
       'Actividad que ya tenía configurada el emisor', true
  FROM fact_emisores e
 WHERE e.codigo_actividad_economica IS NOT NULL
   AND length(e.codigo_actividad_economica) = 6
   AND NOT EXISTS (
     SELECT 1 FROM fact_emisor_actividades a WHERE a.emisor_id = e.id
   );

COMMENT ON COLUMN fact_emisores.codigo_actividad_economica IS
  'La actividad por omisión. Las inscritas están en fact_emisor_actividades y la regla por línea de negocio en fact_actividad_por_linea (prompt 09b, B1).';

-- El comprobante guarda con qué actividad salió. Hoy se deducía del
-- emisor, así que un cambio de configuración reescribía la historia de
-- lo ya emitido.
ALTER TABLE fact_comprobantes
  ADD COLUMN IF NOT EXISTS codigo_actividad VARCHAR(6);

COMMENT ON COLUMN fact_comprobantes.codigo_actividad IS
  'Con qué actividad económica salió ESTE comprobante. Guardado y no deducido: cambiar la configuración no puede reescribir lo ya emitido.';
