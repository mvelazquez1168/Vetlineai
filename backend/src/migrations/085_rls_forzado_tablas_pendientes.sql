-- =====================================================================
-- VetPlatform — Migración 085
-- vetline-clinic-01-cimientos-y-ficha-paciente, punto 1.
--
-- Las 7 tablas que tenían RLS HABILITADO pero NO FORZADO pasan a
-- forzado. Con esto la auditoría reforzada (jobs/auditoriaRls.job.ts)
-- queda limpia sin ninguna excepción en el chequeo de "no forzado" — las
-- dos excepciones que quedan son del otro chequeo (tablas sin política).
--
-- QUÉ CAMBIA REALMENTE, medido antes de escribir esto (no deducido de la
-- documentación): hoy NADA. Se probó en la base de desarrollo con una
-- tabla descartable, RLS forzado y la política estándar:
--
--   * como `postgres` (superusuario CON BypassRLS — el rol de
--     DATABASE_URL, el pool admin), el INSERT sin `app.tenant_id` pasó y
--     el SELECT devolvió la fila: FORCE no lo alcanza, porque BypassRLS
--     gana sobre forzar RLS al dueño;
--   * como `vetplatform_app` (el rol de TENANT_DATABASE_URL), el SELECT
--     sin `app.tenant_id` devolvió 0 filas, con FORCE o sin él: no es
--     dueño de la tabla, así que RLS ya se le aplicaba entero.
--
-- O sea que forzar RLS NO puede romper ningún job ni ningún camino que
-- use el pool admin, y tampoco agrega protección hoy. Es defensa en
-- profundidad para el día en que la conexión de la aplicación deje de
-- ser superusuario: ahí FORCE es lo único que impide que el dueño de las
-- tablas se saltee sus propias políticas. Se aplica ahora, cuando es
-- gratis, y no cuando ya haya un segundo backend escribiendo.
--
-- Lo que SÍ habrá que resolver ese día (anotado acá para que no se
-- descubra de nuevo): tres inserciones en `correos_enviados` pasan
-- `tenant_id = NULL` a propósito (restablecerContrasena.ts x2 y
-- saldoProveedorIa.ts — correos que no pertenecen a ninguna clínica), y
-- la política de esa tabla compara `tenant_id` contra `app.tenant_id`,
-- así que una conexión no-superusuario no podría escribirlas. Hoy las
-- tres corren por el pool admin y no se rompen.
-- =====================================================================

-- Dato de clínica, política de tenant estándar. Único grupo de este
-- conjunto que es estrictamente dato de una clínica.
ALTER TABLE atenciones       FORCE ROW LEVEL SECURITY;
ALTER TABLE correos_enviados FORCE ROW LEVEL SECURITY;

-- Heredan el tenant por EXISTS contra su tabla padre, no tienen
-- `tenant_id` propio — por eso la auditoría (que busca la columna
-- `tenant_id`) nunca las vio ni las va a ver. Se fuerzan igual: su
-- política existe y es correcta, lo único que faltaba era que aplicara
-- al dueño.
ALTER TABLE cuidado_preventivo_enfermedades FORCE ROW LEVEL SECURITY;
ALTER TABLE medicamento_dosis_especie       FORCE ROW LEVEL SECURITY;

-- Analítica de plataforma con política SOLO de INSERT (migración 045):
-- cualquier clínica puede escribir el log, ninguna puede leerlo. Forzar
-- no cambia nada hoy (la plataforma lo lee por el pool admin, que
-- bypassea), pero el día que ese pool deje de ser superusuario va a
-- necesitar un rol con BYPASSRLS explícito para leerlo — el mismo
-- pendiente que ya está anotado en platform.routes.ts.
ALTER TABLE razas_sin_coincidencia_log FORCE ROW LEVEL SECURITY;

-- Las dos tablas con RLS habilitado y CERO políticas a propósito
-- (migración 045 y 051): no son dato de clínica, son evidencia interna.
-- `clinicas_purgadas_auditoria` además está diseñada para sobrevivir al
-- DELETE del tenant. Siguen sin política — eso es el bloqueo total que
-- se quería — y ahora el bloqueo también aplica al dueño.
ALTER TABLE clinica_eventos_ciclo_vida  FORCE ROW LEVEL SECURITY;
ALTER TABLE clinicas_purgadas_auditoria FORCE ROW LEVEL SECURITY;
