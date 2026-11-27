-- ---------------------------------------------------------------------
-- 140 — LAS POLÍTICAS DE LA CLÍNICA, EN UN SOLO LUGAR (prompt 04, §4)
--
-- Hoy las políticas están repartidas en cuatro lugares que nacieron en
-- cuatro prompts distintos: `crm_politicas` (el tope de mensajes y la
-- franja horaria, del 03), `vta_parametros` (el descuento máximo, el
-- umbral de arqueo y la vigencia de presupuestos, del 08 y el 08b),
-- `vta_topes_descuento` (por rol, del 08b) y columnas de producto.
--
-- El resultado: nadie sabe dónde se configura algo, y el margen mínimo
-- y la política de anulación no existen en ninguna parte.
--
-- CÓMO SE MIGRA SIN ROMPER NADA. `politica(clave)` lee de acá y, si la
-- clave no tiene fila, **cae a la columna vieja** mientras exista. Así
-- el día del despliegue ningún módulo cambia de comportamiento, y la
-- columna vieja se borra cuando ya nadie la lea. La alternativa
-- —vaciar las cuatro tablas en la misma migración y reescribir sus
-- lectores— es cómo se rompe la caja en producción.
--
-- EL TOPE POR PRODUCTO SE QUEDA EN EL PRODUCTO, y vale el menor de los
-- dos: lo dice el prompt y ya era así desde el 08b.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS politicas (
  clave       VARCHAR(60) PRIMARY KEY,
  nombre      VARCHAR(120) NOT NULL,
  descripcion TEXT NOT NULL,
  /* 'numero', 'porcentaje', 'dias', 'booleano', 'texto'. Decide cómo se
     dibuja el campo y cómo se valida. */
  tipo        VARCHAR(20) NOT NULL,
  valor_por_omision TEXT NOT NULL,
  /* Para los números: el rango aceptable. Un tope de descuento del 400 %
     es un dedo que se resbaló, no una política. */
  minimo      NUMERIC,
  maximo      NUMERIC,
  modulo      VARCHAR(30) NOT NULL,
  /* De dónde venía antes, para poder leer el respaldo y para que el
     informe diga qué se movió. NULL = nace acá. */
  columna_anterior VARCHAR(80),
  orden       SMALLINT NOT NULL DEFAULT 100,
  CONSTRAINT politicas_tipo_check CHECK (
    tipo IN ('numero', 'porcentaje', 'dias', 'booleano', 'texto')
  )
);

INSERT INTO politicas
  (clave, nombre, descripcion, tipo, valor_por_omision, minimo, maximo, modulo,
   columna_anterior, orden)
SELECT * FROM (VALUES
  ('descuento.maximo_sin_autorizacion',
   'Descuento máximo sin autorización',
   'Hasta qué porcentaje puede descontar alguien sin que un administrador lo autorice. Cada rol puede tener su propio tope, y el del producto también cuenta: vale el menor de los tres.',
   'porcentaje', '10', 0, 100, 'caja', 'vta_parametros.descuento_maximo_pct', 10),

  ('margen.minimo',
   'Margen mínimo',
   'Debajo de este margen, el análisis avisa. No bloquea la venta: hay productos que se venden al costo a propósito.',
   'porcentaje', '20', 0, 100, 'analisis', NULL, 20),

  ('mensajes.tope_promociones_mes',
   'Tope de mensajes promocionales por cliente y mes',
   'Cuántos mensajes de promoción puede recibir un mismo cliente en un mes. Los avisos de salud y los comprobantes no cuentan.',
   'numero', '4', 0, 60, 'crm', 'crm_politicas.tope_promociones_mes', 30),

  ('stock.umbral_aviso',
   'Umbral de aviso de stock',
   'Cuántas unidades tienen que quedar para avisar, en los productos que no tienen un mínimo propio.',
   'numero', '5', 0, 10000, 'inventario', NULL, 40),

  ('presupuesto.vigencia_dias',
   'Vigencia de los presupuestos',
   'Cuántos días vale un presupuesto desde que se entrega. Pasado ese plazo, convertirlo pregunta con qué precio cobrar.',
   'dias', '15', 1, 365, 'caja', 'vta_parametros.presupuesto_vigencia_dias', 50),

  ('anulacion.requiere_aprobacion',
   'Las anulaciones requieren aprobación',
   'Si anular un cobro o un comprobante necesita que lo apruebe alguien con permiso. Quien cobra nunca aprueba su propia anulación, y eso no se configura.',
   'booleano', 'true', NULL, NULL, 'caja', NULL, 60),

  ('anulacion.plazo_horas',
   'Plazo para anular',
   'Hasta cuántas horas después de un cobro se puede pedir su anulación. Pasado el plazo, hay que emitir una nota de crédito.',
   'numero', '72', 1, 8760, 'caja', NULL, 61),

  ('arqueo.umbral_diferencia',
   'Umbral de diferencia del arqueo',
   'Hasta qué diferencia total puede cerrar una caja sin que un administrador la apruebe.',
   'numero', '2000', 0, 10000000, 'caja', 'vta_parametros.umbral_diferencia_arqueo', 70),

  -- LA AUTONOMÍA DEL AGENTE NACE EN SU VALOR MÁS RESTRICTIVO, que es lo
  -- que el prompt pide explícitamente: se crea la política y nada más.
  -- El 16 la va a leer; hasta entonces, «solo sugiere» significa que
  -- ningún agente hace nada por su cuenta.
  ('agente.autonomia',
   'Qué puede hacer el agente por su cuenta',
   'Con «solo sugiere», el agente propone y una persona confirma todo. Es el valor con el que nace y el 16 lo va a usar.',
   'texto', 'solo_sugiere', NULL, NULL, 'agente', NULL, 80)
) AS v(clave, nombre, descripcion, tipo, valor_por_omision, minimo, maximo, modulo,
       columna_anterior, orden)
WHERE NOT EXISTS (SELECT 1 FROM politicas p WHERE p.clave = v.clave);

COMMENT ON TABLE politicas IS
  'El catálogo de políticas: qué se puede configurar, de qué tipo y con qué valor por omisión. De la plataforma; el valor de cada clínica está en tenant_politicas (prompt 04).';

-- ---------------------------------------------------------------------
-- EL VALOR DE CADA CLÍNICA.
--
-- `rol` opcional: las políticas que admiten un valor por rol —el
-- descuento máximo— tienen una fila por rol, y la fila con `rol` NULL es
-- la general. Las que no, solo la general.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_politicas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  clave     VARCHAR(60) NOT NULL REFERENCES politicas(clave) ON DELETE CASCADE,
  /* NULL = el valor general de la clínica. */
  rol       VARCHAR(30) REFERENCES roles(codigo) ON DELETE CASCADE,
  valor     TEXT NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_politicas_general
  ON tenant_politicas (tenant_id, clave) WHERE rol IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_politicas_rol
  ON tenant_politicas (tenant_id, clave, rol) WHERE rol IS NOT NULL;

ALTER TABLE tenant_politicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_politicas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_politicas_tenant ON tenant_politicas;
CREATE POLICY tenant_politicas_tenant ON tenant_politicas
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- EL HISTORIAL. Cada cambio: valor anterior, valor nuevo, quién y
-- cuándo. Lo pide el prompt y es lo que permite contestar «¿desde cuándo
-- el descuento máximo es del 20 %?» seis meses después.
--
-- APPEND-ONLY, con el guardia que ya usa el resto del sistema
-- (`fact_es_operacion_directa`): se puede borrar en cascada con la
-- clínica, y no se puede reescribir a mano. Es la lección de la
-- migración 129.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS politicas_historial (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  clave     VARCHAR(60) NOT NULL,
  rol       VARCHAR(30),
  valor_anterior TEXT,
  valor_nuevo    TEXT NOT NULL,
  cambiado_por   UUID REFERENCES personas(id) ON DELETE SET NULL
                   DEFERRABLE INITIALLY DEFERRED,
  cambiado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_politicas_historial
  ON politicas_historial (tenant_id, clave, cambiado_en DESC);

ALTER TABLE politicas_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE politicas_historial FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politicas_historial_tenant ON politicas_historial;
CREATE POLICY politicas_historial_tenant ON politicas_historial
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE OR REPLACE FUNCTION politicas_historial_solo_insert() RETURNS TRIGGER AS $$
BEGIN
  IF NOT fact_es_operacion_directa() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'El historial de políticas es solo de inserción: un cambio registrado no se reescribe.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_politicas_historial_append_only ON politicas_historial;
CREATE TRIGGER trg_politicas_historial_append_only
  BEFORE UPDATE OR DELETE ON politicas_historial
  FOR EACH ROW EXECUTE FUNCTION politicas_historial_solo_insert();

COMMENT ON TABLE politicas_historial IS
  'Cada cambio de política: valor anterior, nuevo, quién y cuándo. Append-only (prompt 04).';

-- ---------------------------------------------------------------------
-- LA MIGRACIÓN DE LO QUE YA ESTABA CONFIGURADO.
--
-- Cada clínica que ya tenía un valor distinto del por omisión lo
-- conserva. Las que estaban en el valor por omisión no se siembran: una
-- fila que dice lo mismo que el catálogo es ruido, y `politica(clave)`
-- ya cae al por omisión.
-- ---------------------------------------------------------------------
INSERT INTO tenant_politicas (tenant_id, clave, valor)
SELECT p.tenant_id, 'descuento.maximo_sin_autorizacion', p.descuento_maximo_pct::text
  FROM vta_parametros p
 WHERE p.descuento_maximo_pct IS NOT NULL
   AND p.descuento_maximo_pct::text <> '10'
   AND NOT EXISTS (
     SELECT 1 FROM tenant_politicas t
      WHERE t.tenant_id = p.tenant_id
        AND t.clave = 'descuento.maximo_sin_autorizacion' AND t.rol IS NULL
   );

INSERT INTO tenant_politicas (tenant_id, clave, valor)
SELECT p.tenant_id, 'arqueo.umbral_diferencia', p.umbral_diferencia_arqueo::text
  FROM vta_parametros p
 WHERE p.umbral_diferencia_arqueo IS NOT NULL
   AND p.umbral_diferencia_arqueo::text <> '2000'
   AND NOT EXISTS (
     SELECT 1 FROM tenant_politicas t
      WHERE t.tenant_id = p.tenant_id AND t.clave = 'arqueo.umbral_diferencia' AND t.rol IS NULL
   );

INSERT INTO tenant_politicas (tenant_id, clave, valor)
SELECT p.tenant_id, 'presupuesto.vigencia_dias', p.presupuesto_vigencia_dias::text
  FROM vta_parametros p
 WHERE p.presupuesto_vigencia_dias IS NOT NULL
   AND p.presupuesto_vigencia_dias::text <> '15'
   AND NOT EXISTS (
     SELECT 1 FROM tenant_politicas t
      WHERE t.tenant_id = p.tenant_id AND t.clave = 'presupuesto.vigencia_dias' AND t.rol IS NULL
   );

INSERT INTO tenant_politicas (tenant_id, clave, valor)
SELECT c.tenant_id, 'mensajes.tope_promociones_mes', c.tope_promociones_mes::text
  FROM crm_politicas c
 WHERE c.tope_promociones_mes IS NOT NULL
   AND c.tope_promociones_mes::text <> '4'
   AND NOT EXISTS (
     SELECT 1 FROM tenant_politicas t
      WHERE t.tenant_id = c.tenant_id
        AND t.clave = 'mensajes.tope_promociones_mes' AND t.rol IS NULL
   );

-- Los topes por rol del 08b pasan a ser la misma política con `rol`.
INSERT INTO tenant_politicas (tenant_id, clave, rol, valor)
SELECT t.tenant_id, 'descuento.maximo_sin_autorizacion', t.rol, t.tope_pct::text
  FROM vta_topes_descuento t
 WHERE t.tope_pct IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM tenant_politicas tp
      WHERE tp.tenant_id = t.tenant_id
        AND tp.clave = 'descuento.maximo_sin_autorizacion' AND tp.rol = t.rol
   );
