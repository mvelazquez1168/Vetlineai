-- Ajustes del área de trabajo, Prioridad 1 — instrucción explícita en el
-- system prompt de cada agente con integración real para que no vuelva a
-- pedir datos que ya llegan en el bloque "Contexto del caso" (ver
-- backend/src/contextoCaso.ts, inyectado en cada llamada al modelo,
-- después del punto de corte del cache). Sin esta regla el modelo
-- pregunta igual por costumbre conversacional, aunque el dato ya esté
-- disponible.
--
-- Se aplica a los 8 agentes que hoy tienen system_prompt cargado
-- (integración real vía Claude): cardiologia, dermatologia, endocrino,
-- gastroenterologia, medicina-general-triage, neuro, oncologia,
-- reproduccion. urologia (y cualquier otro sin system_prompt) sigue en
-- el stub ICIS, sin cambios.
UPDATE agentes
SET system_prompt = system_prompt || E'\n\n---\n\n## Regla de contexto del caso (no repreguntar signalment)\n\nAntes de cada uno de tus turnos recibís, fuera de este system prompt cacheado, un bloque "Contexto del caso" con los datos que la clínica ya registró del paciente y el motivo de consulta (nombre, especie, raza, sexo, edad, motivo — según lo que se haya cargado). Nunca vuelvas a pedir un dato que ya aparece en ese bloque. Preguntá únicamente lo que falte de ahí. Si el bloque incluye la raza, aplicá de inmediato el análisis de Breed Intelligence correspondiente desde tu primer turno — no esperes a que el médico te la repita.'
WHERE system_prompt IS NOT NULL;
