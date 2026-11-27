-- ---------------------------------------------------------------------
-- 169 — LOS ERRORES DE LA INTERFAZ QUEDAN REGISTRADOS
--
-- El 2026-11-27 la ficha del paciente quedó en blanco: un hook detrás de
-- un `return` condicional en `AtencionActual.tsx` y React abortó el
-- árbol entero. Nos enteramos porque el usuario lo vio y lo contó con el
-- mensaje de la consola. Si no hubiera abierto la consola, el síntoma
-- habría sido «la pantalla no carga», sin una pista.
--
-- Ahora cada pantalla y cada pestaña del expediente van dentro de un
-- límite de error que muestra un mensaje con «Reintentar» en vez de la
-- página blanca, y manda acá lo que pasó.
--
-- ES SOLO ESCRITURA Y SOLO DEL DÍA A DÍA, a propósito:
--   * nadie la edita ni la borra desde la app (el trigger lo impide);
--   * no guarda el cuerpo de la pantalla ni datos del paciente: la
--     pantalla, el mensaje, la pila y el navegador. Un registro de
--     errores que copia datos clínicos es una filtración esperando.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS errores_cliente (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id     UUID REFERENCES personas(id) ON DELETE SET NULL,
  -- Dónde pasó: la ruta y, si fue una pestaña del expediente, cuál.
  pantalla       TEXT NOT NULL,
  ambito         TEXT,
  mensaje        TEXT NOT NULL,
  pila           TEXT,
  -- La pila de componentes de React, que dice qué componente explotó.
  pila_react     TEXT,
  agente_usuario TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS errores_cliente_tenant_fecha_idx
  ON errores_cliente (tenant_id, creado_en DESC);

-- NO SE REESCRIBE. Molde de `crm_interacciones` (108_base_crm.sql), con
-- una diferencia deliberada: el trigger bloquea UPDATE y NO bloquea
-- DELETE.
--
-- POR QUÉ: el `ON DELETE CASCADE` del tenant tiene que poder correr. Un
-- trigger que prohíbe borrar deja la purga de una clínica trabada, que
-- es exactamente el defecto D-006 (42 claves foráneas frenando el
-- borrado, migración 092) y es peor que el problema que resolvería: la
-- purga es una obligación legal y esto es un registro de fallas de
-- pantalla, no un libro contable. Lo que no puede pasar es que alguien
-- EDITE lo que decía el error.
CREATE OR REPLACE FUNCTION errores_cliente_no_se_edita() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'errores_cliente no se edita: es lo que pasó, no una nota.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS errores_cliente_inmutable ON errores_cliente;
CREATE TRIGGER errores_cliente_inmutable
  BEFORE UPDATE ON errores_cliente
  FOR EACH ROW EXECUTE FUNCTION errores_cliente_no_se_edita();

ALTER TABLE errores_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE errores_cliente FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS errores_cliente_tenant ON errores_cliente;
CREATE POLICY errores_cliente_tenant ON errores_cliente
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
