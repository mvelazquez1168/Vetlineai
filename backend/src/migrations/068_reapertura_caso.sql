-- prompt_code_cierre_caso.md, Paso 3 — reapertura de un caso cerrado.
-- Lo capturado en 068_cierre_caso (diagnostico_final/tratamiento_activo/
-- desenlace/cerrado_por/cerrado_en) NO se toca al reabrir — se conserva
-- como historia del cierre anterior, tal como pide el prompt. Estas
-- columnas nuevas registran únicamente el evento de reapertura en sí.
ALTER TABLE casos
  ADD COLUMN motivo_reapertura TEXT,
  ADD COLUMN reabierto_por     UUID REFERENCES personas(id),
  ADD COLUMN reabierto_en      TIMESTAMPTZ;
