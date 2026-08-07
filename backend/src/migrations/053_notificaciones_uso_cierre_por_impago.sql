-- purga.ts::procesarCierrePorImpago inserta notificaciones_uso con
-- umbral='cierre_por_impago' (Vetline_Ai_Suspension_Bloqueo.md sección
-- 4.1), pero el CHECK de esta tabla nunca se extendió cuando se agregó
-- ese valor — mismo patrón de bug que correos_enviados_tipo_check
-- (migración 050): el camino nunca se había ejercitado end-to-end hasta
-- la verificación real.
ALTER TABLE notificaciones_uso DROP CONSTRAINT notificaciones_uso_umbral_check;
ALTER TABLE notificaciones_uso ADD CONSTRAINT notificaciones_uso_umbral_check
    CHECK (umbral IN (
        'saldo_bajo', 'saldo_agotado', 'colchon_agotado', 'tope_recargas',
        'trial_80', 'trial_agotado', 'autorecarga_fallida', 'cobro_fallido',
        'suscripcion_suspendida', 'cuenta_no_operativa', 'cierre_por_impago'
    ));
