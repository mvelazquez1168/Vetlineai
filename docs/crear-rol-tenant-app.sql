-- =====================================================================
-- Rol restringido para TENANT_DATABASE_URL (vetplatform_app).
--
-- Es el rol que hace que RLS aplique de verdad — ver backend/src/db.ts
-- (tenantPool) y la auditoría de aislamiento multi-tenant
-- (backend/src/scripts/auditoria_aislamiento_tenant.ts, que se conectó
-- directo con este rol para confirmar el aislamiento empíricamente).
-- En dev se creó a mano, sin quedar versionado — este script es esa
-- misma creación, ahora reproducible.
--
-- CÓMO CORRERLO:
--   1. Reemplazar CAMBIAR_ESTA_CONTRASENA por un secreto real generado
--      aparte (ej. `openssl rand -base64 32`) — NUNCA commitear este
--      archivo con la contraseña real puesta. Después de correrlo, esa
--      misma contraseña va en TENANT_DATABASE_URL dentro de .env.prod.
--   2. Conectarse a la base de la app (NO a la de Keycloak) con las
--      credenciales que va a usar DATABASE_URL — el usuario maestro de
--      la instancia. Es imprescindible que sea ESE usuario el que corre
--      este script: la sección de "permisos por defecto" de más abajo
--      solo aplica a las tablas que ese mismo rol cree después — que es
--      exactamente lo que hacen las migraciones (corren con
--      DATABASE_URL).
--   3. Correrlo ANTES de las migraciones. Así, cuando las migraciones
--      creen las tablas, cada una nace con los permisos de
--      vetplatform_app ya aplicados por default — no hace falta re-correr
--      nada después de migrar. (Si por algún motivo se corre DESPUÉS de
--      ya haber migrado, el GRANT explícito sobre "ALL TABLES" más abajo
--      cubre retroactivamente lo que ya existe — pero conviene evitarlo,
--      es una fuente de olvidos innecesaria.)
--
--   psql "postgresql://<usuario_maestro>:<password>@<host>:5432/vetplatform" \
--     -f docs/crear-rol-tenant-app.sql
-- =====================================================================

-- Idempotente: seguro de re-correr si por error se ejecuta dos veces.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vetplatform_app') THEN
    CREATE ROLE vetplatform_app
      WITH LOGIN
      PASSWORD 'CAMBIAR_ESTA_CONTRASENA'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

-- Conexión a la base de la app. Por default Postgres deja que CUALQUIER
-- rol nuevo se conecte a CUALQUIER base del clúster (el pseudo-rol
-- PUBLIC tiene CONNECT en todas) — como esta instancia también aloja la
-- base de Keycloak, vetplatform_app hoy PUEDE conectarse ahí también
-- (sin poder hacer nada útil una vez adentro, no tiene USAGE en su
-- esquema). Si se quiere cerrar del todo, correr aparte, conectado a la
-- base de Keycloak:
--   REVOKE CONNECT ON DATABASE <nombre_db_keycloak> FROM PUBLIC;
-- No incluido acá porque este script se conecta a la base de la app, no
-- a la de Keycloak, y es una decisión de endurecimiento aparte, no algo
-- que este rol necesite para funcionar.
GRANT CONNECT ON DATABASE vetplatform TO vetplatform_app;

GRANT USAGE ON SCHEMA public TO vetplatform_app;

-- Cubre las tablas que YA existan al momento de correr esto (0 si se
-- corre antes de migrar, que es el orden recomendado — ver arriba).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vetplatform_app;

-- Permisos por defecto para las tablas que las migraciones creen DESPUÉS
-- de este punto. Server-side, esto queda asociado al rol que ejecuta
-- este ALTER (current_user) — por eso el paso 2 de arriba es obligatorio:
-- si esto lo corre un rol distinto al que después corre las migraciones,
-- las tablas nuevas NO heredan estos permisos, aunque el rol "parezca"
-- igual de admin.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vetplatform_app;

-- No hace falta nada de secuencias: todas las tablas usan
-- "id UUID PRIMARY KEY DEFAULT gen_random_uuid()" (ver 001_init.sql en
-- adelante) — no hay columnas SERIAL/BIGSERIAL en todo el esquema.
