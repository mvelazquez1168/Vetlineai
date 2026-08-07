-- =====================================================================
-- VetPlatform — Migración 014
-- archivos.file_id_anthropic: id devuelto por la Files API de Anthropic
-- al subir el archivo (client.beta.files.upload) — NULL si el archivo
-- todavía no se subió, o si la subida falló (el archivo sigue
-- disponible localmente para descarga humana en ambos casos).
-- =====================================================================

ALTER TABLE archivos ADD COLUMN IF NOT EXISTS file_id_anthropic VARCHAR(255);
