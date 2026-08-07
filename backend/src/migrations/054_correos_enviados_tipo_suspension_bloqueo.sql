-- correos.ts agregó 4 tipos de correo nuevos (cuenta_suspendida_manual,
-- entrada_ventana_cierre, recordatorio_cierre, cuenta_bloqueada) durante
-- el desarrollo de Vetline_Ai_Suspension_Bloqueo.md, pero el CHECK de
-- correos_enviados.tipo nunca se extendió — mismo patrón de bug ya visto
-- dos veces en este mismo prompt (correos_enviados_tipo_check en la
-- migración 050, notificaciones_uso_umbral_check en la 053): el camino
-- nunca se había ejercitado end-to-end hasta esta verificación real.
ALTER TABLE correos_enviados DROP CONSTRAINT correos_enviados_tipo_check;
ALTER TABLE correos_enviados ADD CONSTRAINT correos_enviados_tipo_check
    CHECK (tipo IN (
        'invitacion_medico', 'prueba_por_terminar', 'prueba_terminada', 'recordatorio_eliminacion',
        'verificacion_correo', 'cuenta_no_operativa', 'cobro_fallido', 'cuenta_suspendida',
        'autorecarga_fallida', 'tarjeta_por_vencer', 'recordatorio_cita', 'desparasitacion_proxima',
        'seguimiento_faltante', 'cuenta_suspendida_manual', 'entrada_ventana_cierre',
        'recordatorio_cierre', 'cuenta_bloqueada'
    ));
