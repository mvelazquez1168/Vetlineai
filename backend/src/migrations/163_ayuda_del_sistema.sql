-- ---------------------------------------------------------------------
-- 163 — LA AYUDA DEL SISTEMA (prompt 16a)
--
-- El agente que responde «¿cómo registro una vacuna?» lee el manual de
-- usuario que ya se escribe en `docs/ayuda/` desde el 07c.
--
-- EL MANUAL ES DEL PRODUCTO, NO DE CADA CLÍNICA: estas páginas no
-- llevan `tenant_id` y no tienen RLS, igual que `documentos_conocimiento`
-- o los catálogos de Hacienda. «Cómo se anula un tiquete» es lo mismo
-- en Medicavet que en cualquier otra clínica.
--
-- SE GUARDAN EN LA BASE y no se leen del disco en cada pregunta por dos
-- motivos: la búsqueda tolerante (unaccent + trigramas, migración 090)
-- ya está en la base, y el servidor de producción no necesita tener los
-- archivos —solo el despliegue, cuando corre el cargador—.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ayuda_paginas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* El archivo de `docs/ayuda/`, para poder recargarlo. */
  archivo   VARCHAR(120) NOT NULL,
  /* El título de la página: «Descuentos: topes y motivos». */
  titulo    VARCHAR(200) NOT NULL,
  /* La sección dentro de la página: «Paso a paso», «Qué pasa después».
     NULL = la página entera (el encabezado). */
  seccion   VARCHAR(200),
  contenido TEXT NOT NULL,
  /* A qué pantalla lleva, cuando la página lo declara. */
  ruta      VARCHAR(200),
  /* Los permisos que esa acción necesita, para poder decirle a quien
     pregunta que su rol no la hace y quién sí. */
  permisos  VARCHAR(40)[] NOT NULL DEFAULT '{}',
  /* El orden dentro de la página, para citar en el orden en que se lee. */
  orden     SMALLINT NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ayuda_paginas
  ON ayuda_paginas (archivo, COALESCE(seccion, ''));

-- LA BÚSQUEDA ES LA DE SIEMPRE: `inmutable_unaccent` + trigramas, la de
-- la migración 090. Una búsqueda propia para la ayuda sería un segundo
-- criterio de «parecido» en el mismo sistema.
CREATE INDEX IF NOT EXISTS idx_ayuda_paginas_busqueda
  ON ayuda_paginas USING gin (inmutable_unaccent(titulo || ' ' || COALESCE(seccion, '') || ' ' || contenido) gin_trgm_ops);

COMMENT ON TABLE ayuda_paginas IS
  'El manual de usuario de docs/ayuda/, cargado por scripts/cargar_ayuda.ts. Es del producto y no de cada clínica: sin tenant_id y sin RLS.';

-- ---------------------------------------------------------------------
-- LO QUE SE PREGUNTA, Y LO QUE NO SE PUDO RESPONDER.
--
-- Esto SÍ es de cada clínica: las preguntas de su gente. Y es la parte
-- más útil de todo el prompt a mediano plazo — lo que el agente no supo
-- contestar es la lista de lo que falta documentar o construir.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ayuda_consultas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  pregunta  TEXT NOT NULL,
  /* Desde qué pantalla se preguntó: la misma pregunta significa cosas
     distintas en la ficha de un paciente y en la caja. */
  ruta_actual VARCHAR(200),
  /* Qué páginas se usaron para responder. Es la auditoría que el prompt
     pide: qué herramientas se llamaron y con qué. */
  paginas_usadas VARCHAR(120)[] NOT NULL DEFAULT '{}',
  respondio BOOLEAN NOT NULL,
  /* Por qué no, cuando no: «no está en el manual», «su rol no lo hace». */
  motivo    VARCHAR(60),
  respuesta TEXT,
  modelo    VARCHAR(80),
  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_salida INTEGER NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ayuda_consultas_sin_respuesta
  ON ayuda_consultas (tenant_id, creado_en DESC) WHERE NOT respondio;

ALTER TABLE ayuda_consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ayuda_consultas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ayuda_consultas_tenant ON ayuda_consultas;
CREATE POLICY ayuda_consultas_tenant ON ayuda_consultas
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
