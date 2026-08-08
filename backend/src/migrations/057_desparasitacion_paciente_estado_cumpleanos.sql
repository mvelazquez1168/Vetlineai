-- =====================================================================
-- VetPlatform — Migración 057
-- prompt_code_paciente_nacimiento_estado.md
-- =====================================================================

-- PARTE A — Desparasitación interna/externa + producto aplicado.
-- Solo aplica cuando tipo='desparasitacion' — validado en la app (mismo
-- patrón que colegiatura/vacuna: NOT NULL condicional no se puede
-- expresar limpio en un CHECK sin repetir la condición completa).
ALTER TABLE cuidados_preventivos
    ADD COLUMN subtipo_desparasitacion VARCHAR(20)
        CHECK (subtipo_desparasitacion IN ('interna', 'externa')),
    ADD COLUMN producto_desparasitacion VARCHAR(100);

-- PARTE B1 — Fecha de nacimiento. Nullable a propósito (no todo tutor la
-- sabe, sobre todo con animales adoptados) — convive con edad_anios, que
-- sigue siendo la fuente cuando no hay fecha. Nunca se derivan ambas a la
-- vez: la edad efectiva se calcula en el backend a partir de
-- fecha_nacimiento cuando existe, si no se usa edad_anios tal cual.
ALTER TABLE pacientes ADD COLUMN fecha_nacimiento DATE;

-- PARTE B2 — Estado vital del paciente. 'activo' por defecto para no
-- romper los pacientes existentes. fecha_fallecimiento solo tiene sentido
-- con estado='fallecido' — mismo patrón de NOT NULL condicional que
-- arriba, validado en la app.
ALTER TABLE pacientes
    ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'activo'
        CHECK (estado IN ('activo', 'fallecido')),
    ADD COLUMN fecha_fallecimiento DATE;

-- PARTE B3 — Aviso de cumpleaños: 10º tipo de notificación, único
-- puramente comercial — su propio interruptor para que la clínica lo
-- apague sin pensarlo dos veces.
ALTER TABLE configuracion_notificaciones
    ADD COLUMN cumpleanos_activo BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check
    CHECK (tipo IN (
        'recordatorio_cita', 'desparasitacion_proxima', 'seguimiento_faltante',
        'vacunacion_proxima', 'seguimiento_posterior_consulta', 'agenda_dia_siguiente',
        'confirmacion_cita', 'cita_cancelada_o_reprogramada', 'informe_disponible',
        'cumpleanos'
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
        'confirmacion_cita', 'cita_cancelada_o_reprogramada', 'informe_disponible',
        'cumpleanos'
    ));
