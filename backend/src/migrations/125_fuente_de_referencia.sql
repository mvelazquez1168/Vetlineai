-- ---------------------------------------------------------------------
-- 125 — CÓMO LLEGÓ EL CLIENTE A LA CLÍNICA (anexo 07-03, B3)
--
-- No existía nada: ni columna ni catálogo. Es el dato que después
-- contesta «de dónde viene mi clientela» y el que deja lista la base
-- para premiar referidos (7.1 de la guía), que NO se construye ahora.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- El catálogo, con el molde de `crm_palabras_baja`: `tenant_id` NULL es
-- de la plataforma y lo ve todo el mundo; la clínica agrega las suyas y
-- solo escribe las suyas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_fuentes_referencia (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* NULL = de la plataforma, para todas las clínicas. */
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  codigo    VARCHAR(40) NOT NULL,
  etiqueta  VARCHAR(80) NOT NULL,
  /* Cuando es true, el alta pide ADEMÁS qué cliente lo refirió. Es una
     propiedad de la fuente y no una comparación contra un código fijo:
     una clínica puede llamarla «me la recomendó una clienta». */
  pide_referidor BOOLEAN NOT NULL DEFAULT false,
  orden     SMALLINT NOT NULL DEFAULT 100,
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fuentes_referencia_plataforma
  ON crm_fuentes_referencia (codigo) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fuentes_referencia_tenant
  ON crm_fuentes_referencia (tenant_id, codigo) WHERE tenant_id IS NOT NULL;

ALTER TABLE crm_fuentes_referencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_fuentes_referencia FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_fuentes_referencia_tenant ON crm_fuentes_referencia;
CREATE POLICY crm_fuentes_referencia_tenant ON crm_fuentes_referencia
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE crm_fuentes_referencia IS
  'Cómo llegó el cliente a la clínica. Catálogo por clínica con semilla de plataforma (anexo 07-03, B3).';

INSERT INTO crm_fuentes_referencia (tenant_id, codigo, etiqueta, pide_referidor, orden)
SELECT * FROM (VALUES
  (NULL::uuid, 'redes_sociales',      'Redes sociales',            false, 10),
  (NULL::uuid, 'busqueda',            'Google o búsqueda',         false, 20),
  (NULL::uuid, 'referido_cliente',    'Referido por un cliente',   true,  30),
  (NULL::uuid, 'referido_veterinario','Referido por un veterinario', false, 40),
  (NULL::uuid, 'paso_por_el_local',   'Pasó por el local',         false, 50),
  (NULL::uuid, 'campana',             'Campaña',                   false, 60),
  (NULL::uuid, 'otro',                'Otro',                      false, 99)
) AS v(tenant_id, codigo, etiqueta, pide_referidor, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM crm_fuentes_referencia WHERE tenant_id IS NULL AND codigo = v.codigo
);

-- ---------------------------------------------------------------------
-- El dato en el cliente.
--
-- `referido_por_propietario_id` es una FK a la MISMA tabla: el que
-- refirió es otro cliente. Suma una FK más a la lista que la fusión de
-- B1 tiene que mover, y por eso queda anotada acá.
--
-- ON DELETE SET NULL en el referidor: si el que refirió se borra, el
-- referido no se va con él — perder un cliente por borrar a otro sería
-- bastante peor que perder el dato de quién lo trajo.
-- ---------------------------------------------------------------------
ALTER TABLE propietarios
  ADD COLUMN IF NOT EXISTS fuente_referencia_id UUID
    REFERENCES crm_fuentes_referencia(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS referido_por_propietario_id UUID
    REFERENCES propietarios(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_propietarios_referido_por
  ON propietarios(referido_por_propietario_id)
  WHERE referido_por_propietario_id IS NOT NULL;

COMMENT ON COLUMN propietarios.referido_por_propietario_id IS
  'Qué cliente lo trajo. Un enlace y no un texto, para que la fidelización pueda premiarlo (anexo 07-03, B3).';

-- El evento de la línea de tiempo.
INSERT INTO crm_tipos_evento (codigo, etiqueta, modulo, clinico, orden)
SELECT 'cliente_referido', 'Cliente referido', 'clientes', false, 11
WHERE NOT EXISTS (SELECT 1 FROM crm_tipos_evento WHERE codigo = 'cliente_referido');
