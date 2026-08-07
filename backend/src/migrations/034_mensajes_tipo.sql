-- Anotar vs consultar, Paso 2 — separa el registro de información clínica de
-- la consulta al agente sobre la misma tabla `mensajes`, sin tabla nueva:
-- `remitente` sigue diciendo quién escribió (medico/ai), `tipo` dice para
-- qué. 'informacion' es el bloque agregado sin invocar al modelo;
-- 'consulta' y 'respuesta' arman el hilo de diálogo como hasta ahora
-- (equivalentes a lo que hoy son remitente='medico'/'ai').
--
-- El DEFAULT 'consulta' clasifica correctamente, sin tocarlas, todas las
-- filas existentes con remitente='medico' (eran consultas, es lo único que
-- podían ser antes de este cambio). Las de remitente='ai' quedan mal
-- clasificadas por ese mismo default y se corrigen con el UPDATE de abajo.

BEGIN;

ALTER TABLE mensajes ADD COLUMN tipo varchar(20) NOT NULL DEFAULT 'consulta'
    CHECK (tipo IN ('consulta','informacion','respuesta'));

UPDATE mensajes SET tipo = 'respuesta' WHERE remitente = 'ai';

COMMIT;
