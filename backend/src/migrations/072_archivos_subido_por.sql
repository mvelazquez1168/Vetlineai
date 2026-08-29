-- Quién subió cada adjunto. Hasta acá no se guardaba: la tabla `archivos`
-- solo sabía a qué caso pertenece, no quién lo puso ahí.
--
-- Hace falta para la regla de borrado: un adjunto lo puede eliminar solo
-- quien lo subió. Hoy eso coincide con el médico del caso —POST /archivos
-- exige `casos.medico_id = <quien sube>`, así que no hay otro autor
-- posible— pero deja de coincidir en cuanto un caso se reasigna a otro
-- médico, y ahí la regla escrita como "el médico del caso" pasaría a
-- autorizar a alguien que nunca tocó ese archivo.
ALTER TABLE archivos ADD COLUMN IF NOT EXISTS subido_por_persona_id UUID REFERENCES personas(id);

-- Relleno de las filas existentes, en dos pasos y de la fuente más
-- confiable a la menos confiable:
--
-- 1. El autor del mensaje al que está colgado el archivo. Es el dato real:
--    lo escribió esa persona en ese momento, y sobrevive a una
--    reasignación posterior del caso.
UPDATE archivos a
   SET subido_por_persona_id = m.autor_persona_id
  FROM mensajes m
 WHERE m.id = a.mensaje_id
   AND a.subido_por_persona_id IS NULL
   AND m.autor_persona_id IS NOT NULL;

-- 2. El médico del caso, para los archivos sueltos (mensaje_id NULL) o
--    colgados de mensajes anteriores a autor_persona_id (migración 066).
--    Es una inferencia, no un dato: era el único que podía subirlos SI el
--    caso nunca se reasignó. Se acepta a propósito — la alternativa es
--    dejarlas en NULL y que nadie pueda borrar esos adjuntos.
UPDATE archivos a
   SET subido_por_persona_id = c.medico_id
  FROM casos c
 WHERE c.id = a.caso_id
   AND a.subido_por_persona_id IS NULL;

-- Se deja NULLABLE: una fila con autor desconocido tiene que poder
-- existir (y el backend la trata como "solo el médico del caso puede
-- borrarla"), en vez de hacer fallar la migración o inventar un autor.
CREATE INDEX IF NOT EXISTS idx_archivos_subido_por ON archivos(subido_por_persona_id);
