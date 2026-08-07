import { Pool } from "pg";
import { config } from "./config";

// Pool "admin" — conecta como `postgres` (dueño de las tablas, bypassea
// RLS). Lo usan los jobs en segundo plano que recorren TODOS los tenants
// a propósito (notificaciones.job.ts, suscripciones.job.ts) y la creación
// de un tenant nuevo en registro.routes.ts. NUNCA lo uses para servir una
// request ya autenticada — para eso está `tenantPool` más abajo.
export const pool = new Pool({
  connectionString: config.databaseUrl,
});

pool.on("error", (err) => {
  // Un cliente inactivo del pool tiró un error inesperado — lo logueamos
  // pero no tumbamos el proceso, el pool se encarga de descartar el cliente.
  console.error("Error inesperado en un cliente inactivo de Postgres", err);
});

// Pool "tenant" — conecta como `vetplatform_app`, un rol SIN privilegios
// de superusuario ni dueño de tablas, así que las políticas RLS
// `*_isolation` sí se aplican de verdad. Lo usa exclusivamente
// `withTenantClient` (ver middleware/auth.ts), que además hace
// `SET LOCAL app.tenant_id` por transacción — entre los dos, RLS queda
// como red de seguridad real, no decorativa, si algún endpoint se olvida
// del filtro explícito por tenant_id.
export const tenantPool = new Pool({
  connectionString: config.tenantDatabaseUrl,
});

tenantPool.on("error", (err) => {
  console.error("Error inesperado en un cliente inactivo de Postgres (tenantPool)", err);
});
