-- prompt_code_notificaciones_pendientes.md — registro de vacunas + 6
-- avisos nuevos (3 del job diario, 3 disparados por hecho).

-- Parte A — vacunación como segundo tipo de cuidado preventivo.
ALTER TABLE cuidados_preventivos DROP CONSTRAINT cuidados_preventivos_tipo_check;
ALTER TABLE cuidados_preventivos ADD CONSTRAINT cuidados_preventivos_tipo_check
    CHECK (tipo IN ('desparasitacion', 'vacunacion'));
ALTER TABLE cuidados_preventivos
  ADD COLUMN vacuna VARCHAR(100),
  ADD COLUMN lote VARCHAR(50);

-- Parte B/C — 6 tipos nuevos en los dos catálogos de tipo existentes.
ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check
    CHECK (tipo IN (
        'recordatorio_cita', 'desparasitacion_proxima', 'seguimiento_faltante',
        'vacunacion_proxima', 'seguimiento_posterior_consulta', 'agenda_dia_siguiente',
        'confirmacion_cita', 'cita_cancelada_o_reprogramada', 'informe_disponible'
    ));

ALTER TABLE correos_enviados DROP CONSTRAINT correos_enviados_tipo_check;
ALTER TABLE correos_enviados ADD CONSTRAINT correos_enviados_tipo_check
    CHECK (tipo IN (
        'invitacion_medico', 'prueba_por_terminar', 'prueba_terminada', 'recordatorio_eliminacion',
        'verificacion_correo', 'cuenta_no_operativa', 'cobro_fallido', 'cuenta_suspendida',
        'autorecarga_fallida', 'tarjeta_por_vencer', 'recordatorio_cita', 'desparasitacion_proxima',
        'seguimiento_faltante', 'cuenta_suspendida_manual', 'entrada_ventana_cierre',
        'recordatorio_cierre', 'cuenta_bloqueada',
        'vacunacion_proxima', 'seguimiento_posterior_consulta', 'agenda_dia_siguiente',
        'confirmacion_cita', 'cita_cancelada_o_reprogramada', 'informe_disponible'
    ));

-- Parte D — interruptor + parámetros por aviso nuevo. Los 3 disparados
-- por hecho (confirmación/cancelación-reprogramación/informe) no llevan
-- parámetro de días: son inmediatos, no hay umbral que configurar.
ALTER TABLE configuracion_notificaciones
  ADD COLUMN vacunacion_activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN dias_aviso_vacunacion INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN seguimiento_posterior_activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN dias_seguimiento_posterior INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN agenda_dia_siguiente_activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN confirmacion_cita_activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN cancelacion_cita_activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN informe_disponible_activo BOOLEAN NOT NULL DEFAULT true;
