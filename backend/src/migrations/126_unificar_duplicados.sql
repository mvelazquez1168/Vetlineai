-- ---------------------------------------------------------------------
-- 126 — UNIFICAR CLIENTES Y PACIENTES DUPLICADOS (anexo 07-03, B1)
--
-- El duplicado ya existe en la base de cualquier clínica que lleve unos
-- años: el mismo cliente registrado dos veces con el teléfono escrito
-- distinto, el mismo perro con el nombre mal tipeado. Hasta hoy no
-- había forma de juntarlos y la clínica terminaba con la historia
-- clínica partida en dos.
--
-- LA DECISIÓN DE FONDO: EL ABSORBIDO NO SE BORRA.
--
-- Se queda en su tabla, marcado, apuntando al que sobrevivió. Tres
-- razones, en orden de peso:
--
--   1. `crm_interacciones` y `crm_consentimiento_historial` tienen
--      triggers que PROHÍBEN UPDATE y DELETE (108_base_crm.sql). Son
--      append-only a propósito: el historial de consentimientos es la
--      prueba de que el cliente autorizó algo, y una prueba que se
--      puede reescribir no prueba nada. Si el absorbido se borrara,
--      esas filas quedarían apuntando a un id que no existe —o habría
--      que relajar los triggers, que es exactamente lo que no se hace.
--   2. Un comprobante electrónico ya emitido lleva el nombre y la
--      identificación del receptor congelados. Borrar al receptor no
--      cambia el comprobante, pero deja la factura sin cliente.
--   3. Una unificación equivocada se puede deshacer mirando la
--      auditoría. Un DELETE no.
--
-- Entonces las LECTURAS son las que tienen que excluir al absorbido, y
-- la línea de tiempo del sobreviviente es la que tiene que unir los dos
-- ids. Eso está en el código (`crm/unificar.ts`, `busquedaPropietarios.ts`).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- La marca, en las dos tablas.
--
-- `unificado_hacia_id` apunta al SOBREVIVIENTE. Es self-FK y puede
-- encadenarse: A absorbido por B, y después B absorbido por C. Las
-- lecturas resuelven la cadena; la base no la impide porque impedirla
-- obligaría a reescribir filas viejas.
-- ---------------------------------------------------------------------
ALTER TABLE propietarios
  ADD COLUMN IF NOT EXISTS unificado_hacia_id UUID
    REFERENCES propietarios(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS unificado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unificado_por UUID
    REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS unificado_hacia_id UUID
    REFERENCES pacientes(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS unificado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unificado_por UUID
    REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- NADIE SE ABSORBE A SÍ MISMO. Un ciclo de un solo nodo haría que las
-- lecturas, al resolver la cadena, no terminen nunca.
ALTER TABLE propietarios
  DROP CONSTRAINT IF EXISTS propietarios_unificado_no_a_si_mismo;
ALTER TABLE propietarios
  ADD CONSTRAINT propietarios_unificado_no_a_si_mismo
  CHECK (unificado_hacia_id IS NULL OR unificado_hacia_id <> id);

ALTER TABLE pacientes
  DROP CONSTRAINT IF EXISTS pacientes_unificado_no_a_si_mismo;
ALTER TABLE pacientes
  ADD CONSTRAINT pacientes_unificado_no_a_si_mismo
  CHECK (unificado_hacia_id IS NULL OR unificado_hacia_id <> id);

CREATE INDEX IF NOT EXISTS idx_propietarios_unificado_hacia
  ON propietarios(unificado_hacia_id) WHERE unificado_hacia_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pacientes_unificado_hacia
  ON pacientes(unificado_hacia_id) WHERE unificado_hacia_id IS NOT NULL;

COMMENT ON COLUMN propietarios.unificado_hacia_id IS
  'Este cliente fue absorbido por otro: la ficha viva es la del otro. No se borra porque el historial del CRM y los comprobantes emitidos lo referencian (anexo 07-03, B1).';
COMMENT ON COLUMN pacientes.unificado_hacia_id IS
  'Este paciente fue absorbido por otro: el expediente vivo es el del otro (anexo 07-03, B1).';

-- ---------------------------------------------------------------------
-- EL NÚMERO DE EXPEDIENTE VIEJO SIGUE SIENDO BUSCABLE.
--
-- La clínica tiene el número anotado en el carnet de vacunas del
-- paciente, en el papel del laboratorio y en la cabeza de la recepción.
-- Después de unificar, buscar «VET-0042» tiene que llevar al expediente
-- que sobrevivió.
--
-- Es un arreglo y no una columna con el número suelto: una fusión se
-- puede encadenar y el sobreviviente puede terminar respondiendo por
-- tres números. No se toca `numero_expediente`, que sigue siendo UNIQUE
-- por clínica (047) y sigue siendo el del absorbido en su propia fila.
-- ---------------------------------------------------------------------
ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS numero_expediente_alias TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_pacientes_expediente_alias
  ON pacientes USING gin (numero_expediente_alias);

COMMENT ON COLUMN pacientes.numero_expediente_alias IS
  'Números de expediente de los pacientes que éste absorbió, para que el número que la clínica tiene anotado siga encontrando al expediente vivo (anexo 07-03, B1).';

-- ---------------------------------------------------------------------
-- LA AUDITORÍA DE CADA FUSIÓN.
--
-- Qué se movió y cuánto, y qué valor se eligió campo por campo. Sin
-- esto, «¿por qué este cliente tiene el teléfono de la otra ficha?» no
-- tiene respuesta seis meses después.
--
-- `detalle` es jsonb y no columnas: lo que se mueve cambia cada vez que
-- el sistema gana una tabla, y una columna por tabla envejecería mal.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_unificaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
                   DEFERRABLE INITIALLY DEFERRED,
  /* 'cliente' o 'paciente'. */
  entidad        VARCHAR(20) NOT NULL,
  /* Los dos ids, SIN FK a propósito: la fila de auditoría tiene que
     sobrevivir a la purga de la clínica que la borre. */
  sobreviviente_id UUID NOT NULL,
  absorbido_id     UUID NOT NULL,
  /* Cómo se llamaban, para que la auditoría se lea sin consultar. */
  sobreviviente_nombre TEXT NOT NULL,
  absorbido_nombre     TEXT NOT NULL,
  /* { "movido": { "tabla": n }, "elegido": { "campo": "valor" },
       "conflictos": [ "..." ] } */
  detalle        JSONB NOT NULL DEFAULT '{}'::jsonb,
  hecho_por      UUID REFERENCES personas(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  hecho_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_unificaciones_entidad_check CHECK (entidad IN ('cliente', 'paciente')),
  CONSTRAINT crm_unificaciones_distintos CHECK (sobreviviente_id <> absorbido_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_unificaciones_tenant
  ON crm_unificaciones(tenant_id, hecho_en DESC);
CREATE INDEX IF NOT EXISTS idx_crm_unificaciones_absorbido
  ON crm_unificaciones(absorbido_id);

ALTER TABLE crm_unificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_unificaciones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_unificaciones_tenant ON crm_unificaciones;
CREATE POLICY crm_unificaciones_tenant ON crm_unificaciones
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- NO SE REESCRIBE NI SE BORRA, igual que el historial de
-- consentimientos: es el registro de una operación que movió plata e
-- historia clínica de una ficha a otra.
CREATE OR REPLACE FUNCTION crm_unificaciones_solo_insert() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'crm_unificaciones es solo de inserción: una unificación registrada no se reescribe.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_unificaciones_append_only ON crm_unificaciones;
CREATE TRIGGER trg_crm_unificaciones_append_only
  BEFORE UPDATE OR DELETE ON crm_unificaciones
  FOR EACH ROW EXECUTE FUNCTION crm_unificaciones_solo_insert();

COMMENT ON TABLE crm_unificaciones IS
  'Cada fusión de clientes o pacientes: qué se movió, qué valor se eligió y quién lo hizo. Append-only (anexo 07-03, B1).';

-- El evento en la línea de tiempo del cliente que sobrevivió.
INSERT INTO crm_tipos_evento (codigo, etiqueta, modulo, clinico, orden)
SELECT 'cliente_unificado', 'Fichas unificadas', 'clientes', false, 12
WHERE NOT EXISTS (SELECT 1 FROM crm_tipos_evento WHERE codigo = 'cliente_unificado');
