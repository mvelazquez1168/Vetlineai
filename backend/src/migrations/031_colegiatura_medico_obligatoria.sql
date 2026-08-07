-- Prompt agentes/países, Prompt A Paso 6 — la colegiatura es obligatoria
-- para todo médico (se usa para firmar los informes clínicos). Ya se
-- valida en todos los puntos de alta vigentes (registro.routes.ts,
-- invitacionesPublicas.routes.ts) pero no había respaldo a nivel de base
-- — así fue como el endpoint viejo de alta directa (ya eliminado, tenía
-- el campo marcado "opcional") dejó médicos sin colegiatura.
--
-- NOT VALID: exige la regla para cualquier INSERT/UPDATE nuevo desde ya,
-- sin fallar por las filas existentes que la violan (hay médicos reales
-- de antes de esta migración sin colegiatura — no se les puede inventar
-- un número de colegiatura real, hace falta pedírselo a cada clínica).
ALTER TABLE personas
  ADD CONSTRAINT colegiatura_medico_obligatoria
  CHECK (es_medico = false OR (colegiatura IS NOT NULL AND colegiatura <> ''))
  NOT VALID;
