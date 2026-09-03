import { Pool } from "pg";
import { config } from "./config";

// Pool "admin" — conecta como `postgres` (dueño de las tablas, bypassea
// RLS). Lo usan los jobs en segundo plano que recorren TODOS los tenants
// a propósito (notificaciones.job.ts, suscripciones.job.ts) y la creación
// de un tenant nuevo en registro.routes.ts. NUNCA lo uses para servir una
// request ya autenticada — para eso está `tenantPool` más abajo.
// Los topes viven ACÁ y no en una migración: así valen desde el primer
// arranque, en cualquier base, sin depender de que alguien haya corrido un
// ALTER DATABASE contra el servidor. Es la forma que ya usa Converza
// (packages/db/src/acceso.ts).
//
// `idle_in_transaction_session_timeout` es la red de seguridad de la
// alerta de AWS: una sesión con una transacción abierta y quieta retiene
// bloqueos y congela el horizonte de vacuum, así que las tablas calientes
// se inflan sin que nada falle a la vista.
//
// 10 minutos, y no 15 segundos como Converza, porque todavía quedan rutas
// (dashboard, informe, validación de recetas, registro) donde la
// transacción abarca la llamada externa. A medida que se migren al patrón
// del chat —transacción corta, llamada afuera, transacción corta— este
// número BAJA. Ponerlo bajo antes de migrarlas no corta sesiones colgadas:
// corta requests sanos.
const TOPE_IDLE_EN_TRANSACCION_MS = 600_000;

// Sin esto, `pool.query` con el grupo agotado espera PARA SIEMPRE (el
// default de pg es 0 = sin límite). El request se cuelga en vez de fallar,
// y nada corta esa espera: Caddy reenvía sin timeout de respuesta, así que
// el navegador también se queda colgado. Con un tope, el request falla
// rápido, con un error que queda en el log y un 503 que se puede leer.
//
// El valor queda CÓMODAMENTE POR DEBAJO de los 5 s del `--timeout` del
// HEALTHCHECK de backend/Dockerfile.prod (wget contra /api/health): si
// fuera igual o mayor, el wget se rendiría antes de que la aplicación
// alcance a responder, y el contenedor se marcaría no-sano por timeout en
// vez de por un 503 explicado. 2 s deja 3 s para fallar, registrar y
// contestar. Si alguien toca ese `--timeout`, este número lo sigue.
//
// (Hoy ese estado no-sano no dispara nada — ver DEFECTOS_ABIERTOS.md
// D-003. Igual conviene que sea correcto para cuando alguien lo consuma.)
const TOPE_ESPERA_CONEXION_MS = 2_000;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: TOPE_ESPERA_CONEXION_MS,
  idle_in_transaction_session_timeout: TOPE_IDLE_EN_TRANSACCION_MS,
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
  connectionTimeoutMillis: TOPE_ESPERA_CONEXION_MS,
  idle_in_transaction_session_timeout: TOPE_IDLE_EN_TRANSACCION_MS,
});

tenantPool.on("error", (err) => {
  console.error("Error inesperado en un cliente inactivo de Postgres (tenantPool)", err);
});
