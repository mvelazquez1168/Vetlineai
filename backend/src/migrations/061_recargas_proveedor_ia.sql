-- =====================================================================
-- VetPlatform — Migración 061
-- prompt_code_panel_consumo_plataforma, Paso 1 — recargas de la cuenta
-- de Anthropic (el proveedor de IA, no de una clínica — no confundir con
-- la tabla "recargas" de migración 024, que es la recarga de crédito que
-- compra una clínica). Entrada manual: Anthropic no expone el saldo por
-- API, así que este es el único punto de partida real para derivarlo
-- (saldo = suma de estas recargas − gasto real acumulado desde la
-- primera, ver Paso 3).
-- =====================================================================

CREATE TABLE recargas_proveedor_ia (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha        DATE NOT NULL,
    monto_usd    NUMERIC(12,2) NOT NULL CHECK (monto_usd > 0),
    cargado_por  UUID NOT NULL REFERENCES staff_plataforma(id),
    nota         TEXT,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recargas_proveedor_ia_fecha ON recargas_proveedor_ia(fecha);

-- Sin RLS: es staff-only (mismo criterio que staff_plataforma misma, sin
-- tenant_id — ver el comentario de RLS en 001_init.sql), autorización
-- por rol en el router, no por política de fila.
