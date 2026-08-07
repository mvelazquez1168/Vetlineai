-- =====================================================================
-- VetPlatform — Migración 040
-- Cupo de médicos de la prueba (prompt urgente medico_agente, Causa 2 —
-- quedó pendiente de la vez anterior). Dos médicos: el mínimo que
-- permite ejercitar el flujo de invitación durante la prueba
-- (registrante-médico + un invitado, o admin no médico + primer
-- veterinario).
-- =====================================================================

INSERT INTO parametros_plataforma (clave, valor, tipo, descripcion) VALUES
 ('trial.medicos_incluidos', '2', 'numero',
  'Médicos incluidos en la suscripción de prueba — el mínimo para ejercitar la invitación durante la prueba')
ON CONFLICT (clave) DO NOTHING;

-- Backfill: suscripciones de prueba YA CREADAS con el viejo valor
-- hardcodeado (1). Solo toca estado='prueba' — una suscripción que ya
-- convirtió a un plan pago tiene su propio medicos_contratados pactado
-- con ese plan, no debe tocarse acá.
UPDATE suscripciones SET medicos_contratados = 2
    WHERE estado = 'prueba' AND medicos_contratados = 1;
