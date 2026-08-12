-- Cronología de seguimiento, Paso 1 (resolución previa) — `mensajes` nunca
-- guardó quién escribió cada fila: el autor de un remitente='medico' era
-- implícito vía casos.medico_id, válido solo mientras el caso nunca se
-- reasignara. La reasignación de casos ya existe (PUT /admin/casos/:id/reasignar),
-- así que atribuir por casos.medico_id es historia clínica potencialmente
-- mal atribuida, sin error visible — inaceptable para algo que puede
-- terminar en el reporte de atenciones que se presenta ante el colegio.
--
-- `autor_persona_id` queda NULL para remitente='ai' (nadie lo escribió) y
-- se completa desde acá en adelante en cada INSERT con remitente='medico'
-- (ver workspace.routes.ts).

BEGIN;

ALTER TABLE mensajes ADD COLUMN autor_persona_id UUID REFERENCES personas(id);

-- Rellenado de filas existentes — NO usa casos.medico_id directo (sería
-- exacto solo para casos nunca reasignados). En cambio, para cada mensaje
-- busca en bitacora_auditoria (accion='admin_reasigno_caso', la única
-- fuente que modifica casos.medico_id, ver comentario en admin.routes.ts)
-- la reasignación MÁS TEMPRANA ocurrida DESPUÉS de que el mensaje se
-- escribió: si existe, el autor real es el médico ANTERIOR a esa
-- reasignación (medicoAnterior) — el que tenía el caso en el momento en
-- que el mensaje se creó. Si no existe ninguna reasignación posterior al
-- mensaje, el caso no cambió de médico desde entonces y casos.medico_id
-- actual es exacto.
UPDATE mensajes m
SET autor_persona_id = COALESCE(
  (
    SELECT (b.detalle->'medicoAnterior'->>'id')::uuid
    FROM bitacora_auditoria b
    WHERE b.accion = 'admin_reasigno_caso'
      AND b.entidad_id = m.caso_id
      AND b.creado_en > m.creado_en
    ORDER BY b.creado_en ASC
    LIMIT 1
  ),
  (SELECT c.medico_id FROM casos c WHERE c.id = m.caso_id)
)
WHERE m.remitente = 'medico';

COMMIT;
