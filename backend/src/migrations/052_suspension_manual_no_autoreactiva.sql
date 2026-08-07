-- Vetline_Ai_Suspension_Bloqueo.md sección 3.2: "Una suspensión manual no
-- se levanta sola con un cobro exitoso". confirmarCobroSuscripcionExitoso
-- (pagos/cicloCobro.ts) necesita distinguir el origen de la suspensión
-- para saber si un cobro exitoso debe reactivar la suscripción o no —
-- hasta ahora no había forma de distinguirlo.
ALTER TABLE suscripciones
  ADD COLUMN suspendida_manualmente BOOLEAN NOT NULL DEFAULT false;
