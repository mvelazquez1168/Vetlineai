-- ---------------------------------------------------------------------
-- 107 — Una atención no se cierra dejando los cargos afuera
--
-- DEFECTO REAL, encontrado cerrando la atención desde el navegador: el
-- bloque A había dejado su propia ruta `POST /atenciones/:id/cerrar`,
-- que solo firmaba. Al llegar el bloque B quedaron DOS rutas con la
-- misma URL, y Express atiende la primera: la pantalla nueva firmaba la
-- atención y los tres ítems cargados se quedaban sin cargo. La atención
-- terminó cerrada, con `cuenta_id` en NULL, y la plata de esa consulta
-- no existía en ninguna parte.
--
-- La ruta duplicada ya no está. Pero el arreglo de verdad es que la BASE
-- no lo deje pasar: cualquier camino que cierre una atención dejando
-- ítems cobrables sin cargo falla, venga del código que venga. Es la
-- misma idea que las tres reglas de dinero del prompt 08 —el stock y el
-- dinero no dependen de que quien llama se acuerde—.
--
-- No aplica a los ítems que el cliente compra afuera (`dispensado_aqui`
-- en false): esos nunca se cobran acá, y por eso no tienen cargo.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION exp_cierre_no_deja_cargos_afuera() RETURNS TRIGGER AS $$
DECLARE
  v_pendientes INTEGER;
BEGIN
  IF NEW.estado = 'cerrada' AND OLD.estado <> 'cerrada' THEN
    SELECT count(*) INTO v_pendientes
      FROM exp_atencion_items i
     WHERE i.atencion_id = NEW.id
       AND i.dispensado_aqui
       AND i.cargo_id IS NULL;
    IF v_pendientes > 0 THEN
      RAISE EXCEPTION
        'No se puede cerrar la atención: % ítem(s) cobrables no tienen cargo. Cerrala por el cierre completo, que manda los cargos a la caja.',
        v_pendientes;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cierre_no_deja_cargos_afuera ON atenciones;
CREATE TRIGGER trg_cierre_no_deja_cargos_afuera
  BEFORE UPDATE ON atenciones
  FOR EACH ROW EXECUTE FUNCTION exp_cierre_no_deja_cargos_afuera();

COMMENT ON FUNCTION exp_cierre_no_deja_cargos_afuera() IS
  'Impide cerrar una atención con ítems cobrables sin cargo. Nació de una ruta duplicada que firmaba sin cobrar; el candado vale para cualquier camino futuro.';
