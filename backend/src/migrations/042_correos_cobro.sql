-- =====================================================================
-- VetPlatform — Migración 042
-- Correos de cobro y área del logo — los 4 correos que dependían de la
-- política de reintentos del motor de cobros (que ya existe).
-- =====================================================================

ALTER TABLE correos_enviados DROP CONSTRAINT correos_enviados_tipo_check;
ALTER TABLE correos_enviados ADD CONSTRAINT correos_enviados_tipo_check
    CHECK (tipo IN ('invitacion_medico', 'prueba_por_terminar',
                    'prueba_terminada', 'recordatorio_eliminacion',
                    'verificacion_correo', 'cuenta_no_operativa',
                    'cobro_fallido', 'cuenta_suspendida',
                    'autorecarga_fallida', 'tarjeta_por_vencer'));

-- Marca de "ya avisado" para el método de pago que está por vencer — sin
-- esto el job diario mandaría el mismo aviso todos los días hasta que se
-- reemplace la tarjeta. Se limpia sola cuando se registra un método
-- nuevo (referencia_externa distinta = fila nueva, ver metodos_pago).
ALTER TABLE metodos_pago ADD COLUMN aviso_vencimiento_enviado_en timestamptz;

-- Correo 4 (tarjeta por vencer) — la anticipación es un parámetro de
-- plataforma, no un valor cableado (pedido explícito del prompt).
INSERT INTO parametros_plataforma (clave, valor, tipo, descripcion) VALUES
 ('cobro.aviso_vencimiento_dias', '20', 'numero', 'Anticipación en días del aviso de tarjeta por vencer')
ON CONFLICT (clave) DO NOTHING;
