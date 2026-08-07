-- Anotar vs consultar, Paso 2 (precisión 1) — marca explícita en vez de
-- corte por fecha. Deducir "información pendiente de incorporar" por
-- creado_en > última respuesta tiene una ventana de carrera real: si se
-- agrega información mientras una llamada anterior todavía está generando
-- (varios segundos), su creado_en queda antes que el de la respuesta que
-- la sucede, aunque el modelo nunca la haya visto — y se perdería para
-- siempre. `incorporada` se pone explícitamente, solo sobre las filas que
-- efectivamente entraron en una llamada, solo después de que esa llamada
-- respondió con éxito (ver workspace.routes.ts) — así es inmune al orden
-- de escritura y una llamada que falla no pierde la información.
--
-- Solo tiene sentido para tipo='informacion'; en 'consulta'/'respuesta'
-- queda en su default sin usarse.

BEGIN;

ALTER TABLE mensajes ADD COLUMN incorporada boolean NOT NULL DEFAULT false;

COMMIT;
