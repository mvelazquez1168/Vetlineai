-- ---------------------------------------------------------------------
-- 149 — EL MÓDULO DE FINANZAS, SUS PERMISOS Y SU POLÍTICA
--       (prompt 10a)
--
-- DIFERENCIA CON EL PROMPT, para corregir la guía: el 10a dice «usa el
-- módulo `finanzas` que agrega el 04», y el 04 no lo agrega —su prompt
-- no lo menciona en ninguna parte y la entrega del 04 no lo creó—. Se
-- crea acá, que es donde se usa, y queda reportado.
--
-- Lo mismo con el permiso `finanzas.registrar`: el 10a dice que «el 04
-- lo agrega a la matriz como configurable». No estaba. Se agrega acá con
-- los otros tres.
-- ---------------------------------------------------------------------

-- El módulo. El CHECK de `tenant_modulos` es cerrado a propósito —así se
-- diseñó en el 01— y por eso hay que extenderlo: es la cuarta vez que un
-- CHECK cerrado se queda corto al aparecer un caso nuevo, y la lección
-- ya está escrita en el repo.
ALTER TABLE tenant_modulos DROP CONSTRAINT IF EXISTS tenant_modulos_modulo_check;
ALTER TABLE tenant_modulos
  ADD CONSTRAINT tenant_modulos_modulo_check CHECK (
    modulo IN ('expediente', 'inventario', 'ventas', 'facturacion', 'crm', 'finanzas')
  );

-- ---------------------------------------------------------------------
-- LOS PERMISOS.
--
--   * `finanzas.ver` — la plata que sale y la que falta cobrar. El
--     contador la ve en modo lectura y nadie más por omisión: cuánto
--     debe la clínica no es información de mostrador.
--   * `finanzas.registrar` — asentar un gasto o un pago. **Configurable**:
--     hay clínicas donde esto lo hace la administradora y otras donde lo
--     hace quien está en caja.
--   * `finanzas.anular_pago` — un pago no se borra, se anula, y eso
--     devuelve saldo a una cuenta: lleva su propio permiso.
--   * `finanzas.cerrar_con_diferencia` — cerrar el día cuando el banco y
--     la caja no coinciden. Es una decisión, no un trámite.
-- ---------------------------------------------------------------------
INSERT INTO permisos (codigo, nombre, modulo, configurable, orden)
SELECT * FROM (VALUES
  ('finanzas.ver',                   'Ver finanzas: lo que se debe y lo que falta cobrar', 'finanzas', false, 80),
  ('finanzas.registrar',             'Registrar gastos y pagos a proveedores',             'finanzas', true,  81),
  ('finanzas.anular_pago',           'Anular un pago a proveedor',                         'finanzas', false, 82),
  ('finanzas.cerrar_con_diferencia', 'Cerrar el día con una diferencia',                   'finanzas', false, 83)
) AS v(codigo, nombre, modulo, configurable, orden)
WHERE NOT EXISTS (SELECT 1 FROM permisos p WHERE p.codigo = v.codigo);

-- El administrador los cuatro; el contador, solo ver. Caja NO registra
-- pagos por omisión: es el permiso configurable, y la clínica que
-- trabaje así lo activa desde la pantalla de roles.
INSERT INTO rol_permisos (rol, permiso)
SELECT * FROM (VALUES
  ('admin_clinica', 'finanzas.ver'),
  ('admin_clinica', 'finanzas.registrar'),
  ('admin_clinica', 'finanzas.anular_pago'),
  ('admin_clinica', 'finanzas.cerrar_con_diferencia'),
  ('contador',      'finanzas.ver')
) AS v(rol, permiso)
WHERE NOT EXISTS (
  SELECT 1 FROM rol_permisos rp WHERE rp.rol = v.rol AND rp.permiso = v.permiso
);

-- ---------------------------------------------------------------------
-- LA POLÍTICA DE LA COBRANZA AMABLE.
--
-- Cada cuántos días se le puede volver a recordar el saldo al mismo
-- deudor. Catorce por omisión: recordarle cada día a quien debe es la
-- forma más rápida de que marque los mensajes de la clínica como no
-- deseados, y eso se paga con los avisos de vacunación que después no
-- llegan.
-- ---------------------------------------------------------------------
INSERT INTO politicas
  (clave, nombre, descripcion, tipo, valor_por_omision, minimo, maximo, modulo,
   columna_anterior, orden)
SELECT * FROM (VALUES
  ('cobranza.dias_entre_recordatorios',
   'Días entre recordatorios de saldo',
   'Cada cuántos días se le puede volver a recordar el saldo al mismo deudor. Recordarle todos los días a quien debe es la forma más rápida de que marque los correos de la clínica como no deseados.',
   'dias', '14', 1, 90, 'finanzas', NULL, 95)
) AS v(clave, nombre, descripcion, tipo, valor_por_omision, minimo, maximo, modulo,
       columna_anterior, orden)
WHERE NOT EXISTS (SELECT 1 FROM politicas p WHERE p.clave = v.clave);
