import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Revisá tu archivo .env (ver .env.example).`
    );
  }
  return value;
}

export const config = {
  databaseUrl: requireEnv("DATABASE_URL"),
  // Conexión SEPARADA, con un rol de Postgres SIN privilegios de
  // superusuario/dueño de tablas (ver migración de seguridad — leak
  // confirmado en GET /admin/medicos y ~25 endpoints más, todos confiando
  // en RLS que nunca se aplicaba porque `databaseUrl` de arriba conecta
  // como `postgres`, y RLS no rige para superusuarios/dueños). Solo la
  // usa `withTenantClient` (ver middleware/auth.ts) para las queries de
  // cada request ya autenticado — así RLS actúa como red de seguridad
  // real además de los filtros explícitos en cada endpoint. El pool
  // "admin" de arriba se mantiene para los jobs en segundo plano
  // (recorren todos los tenants a propósito, sin `app.tenant_id` seteado)
  // y para la creación de un tenant nuevo en registro.routes.ts (no hay
  // `app.tenant_id` que setear todavía en ese momento).
  tenantDatabaseUrl: requireEnv("TENANT_DATABASE_URL"),
  // Ya no se usa para emitir/validar tokens de sesión (eso ahora lo hace
  // Keycloak) — se mantiene porque POST /api/registro-publico todavía
  // firma un token propio al final del alta self-service (fuera de
  // alcance de esta fase, ver nota en registro.routes.ts).
  jwtSecret: requireEnv("JWT_SECRET"),
  keycloakIssuer: requireEnv("KEYCLOAK_ISSUER"),
  keycloakClientId: requireEnv("KEYCLOAK_CLIENT_ID"),
  // Host:puerto para llegar al JWKS de Keycloak DESDE este proceso backend.
  // Normalmente coincide con el host del issuer, pero en este entorno
  // Docker el issuer dice "localhost:8080" (así lo ve el cliente/navegador
  // que pidió el token) mientras que este proceso necesita el nombre de
  // servicio de Docker ("keycloak:8080") para resolverlo en la red interna
  // — ver docker-compose.yml. Opcional: si no se define, se usa el propio
  // host del issuer (sirve para correr el backend fuera de Docker).
  keycloakJwksHost: process.env.KEYCLOAK_JWKS_HOST || undefined,
  // Admin API de Keycloak — usada para crear usuarios automáticamente
  // desde el backend (alta de clínica, alta de médico) en vez de crearlos
  // a mano en la consola. El client de servicio (confidencial, service
  // account con el rol manage-users de realm-management) se crea
  // manualmente en Keycloak — ver keycloakAdmin.ts.
  keycloakAdminUrl: requireEnv("KEYCLOAK_ADMIN_URL"),
  keycloakServiceClientId: requireEnv("KEYCLOAK_SERVICE_CLIENT_ID"),
  keycloakServiceClientSecret: requireEnv("KEYCLOAK_SERVICE_CLIENT_SECRET"),
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Base para los enlaces DENTRO del cuerpo de los correos transaccionales
  // (invitación de médico, verificación de correo, avisos de purga, etc.
  // — ver correos.ts). Conceptualmente distinta de CORS_ORIGIN (qué
  // orígenes acepta la API) aunque hoy coincidan en valor — en producción
  // pueden diferir (ej. un CDN o dominio distinto sirviendo el frontend).
  // Sin default silencioso: si falta, se usa el mismo fallback de
  // CORS_ORIGIN para no romper los enlaces con "undefined", pero
  // validarFrontendUrlConfigurada() (llamada al arrancar, ver index.ts)
  // lo reporta fuerte en el log — un enlace roto en un correo falla en
  // silencio: el sistema cree que envió, el destinatario no puede actuar.
  frontendUrl: process.env.FRONTEND_URL ?? process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Opcionales a propósito: el usuario las completa después con sus
  // credenciales reales de Stripe (test mode). El backend tiene que poder
  // arrancar sin ellas — las rutas que las necesitan (registro público,
  // uso-facturación, plan, webhook) devuelven un error claro si faltan,
  // en vez de tirar abajo todo el proceso al boot como hace requireEnv.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  // Igual que Stripe: opcional a propósito, el backend arranca sin ella —
  // solo el agente que tenga agentes.system_prompt cargado (hoy: GCIS /
  // Gastroenterología) intenta la llamada real y devuelve un error claro
  // si falta la key en vez de tirar abajo el proceso al boot.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  // Igual que Stripe/Anthropic: opcional a propósito. Sin ella, el job de
  // notificaciones sigue registrando cada aviso en estado 'simulada' (ver
  // migración 019) — nunca tira abajo el proceso al boot.
  resendApiKey: process.env.RESEND_API_KEY,
  // Remitente verificado en Resend. Por defecto usa el dominio de pruebas
  // que Resend habilita sin verificación (sirve para probar el envío real
  // antes de que termine de propagar el DNS de vetlineai.com) — una vez
  // verificado el dominio propio, alcanza con fijar esta env var.
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "VetlineAI <onboarding@resend.dev>",
  // Firma de los webhooks de Resend (Svix) — opcional en dev con el mismo
  // criterio que el resto de este bloque: sin ella, el endpoint acepta
  // cualquier notificación sin verificar autenticidad, con un log fuerte
  // cada vez. Se configura en Resend → Webhooks → el endpoint → "Signing Secret".
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET,
  // Prueba de integración con Tilopay (ver capa-pagos-tilopay.md) — todavía
  // no es la pasarela definitiva, solo el hito de tokenizar+cobrar contra
  // el sandbox. Igual de opcional que Resend/Stripe/Anthropic: sin esto,
  // las rutas de prueba devuelven un error claro en vez de tirar abajo el
  // arranque. tilopayApiKey es la "key" de comercio (Admin → Integración de
  // Plataformas), distinta de apiuser/apipassword.
  tilopayApiKey: process.env.TILOPAY_API_KEY,
  tilopayApiUser: process.env.TILOPAY_API_USER,
  tilopayApiPassword: process.env.TILOPAY_API_PASSWORD,
  tilopayModoPruebas: process.env.TILOPAY_MODO_PRUEBAS === "true",
  // Motor de cobros — secreto compartido para validar la autenticidad del
  // callback público de la pasarela (POST /api/webhooks/pasarela). Opcional
  // en dev por el mismo criterio que el resto de este bloque, pero sin
  // ella el endpoint acepta cualquier notificación — se loguea fuerte cada
  // vez que eso pasa.
  pagosCallbackSecret: process.env.PAGOS_CALLBACK_SECRET,
};

// Mismo patrón que validarCredencialesPaisesHabilitados (pagos/credencialesPasarela.ts)
// — se llama una vez al arrancar (ver index.ts), reporta fuerte y no tumba
// el proceso. Chequea el env var CRUDO, no config.frontendUrl (que ya
// tiene el fallback aplicado) — el objetivo es distinguir "configurada
// explícitamente" de "cayendo en el default", para que ese segundo caso
// no pase desapercibido.
export function validarFrontendUrlConfigurada(): void {
  if (!process.env.FRONTEND_URL) {
    console.error(
      `[config] FRONTEND_URL no está configurada — los enlaces de los correos transaccionales ` +
        `(invitación de médico, verificación de correo, avisos de purga, etc.) están usando el ` +
        `fallback "${config.frontendUrl}". Si ese valor no es el dominio real del frontend, esos ` +
        `enlaces van a estar rotos y nadie se va a enterar hasta que un destinatario reporte que no puede usarlos.`
    );
  }
}
