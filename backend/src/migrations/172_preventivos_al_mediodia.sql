-- ---------------------------------------------------------------------
-- 172 — LA VACUNA APARECÍA UN DÍA ANTES
--
-- Encontrado verificando la migración 171. `cuidados_preventivos.
-- fecha_aplicacion` es DATE, y el evento de la línea de tiempo la
-- guardaba tal cual en `crm_interacciones.ocurrido_en`, que es
-- TIMESTAMPTZ. Medianoche del 27 en UTC es el 26 a las 18:00 en Costa
-- Rica, y la pantalla muestra la hora en la zona de la clínica: el
-- usuario tecleaba el 27 y la pestaña decía 26.
--
-- NO ES SOLO DEL RELLENO. Afecta a todo lo cargado desde la ficha del
-- paciente (`POST /pacientes/:id/cuidados-preventivos`), que es el
-- camino que existe desde antes. El código de los dos caminos ya quedó
-- corregido; esto arregla lo ya escrito.
--
-- EL MEDIODÍA, y no una zona concreta: a las 12:00 UTC el día del
-- calendario es el mismo en toda zona entre UTC−11 y UTC+11. Guardar la
-- hora real no tiene sentido —nadie registró a qué hora de la tarde de
-- hace tres años le pusieron la vacuna—, y lo que importa es que el día
-- se lea igual en cualquier parte.
--
-- SE APAGA EL TRIGGER APPEND-ONLY para este UPDATE y se vuelve a
-- encender. Es deliberado y acotado a estas filas: lo que el trigger
-- protege es que nadie reescriba la historia, y acá la historia que se
-- está arreglando es la que escribió mal el propio sistema. Si fuera un
-- cambio de contenido —otra vacuna, otro paciente— no se haría así: se
-- agregaría un evento nuevo.
-- ---------------------------------------------------------------------

ALTER TABLE crm_interacciones DISABLE TRIGGER trg_interaccion_solo_se_agrega;

UPDATE crm_interacciones i
   SET ocurrido_en = (i.ocurrido_en::date + time '12:00') AT TIME ZONE 'UTC'
 WHERE i.origen_tabla = 'cuidados_preventivos'
   AND i.tipo IN ('vacuna_aplicada', 'desparasitacion')
   -- Solo las que quedaron exactamente a medianoche UTC, que son las
   -- que vienen de un DATE. Una con hora real no se toca.
   AND (i.ocurrido_en AT TIME ZONE 'UTC')::time = time '00:00';

ALTER TABLE crm_interacciones ENABLE TRIGGER trg_interaccion_solo_se_agrega;
