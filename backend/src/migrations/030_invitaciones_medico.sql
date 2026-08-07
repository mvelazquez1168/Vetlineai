-- Invitación y alta de médicos (prompts_code_pantallas_faltantes.md,
-- Prompt A). Reemplaza el alta directa con DevPassword123! por un flujo de
-- invitación con enlace de un solo uso. `estado` es la fuente de verdad
-- para 'aceptada'/'cancelada' (transiciones explícitas); 'vencida' se
-- deriva en el código comparando vence_en contra now() en vez de requerir
-- un job que la actualice — misma decisión que el cálculo de vencimiento
-- de metodos_pago en el prompt de pantallas de pago.
CREATE TABLE invitaciones_medico (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email        varchar(200) NOT NULL,
    token        uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    estado       varchar(20) NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente','aceptada','cancelada')),
    -- Lógica, no FK real: quien invita puede ser el admin de clínica
    -- (personas.id) al invitar desde el panel, o la propia persona
    -- recién creada en el registro público (mismo tenant, mismo momento).
    -- Nunca es staff_plataforma acá, pero se mantiene sin constraint por
    -- consistencia con el resto del esquema.
    invitado_por uuid,
    persona_id   uuid REFERENCES personas(id),
    creada_en    timestamptz NOT NULL DEFAULT now(),
    vence_en     timestamptz NOT NULL,
    aceptada_en  timestamptz,
    cancelada_en timestamptz
);

CREATE INDEX idx_invitaciones_medico_tenant ON invitaciones_medico (tenant_id);
CREATE UNIQUE INDEX idx_invitaciones_medico_token ON invitaciones_medico (token);

ALTER TABLE invitaciones_medico ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitaciones_medico FORCE ROW LEVEL SECURITY;
CREATE POLICY invitaciones_medico_isolation ON invitaciones_medico
    USING ((tenant_id)::text = current_setting('app.tenant_id', true));
