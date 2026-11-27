-- ---------------------------------------------------------------------
-- 170 — QUIÉN COPIÓ EL ENLACE DE UNA INVITACIÓN
--
-- El enlace `/invitacion/:token` es una CREDENCIAL: quien lo tenga crea
-- la cuenta de esa persona, con sus roles, en esta clínica. Hasta ahora
-- solo viajaba por correo. Poder copiarlo desde la pantalla es
-- necesario —en desarrollo el correo es simulado y es el único camino
-- para completar el alta—, pero copiar una credencial tiene que dejar
-- rastro.
--
-- POR QUÉ UNA TABLA Y NO UNA COLUMNA en `invitaciones_medico`: se puede
-- copiar muchas veces, y «la última vez» no sirve para la pregunta real
-- («¿quién tuvo este enlace?»). Una columna borraría las copias
-- anteriores cada vez.
--
-- SE LEE DESDE LA AUDITORÍA, no desde una pantalla propia: es una fuente
-- más de `clinica/auditoria.ts`, como las políticas o los precios. La
-- regla del prompt 11 es consolidar la lectura, no crear registros
-- paralelos.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invitacion_enlace_copiado (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invitacion_id UUID NOT NULL REFERENCES invitaciones_medico(id) ON DELETE CASCADE,
  -- Quién lo copió. Sin FK dura por el mismo motivo que
  -- `invitaciones_medico.invitado_por` (030): puede ser personal de la
  -- clínica o, en el registro, la persona recién creada.
  persona_id    UUID REFERENCES personas(id) ON DELETE SET NULL,
  ip            INET,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitacion_enlace_copiado_invitacion_idx
  ON invitacion_enlace_copiado (invitacion_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS invitacion_enlace_copiado_tenant_idx
  ON invitacion_enlace_copiado (tenant_id, creado_en DESC);

-- No se edita. El DELETE queda libre para que el borrado de la clínica
-- pueda cascadear (mismo criterio que la migración 169 y el defecto
-- D-006: un trigger que prohíbe borrar traba la purga).
CREATE OR REPLACE FUNCTION invitacion_enlace_copiado_no_se_edita() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invitacion_enlace_copiado no se edita: es constancia de que alguien tuvo la credencial.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invitacion_enlace_copiado_inmutable ON invitacion_enlace_copiado;
CREATE TRIGGER invitacion_enlace_copiado_inmutable
  BEFORE UPDATE ON invitacion_enlace_copiado
  FOR EACH ROW EXECUTE FUNCTION invitacion_enlace_copiado_no_se_edita();

ALTER TABLE invitacion_enlace_copiado ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitacion_enlace_copiado FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitacion_enlace_copiado_tenant ON invitacion_enlace_copiado;
CREATE POLICY invitacion_enlace_copiado_tenant ON invitacion_enlace_copiado
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
