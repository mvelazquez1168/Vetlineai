-- ---------------------------------------------------------------------
-- 104 — Un archivo del expediente no cuelga de un caso
--
-- DEFECTO de la migración 101, encontrado al sembrar el paciente de
-- demostración: le agregué `paciente_id` a `archivos` para colgar
-- radiografías y documentos externos del expediente, pero `caso_id`
-- seguía siendo NOT NULL porque la tabla nació para los adjuntos de un
-- caso de Vetline Ai.
--
-- Resultado: no se podía guardar la radiografía que trae el cliente sin
-- inventarle un caso. Y un caso inventado aparecería en la pestaña de
-- casos, en los listados y en el consumo de IA.
--
-- Ahora `caso_id` admite NULL, y un CHECK impone lo que de verdad hace
-- falta: TODO archivo cuelga de algo —de un caso o de un paciente—.
-- Un archivo sin ninguno de los dos es un archivo que nadie va a volver
-- a encontrar.
-- ---------------------------------------------------------------------

ALTER TABLE archivos ALTER COLUMN caso_id DROP NOT NULL;

ALTER TABLE archivos DROP CONSTRAINT IF EXISTS archivos_cuelga_de_algo;
ALTER TABLE archivos
  ADD CONSTRAINT archivos_cuelga_de_algo
  CHECK (caso_id IS NOT NULL OR paciente_id IS NOT NULL);

COMMENT ON COLUMN archivos.caso_id IS
  'El caso de Vetline Ai al que pertenece, si pertenece a uno. NULL para un documento del expediente (una radiografía, la historia de otra clínica): ese cuelga de paciente_id.';
