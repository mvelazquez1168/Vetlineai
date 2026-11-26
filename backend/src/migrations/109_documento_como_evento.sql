-- ---------------------------------------------------------------------
-- 109 - El documento del expediente es un evento del CRM
--
-- La linea de tiempo del expediente (prompt 07) mostraba nueve clases de
-- hecho; el catalogo del CRM cubria ocho. Faltaba el DOCUMENTO: la
-- radiografia, el resultado que trae el cliente, la historia de otra
-- clinica.
--
-- El prompt 03 lo dice asi: si una vista del expediente necesita algo que
-- la tabla de eventos no tiene, se agrega el tipo de evento. Es lo que
-- hace esta migracion, y con eso las dos lineas de tiempo pueden ser la
-- misma.
-- ---------------------------------------------------------------------

INSERT INTO crm_tipos_evento (codigo, etiqueta, modulo, clinico, orden)
VALUES ('documento_adjunto', 'Documento o imagen', 'expediente', true, 47)
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta,
      modulo = EXCLUDED.modulo,
      clinico = EXCLUDED.clinico,
      orden = EXCLUDED.orden;
