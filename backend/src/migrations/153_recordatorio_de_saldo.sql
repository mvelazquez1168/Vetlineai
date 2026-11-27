-- ---------------------------------------------------------------------
-- 153 — EL RECORDATORIO DE SALDO, Y EL CANAL QUE LA COLUMNA NO ADMITÍA
--       (prompt 10a, §4)
--
-- Dos cosas, y la segunda es un defecto real que apareció al leer estos
-- CHECK para agregar el tipo nuevo.
-- ---------------------------------------------------------------------

-- 1. El tipo de aviso nuevo, en los tres lugares que lo restringen.
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_tipo_check CHECK (
    tipo IN (
      'recordatorio_cita', 'desparasitacion_proxima', 'seguimiento_faltante',
      'vacunacion_proxima', 'seguimiento_posterior_consulta', 'agenda_dia_siguiente',
      'confirmacion_cita', 'cita_cancelada_o_reprogramada', 'informe_disponible',
      'cumpleanos', 'comprobante_electronico', 'receta_emitida',
      'recordatorio_saldo'
    )
  );

ALTER TABLE correos_enviados DROP CONSTRAINT IF EXISTS correos_enviados_tipo_check;
ALTER TABLE correos_enviados
  ADD CONSTRAINT correos_enviados_tipo_check CHECK (
    tipo IN (
      'invitacion_medico', 'prueba_por_terminar', 'prueba_terminada',
      'recordatorio_eliminacion', 'verificacion_correo', 'cuenta_no_operativa',
      'cobro_fallido', 'cuenta_suspendida', 'autorecarga_fallida', 'tarjeta_por_vencer',
      'recordatorio_cita', 'desparasitacion_proxima', 'seguimiento_faltante',
      'cuenta_suspendida_manual', 'entrada_ventana_cierre', 'recordatorio_cierre',
      'cuenta_bloqueada', 'vacunacion_proxima', 'seguimiento_posterior_consulta',
      'agenda_dia_siguiente', 'confirmacion_cita', 'cita_cancelada_o_reprogramada',
      'informe_disponible', 'cumpleanos', 'saldo_proveedor_bajo',
      'restablecimiento_contrasena', 'contrasena_cambiada', 'comprobante_electronico',
      'receta_emitida',
      'recordatorio_saldo'
    )
  );

-- ---------------------------------------------------------------------
-- 2. DEFECTO REAL: `notificaciones.canal` solo admitía 'correo'.
--
-- El anexo 07-03 (B4) hizo que los avisos se despachen por el canal que
-- el cliente prefiere, WhatsApp incluido… pero la columna que dice por
-- dónde salió tiene un CHECK de un solo valor y el INSERT ni la escribe.
-- O sea: **todo aviso enviado por WhatsApp quedó registrado como
-- «correo»**. La columna miente, y es el tipo de defecto que no rompe
-- nada hasta que alguien pregunta «¿por dónde le avisamos?».
--
-- Se extiende el CHECK y el código pasa a escribir el canal de verdad.
-- Las filas viejas se quedan en 'correo': la mayoría salieron por correo
-- y las que no, no se pueden distinguir ya. Se dice acá en vez de
-- inventar una corrección.
-- ---------------------------------------------------------------------
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_canal_check;
ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_canal_check CHECK (canal IN ('correo', 'whatsapp'));

COMMENT ON COLUMN notificaciones.canal IS
  'Por dónde salió de verdad. Hasta la migración 153 solo admitía correo y nadie la escribía, así que los avisos por WhatsApp quedaron marcados como correo.';
