-- =====================================================================
-- VetPlatform — Migración 036
-- Correos transaccionales, Paso 5 — registro de envíos + Paso 2 —
-- "prueba por terminar" (aviso previo, antes no existía ningún chequeo
-- calendario para esto — procesarFinDePruebas en purga.ts solo dispara
-- DESPUÉS de que la prueba ya terminó).
-- =====================================================================

-- tenant_id SIN FK a propósito, mismo patrón que clinicas_purgadas_auditoria
-- (migración 027): el registro de un correo de purga/eliminación tiene que
-- sobrevivir al DELETE FROM tenants que hace ejecutarPurgas — si colgara de
-- tenants con ON DELETE CASCADE, se borraría en la misma transacción que la
-- eliminación que el correo estaba avisando.
CREATE TABLE correos_enviados (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid,
    destinatario  varchar(320) NOT NULL,
    tipo          varchar(40) NOT NULL
                  CHECK (tipo IN ('invitacion_medico', 'prueba_por_terminar',
                                  'prueba_terminada', 'recordatorio_eliminacion')),
    resultado     varchar(20) NOT NULL CHECK (resultado IN ('enviado', 'fallido')),
    error         text,
    enviado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_correos_enviados_tenant ON correos_enviados(tenant_id);

-- Aviso previo de fin de prueba — marca de "ya avisado" para no repetir
-- (mismo patrón que tenants.purga_recordatorio_en).
ALTER TABLE tenants ADD COLUMN trial_aviso_enviado_en timestamptz;

INSERT INTO parametros_plataforma (clave, valor, tipo, descripcion) VALUES
 ('trial.aviso_dias_antes', '2', 'numero', 'Anticipación en días del aviso de fin de prueba')
ON CONFLICT (clave) DO NOTHING;
