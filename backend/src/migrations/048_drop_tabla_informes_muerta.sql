-- =====================================================================
-- VetPlatform — Migración 048
-- Elimina la tabla `informes` (migración 001): nunca se pobló — ningún
-- INSERT la usó jamás — desde que el informe clínico real se implementó
-- sobre `informes_generados` (migración 018, contenido_docx bytea).
-- Código muerto en el modelo de datos: la única referencia que quedaba
-- era un DELETE de limpieza en purga.ts, ya eliminado en el mismo cambio
-- que esta migración (prompt_code_dashboards_informes.md).
-- =====================================================================

DROP TABLE IF EXISTS informes;
