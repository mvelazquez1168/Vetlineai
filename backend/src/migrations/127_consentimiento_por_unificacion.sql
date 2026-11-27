-- ---------------------------------------------------------------------
-- 127 — DE DÓNDE SALIÓ UN CONSENTIMIENTO: TAMBIÉN DE UNA FUSIÓN
--       (anexo 07-03, B1)
--
-- Al unificar dos clientes, el consentimiento del sobreviviente puede
-- cambiar: si uno de los dos dijo NO, gana la negativa. Ese cambio se
-- escribe en `crm_consentimiento_historial`, que lleva `fuente` con un
-- CHECK cerrado de cinco valores, ninguno de los cuales es «lo cambió
-- una fusión de fichas».
--
-- Se agrega el valor en vez de reusar `importacion`. Es la tercera vez
-- en este sistema que un CHECK cerrado se queda corto cuando aparece un
-- disparador nuevo (los tipos de `correos_enviados` en la 050, los
-- estados de suspensión), y la lección de las dos anteriores es la
-- misma: etiquetar el caso nuevo con el nombre de otro hace que el
-- historial mienta sobre por qué cambió.
-- ---------------------------------------------------------------------
ALTER TABLE crm_consentimiento_historial
  DROP CONSTRAINT IF EXISTS crm_consentimiento_historial_fuente_check;

ALTER TABLE crm_consentimiento_historial
  ADD CONSTRAINT crm_consentimiento_historial_fuente_check
  CHECK (fuente IN ('registro', 'recepcion', 'respuesta_cliente', 'importacion',
                    'existente_al_habilitar', 'unificacion'));
