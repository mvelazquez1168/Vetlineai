-- ---------------------------------------------------------------------
-- 118 - La receta emitida tambien es una notificacion (prompt 07c)
--
-- DEFECTO REAL, encontrado al enviar la receta desde el navegador:
--
--   new row for relation "notificaciones" violates check constraint
--   "notificaciones_tipo_check"
--
-- Es la TERCERA vez que pasa lo mismo en este repo: se agrega un tipo
-- de correo en TypeScript y el CHECK de la tabla, que repite la lista a
-- mano, se queda atras. La primera fue `correos_enviados.tipo`
-- (migracion 050) y la segunda sus tres tipos nuevos.
--
-- No se arregla el patron aca —quitar el CHECK y dejar la lista solo en
-- el codigo seria perder la garantia de la base, y una tabla de tipos
-- es una migracion mas grande que lo que este prompt abarca—, pero
-- queda dicho: el CHECK y `TipoCorreo` son dos copias de la misma
-- lista, y ya se separaron tres veces.
-- ---------------------------------------------------------------------

ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
    'recordatorio_cita',
    'desparasitacion_proxima',
    'seguimiento_faltante',
    'vacunacion_proxima',
    'seguimiento_posterior_consulta',
    'agenda_dia_siguiente',
    'confirmacion_cita',
    'cita_cancelada_o_reprogramada',
    'informe_disponible',
    'cumpleanos',
    'receta_emitida'
  ));

ALTER TABLE correos_enviados DROP CONSTRAINT IF EXISTS correos_enviados_tipo_check;
ALTER TABLE correos_enviados ADD CONSTRAINT correos_enviados_tipo_check
  CHECK (tipo IN (
    'invitacion_medico', 'prueba_por_terminar', 'prueba_terminada',
    'recordatorio_eliminacion', 'verificacion_correo', 'cuenta_no_operativa',
    'cobro_fallido', 'cuenta_suspendida', 'autorecarga_fallida', 'tarjeta_por_vencer',
    'recordatorio_cita', 'desparasitacion_proxima', 'seguimiento_faltante',
    'cuenta_suspendida_manual', 'entrada_ventana_cierre', 'recordatorio_cierre',
    'cuenta_bloqueada', 'vacunacion_proxima', 'seguimiento_posterior_consulta',
    'agenda_dia_siguiente', 'confirmacion_cita', 'cita_cancelada_o_reprogramada',
    'informe_disponible', 'cumpleanos', 'saldo_proveedor_bajo',
    'restablecimiento_contrasena', 'contrasena_cambiada', 'comprobante_electronico',
    'receta_emitida'
  ));
