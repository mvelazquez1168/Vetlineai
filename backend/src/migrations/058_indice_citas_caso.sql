-- =====================================================================
-- VetPlatform — Migración 058
-- prompt: vincular caso↔cita para el reporte de atenciones
-- =====================================================================

-- citas.caso_id existe desde la migración 017 pero nunca tuvo índice
-- porque nunca se escribía (ninguna pantalla lo cargaba). Ahora se vuelve
-- una columna real: el reporte de atenciones filtra por ella (JOIN directo
-- y NOT EXISTS para "casos sin cita").
CREATE INDEX IF NOT EXISTS idx_citas_caso ON citas(caso_id) WHERE caso_id IS NOT NULL;
