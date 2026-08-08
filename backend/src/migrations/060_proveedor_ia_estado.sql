-- Alerta de "sin crédito con el proveedor de IA" — hoy no había ninguna
-- señal visible en Platform Admin cuando Anthropic rechaza las llamadas
-- por saldo agotado (HTTP 400 "credit balance is too low"): el chat, el
-- Dashboard, el Informe y la validación de recetas simplemente devuelven
-- 502 uno por uno, y nadie en la plataforma se entera hasta un reclamo de
-- una clínica real. Esta tabla guarda el último estado conocido por
-- proveedor (hoy solo 'anthropic') para que Platform Admin lo muestre —
-- ver proveedorIaEstado.ts y GET /platform-admin/tarifas/alertas.
CREATE TABLE proveedor_ia_estado (
    proveedor      varchar(30) PRIMARY KEY,
    bloqueado      boolean NOT NULL DEFAULT false,
    motivo         text,
    detectado_en   timestamptz,
    actualizado_en timestamptz NOT NULL DEFAULT now()
);
