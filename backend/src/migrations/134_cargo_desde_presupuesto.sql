-- ---------------------------------------------------------------------
-- 134 — UN CARGO PUEDE VENIR DE UN PRESUPUESTO (prompt 08b, A1)
--
-- `vta_cargos.origen` tiene un CHECK cerrado con cuatro valores:
-- mostrador, manual, atención y encargo. La conversión de un
-- presupuesto crea cargos y necesita decir de dónde vienen.
--
-- Es la cuarta vez que un CHECK cerrado se queda corto al aparecer un
-- disparador nuevo (los tipos de `correos_enviados` en la 050, los
-- estados de suspensión, la fuente del consentimiento en la 127). La
-- alternativa —etiquetar la conversión como «manual»— haría que nadie
-- pueda contestar después «cuánto de lo que facturamos salió de un
-- presupuesto», que es justamente lo que la clínica va a querer saber
-- para decidir si los presupuestos sirven.
-- ---------------------------------------------------------------------
ALTER TABLE vta_cargos DROP CONSTRAINT IF EXISTS vta_cargos_origen_check;
ALTER TABLE vta_cargos
  ADD CONSTRAINT vta_cargos_origen_check
  CHECK (origen IN ('mostrador', 'manual', 'atencion', 'encargo', 'presupuesto'));

COMMENT ON COLUMN vta_cargos.origen IS
  'De dónde nació el cargo: el mostrador, un cargo manual, el cierre de una atención, un encargo o la conversión de un presupuesto.';
