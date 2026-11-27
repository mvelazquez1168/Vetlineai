-- ---------------------------------------------------------------------
-- 171 — EL EVENTO QUE LES FALTA A LOS PREVENTIVOS HISTÓRICOS
--
-- Defecto del 2026-11-27, punto 1: «Registrar histórico» decía
-- «guardado» y la vacuna no aparecía ni en la pestaña ni en la línea de
-- tiempo. La fila SÍ se guardaba en `cuidados_preventivos` —el aviso de
-- la próxima dosis hasta salía—, pero las pestañas Vacunas y
-- Desparasitaciones leen la LÍNEA DE TIEMPO, y `registrarHistorico`
-- nunca registraba su evento. El usuario lo cargaba dos y tres veces.
--
-- El código ya quedó corregido. Esto es el relleno de lo ya cargado:
-- sin él, los históricos de estos días siguen invisibles.
--
-- ES IDEMPOTENTE por el `NOT EXISTS` y por el índice único de
-- `crm_interacciones (tipo, origen_tabla, origen_id)`. Correrla dos
-- veces no duplica nada.
--
-- NO TOCA los preventivos que entraron por el cierre de una atención
-- (`atencion_id IS NOT NULL`): esos ya tienen su evento, los viejos
-- apuntando a `exp_atencion_items` y los nuevos a esta misma tabla.
-- Ponerles otro serían dos eventos de la misma vacuna.
--
-- LA FECHA DEL EVENTO ES LA DE APLICACIÓN, no la de hoy ni la de carga:
-- una vacuna de hace tres años tiene que aparecer hace tres años. Con
-- `now()` la línea de tiempo diría que al paciente se le aplicaron hoy
-- catorce vacunas.
-- ---------------------------------------------------------------------

INSERT INTO crm_interacciones
  (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en,
   origen_tabla, origen_id, persona_id, resumen, nota)
SELECT cp.tenant_id,
       pac.propietario_id,
       cp.paciente_id,
       CASE WHEN cp.tipo = 'vacunacion' THEN 'vacuna_aplicada' ELSE 'desparasitacion' END,
       -- AL MEDIODÍA UTC, no a medianoche: la pantalla muestra
       -- `ocurrido_en` en la zona de la clínica, y medianoche UTC del 27
       -- es el 26 a las 18:00 en Costa Rica. La vacuna aparecería un día
       -- antes de lo que dice la cartilla.
       (cp.fecha_aplicacion + time '12:00') AT TIME ZONE 'UTC',
       'cuidados_preventivos',
       cp.id,
       cp.registrado_por,
       COALESCE(cp.vacuna, cp.producto_desparasitacion),
       CASE WHEN cp.historico THEN 'histórico' ELSE NULL END
  FROM cuidados_preventivos cp
  JOIN pacientes pac ON pac.id = cp.paciente_id
 WHERE cp.atencion_id IS NULL
   AND cp.tipo IN ('vacunacion', 'desparasitacion')
   AND NOT EXISTS (
     SELECT 1 FROM crm_interacciones i
      WHERE i.origen_tabla = 'cuidados_preventivos'
        AND i.origen_id = cp.id
        AND i.tipo IN ('vacuna_aplicada', 'desparasitacion')
   )
ON CONFLICT DO NOTHING;
