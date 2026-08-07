-- =====================================================================
-- VetPlatform — Migración 039
-- Verificación de correo del administrador (prompt_code_verificacion_correo.md).
-- Tres capas: prevenir (frontend), detectar el rebote (webhook de Resend),
-- corregir (cambio de correo). Más el límite exterior de purga para
-- cuentas que nunca llegan a estar operativas.
-- =====================================================================

-- Estado de verificación del correo del administrador. Solo se usa para
-- es_admin_clinica=true — el médico invitado nunca pasa por acá, su
-- enlace de invitación ya prueba que recibió el correo.
ALTER TABLE personas ADD COLUMN correo_verificado_en timestamptz;
ALTER TABLE personas ADD COLUMN correo_rebotado_en timestamptz;
ALTER TABLE personas ADD COLUMN token_verificacion_correo uuid;
ALTER TABLE personas ADD COLUMN token_verificacion_expira_en timestamptz;
CREATE UNIQUE INDEX idx_personas_token_verificacion ON personas(token_verificacion_correo)
    WHERE token_verificacion_correo IS NOT NULL;

-- Backfill: todo administrador que ya existe hoy se considera verificado
-- desde su alta — no hay forma de saber retroactivamente si su correo es
-- válido, y tratarlos a todos como "no verificado" desde ahora dispararía
-- el límite exterior (30 días) sobre cuentas que llevan operando meses.
-- Consistente con que Keycloak ya los tiene con emailVerified=true (ver
-- crearUsuarioKeycloak, que lo hardcodeaba true hasta este prompt).
--
-- Excluye admin+médico sin colegiatura (constraint colegiatura_medico_obligatoria,
-- NOT VALID desde el prompt de medico_agente — no valida retroactivo, pero
-- SÍ revalida en cualquier UPDATE posterior de esa fila, aunque la columna
-- tocada no sea colegiatura). Son los mismos registros preexistentes ya
-- reportados sin corregir (no se puede inventar el dato de colegiatura) —
-- quedan con correo_verificado_en NULL, no bloquea esta migración.
UPDATE personas SET correo_verificado_en = creado_en
    WHERE es_admin_clinica = true AND correo_verificado_en IS NULL
      AND NOT (es_medico = true AND colegiatura IS NULL);

-- Correlación exacta de rebotes: el id que devuelve Resend al aceptar el
-- envío, para no depender de matchear por destinatario cuando llega el
-- webhook (ver backend/src/routes/webhooks.routes.ts).
ALTER TABLE correos_enviados ADD COLUMN proveedor_message_id text;
ALTER TABLE correos_enviados ADD COLUMN rebotado_en timestamptz;
CREATE INDEX idx_correos_enviados_proveedor_message_id ON correos_enviados(proveedor_message_id)
    WHERE proveedor_message_id IS NOT NULL;

ALTER TABLE correos_enviados DROP CONSTRAINT correos_enviados_tipo_check;
ALTER TABLE correos_enviados ADD CONSTRAINT correos_enviados_tipo_check
    CHECK (tipo IN ('invitacion_medico', 'prueba_por_terminar', 'prueba_terminada',
                     'recordatorio_eliminacion', 'verificacion_correo', 'cuenta_no_operativa'));

-- Registro CRUDO de cada evento de webhook de Resend, persistido ANTES de
-- procesarlo (idempotencia + auditoría) — mismo criterio que
-- procesarNotificacionCallback en pagos/callbackCobros.ts. El id es el
-- que asigna Resend/Svix a cada evento, natural como clave de idempotencia.
CREATE TABLE webhooks_resend_eventos (
    id           text PRIMARY KEY,
    tipo         text NOT NULL,
    payload      jsonb NOT NULL,
    recibido_en  timestamptz NOT NULL DEFAULT now(),
    procesado_en timestamptz
);

-- Marca de "ya se envió el recordatorio intermedio de cuenta no operativa"
-- — mismo patrón que trial_aviso_enviado_en / purga_recordatorio_en.
ALTER TABLE tenants ADD COLUMN aviso_cuenta_no_operativa_enviado_en timestamptz;

INSERT INTO parametros_plataforma (clave, valor, tipo, descripcion) VALUES
 ('cuenta.dias_limite_no_operativa', '30', 'numero',
  'Días desde el alta sin correo verificado y sin médico activo con colegiatura antes de entrar en ventana de purga'),
 ('cuenta.aviso_dias_no_operativa', '7', 'numero',
  'Días desde el alta para el recordatorio intermedio de cuenta no operativa, si todavía no lo está')
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE notificaciones_uso DROP CONSTRAINT notificaciones_uso_umbral_check;
ALTER TABLE notificaciones_uso ADD CONSTRAINT notificaciones_uso_umbral_check
    CHECK (umbral IN ('saldo_bajo', 'saldo_agotado', 'colchon_agotado',
                      'tope_recargas', 'trial_80', 'trial_agotado',
                      'autorecarga_fallida', 'cobro_fallido', 'suscripcion_suspendida',
                      'cuenta_no_operativa'));
