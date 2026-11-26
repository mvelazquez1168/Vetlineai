-- ---------------------------------------------------------------------
-- 117 - Una receta emitida sobrevive a su catalogo (prompt 07c)
--
-- DEFECTO REAL, encontrado por el verificador al limpiar su clinica de
-- prueba: borrar una presentacion del inventario dispara
-- `ON DELETE SET NULL` sobre `receta_items.presentacion_id`, y eso
-- violaba el CHECK "exactamente un origen" que la 115 habia agregado.
-- El borrado fallaba con una violacion de restriccion.
--
-- No es un problema del verificador. Pasa cada vez que una clinica
-- descontinua un producto, y pasaria en la PURGA de una clinica, que es
-- justo donde un error de restriccion deja todo a medias (la familia de
-- defectos D-006).
--
-- EL ARREGLO DE FONDO es reconocer qué es una receta: un DOCUMENTO
-- EMITIDO, no una vista del catalogo. Lo que el propietario tiene en la
-- mano dice "Amoxicilina 500 mg — Tableta", y eso tiene que seguir
-- diciendo dentro de dos años aunque la clinica ya no venda ese
-- producto. Entonces:
--
--   1. La linea guarda SU PROPIO NOMBRE, congelado al escribirla.
--   2. El origen pasa a ser "como maximo uno", no "exactamente uno":
--      perder la referencia al catalogo es normal con el tiempo y no
--      puede romper el documento.
--
-- Es la misma decision que ya esta tomada en `exp_atencion_items`
-- (`descripcion` congelada) y en los cargos de caja.
-- ---------------------------------------------------------------------

ALTER TABLE receta_items
  ADD COLUMN IF NOT EXISTS nombre_impreso VARCHAR(220);

-- Las lineas que ya existen toman el nombre que hoy resuelven por JOIN.
UPDATE receta_items ri
   SET nombre_impreso = COALESCE(
         ri.texto_libre,
         (SELECT m.nombre FROM medicamentos m WHERE m.id = ri.medicamento_id),
         (SELECT p.nombre || ' — ' || pr.nombre
            FROM inv_presentaciones pr JOIN inv_productos p ON p.id = pr.producto_id
           WHERE pr.id = ri.presentacion_id),
         'Medicamento sin nombre'
       )
 WHERE ri.nombre_impreso IS NULL;

ALTER TABLE receta_items ALTER COLUMN nombre_impreso SET NOT NULL;

COMMENT ON COLUMN receta_items.nombre_impreso IS
  'El nombre tal como se imprimio, congelado. La receta es un documento: no cambia porque el catalogo cambie, ni se rompe si el producto se borra (migracion 117).';

-- El origen pasa a ser "como maximo uno".
ALTER TABLE receta_items DROP CONSTRAINT IF EXISTS receta_item_tiene_un_origen;
ALTER TABLE receta_items ADD CONSTRAINT receta_item_tiene_un_origen
  CHECK (
    (CASE WHEN medicamento_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN presentacion_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN texto_libre IS NOT NULL THEN 1 ELSE 0 END) <= 1
  );

-- `medicamento_id` no tenia clausula de borrado: era NO ACTION, asi que
-- borrar un medicamento del catalogo quedaba bloqueado por cualquier
-- receta vieja que lo mencionara. Mismo criterio que la presentacion.
ALTER TABLE receta_items DROP CONSTRAINT IF EXISTS receta_items_medicamento_id_fkey;
ALTER TABLE receta_items
  ADD CONSTRAINT receta_items_medicamento_id_fkey
  FOREIGN KEY (medicamento_id) REFERENCES medicamentos(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
