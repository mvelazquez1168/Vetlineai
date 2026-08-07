-- =====================================================================
-- VetPlatform — Migración 043
-- Carga selectiva de predisposiciones raciales (prompt_code_seleccion_raza)
-- Paso 3 — registro de razas que no coincidieron con ninguna sección del
-- documento de predisposiciones, para detectar razas frecuentes que
-- falten en el documento o problemas de escritura en el catálogo.
-- =====================================================================

CREATE TABLE razas_sin_coincidencia_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid,
    caso_id     uuid,
    especie     varchar(50),
    raza_texto  varchar(150),
    creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_razas_sin_coincidencia_raza ON razas_sin_coincidencia_log(raza_texto);
