-- ---------------------------------------------------------------------
-- 154 — EL RECORDATORIO DE SALDO EN LA LÍNEA DE TIEMPO (prompt 10a, §4)
--
-- Su propio tipo de evento y no `mensaje_enviado`: la línea de tiempo
-- tiene que poder decir «le recordamos el saldo el 3 de diciembre», que
-- es lo que alguien busca cuando el cliente llama a reclamar. Con
-- `mensaje_enviado` diría «mensaje enviado» y habría que abrir el
-- contenido para saber de qué se trataba.
--
-- `clinico = false`: es de la relación comercial, no del expediente.
-- ---------------------------------------------------------------------
INSERT INTO crm_tipos_evento (codigo, etiqueta, modulo, clinico, orden)
VALUES ('recordatorio_saldo', 'Recordatorio de saldo', 'finanzas', false, 72)
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta, modulo = EXCLUDED.modulo, orden = EXCLUDED.orden;
