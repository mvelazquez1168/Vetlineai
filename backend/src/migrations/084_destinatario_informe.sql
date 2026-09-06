-- Paso 4 de prompt_code_sintesis_unica: el informe pregunta para quién es.
--
-- Dos destinatarios con caminos de generación DISTINTOS, no dos plantillas:
--
--   colega  composición pura desde la síntesis. CERO consumo de IA — el
--           lenguaje técnico ya está en la síntesis.
--   tutor   una llamada chica que REESCRIBE la síntesis en lenguaje
--           llano. Entrada chica, salida chica, sin volver a cargar la
--           base de conocimiento y sin volver a razonar.
--
-- 1) La preferencia, POR MÉDICO y en la base.
--
-- No en el navegador: en una computadora compartida por varios médicos de
-- la clínica —lo normal en un consultorio— localStorage le mostraría a
-- cada uno lo que eligió el anterior. La preferencia es de la persona, así
-- que vive con la persona.
--
-- Nullable a propósito: null = todavía no eligió nunca, y ahí la interfaz
-- no preselecciona nada en vez de inventar un default. La primera elección
-- la escribe el propio flujo de generación.
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS destinatario_informe_preferido text;

ALTER TABLE personas DROP CONSTRAINT IF EXISTS personas_destinatario_informe_check;
ALTER TABLE personas
  ADD CONSTRAINT personas_destinatario_informe_check
  CHECK (destinatario_informe_preferido IS NULL
         OR destinatario_informe_preferido IN ('colega', 'tutor'));

-- 2) Con qué destinatario se emitió cada informe.
--
-- El .docx guardado en informes_generados YA es distinto según para quién
-- se generó. Sin esta columna, dos documentos con contenido distinto
-- quedan indistinguibles en el historial, y el médico que descarga uno
-- viejo no sabe si le está dando al tutor una versión escrita para un
-- colega. Es dato del documento, no una duplicación de la preferencia.
--
-- Las filas anteriores quedan en NULL, que es la verdad: se generaron
-- cuando el informe no preguntaba y todas eran técnicas. No se rellenan
-- con 'colega' — inventar el pasado para que la columna se vea completa es
-- exactamente cómo una serie empieza a mentir.
ALTER TABLE informes_generados
  ADD COLUMN IF NOT EXISTS destinatario text;

ALTER TABLE informes_generados DROP CONSTRAINT IF EXISTS informes_generados_destinatario_check;
ALTER TABLE informes_generados
  ADD CONSTRAINT informes_generados_destinatario_check
  CHECK (destinatario IS NULL OR destinatario IN ('colega', 'tutor'));
