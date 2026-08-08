-- =====================================================================
-- VetPlatform — Migración 056
-- Defecto de solicitarDowngrade: 'programado' estaba sobrecargado con dos
-- significados distintos — "agendado para el fin del período, no cobra"
-- (downgrade/cancelación) y "cobro enviado, esperando confirmación del
-- callback" (upgrade/conversion_prueba). solicitarDowngrade cancelaba
-- CUALQUIER fila en 'programado' de la suscripción para reemplazarla,
-- lo que incluía de paso un upgrade/conversión con el cobro ya en
-- tránsito — cancelando un cambio que la clínica ya pagó.
--
-- A partir de acá 'programado' significa SOLO lo primero. 'espera_pago'
-- es el estado nuevo para lo segundo.
-- =====================================================================

ALTER TABLE cambios_suscripcion DROP CONSTRAINT cambios_suscripcion_estado_check;
ALTER TABLE cambios_suscripcion ADD CONSTRAINT cambios_suscripcion_estado_check
    CHECK (estado IN ('programado', 'espera_pago', 'ejecutado', 'cancelado', 'requiere_atencion', 'fallido'));

-- Filas existentes de upgrade/conversion_prueba que estén hoy en
-- 'programado' esperando su callback (la ventana normal es de segundos,
-- pero una corrida en curso al aplicar esta migración no debe quedar mal
-- clasificada) pasan a 'espera_pago' — nunca deberían haber compartido el
-- significado de 'programado' con downgrade/cancelación.
UPDATE cambios_suscripcion
SET estado = 'espera_pago'
WHERE estado = 'programado' AND tipo IN ('upgrade', 'conversion_prueba');
