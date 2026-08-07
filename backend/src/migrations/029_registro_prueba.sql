-- Prompt B (prompts_code_platform_admin_registro.md) — registro y alta con
-- prueba. El registro público actual (registro.routes.ts) todavía escribe
-- en el modelo viejo (tenants.estado_suscripcion/plan_id, cobra de
-- inmediato vía Tilopay) y nunca crea suscripciones/saldos_ia — se
-- reemplaza por completo.

-- Correo del primer médico a invitar, cuando el registrante no marca "también
-- soy médico" — el crédito de prueba queda retenido hasta que ese médico
-- complete su alta (ver POST /admin/medicos).
ALTER TABLE tenants ADD COLUMN medico_invitado_email VARCHAR(200);

-- Distingue "todavía no se otorgó crédito de prueba" de "se otorgó y ya se
-- consumió a cero" — saldos_ia por sí solo no alcanza para esa distinción.
ALTER TABLE tenants ADD COLUMN credito_prueba_otorgado_en TIMESTAMPTZ;

-- Campos del paso de verificación profesional del registro (mockup:
-- universidad de egreso + año de graduación), además de la colegiatura que
-- ya existía.
ALTER TABLE personas ADD COLUMN universidad_egreso VARCHAR(200);
ALTER TABLE personas ADD COLUMN anio_graduacion INTEGER;
