-- =====================================================================
-- VetPlatform — Migración 046
-- prompt_code_optimizacion_contexto, Cambio 4 (confirmado por el usuario
-- tras el reporte previo — ver memoria de la sesión). La purga de un
-- tenant ya borraba uso_api sin fallar (purga.ts::ejecutarPurgas), pero
-- no dejaba ningún rastro agregado de lo que esa cuenta consumió. Estas
-- columnas se pueblan en la misma transacción, antes de borrar uso_api.
-- =====================================================================

-- credito_otorgado_usd es el crédito de prueba efectivamente otorgado
-- (puede ser menor al nominal si el tope global mensual ya estaba
-- consumido al momento del alta — ver registroPrueba.ts). Comparado
-- contra consumo_total_usd, sin volver a tocar saldos_ia (que ya se
-- borra en cascada con el tenant), permite saber si la cuenta agotó su
-- crédito de prueba o lo dejó sin usar: son señales distintas.
ALTER TABLE clinicas_purgadas_auditoria
    ADD COLUMN consumo_total_usd numeric(12,4) NOT NULL DEFAULT 0,
    ADD COLUMN cantidad_llamadas integer NOT NULL DEFAULT 0,
    ADD COLUMN primera_llamada_en timestamptz,
    ADD COLUMN ultima_llamada_en timestamptz,
    ADD COLUMN credito_otorgado_usd numeric(12,4) NOT NULL DEFAULT 0;
