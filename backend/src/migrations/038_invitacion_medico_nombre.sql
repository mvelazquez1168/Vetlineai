-- Ajustes del recorrido de prueba, Bloque 3 — la invitación de médico hoy
-- solo pide el correo. Con varias invitaciones pendientes en curso, la
-- lista se vuelve ilegible (solo correos). El nombre es OPCIONAL — nunca
-- se pide colegiatura ni otro dato profesional al invitar, eso lo carga
-- el propio médico al aceptar.
ALTER TABLE invitaciones_medico ADD COLUMN nombre varchar(200);
