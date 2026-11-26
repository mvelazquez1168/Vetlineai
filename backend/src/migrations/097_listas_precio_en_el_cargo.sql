-- ---------------------------------------------------------------------
-- 097 — La lista de precio queda registrada en el cargo
--
-- Las listas de precio (nocturno, fin de semana, urgencia, convenio) se
-- modelaron en la 095 y nadie las leía: el cargo tomaba siempre el
-- precio base. Ahora `agregarCargo` resuelve el precio por
-- `inventario/precios.ts`, y esta columna guarda CUÁL lista lo
-- determinó.
--
-- POR QUÉ HACE FALTA LA COLUMNA Y NO ALCANZA CON EL PRECIO: el precio
-- ya queda congelado en `precio_unitario`, así que la factura es
-- reconstruible sin esto. Lo que no es reconstruible sin esto es la
-- PREGUNTA que la clínica se hace al revisar el mes: "¿este cargo salió
-- caro porque era urgencia o porque alguien lo digitó mal?". Sin la
-- columna, las dos cosas se ven idénticas.
--
-- ON DELETE SET NULL y DEFERRABLE, igual que las otras referencias de
-- `vta_cargos`: borrar una lista vieja no puede trabar la purga de una
-- clínica (lección de la migración 092) ni borrar el cargo.
-- ---------------------------------------------------------------------

ALTER TABLE vta_cargos
  ADD COLUMN IF NOT EXISTS lista_precio_id UUID
    REFERENCES inv_listas_precio(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN vta_cargos.lista_precio_id IS
  'La lista de precio que determinó precio_unitario. NULL = precio base del catálogo.';

-- La lista que la caja ofrece por defecto. NULL = precio base, que es
-- lo que vale para la clínica que no usa listas: el parámetro no puede
-- obligar a configurar algo que no se usa.
ALTER TABLE vta_parametros
  ADD COLUMN IF NOT EXISTS lista_precio_id UUID
    REFERENCES inv_listas_precio(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN vta_parametros.lista_precio_id IS
  'Lista de precio preseleccionada en la caja. NULL = precio base.';
