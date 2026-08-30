-- Síntesis clínica: una sola por caso, dos vistas.
--
-- Hoy el dashboard y el informe son dos llamadas independientes sobre el
-- mismo caso. Se paga dos veces, y —más grave— son dos razonamientos que
-- pueden discrepar sobre el mismo paciente sin que nadie lo note hasta que
-- alguien compare la pantalla con el documento.
--
-- Tres columnas:
--
--   sintesis             el razonamiento estructurado del caso, del que
--                        salen tanto el dashboard como el informe.
--   sintesis_huella      hash del material que la produjo. Si el material
--                        cambió, la síntesis está vieja.
--   sintesis_generada_en cuándo.
--
-- POR QUÉ UNA HUELLA Y NO UNA CLASIFICACIÓN DE LA CAUSA. Sería posible
-- registrar QUÉ cambió —llegó un adjunto, se emitió una receta— y decidir
-- si eso amerita regenerar. No se hace a propósito: esa decisión es una
-- heurística sobre qué importa clínicamente, y equivocarse en ella
-- significa razonar sobre un caso desactualizado sin saberlo. Cualquier
-- cambio invalida la síntesis, sin excepciones y sin criterio.
--
-- dashboard_cache NO se borra en esta migración. La síntesis lo va a
-- reemplazar como fuente, pero mientras el código viejo siga leyéndolo,
-- borrarlo dejaría casos sin dashboard. Se retira en una migración
-- posterior, cuando las dos vistas ya lean de la síntesis.

ALTER TABLE casos
  ADD COLUMN IF NOT EXISTS sintesis             jsonb,
  ADD COLUMN IF NOT EXISTS sintesis_huella      text,
  ADD COLUMN IF NOT EXISTS sintesis_generada_en timestamptz;

-- Las tres van juntas o no van: una síntesis sin huella no se puede saber
-- si está vigente, y una huella sin síntesis no apunta a nada. El CHECK
-- lo hace imposible en vez de dejarlo a que el código se acuerde.
ALTER TABLE casos
  DROP CONSTRAINT IF EXISTS casos_sintesis_completa_check;
ALTER TABLE casos
  ADD CONSTRAINT casos_sintesis_completa_check
  CHECK (
    (sintesis IS NULL     AND sintesis_huella IS NULL     AND sintesis_generada_en IS NULL)
    OR
    (sintesis IS NOT NULL AND sintesis_huella IS NOT NULL AND sintesis_generada_en IS NOT NULL)
  );

COMMENT ON COLUMN casos.sintesis IS
  'Síntesis clínica del caso: fuente única del dashboard y del informe. Ninguna de las dos vistas vuelve a razonar sobre el caso.';
COMMENT ON COLUMN casos.sintesis_huella IS
  'sha256 del material que produjo la síntesis (caso, mensajes, archivos, recetas). Distinta de la huella actual = la síntesis está vieja. No clasifica qué cambió, a propósito.';
