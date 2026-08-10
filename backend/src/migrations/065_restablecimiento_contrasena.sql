-- prompt_code_restablecer_contrasena.

-- Tabla dedicada — NO se reutilizan las columnas de token de
-- verificación de correo (personas.token_verificacion_*): son
-- propósitos distintos, y compartirlas haría que pedir uno invalidara
-- el otro. Cubre las tres clases de usuario (médico, admin de clínica,
-- staff de plataforma) con dos FK nulables — exactamente una poblada
-- por fila, mismo patrón que la resolución de operador en
-- movimientos_credito (LEFT JOIN personas / LEFT JOIN staff_plataforma).
--
-- La regla "exactamente una referencia" queda exigida acá, en la base,
-- no solo en el código del módulo que la usa: sin este CHECK, una fila
-- con las dos en NULL o las dos pobladas es perfectamente válida para
-- Postgres, y el defecto aparecería después como un comportamiento raro
-- sin relación aparente con esto.
CREATE TABLE restablecimientos_contrasena (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id  UUID REFERENCES personas(id),
    staff_id    UUID REFERENCES staff_plataforma(id),
    token       UUID NOT NULL DEFAULT gen_random_uuid(),
    expira_en   TIMESTAMPTZ NOT NULL,
    usado_en    TIMESTAMPTZ,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT restablecimientos_contrasena_referencia_exclusiva CHECK (
        (persona_id IS NOT NULL AND staff_id IS NULL) OR
        (persona_id IS NULL AND staff_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_restablecimientos_contrasena_token ON restablecimientos_contrasena(token);
CREATE INDEX idx_restablecimientos_contrasena_persona ON restablecimientos_contrasena(persona_id, creado_en DESC) WHERE persona_id IS NOT NULL;
CREATE INDEX idx_restablecimientos_contrasena_staff ON restablecimientos_contrasena(staff_id, creado_en DESC) WHERE staff_id IS NOT NULL;

-- correos_enviados.tipo — decisión explícita del usuario: eliminar el
-- CHECK, no extenderlo una sexta vez. Ya se extendió cinco veces
-- (migraciones 039, 042, 050, 053/054, 064) y cada una fue un olvido
-- real, no mala suerte. No protege nada relevante: la app nunca puede
-- llamar a enviarCorreoTransaccional con un tipo inválido porque
-- TipoCorreo (correos.ts) ya es la unión cerrada que TypeScript exige en
-- cada call site — el CHECK era redundante con eso. Y en el peor caso,
-- si alguna vez estuvo desalineado, el fallo no era "un registro sucio":
-- enviarCorreoTransaccional inserta tanto en el camino de éxito como en
-- el de fallo (correos.ts, ambos parametrizan tipo) — un tipo nuevo sin
-- migrar podía hacer que INCLUSO el insert que registra el fallo del
-- envío violara el CHECK, escalando un error ya manejado a una excepción
-- sin capturar. De acá en más, tipo es texto libre; TipoCorreo sigue
-- siendo la única fuente de verdad real.
ALTER TABLE correos_enviados DROP CONSTRAINT correos_enviados_tipo_check;
