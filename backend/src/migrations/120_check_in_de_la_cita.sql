-- ---------------------------------------------------------------------
-- 120 — LA HORA DE LLEGADA DEL PACIENTE (anexo del 07, parte A2).
--
-- El anexo dice: «la hora de ingreso se toma del check-in de la cita
-- cuando existe». El check-in ya está modelado —es el estado
-- `registrada` de la cita, que el CRM registra como el evento
-- `llegada`—, pero solo como un ESTADO: se sabe que el paciente llegó y
-- no a qué hora.
--
-- `actualizado_en` no sirve para esto: lo pisa cualquier cambio
-- posterior de la cita. Una hora de llegada que se mueve sola cuando
-- alguien edita el motivo no es una hora de llegada.
--
-- Por qué una columna y no leer `crm_interacciones`: la interacción de
-- CRM es un evento de comunicación con el cliente y puede faltar (el
-- CRM es un módulo que la clínica puede no tener). La hora a la que el
-- paciente entró es un dato de la agenda.
-- ---------------------------------------------------------------------

ALTER TABLE citas ADD COLUMN IF NOT EXISTS check_in_en TIMESTAMPTZ;

COMMENT ON COLUMN citas.check_in_en IS
  'Cuándo llegó el paciente a la clínica: se sella al pasar la cita a «registrada» y no se vuelve a tocar. La atención lo copia a ingreso_en (anexo del 07, A2).';

-- Las citas que YA están registradas o en consulta no tienen hora de
-- llegada y no se puede inventar: quedan en NULL, y la atención usa su
-- propia hora de apertura. Inventarlas con `actualizado_en` sería
-- llenar una columna nueva con un dato que no es el que dice su nombre.
