-- ---------------------------------------------------------------------
-- 113 - La apariencia de la clinica (prompt 01c, seccion 2)
--
-- Una tabla y no columnas en `tenants`: lo que viene detras -el modo
-- oscuro, una tipografia por clinica, un favicon- es de la misma clase,
-- y `tenants` ya tiene cuarenta columnas de cosas que no se parecen
-- entre si.
--
-- SIN FILA, LA CLINICA RECIBE EL TEMA «MARCA DE LA CLINICA» CON EL
-- PRIMARIO POR DEFECTO. Eso lo resuelve la lectura, no un DEFAULT por
-- clinica: una fila por tenant creada de oficio seria una fila que hay
-- que mantener cuando el valor por defecto cambie.
--
-- EL LOGO NO ESTA ACA, Y ES A PROPOSITO. Ya vive en `tenants.logo_url`,
-- lo sube `POST /admin/clinica/logo` con el almacenamiento publico y lo
-- usan los correos al cliente y el informe en .docx. Una columna de logo
-- en esta tabla seria el mismo dato en dos lugares: el dia que alguien
-- cambie el logo por una de las dos puertas, la otra mostraria el viejo.
-- Lo unico que hizo falta fue aceptar WebP ademas de PNG y JPG.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clinica_apariencia (
  tenant_id       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE
                    DEFERRABLE INITIALLY DEFERRED,
  /* El color que la clinica eligio, tal como lo eligio. Lo que se
     muestra puede ser una version oscurecida para cumplir contraste;
     este campo guarda el original para poder decirle «ajustamos el tono»
     y mostrarle los dos. */
  primario        VARCHAR(7) NOT NULL DEFAULT '#0F766E'
                    CHECK (primario ~* '^#[0-9a-f]{6}$'),
  tema            VARCHAR(20) NOT NULL DEFAULT 'marca'
                    CHECK (tema IN ('marca', 'sereno', 'vibrante')),
  actualizado_por UUID REFERENCES personas(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clinica_apariencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinica_apariencia FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinica_apariencia_tenant ON clinica_apariencia;
CREATE POLICY clinica_apariencia_tenant ON clinica_apariencia
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON COLUMN clinica_apariencia.primario IS
  'El color que eligio la clinica, SIN ajustar. El que se muestra puede ser una version oscurecida para cumplir WCAG AA; el calculo vive en src/tema.ts y no se guarda, se deriva.';
