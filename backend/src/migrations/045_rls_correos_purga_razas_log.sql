-- =====================================================================
-- VetPlatform — Migración 045
-- Auditoría de aislamiento multi-tenant (prompt_code_auditoria_tenant):
-- 3 tablas con tenant_id sin RLS. No son el mismo caso, y el usuario dio
-- un criterio distinto para cada una — ver memoria de la sesión
-- (project_vetplatform_auditoria_aislamiento_tenant_2026-08.md).
-- =====================================================================

-- correos_enviados — dato de clínica, política de tenant estándar.
-- Mismo patrón exacto que casos_isolation / uso_api_isolation
-- (confirmado contra pg_policies): tenant_id es NOT NULL acá, y sus
-- escrituras vienen tanto de contexto de clínica (invitaciones,
-- verificación de correo) como de jobs de fondo por `pool` (bypass) —
-- ninguna se rompe con esta política.
ALTER TABLE correos_enviados ENABLE ROW LEVEL SECURITY;
CREATE POLICY correos_enviados_isolation ON correos_enviados
    USING ((tenant_id)::text = current_setting('app.tenant_id'::text, true));

-- clinicas_purgadas_auditoria — NO es dato de clínica: está diseñada para
-- sobrevivir al DELETE del tenant (migración 027, sin FK a propósito) y
-- es evidencia interna de purga que ninguna clínica debería poder leer.
-- Su único punto de escritura (purga.ts::ejecutarPurgas) usa el `pool`
-- con bypass de RLS, nunca `req.db` — así que RLS habilitado SIN ninguna
-- política bloquea por completo el acceso desde `vetplatform_app`
-- (tenant) sin afectar la escritura real del job.
ALTER TABLE clinicas_purgadas_auditoria ENABLE ROW LEVEL SECURITY;

-- razas_sin_coincidencia_log — analítica de plataforma, pero a diferencia
-- de la anterior SÍ se escribe desde contexto de clínica en tiempo real
-- (razaDocumento.ts::registrarSinCoincidencia corre dentro de `req.db`,
-- durante el chat/dashboard/informe/receta). Un lockout total rompería
-- el log en silencio (el catch de la función se come el error sin fallar
-- la request). Se permite el INSERT desde cualquier tenant y se bloquea
-- la lectura — la clínica puede seguir generando el registro, pero no
-- puede leerlo de vuelta.
ALTER TABLE razas_sin_coincidencia_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY razas_sin_coincidencia_log_insert ON razas_sin_coincidencia_log
    FOR INSERT WITH CHECK (true);
