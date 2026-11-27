-- ---------------------------------------------------------------------
-- 131 — LOS MOTIVOS DE DESCUENTO DE UNA VETERINARIA, MAPEADOS A LOS
--       CÓDIGOS OFICIALES (prompt 08b, A3)
--
-- Los diez códigos salen de `CodigoDescuentoType` del XSD oficial v4.4
-- que vive en `backend/esquemas/fe-cr/xml-schemas/v4.4/`, leídos del
-- archivo y no de la memoria:
--
--   01 Regalía · 02 Regalía IVA cobrado al cliente · 03 Bonificación
--   04 Volumen · 05 Temporada (estacional) · 06 Promocional
--   07 Comercial · 08 Frecuencia · 09 Sostenido · 99 Otros
--
-- LA SEMILLA TRADUCE, NO INVENTA. Cada etiqueta que el cajero va a ver
-- apunta a uno de esos diez. Las dos que caen en «99 Otros» llevan su
-- texto, porque la estructura lo exige cuando el código es 99 —y si no
-- lo llevara, el comprobante saldría diciendo «otros» sin decir qué—.
--
-- El verificador comprueba que los diez códigos usados acá existan en
-- la enumeración del XSD: si Hacienda cambia la lista, falla antes de
-- que un comprobante se rechace.
-- ---------------------------------------------------------------------
INSERT INTO vta_motivos_descuento
  (tenant_id, etiqueta, codigo_hacienda, codigo_hacienda_otro, exige_autorizacion, orden)
SELECT * FROM (VALUES
  (NULL::uuid, 'Cliente frecuente',          '08', NULL,                               false, 10),
  (NULL::uuid, 'Promoción vigente',          '06', NULL,                               false, 20),
  (NULL::uuid, 'Campaña de temporada',       '05', NULL,                               false, 30),
  (NULL::uuid, 'Descuento comercial',        '07', NULL,                               false, 40),
  (NULL::uuid, 'Compra por volumen',         '04', NULL,                               false, 50),
  (NULL::uuid, 'Muestra o bonificación',     '03', NULL,                               false, 60),
  /* Las dos que exigen autorización pase lo que pase con el tope: una
     cortesía no la decide quien cobra, y el descuento a un albergue es
     una política de la clínica, no del mostrador. */
  (NULL::uuid, 'Cortesía de la clínica',     '99', 'Cortesía de la clínica',           true,  70),
  (NULL::uuid, 'Rescate o albergue',         '99', 'Animal de rescate o albergue',     true,  80)
) AS v(tenant_id, etiqueta, codigo_hacienda, codigo_hacienda_otro, exige_autorizacion, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM vta_motivos_descuento m
   WHERE m.tenant_id IS NULL AND m.etiqueta = v.etiqueta
);

-- ---------------------------------------------------------------------
-- LOS TOPES POR ROL, para las clínicas que ya existen.
--
-- Médico 10 %, administrador sin tope y con permiso de autorizar. Es lo
-- que el prompt propone como ejemplo, y es editable por la clínica.
--
-- NO SE SIEMBRA «recepcion»: ese rol todavía no existe en el sistema
-- (`personas` tiene `es_medico` y `es_admin_clinica` y nada más).
-- Sembrarlo ahora sería dejar una fila que no gobierna a nadie y que el
-- día del prompt 04 nadie sabría si está puesta a propósito.
-- ---------------------------------------------------------------------
INSERT INTO vta_topes_descuento (tenant_id, rol, tope_pct, puede_autorizar)
SELECT t.id, v.rol, v.tope, v.autoriza
  FROM tenants t
  CROSS JOIN (VALUES
    ('medico',        10.00::numeric, false),
    ('admin_clinica', NULL::numeric,  true)
  ) AS v(rol, tope, autoriza)
 WHERE NOT EXISTS (
   SELECT 1 FROM vta_topes_descuento x WHERE x.tenant_id = t.id AND x.rol = v.rol
 );
