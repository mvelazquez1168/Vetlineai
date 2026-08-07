-- =====================================================================
-- VetPlatform — Migración 050
-- prompt_code_notificaciones: correos_enviados.tipo todavía no aceptaba
-- los 3 tipos del módulo de notificaciones (recordatorio_cita,
-- desparasitacion_proxima, seguimiento_faltante) agregados a
-- correos.ts en la migración 049 — bug real encontrado en verificación
-- (todo intento de envío de esos 3 tipos violaba el CHECK, tanto en el
-- camino de éxito como en el de fallo).
-- =====================================================================

ALTER TABLE correos_enviados DROP CONSTRAINT correos_enviados_tipo_check;
ALTER TABLE correos_enviados ADD CONSTRAINT correos_enviados_tipo_check
    CHECK (tipo IN ('invitacion_medico', 'prueba_por_terminar',
                    'prueba_terminada', 'recordatorio_eliminacion',
                    'verificacion_correo', 'cuenta_no_operativa',
                    'cobro_fallido', 'cuenta_suspendida',
                    'autorecarga_fallida', 'tarjeta_por_vencer',
                    'recordatorio_cita', 'desparasitacion_proxima',
                    'seguimiento_faltante'));
