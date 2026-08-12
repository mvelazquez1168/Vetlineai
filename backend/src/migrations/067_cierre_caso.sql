-- prompt_code_cierre_caso.md, Paso 2 — captura al cerrar un caso: diagnóstico
-- final, si queda tratamiento activo y cuál, desenlace, y quién/cuándo cerró.
-- casos.estado ya tenía 'completado' en su CHECK desde 001_init.sql pero
-- ningún código lo escribía nunca — este es el primer camino real hacia ahí.
ALTER TABLE casos
  ADD COLUMN diagnostico_final          TEXT,
  ADD COLUMN tratamiento_activo         BOOLEAN,
  ADD COLUMN tratamiento_activo_detalle TEXT,
  ADD COLUMN desenlace                  VARCHAR(20)
                                         CHECK (desenlace IN ('resuelto', 'derivado', 'en_control', 'fallecido')),
  ADD COLUMN cerrado_por                UUID REFERENCES personas(id),
  ADD COLUMN cerrado_en                 TIMESTAMPTZ;
