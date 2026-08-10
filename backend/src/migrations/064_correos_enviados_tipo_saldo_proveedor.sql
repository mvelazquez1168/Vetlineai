-- correos.ts agregó el tipo "saldo_proveedor_bajo" (prompt_code_panel_consumo_sin_api)
-- pero el CHECK de correos_enviados.tipo nunca se extendió — mismo patrón de
-- bug ya visto varias veces en este proyecto (050, 053, 054): el camino no
-- se había ejercitado end-to-end hasta esta verificación real.
ALTER TABLE correos_enviados DROP CONSTRAINT correos_enviados_tipo_check;
ALTER TABLE correos_enviados ADD CONSTRAINT correos_enviados_tipo_check
    CHECK (tipo IN (
        'invitacion_medico', 'prueba_por_terminar', 'prueba_terminada', 'recordatorio_eliminacion',
        'verificacion_correo', 'cuenta_no_operativa', 'cobro_fallido', 'cuenta_suspendida',
        'autorecarga_fallida', 'tarjeta_por_vencer', 'recordatorio_cita', 'desparasitacion_proxima',
        'seguimiento_faltante', 'cuenta_suspendida_manual', 'entrada_ventana_cierre',
        'recordatorio_cierre', 'cuenta_bloqueada', 'vacunacion_proxima', 'seguimiento_posterior_consulta',
        'agenda_dia_siguiente', 'confirmacion_cita', 'cita_cancelada_o_reprogramada', 'informe_disponible',
        'cumpleanos', 'saldo_proveedor_bajo'
    ));
