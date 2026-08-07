-- =====================================================================
-- VetPlatform — Migración 047
-- prompt_code_expediente_y_propietario
--
-- PARTE A — Número de expediente consecutivo por clínica. Un solo
-- contador por tenant (expediente_ultimo_numero) — SIN una columna de
-- inicio separada: configurar el inicio es un UPDATE de esa misma
-- columna a (inicio - 1), decisión del usuario tras señalar que la
-- columna de inicio era derivable y sobraba. El registro de que se
-- configuró un salto vive en la bitácora de auditoría (ver
-- expediente.ts::configurarInicioExpediente), no en una columna de
-- estado acá.
-- =====================================================================

ALTER TABLE tenants ADD COLUMN expediente_ultimo_numero integer NOT NULL DEFAULT 0;
ALTER TABLE casos ADD COLUMN numero_expediente integer;

-- Backfill de los casos existentes: por clínica, en orden de creación,
-- empezando en 1 (ninguna clínica real tenía numeración previa que
-- migrar en este momento).
DO $backfill$
DECLARE
    fila_tenant RECORD;
    fila_caso   RECORD;
    contador    integer;
BEGIN
    FOR fila_tenant IN SELECT DISTINCT tenant_id FROM casos LOOP
        contador := 0;
        FOR fila_caso IN
            SELECT id FROM casos WHERE tenant_id = fila_tenant.tenant_id ORDER BY creado_en ASC
        LOOP
            contador := contador + 1;
            UPDATE casos SET numero_expediente = contador WHERE id = fila_caso.id;
        END LOOP;
        UPDATE tenants SET expediente_ultimo_numero = contador WHERE id = fila_tenant.tenant_id;
    END LOOP;
END $backfill$;

ALTER TABLE casos ALTER COLUMN numero_expediente SET NOT NULL;
ALTER TABLE casos ADD CONSTRAINT casos_numero_expediente_unico UNIQUE (tenant_id, numero_expediente);

-- =====================================================================
-- PARTE B — Identificación del propietario. Mismo patrón exacto que
-- tenants.tipo_identificacion_id/numero_identificacion (migración 024)
-- — reusa el catálogo tipos_identificacion, no crea uno nuevo. Ambos
-- opcionales; el CHECK evita el estado a medias (tipo sin número, o
-- número sin tipo) que la sola restricción de unicidad no atrapa,
-- porque en Postgres cada fila con NULL en una UNIQUE se considera
-- distinta de las demás.
-- =====================================================================

ALTER TABLE propietarios ADD COLUMN tipo_identificacion_id uuid REFERENCES tipos_identificacion(id);
ALTER TABLE propietarios ADD COLUMN numero_identificacion  varchar(60);

ALTER TABLE propietarios ADD CONSTRAINT propietarios_identificacion_ambos_o_ninguno
    CHECK ((tipo_identificacion_id IS NULL) = (numero_identificacion IS NULL));

ALTER TABLE propietarios ADD CONSTRAINT propietarios_identificacion_unica
    UNIQUE (tenant_id, tipo_identificacion_id, numero_identificacion);
