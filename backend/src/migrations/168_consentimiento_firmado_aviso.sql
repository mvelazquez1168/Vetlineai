-- ---------------------------------------------------------------------
-- 168 — EL CONSENTIMIENTO FIRMADO SE LE MANDA AL CLIENTE
--
-- Hacen falta dos tipos nuevos: `consentimiento_firmado` (el PDF que se
-- le manda después de firmar) y `consentimiento_a_firmar` (el enlace de
-- la firma a distancia).
--
-- SE AGREGAN SIN REESCRIBIR LA LISTA, y ese es el punto de esta
-- migración. El CHECK de `correos_enviados.tipo` ya rompió dos veces por
-- el mismo motivo: alguien lo reescribe de memoria, se olvida de tipos
-- que ya existen en la base —`cuenta_bloqueada`, `prueba_terminada`,
-- `saldo_proveedor_bajo`…— y la migración falla o, peor, pasa y después
-- rechaza un correo real al grabarlo.
--
-- Así que la lista nueva se CALCULA: lo que ya hay en la tabla, más lo
-- que el código puede mandar, más los dos nuevos. Una lista escrita a
-- mano es un inventario que envejece; esto no puede quedar corto.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_tipos TEXT;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(t), ', ')
    INTO v_tipos
    FROM (
      -- 1. Lo que YA está en la tabla: no se puede rechazar.
      SELECT tipo AS t FROM correos_enviados
      UNION
      -- 2. Lo que el código puede mandar hoy (TipoCorreo de correos.ts).
      SELECT * FROM unnest(ARRAY[
        'bienvenida', 'invitacion_medico', 'verificacion_correo',
        'restablecer_contrasena', 'restablecimiento_contrasena', 'contrasena_cambiada',
        'recordatorio_cita', 'desparasitacion_proxima', 'vacunacion_proxima',
        'seguimiento_posterior_consulta', 'seguimiento_faltante', 'agenda_dia_siguiente',
        'confirmacion_cita', 'cita_cancelada_o_reprogramada', 'informe_disponible',
        'cumpleanos', 'comprobante_electronico', 'receta_emitida', 'recordatorio_saldo',
        'cobro_fallido', 'suspension', 'autorecarga', 'autorecarga_fallida',
        'tarjeta_por_vencer', 'prueba_por_terminar', 'prueba_terminada',
        'cuenta_no_operativa', 'cuenta_suspendida', 'cuenta_suspendida_manual',
        'cuenta_bloqueada', 'entrada_ventana_cierre', 'recordatorio_eliminacion',
        'purga_aviso', 'purga_recordatorio', 'exportacion_lista', 'cambio_plan',
        'recarga_credito', 'pago_recibido', 'saldo_proveedor_bajo',
      -- 3. Los dos nuevos.
        'consentimiento_firmado', 'consentimiento_a_firmar'
      ])
    ) todos;

  EXECUTE 'ALTER TABLE correos_enviados DROP CONSTRAINT IF EXISTS correos_enviados_tipo_check';
  EXECUTE format(
    'ALTER TABLE correos_enviados ADD CONSTRAINT correos_enviados_tipo_check CHECK (tipo IN (%s))',
    v_tipos
  );
END $$;

-- `notificaciones.tipo` sí se puede escribir completo: son los avisos al
-- cliente, son pocos y están todos en el código.
DO $$
DECLARE
  v_tipos TEXT;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(t), ', ')
    INTO v_tipos
    FROM (
      SELECT tipo AS t FROM notificaciones
      UNION
      SELECT * FROM unnest(ARRAY[
        'recordatorio_cita', 'desparasitacion_proxima', 'seguimiento_faltante',
        'vacunacion_proxima', 'seguimiento_posterior_consulta', 'agenda_dia_siguiente',
        'confirmacion_cita', 'cita_cancelada_o_reprogramada', 'informe_disponible',
        'cumpleanos', 'comprobante_electronico', 'receta_emitida', 'recordatorio_saldo',
        'consentimiento_firmado', 'consentimiento_a_firmar'
      ])
    ) todos;

  EXECUTE 'ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check';
  EXECUTE format(
    'ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (tipo IN (%s))',
    v_tipos
  );
END $$;
