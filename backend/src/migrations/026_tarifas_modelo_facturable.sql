-- Motor de crédito, Bloque 1 — distingue "no facturable a propósito" (modelos
-- simulados/de prueba) de "falta tarifa por descuido" (modelo real sin
-- precio cargado). Antes de esta columna, ambos casos eran indistinguibles
-- desde el código: la ausencia de fila en tarifas_modelo significaba
-- cualquiera de los dos, y el servicio de tarifas no podía evitar alertar
-- por un modelo que nunca va a tener precio (ej. claude-sonnet-5-mock).
--
-- Con esta columna, el servicio de tarifas tiene tres estados:
--   - tarifa vigente y facturable = true  -> calcula y cobra.
--   - tarifa vigente y facturable = false -> calcula en cero, cobrable en
--     false, sin alerta. Caso de los modelos simulados.
--   - sin tarifa vigente (ninguna fila)   -> costo cero, cobrable en false,
--     alerta de nivel error. Es el descuido real a corregir en Platform Admin.

BEGIN;

ALTER TABLE tarifas_modelo
    ADD COLUMN facturable boolean NOT NULL DEFAULT true;

COMMIT;
