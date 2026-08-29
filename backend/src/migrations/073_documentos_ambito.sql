-- Ámbito de cada documento de conocimiento: en qué parte del pedido entra.
--
--   'clinico'    → bloque A. Lo leen los cuatro caminos (chat, dashboard,
--                  informe, receta). Es evidencia y razonamiento clínico.
--   'generacion' → bloque B. Solo lo mandan dashboard, informe y receta.
--                  Es cómo se arma la salida: qué tarjetas produce cada
--                  componente, qué campos, qué KPIs. Un turno de chat no
--                  lo usa nunca.
--
-- Por qué dos bloques y no dos conjuntos de documentos: el caché es un
-- match de prefijo y el orden de render es tools → system → messages. Si
-- el chat mandara menos documentos DENTRO del mismo bloque, su prefijo
-- dejaría de coincidir con el de los otros tres y volveríamos a pagar dos
-- escrituras (ver herramientasAgente.ts). Con dos bloques encadenados, el
-- prefijo del chat (tools + A) es un prefijo exacto del de generación
-- (tools + A + B): A se comparte entre los cuatro y B es una extensión
-- que solo escriben y leen los tres de generación.
--
-- DEFAULT 'clinico' a propósito: mientras nadie marque un documento, todo
-- sigue entrando donde entraba y no cambia ningún prefijo.
ALTER TABLE documentos_conocimiento
  ADD COLUMN IF NOT EXISTS ambito VARCHAR(20) NOT NULL DEFAULT 'clinico';

ALTER TABLE documentos_conocimiento
  DROP CONSTRAINT IF EXISTS documentos_conocimiento_ambito_check;

ALTER TABLE documentos_conocimiento
  ADD CONSTRAINT documentos_conocimiento_ambito_check
  CHECK (ambito IN ('clinico', 'generacion'));

-- El orden dentro de cada bloque tiene que ser estable por la misma razón
-- que el desempate por id de la consulta (ver casos.routes.ts): un orden
-- distinto es un prefijo distinto, o sea una reescritura de caché entera.
CREATE INDEX IF NOT EXISTS idx_documentos_ambito
  ON documentos_conocimiento(ambito, fecha_carga DESC, id);
