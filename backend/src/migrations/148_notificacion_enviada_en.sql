-- ---------------------------------------------------------------------
-- 148 — CUÁNDO SALIÓ LA NOTIFICACIÓN
--
-- DEFECTO REAL, encontrado por el verificador por HTTP del prompt 04 y
-- NO introducido por él: el despacho por WhatsApp del anexo 07-03
-- escribe `UPDATE notificaciones SET estado = 'enviada', enviada_en =
-- now()`, y esa columna **no existe**. Cualquier aviso que saliera por
-- WhatsApp terminaba en un error de columna inexistente, y como el aviso
-- se emite dentro de la misma transacción que crea la cita, **la cita
-- también fallaba**: `POST /citas` contestaba 500.
--
-- Cómo pasó inadvertido: los verificadores de notificaciones prueban el
-- correo, que no toca esa columna, y las citas de prueba de los demás
-- verificadores son de dueños sin consentimiento de WhatsApp, así que
-- nunca entraron a esa rama. Se descubrió al agendar por la API con un
-- dueño que solo tiene teléfono.
--
-- SE AGREGA LA COLUMNA en vez de borrar el UPDATE: el dato es el
-- correcto —cuándo salió, que no es cuándo se creó la fila— y es el que
-- hace falta para contestar «¿esto se mandó?» sin mirar el proveedor. El
-- correo también la escribe desde ahora, por el mismo motivo.
-- ---------------------------------------------------------------------
ALTER TABLE notificaciones
  ADD COLUMN IF NOT EXISTS enviada_en TIMESTAMPTZ;

COMMENT ON COLUMN notificaciones.enviada_en IS
  'Cuándo salió de verdad, que no es cuándo se creó la fila. NULL si todavía no salió o si falló.';

-- Las que ya están marcadas como enviadas no tienen ese dato y no se
-- puede inventar: se deja en NULL a propósito. `creado_en` es cuándo se
-- creó la fila, no cuándo salió, y copiarlo haría pasar una suposición
-- por un hecho.
