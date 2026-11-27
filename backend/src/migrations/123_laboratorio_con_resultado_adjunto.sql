-- ---------------------------------------------------------------------
-- 123 — REGISTRAR UN LABORATORIO YA REALIZADO (anexo 07-03, A6)
--
-- Lo que falta no es el modelo del estudio: `exp_estudios_lab` ya decide
-- bien que «una orden es un estudio que todavía no tiene resultado», que
-- es justo lo que el A6 pide conservar. Lo que falta es poder ADJUNTAR
-- el resultado, y hoy ningún archivo puede colgar de un paciente.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. VARIOS ARCHIVOS POR ESTUDIO, EN UN SOLO LUGAR
--
-- `exp_estudios_lab.archivo_id` guardaba UN archivo. El A6 pide «uno o
-- varios (PDF o foto tomada con el celular)»: un laboratorio manda el
-- informe y la tirilla, y una foto del papel sale en dos tomas.
--
-- Se invierte la relación: el archivo apunta al estudio, como ya apunta
-- al caso y al paciente. Y la columna vieja SE VA, después de mover lo
-- que tenga. Dejarla sería tener el primer archivo en dos lugares y
-- descubrir dentro de un año que no coinciden.
-- ---------------------------------------------------------------------
ALTER TABLE archivos
  ADD COLUMN IF NOT EXISTS estudio_lab_id UUID
    REFERENCES exp_estudios_lab(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_archivos_estudio_lab
  ON archivos(estudio_lab_id) WHERE estudio_lab_id IS NOT NULL;

-- Lo que ya estaba colgado de `archivo_id` pasa a la relación nueva, y
-- de paso queda atado al paciente del estudio (hasta hoy un archivo de
-- laboratorio no tenía `paciente_id`).
UPDATE archivos a
   SET estudio_lab_id = e.id,
       paciente_id    = COALESCE(a.paciente_id, e.paciente_id)
  FROM exp_estudios_lab e
 WHERE e.archivo_id = a.id
   AND a.estudio_lab_id IS NULL;

ALTER TABLE exp_estudios_lab DROP COLUMN IF EXISTS archivo_id;

COMMENT ON COLUMN archivos.estudio_lab_id IS
  'El estudio de laboratorio al que pertenece este archivo. Reemplaza a exp_estudios_lab.archivo_id, que guardaba uno solo (migración 123).';

-- ---------------------------------------------------------------------
-- 2. CUÁNDO SE TOMÓ LA MUESTRA
--
-- `fecha_solicitud` es cuándo se pidió y `fecha_resultado` cuándo llegó.
-- Ninguna de las dos es cuándo se tomó la muestra, que es la que el
-- médico lee para interpretar el valor: un hemograma de hace tres
-- semanas cargado hoy no dice lo mismo que uno de ayer.
--
-- Nullable: los estudios que ya están cargados no tienen el dato y no se
-- puede inventar. Para un laboratorio que se registra con su resultado,
-- la pantalla la pide.
-- ---------------------------------------------------------------------
ALTER TABLE exp_estudios_lab ADD COLUMN IF NOT EXISTS fecha_muestra DATE;

COMMENT ON COLUMN exp_estudios_lab.fecha_muestra IS
  'Cuándo se tomó la muestra. Distinta de fecha_solicitud (cuándo se pidió) y de fecha_resultado (cuándo llegó): es la que se usa para interpretar el valor (anexo 07-03, A6).';

-- ---------------------------------------------------------------------
-- 3. EL CONTADOR DE EXPEDIENTES, PUESTO AL DÍA
--
-- Defecto encontrado al construir el alta del A5: una clínica puede
-- tener `tenants.paciente_expediente_ultimo_numero` POR DETRÁS del
-- mayor `numero_expediente` que ya existe —pasa cuando los pacientes
-- entraron por sembrado, importación o reconstrucción, sin pasar por
-- `asignarNumeroExpedientePaciente`—. Cuando eso ocurre, el alta falla
-- con una violación de unicidad y un 500 que al usuario no le dice nada.
--
-- `asignarNumeroExpedientePaciente` ya se pone al día sola desde el A5,
-- así que esto no es lo que arregla el defecto: es la corrección del
-- dato que quedó mal, para que el contador diga la verdad desde el
-- momento del despliegue y no recién en el próximo alta.
--
-- Idempotente y sin efecto donde el contador ya está bien: el GREATEST
-- no baja nada nunca.
-- ---------------------------------------------------------------------
UPDATE tenants t
   SET paciente_expediente_ultimo_numero = GREATEST(
         t.paciente_expediente_ultimo_numero,
         COALESCE((SELECT max(p.numero_expediente) FROM pacientes p
                    WHERE p.tenant_id = t.id), 0)
       )
 WHERE t.paciente_expediente_ultimo_numero <
       COALESCE((SELECT max(p.numero_expediente) FROM pacientes p
                  WHERE p.tenant_id = t.id), 0);
