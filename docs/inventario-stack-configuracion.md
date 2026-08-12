# Inventario 4 — Stack y configuración

## Versiones

| Componente | Versión |
|---|---|
| Node.js (backend y frontend) | 20 (`node:20-alpine`, ambos `Dockerfile` de desarrollo) |
| TypeScript | ^5.5.3 (backend y frontend) |
| React | ^18.3.1 |
| PostgreSQL | 17 — **externo al `docker-compose.yml` de este proyecto**, corre en un contenedor propio (`postgres17`) en la red compartida `postgres_default`. Este repo no lo levanta ni lo versiona. |

Keycloak (autenticación) es igualmente **externo** — no aparece en `docker-compose.yml`, se asume corriendo en la misma red `postgres_default` con alias `keycloak`, puerto 8080. Su reino, clientes y roles se configuran a mano en la consola (ver comentarios en `backend/src/keycloakAdmin.ts`). Hay un respaldo real del reino (`kc.sh export --users`, no versionado en git) en `keycloak-realm/Vetplatform-realm.json` — ver `## Keycloak — secretos, respaldo y restauración` más abajo.

## Dependencias principales — backend (`backend/package.json`)

| Paquete | Versión | Para qué se usa |
|---|---|---|
| `express` | ^4.19.2 | Framework HTTP. |
| `pg` | ^8.12.0 | Cliente de Postgres (sin ORM — ver `README.md` para la justificación original). |
| `@anthropic-ai/sdk` | ^0.115.0 | Llamadas al modelo (chat clínico, Dashboard, Informe, validación de recetas) + Files API. |
| `jsonwebtoken` + `jwks-rsa` | ^9.0.2 / ^3.2.2 | Verificación de la firma RS256 del JWT de Keycloak contra su JWKS. |
| `bcrypt` | ^5.1.1 | Hash de contraseñas (las que este backend sigue generando para el auto-login post-registro/invitación). |
| `stripe` | ^16.12.0 | Solo lo usa el modelo de facturación **anterior** (`stripe.ts`, `webhooks.routes.ts` → `/stripe`, `jobs/suscripciones.job.ts` desactivado). El motor de cobros vigente usa Tilopay, no Stripe. |
| `resend` | ^4.0.1 | Envío de correos transaccionales. |
| `svix` | ^1.99.1 | Verificación de firma de los webhooks de Resend. |
| `docx` | ^9.7.1 | Ensamblado del Informe Clínico (.docx). |
| `pdfkit` | ^0.19.1 | Generación del PDF de recetas. |
| `pdf-parse` + `mammoth` | ^2.4.5 / ^1.12.0 | Extracción de texto de PDF/DOCX de la Base de Conocimiento (`lib/extraccion.ts`). |
| `moment-timezone` | ^0.5.45 | Resolución de zonas horarias por país (nunca offsets a mano). |
| `multer` | ^2.2.0 | Subida de archivos multipart (casos, documentos de conocimiento, logo). |
| `node-cron` | ^4.6.0 | Los 3 trabajos programados vigentes (ver Inventario 3). |
| `archiver` | ^8.0.0 | Empaquetado zip de la exportación de datos de una clínica. |
| `@napi-rs/canvas-linux-x64-musl` | ^0.1.80 | Dependencia nativa de `pdf-parse` para renderizar páginas (target Alpine/musl, coherente con la imagen `node:20-alpine`). |

Dev: `ts-node-dev` (hot reload), `ts-node` (scripts/seed), `typescript`, más los `@types/*` correspondientes.

## Dependencias principales — frontend (`frontend/package.json`)

| Paquete | Versión | Para qué se usa |
|---|---|---|
| `react` / `react-dom` | ^18.3.1 | UI. |
| `react-router-dom` | ^6.24.1 | Ruteo. |
| `react-markdown` + `remark-gfm` | ^10.1.0 / ^4.0.1 | Renderizado del texto del chat clínico (Markdown/GFM). |

`@stripe/react-stripe-js` + `@stripe/stripe-js` — **eliminados 2026-08-08** (preparación del despliegue a producción). No tenían ningún `import` real en `frontend/src`, resto muerto del flujo de registro con Stripe reemplazado por Tilopay; `VITE_STRIPE_PUBLISHABLE_KEY` se eliminó junto con ellos. El backend conserva `stripe` como dependencia (`stripe.ts`, `webhooks.routes.ts` siguen existiendo) — es una deuda distinta, no cerrada: ver `## Producción — qué cambia respecto de desarrollo` sobre por qué esas variables igual no viajan al ambiente de producción.

Dev: `vite`, `@vitejs/plugin-react`, `tailwindcss` + `postcss` + `autoprefixer`, `typescript`.

## Variables de entorno

Sin valores — solo nombre, propósito y si el arranque las exige.

### Backend

| Variable | Obligatoria al arrancar | Propósito |
|---|---|---|
| `DATABASE_URL` | **Sí** (`requireEnv`, tira el proceso si falta) | Pool admin — conecta como owner de las tablas, sin RLS. |
| `TENANT_DATABASE_URL` | **Sí** | Pool tenant — rol sin privilegios, RLS real. |
| `JWT_SECRET` | **Sí** | Ya no emite/valida tokens de sesión (eso lo hace Keycloak) — se mantiene solo porque el registro público sigue firmando un token propio en un punto puntual. |
| `KEYCLOAK_ISSUER` | **Sí** | El backend acepta un token si su claim `iss` coincide LITERAL (sin normalizar) con este valor **o** con el alias interno de Docker derivado de `KEYCLOAK_JWKS_HOST` (`http://keycloak:8080/realms/Vetplatform`) — ver `ISSUERS_ACEPTADOS` en `middleware/auth.ts`. Los dos existen porque Keycloak estampa el `iss` según el host por el que le llegó la request, no un valor fijo: un token pedido por el propio backend (registro público, auto-login) entra por el alias interno; uno pedido por el navegador entra por `KEYCLOAK_ISSUER`. Sin aceptar ambos, el auto-login del registro público se rechazaba siempre — bug real, ya corregido, no confundir con la config de red local de abajo. |
| `KEYCLOAK_CLIENT_ID` | **Sí** | Client público usado para password grant. |
| `KEYCLOAK_ADMIN_URL` | **Sí** | Base de la Admin API de Keycloak. |
| `KEYCLOAK_SERVICE_CLIENT_ID` | **Sí** | Client de servicio (confidencial) para la Admin API. |
| `KEYCLOAK_SERVICE_CLIENT_SECRET` | **Sí** | Secreto del client de servicio. |
| `KEYCLOAK_JWKS_HOST` | No (opcional, con fallback al host del issuer) | Host:puerto para resolver el JWKS desde dentro de Docker, cuando difiere del issuer visible por el navegador. |
| `PORT` | No (default `4000`) | Puerto HTTP del backend. |
| `CORS_ORIGIN` | No (default `http://localhost:5173`) | Origen permitido por CORS — qué origen puede llamar a la API. En este entorno de desarrollo vale `http://localhost:5174`. |
| `FRONTEND_URL` | No, con fallback a `CORS_ORIGIN` y luego a `http://localhost:5173` — pero validada al arrancar (`validarFrontendUrlConfigurada()`, `console.error` si falta, sin tumbar el proceso) | Base de los enlaces DENTRO del cuerpo de los correos transaccionales (invitación de médico, verificación de correo, avisos de purga, cambio de plan, etc. — ver `correos.ts`). Conceptualmente distinta de `CORS_ORIGIN`: `CORS_ORIGIN` es qué origen acepta la API, `FRONTEND_URL` es adónde apunta un enlace que alguien va a clickear desde su bandeja de entrada — en producción pueden diferir (ej. CDN o dominio distinto). En este entorno de desarrollo vale `http://localhost:5174` — quedó como variable propia (ese fue el arreglo de fondo) aunque hoy coincide en valor con `CORS_ORIGIN`. Ejemplo de producción: `https://app.vetlineai.com`. |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | No | Modelo de facturación anterior. Sin ellas, esas rutas devuelven un error claro en vez de tumbar el arranque. **No se definen en producción** (`docker-compose.prod.yml`) — el job que las necesitaba de verdad (`jobs/suscripciones.job.ts`) se borró 2026-08-08; lo que queda de Stripe en el código (`stripe.ts`, `webhooks.routes.ts`) sigue existiendo pero no corre nada real sin estas tres. |
| `ALMACENAMIENTO_PROVEEDOR` | No (default `local`) | `local` (filesystem del contenedor, solo dev — se pierde en cada reinicio) o `s3` (cualquier proveedor compatible con la API de S3 — ver `almacenamiento/`). **Producción siempre usa `s3`.** |
| `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET_PRIVADO` / `S3_BUCKET_PUBLICO` / `S3_URL_PUBLICA_BASE` | **Sí, pero solo si `ALMACENAMIENTO_PROVEEDOR=s3`** (`almacenamiento/index.ts` valida y tira un error explícito al primer uso si falta alguna — no al arrancar el proceso, para no exigirlas en dev con el proveedor local) | Credenciales y nombres de los dos buckets (privado/público — ver `almacenamiento/tipos.ts` sobre por qué son dos separados). No definidas en desarrollo. |
| `ANTHROPIC_API_KEY` | No | Sin ella, cualquier endpoint que llame al modelo devuelve un error claro (`requerirAnthropic()`), el resto del backend arranca igual. |
| `RESEND_API_KEY` | No | Sin ella, los correos quedan registrados como no enviados/simulados, nunca tumba el arranque. |
| `RESEND_FROM_EMAIL` | No (default `VetlineAI <onboarding@resend.dev>`) | Remitente verificado. |
| `RESEND_WEBHOOK_SECRET` | No | Sin ella, `POST /api/webhooks/resend` acepta cualquier notificación sin validar firma (con log de advertencia en cada request). |
| `TILOPAY_API_KEY` / `TILOPAY_API_USER` / `TILOPAY_API_PASSWORD` | No | PoC de Tilopay (rutas de prueba). |
| `TILOPAY_MODO_PRUEBAS` | No (default `false`) | — |
| `PASARELA_<ISO>_API_KEY` / `_API_USER` / `_API_PASSWORD` (ej. `PASARELA_CR_API_KEY`) | **No exigida al arrancar, pero validada y reportada** | Credenciales de pasarela por país — un trío por cada país habilitado. No usa `requireEnv` (no están en `config.ts`, se leen directo por `credencialesPasarela.ts`), pero `validarCredencialesPaisesHabilitados()` corre al final del arranque y **loguea un `console.error` explícito** (sin tumbar el proceso) listando qué países habilitados quedaron sin credenciales. |
| `PAGOS_CALLBACK_SECRET` | No | Sin ella, `POST /api/webhooks/pasarela` acepta cualquier notificación sin validar firma (mismo criterio que `RESEND_WEBHOOK_SECRET`). |

### Frontend (Vite — prefijo `VITE_`, todas opcionales con fallback embebido en el código, ninguna validada)

| Variable | Fallback si falta | Propósito |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000/api` | Base de la API. **Se compila DENTRO del bundle** que sirve Vite — cambiar esta variable sin recrear el contenedor `frontend` (no solo reiniciarlo) deja el JS servido con el valor viejo. En este entorno de desarrollo vale `http://localhost:4000/api`. |
| `VITE_KEYCLOAK_ISSUER` | `http://localhost:8080/realms/Vetplatform` | Issuer de Keycloak visible desde el navegador — mismo cuidado que `VITE_API_URL` (se compila en el bundle, hace falta recrear el contenedor). En este entorno de desarrollo vale `http://localhost:8080/realms/Vetplatform` y coincide con `KEYCLOAK_ISSUER` del backend. |
| `VITE_KEYCLOAK_CLIENT_ID` | `vetplatform-web` | Client público de Keycloak. |

`VITE_STRIPE_PUBLISHABLE_KEY` — **eliminada 2026-08-08** junto con las dependencias de Stripe del frontend (ver arriba); no se leía en ningún archivo.

**En producción estas tres variables NO se compilan en el bundle** — a diferencia de dev (donde Vite las resuelve en `npm run build`/`npm run dev` y quedan fijas hasta reconstruir), la imagen de producción (`frontend/Dockerfile.prod`) genera `env-config.js` en cada arranque del contenedor a partir de las variables de entorno reales (`docker-entrypoint.sh` + `env-config.js.template`, vía `envsubst`) y `runtimeEnv.ts` las lee de `window.__ENV__` antes de caer a `import.meta.env`. Una misma imagen sirve para cualquier ambiente — no hace falta reconstruir para cambiar `VITE_API_URL`, solo recrear el contenedor con otro valor.

## Puertos

| Servicio | Puerto contenedor | Puerto host (`docker-compose.yml`) |
|---|---|---|
| `backend` | 4000 | 4000 |
| `frontend` (Vite dev server) | 5173 | 5174 |
| PostgreSQL (`postgres17`, externo) | 5432 (asumido) | No publicado por este `docker-compose.yml` — pertenece a otro compose. |
| Keycloak (externo) | 8080 (asumido, por `KEYCLOAK_ISSUER`/`KEYCLOAK_ADMIN_URL`) | Igual, fuera de este repo. |

## Desarrollo con acceso desde la red local — ALTERNATIVA, NO ACTIVA

**Estado real: probada, funcionaba a nivel de código (bundle, CORS, headers), pero el router de esta red aísla los dispositivos entre sí — así que nunca permitió abrir nada desde un teléfono real.** Queda documentada para el día que se pruebe en una red sin aislamiento de clientes (router distinto, o una red doméstica normal), no para uso inmediato. La config activa hoy es la de la sección de arriba (`localhost` en las 5 variables).

Motivo original (no cosmético): el flujo de invitación de médicos manda un correo con un enlace, y el veterinario invitado lo toca desde su teléfono — si ese enlace apunta a `localhost`, apunta al propio teléfono y nunca llega a este backend. Autenticarse contra Keycloak desde ese mismo teléfono agrega dos variables más al conjunto.

| Variable | Servicio | Valor a usar (si se retoma) | Por qué tiene que ser ESE valor |
|---|---|---|---|
| `FRONTEND_URL` | `backend` | `http://<IP-de-red>:5174` | Es lo que queda escrito dentro del correo — tiene que ser una dirección que el teléfono pueda resolver. `localhost` ahí resolvería contra el propio teléfono. |
| `CORS_ORIGIN` | `backend` | `http://<IP-de-red>:5174` | Es el origen que la API acepta. Tiene que coincidir EXACTO con el origen real desde el que el navegador (del teléfono o de esta máquina) sirve las peticiones. |
| `VITE_API_URL` | `frontend` | `http://<IP-de-red>:4000/api` | Es la URL que el JS del frontend usa para llamar a la API. Queda cableada en el bundle que se le sirve al navegador — si dice `localhost`, el teléfono intenta hablar consigo mismo. |
| `KEYCLOAK_ISSUER` | `backend` | `http://<IP-de-red>:8080/realms/Vetplatform` | El backend acepta un token si su `iss` coincide LITERAL con este valor **o** con el alias interno de Docker (ver la fila de `KEYCLOAK_ISSUER` en la tabla principal) — no hay normalización de ningún tipo. Tiene que coincidir EXACTO con `VITE_KEYCLOAK_ISSUER`, porque es el navegador el que determina qué `iss` termina en el token. |
| `VITE_KEYCLOAK_ISSUER` | `frontend` | `http://<IP-de-red>:8080/realms/Vetplatform` | Adónde apunta el navegador para pedirle el token a Keycloak (Direct Access Grant, sin redirect — ver `keycloakAuth.ts`). Si no coincide con `KEYCLOAK_ISSUER` del backend, Keycloak igual emite el token — es el backend el que lo rechaza después. |

**No confundir con `KEYCLOAK_JWKS_HOST` y `KEYCLOAK_ADMIN_URL`** (ambas en `backend`): NO son parte de este bloque y NO deben apuntar a la IP de red — resuelven desde DENTRO de la red de contenedores Docker (alias `keycloak:8080`), donde la IP del host no aplica.

**Lección operativa real, no anticipada la primera vez**: `VITE_API_URL`/`VITE_KEYCLOAK_ISSUER` se compilan DENTRO del bundle que Vite sirve — cambiar la variable en `docker-compose.yml` no alcanza, hace falta recrear el contenedor `frontend` (`docker compose up -d --force-recreate frontend`, no solo `restart`), o el JS servido sigue trayendo el valor viejo. Esto fue, literalmente, la causa de que el login empezara a fallar incluso desde `localhost` en un momento de esta sesión — el bundle todavía traía la IP de red mientras el resto de la config ya había cambiado.

**Motivo del abandono**: el router de esta red aplica aislamiento de clientes (client/AP isolation) — los dispositivos conectados no se ven entre sí aunque compartan la misma IP de red y el mismo SSID. Confirmado indirectamente: todo lo verificable por código (bundle con la IP correcta, headers CORS correctos, tokens de Keycloak con el `iss` esperado) pasó — lo único que nunca se pudo confirmar fue la conexión real desde un teléfono, que es exactamente lo que ese tipo de aislamiento bloquea. Revertido a pedido explícito del usuario.

Si se retoma en una red sin este aislamiento, dos pasos adicionales necesarios (no se automatizaron, quedan documentados):

- **Cliente de Keycloak**: el client público `vetplatform-web` necesita `http://<IP-de-red>:5174/*` en Redirect URIs válidas y `http://<IP-de-red>:5174` en Web Origins (conservando las de `localhost`). Se intentó automatizar vía la Admin API (`backend/src/scripts/agregar_redirect_uri_lan.ts`, mismo mecanismo que `keycloakAdmin.ts`) y **falló con HTTP 403**: la service account (`vetplatform-backend-service`) solo tiene el rol `manage-users` de `realm-management`, nunca tuvo `view-clients`/`manage-clients`. Opción A: otorgar el rol (Clients → `vetplatform-backend-service` → Service Account Roles → Assign role → `realm-management` → `manage-clients`) y correr el script. Opción B: hacerlo a mano en Clients → `vetplatform-web` → Settings.
- **Firewall de Windows**: el perfil de red activo de este host es `Public` (más restrictivo por defecto) y no hay regla de entrada explícita para 4000/5174/8080 — solo la genérica de "Docker Desktop Backend". Correr como administrador:
  ```powershell
  New-NetFirewallRule -DisplayName "VetPlatform dev LAN (4000,5174,8080)" -Direction Inbound -Protocol TCP -LocalPort 4000,5174,8080 -Action Allow
  ```

**Verificado real cuando estuvo activo** (`backend/src/scripts/verificar_lan_completo.ts`, 8/8 aserciones para `FRONTEND_URL`/`CORS_ORIGIN`/`VITE_API_URL`; verificación manual por `curl` desde el host para `KEYCLOAK_ISSUER`/`VITE_KEYCLOAK_ISSUER`, con el mismo POST que hace el navegador contra Keycloak): el bundle traía la IP cableada, los headers CORS eran correctos, y el token real que emitía Keycloak con `iss=IP-de-red` era aceptado por el backend. Todo el camino de código funcionaba — el bloqueo era exclusivamente de red.

## Comandos de operación

### Backend (`backend/package.json`)

| Comando | Qué hace |
|---|---|
| `npm run dev` | `ts-node-dev --respawn --transpile-only src/index.ts` — desarrollo, hot reload. Usado por el `Dockerfile` de desarrollo (`docker-compose.yml`). |
| `npm run build` | `tsc -p tsconfig.build.json` — compila a `dist/`, **excluyendo `src/scripts/`** (configuración de compilación propia para producción, separada de `tsconfig.json` que sigue usando dev). Usado por `backend/Dockerfile.prod`. |
| `npm run start` | `node dist/index.js` — asume que `build` ya corrió. Es el `CMD` de `backend/Dockerfile.prod`. |
| `npm run migrate` | `ts-node --transpile-only src/migrate.ts` (dev). Reescrito 2026-08-09 tras el primer despliegue real a AWS — el ejecutor viejo (`node -e` inline) no era incremental (reintentaba desde 001 y chocaba con lo existente) y mandaba cada archivo entero por `pool.query()`, que solo entiende SQL (la migración 025 traía un bloque de verificación con `\echo`, meta-comando de psql, y fallaba ahí). El nuevo `src/migrate.ts` lleva una tabla `schema_migrations` (la crea él mismo si no existe) y solo aplica lo que todavía no está registrada — correrlo de nuevo no reintenta nada. Ver la sección de abajo sobre el backfill que hace falta en cualquier base que ya haya sido migrada con el ejecutor viejo. |
| `npm run migrate:prod` | `node dist/migrate.js` — mismo ejecutor, compilado. Es lo que corre contra el servidor real (`ts-node` no está en la imagen de producción, ver `Dockerfile.prod`). |
| `npm run seed` | `ts-node --transpile-only src/seed/seed.ts` — datos de ejemplo de desarrollo (tenant, agentes, usuarios, casos). No toca `system_prompt` de agentes ni contenido real de la Base de Conocimiento — eso vive solo en la base viva (mismo relevamiento). |
| `npm run seed:plataforma:prod` | `node dist/seed/seedPlataforma.js` — el sembrado de plataforma (tarifas/agentes/documentos/alias de raza, ver `backend/src/seed/seedPlataforma.ts`), compilado. Mismo motivo que `migrate:prod`: `ts-node` no está en la imagen de producción — `npm run seed:plataforma` (con ts-node) solo sirve en dev. Los archivos `.json`/`.txt` que lee siguen siendo accesibles desde `dist/seed/seedPlataforma.js` porque `Dockerfile.prod` los copia a `dist/seed/plataforma` en el mismo lugar donde `path.join(__dirname, "plataforma")` los busca una vez compilado. |
| `npm run crear-admin-plataforma[:prod]` | Crea el primer `super_admin` de plataforma (Keycloak + fila en `staff_plataforma`, vinculados). Ver la sección "Primer administrador de plataforma" más abajo — no existía ningún procedimiento documentado para esto hasta el primer despliegue real a AWS. |

### Frontend (`frontend/package.json`)

| Comando | Qué hace |
|---|---|
| `npm run dev` | `vite` — servidor de desarrollo. Usado por el `Dockerfile` de desarrollo. |
| `npm run build` | `tsc -b && vite build` — build de producción, genera `dist/` (assets con hash de contenido + `sw.js`/`workbox-*.js` de vite-plugin-pwa). Usado por `frontend/Dockerfile.prod`. |
| `npm run preview` | Sirve el build de producción localmente. Sin uso documentado — la imagen de producción usa nginx, no esto. |

### Docker

| Comando | Qué hace |
|---|---|
| `docker compose up --build` | Levanta `backend` + `frontend` (ambos en modo desarrollo, hot reload vía volumen montado). Asume que Postgres y Keycloak ya están corriendo en la red externa `postgres_default`. |
| `docker compose exec backend npm run seed` | Siembra datos de ejemplo contra la base ya migrada. |
| `docker compose down` | Baja los dos servicios. |
| `docker compose -f docker-compose.prod.yml --env-file .env.prod up --build` | Composición de **producción** — ver la sección siguiente. |

## Producción — qué cambia respecto de desarrollo

Preparado 2026-08-08. Los `Dockerfile` de desarrollo (`backend/Dockerfile`, `frontend/Dockerfile`) y `docker-compose.yml` **no se tocaron** — siguen siendo el camino de día a día. Producción es un juego de archivos aparte:

| Archivo | Reemplaza / agrega |
|---|---|
| `backend/Dockerfile.prod` | Build multi-stage (`npm ci` con dev deps → `npm run build` → imagen final solo con deps de producción), usuario `node` sin privilegios, `HEALTHCHECK` sobre `GET /api/health`, apagado ordenado (`CMD` en forma exec — ver `index.ts`, maneja `SIGTERM`/`SIGINT`). |
| `frontend/Dockerfile.prod` | Build multi-stage (`vite build` → nginx sirviendo `dist/`). `nginx.conf`: gzip, caché `immutable` de 1 año solo para `/assets/*` (con hash de contenido), `Cache-Control: no-cache` explícito en `sw.js`/`env-config.js`/`index.html`. `docker-entrypoint.sh` genera `env-config.js` en cada arranque (ver la nota de `VITE_*` más arriba). |
| `docker-compose.prod.yml` | Imágenes construidas (nunca código montado), Caddy como único servicio con puertos publicados al host (80/443, certificados TLS automáticos), Keycloak en modo producción (`start`, no `start-dev`) con su propia base de datos, `restart: unless-stopped` + `mem_limit`/`mem_reservation` en los 4 servicios. La base de datos de la aplicación **no está en este archivo** — es una base administrada aparte, igual que en dev (`DATABASE_URL`/`TENANT_DATABASE_URL` apuntan afuera). |
| `Caddyfile` | Ruteo: `/api/*` y `/uploads/*` → `backend`, resto → `frontend`; un segundo dominio → `keycloak`. TLS automático nativo de Caddy, sin config adicional. |
| `.env.prod.example` | Plantilla de las variables que exige `docker-compose.prod.yml` — **sin valores reales**. Copiar a `.env.prod` (ya cubierto por el patrón `.env.*` de `.gitignore`) y completar ahí, nunca en el compose. |

**Variables nuevas, solo en producción**: `ALMACENAMIENTO_PROVEEDOR=s3` + los 7 `S3_*` (ver la tabla de variables del backend más arriba), y del lado de Keycloak: `KC_DB_URL`/`KC_DB_USERNAME`/`KC_DB_PASSWORD` (su base propia), `KC_HOSTNAME_STRICT_HTTPS`, `KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD` (usuario admin inicial del reino).

**Variables que desaparecen en producción**: las tres `STRIPE_*` del backend (ver nota en la tabla) y las dependencias/variable de Stripe del frontend, ya eliminadas del código.

**Primer despliegue real a AWS: 2026-08-09** (Virginia del Norte, `app.vetlineai.com`, una instancia administrada con dos bases — app y Keycloak — más un bucket de almacenamiento). Las 60 migraciones y las 62 tablas resultantes llegaron bien; el sembrado de plataforma y la conexión cifrada a la base no, por 4 brechas reales que no aparecían en dev (todas corregidas el mismo día — ver los cambios en `backend/src/migrate.ts`, `backend/package.json`, `backend/Dockerfile.prod` y esta sección):

1. **`npm run seed:plataforma` invocaba `ts-node`**, que no está en la imagen de producción (`npm ci --omit=dev`). Usar `npm run seed:plataforma:prod` (`node dist/seed/seedPlataforma.js`) — ver la tabla de comandos más arriba.
2. **El ejecutor de migraciones mandaba cada archivo con `pool.query()`**, que solo entiende SQL — la migración 025 traía un bloque de verificación con `\echo` (meta-comando de psql, no SQL) y fallaba ahí. Se sacó ese bloque del archivo, y el ejecutor nuevo (`src/migrate.ts`) rechaza de entrada cualquier migración que vuelva a traer algo así, señalando el archivo exacto en vez de fallar a mitad de camino.
3. **No llevaba registro de lo aplicado** — reintentaba todo desde 001 en cada corrida. `src/migrate.ts` crea y usa una tabla `schema_migrations` (filename + fecha) para aplicar solo lo pendiente. **Backfill necesario en cualquier base que ya haya sido migrada con el ejecutor viejo** (la de este despliegue, por ejemplo) — antes de volver a correr `migrate:prod` ahí, hay que registrar como ya aplicadas las migraciones que efectivamente ya corrieron, si no el ejecutor nuevo va a intentar reaplicarlas y va a chocar con lo que ya existe:
   ```sql
   CREATE TABLE IF NOT EXISTS schema_migrations (
     filename    text PRIMARY KEY,
     applied_at  timestamptz NOT NULL DEFAULT now()
   );
   INSERT INTO schema_migrations (filename)
   SELECT unnest(ARRAY[
     '001_init.sql','002_accesos_paises_conocimiento.sql','003_i18n_paises_zona_horaria.sql',
     '004_cancelacion_suscripcion.sql','005_planes_stripe_uso_api.sql','006_documentos_legales.sql',
     '007_agentes_especialidad.sql','008_casos_medico_agente.sql','009_razas.sql',
     '010_limite_uso_notificaciones.sql','011_keycloak_auth.sql','012_facturacion_eventos.sql',
     '013_agentes_system_prompt.sql','014_archivos_file_id_anthropic.sql','015_dashboard_cache.sql',
     '016_receta_medica.sql','017_agenda_citas.sql','018_informes_generados.sql',
     '019_notificaciones.sql','020_notificaciones_leida.sql','021_rename_vetline_ai.sql',
     '022_pagos_tilopay.sql','023_eventos_facturacion_referencia_generica.sql','024_facturacion_estructura.sql',
     '025_facturacion_datos.sql','026_tarifas_modelo_facturable.sql','027_flujos_suscripcion_purga.sql',
     '028_ajuste_admin_saldo.sql','029_registro_prueba.sql','030_invitaciones_medico.sql',
     '031_colegiatura_medico_obligatoria.sql','032_regla_contexto_caso_agentes.sql','033_tarifa_cache_escritura_1h.sql',
     '034_mensajes_tipo.sql','035_mensajes_incorporada.sql','036_correos_transaccionales.sql',
     '037_motor_cobros.sql','038_invitacion_medico_nombre.sql','039_verificacion_correo.sql',
     '040_trial_medicos_incluidos.sql','041_estados_agentes_paises.sql','042_correos_cobro.sql',
     '043_raza_no_coincidente_log.sql','044_razas_alias_documento.sql','045_rls_correos_purga_razas_log.sql',
     '046_consumo_agregado_purga.sql','047_expediente_y_propietario.sql','048_drop_tabla_informes_muerta.sql',
     '049_notificaciones_completar.sql','050_correos_enviados_tipo_notificaciones.sql','051_suspension_bloqueo_cierre.sql',
     '052_suspension_manual_no_autoreactiva.sql','053_notificaciones_uso_cierre_por_impago.sql','054_correos_enviados_tipo_suspension_bloqueo.sql',
     '055_notificaciones_pendientes.sql','056_espera_pago_cambios_suscripcion.sql','057_desparasitacion_paciente_estado_cumpleanos.sql',
     '058_indice_citas_caso.sql','059_documentos_conocimiento_contenido_contexto.sql','060_proveedor_ia_estado.sql'
   ])
   ON CONFLICT (filename) DO NOTHING;
   ```
   Ajustar la lista si en el momento de correrlo ya existen migraciones más nuevas que 060 — solo deben quedar registradas las que **realmente** ya se aplicaron en esa base, nunca de más (eso las saltearía sin haberlas corrido).

   **Este backfill es parte de introducir el ejecutor nuevo en CUALQUIER ambiente que ya tenía migraciones aplicadas a mano (el método viejo), no un paso exclusivo del despliegue a producción** — es fácil leerlo así porque acá se descubrió ahí, pero el ambiente de dev tenía el mismo problema y pasó desapercibido varios días: `schema_migrations` se creó vacía pese a que las 65 migraciones previas ya estaban aplicadas, así que `npm run migrate` intentaba reaplicar la 001 y chocaba con `relation "tenants" already exists`. Backfill de dev hecho el 2026-08-12 (66 migraciones, hasta `066_mensajes_autor.sql` inclusive — ver esa migración para el contexto). Si se clona el repo contra una base ya migrada por otra vía, o se recupera un volumen/snapshot de antes de que `src/migrate.ts` existiera, hay que correr este mismo backfill ahí antes del primer `npm run migrate` — chequear con `SELECT count(*) FROM schema_migrations;` contra `ls backend/src/migrations/*.sql | wc -l` si hay dudas de si ya se hizo.
4. **El backend no cifraba la conexión a la base** — sin manejo de SSL en `db.ts`/`config.ts`, sorteado al momento con `sslmode=require&uselibpqcompat=true` en las cadenas de conexión (funciona porque `pg` ≥ 8.16 soporta parseo de parámetros al estilo libpq bajo ese flag — confirmado contra la versión real instalada, `pg` 8.22.0 / `pg-connection-string` 2.14.0). Sin `sslrootcert`, `require` cifra pero **no valida la autoridad certificadora** — protege contra un espionaje pasivo del tráfico, no contra que algo se haga pasar por la base (un MITM activo dentro de la red). Cerrado agregando el paquete de certificados raíz de RDS a la imagen (`Dockerfile.prod` lo descarga en cada build, no se versiona — es público y AWS rota sus CAs de tanto en tanto) y pasando a `sslmode=verify-full` (valida cadena de confianza *y* que el hostname del certificado coincide con el endpoint real):
   ```
   DATABASE_URL=postgres://usuario:pass@host:5432/vetplatform?uselibpqcompat=true&sslmode=verify-full&sslrootcert=/etc/vetplatform/rds-global-bundle.pem
   TENANT_DATABASE_URL=postgres://vetplatform_app:pass@host:5432/vetplatform?uselibpqcompat=true&sslmode=verify-full&sslrootcert=/etc/vetplatform/rds-global-bundle.pem
   ```
   No hace falta tocar `db.ts`/`config.ts`/`seedPlataforma.ts`/`migrate.ts`: `pg-connection-string` lee `sslrootcert` del disco por su cuenta al parsear la cadena de conexión (confirmado en su código fuente real, no en la documentación), así que alcanza con que el archivo exista en la imagen en esa ruta. Aplica igual a la base de Keycloak (`KC_DB_URL`) si la instancia administrada exige TLS ahí también — Keycloak tiene su propio mecanismo de trust store, fuera del alcance de este inventario.

**Composición completa verificada contra Postgres/Keycloak/S3 reales**: sí, en este mismo despliegue — los 4 puntos de arriba son justamente lo que apareció al hacerlo por primera vez contra servicios administrados reales en vez de contenedores locales.

## Keycloak — secretos, respaldo y restauración

### Rotación del secreto de `vetplatform-backend-service`

El client de servicio (confidencial, service account con rol `manage-users` de `realm-management` — ver `backend/src/keycloakAdmin.ts`) es el único consumidor de `KEYCLOAK_SERVICE_CLIENT_SECRET`. Ese secreto quedó expuesto en texto claro dos veces al inspeccionar `keycloak-realm/Vetplatform-realm.json` (2026-08-08) — hay que rotarlo antes de producción.

**Dónde se regenera:** consola de Keycloak → reino `Vetplatform` → Clients → `vetplatform-backend-service` → pestaña Credentials → botón "Regenerate secret" (equivalente por API: `POST /admin/realms/Vetplatform/clients/{id}/client-secret`, autenticado como un admin real — no con el propio client de servicio, que no tiene permiso sobre sí mismo). Keycloak no permite elegir el valor nuevo ni mantener el viejo en paralelo — la regeneración invalida el secreto anterior al instante, sin período de gracia.

**Qué actualizar:** la variable `KEYCLOAK_SERVICE_CLIENT_SECRET` —
- Dev: `docker-compose.yml`, servicio `backend`.
- Producción: `.env.prod` (nunca en `docker-compose.prod.yml` directamente).

**Qué reiniciar:** solo el `backend` — es el único servicio que lee esta variable (`config.ts` la carga una sola vez al arrancar el proceso, vía `requireEnv`; no hay hot-reload de variables de entorno). En producción, `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend` (recrea el contenedor porque el entorno resuelto cambió — un `restart` simple no relee `.env.prod`). Keycloak mismo no necesita reiniciarse: la regeneración actualiza su propia base al toque.

**Ventana de corte esperada:** entre regenerar en Keycloak y que el `backend` levante con el valor nuevo, cualquier flujo que dependa de la Admin API de Keycloak (alta de usuario en el registro público, aceptación de una invitación de médico) va a fallar con `invalid_client` — es el comportamiento esperado, no un bug. No afecta sesiones ya activas ni el login en sí (eso pasa por `vetplatform-web`, un client distinto, sin secreto). Conviene rotar en una ventana de baja actividad, o aceptar ese margen corto.

**Cuándo rotar — las dos cosas, no una u otra:**
1. **Ahora, en dev**, para verificar el procedimiento completo (regenerar → actualizar `.env`/`docker-compose.yml` → recrear el contenedor → confirmar que el registro público o una invitación de médico todavía crea el usuario en Keycloak) en un ambiente sin costo si algo sale mal, y para que el secreto hoy expuesto deje de ser válido en cualquier lado.
2. **De nuevo, al configurar producción**, con un secreto propio generado ahí — nunca reutilizando el de dev, ni siquiera si el de dev ya estuviera rotado y "limpio". Dev y producción no deberían compartir nunca un secreto vivo, independientemente de si hubo una exposición — es higiene básica de separación de ambientes, no una reacción puntual a este incidente.

### Respaldo y restauración del reino

**Mecanismo recurrente: la base de datos propia de Keycloak** (`KC_DB_URL` en producción — ver la tabla de variables nuevas de producción). Todo lo que importa (usuarios, credenciales, claves de firma, secretos de client, roles, flujos) vive ahí — un `kc.sh export` es una foto derivada de esa base, nunca al revés. Respaldarla con el mismo criterio que ya se usa para la base de la aplicación (`pg_dump`/`pg_basebackup` + WAL) tiene una ventaja operativa real sobre el export: se toma en caliente, sin parar Keycloak. `kc.sh export` en cambio está pensado para correr con el servidor sin tráfico activo — sin eso no hay garantía de que la foto sea consistente contra escrituras concurrentes, así que como mecanismo recurrente exige una ventana de mantenimiento cada vez.

**El export (`kc.sh export --users realm_file`, `keycloak-realm/Vetplatform-realm.json`) queda como foto puntual**, útil para tres casos concretos, no como respaldo periódico:
- Verificar que un respaldo de base efectivamente reconstruye un reino funcional (probarlo importándolo aparte, sin tocar el reino real).
- Portar el reino a un motor de base distinto.
- Bootstrapear un reino nuevo desde cero (el uso que ya se le dio en la verificación del Paso 6 de este despliegue).

Confirmado por inspección directa del archivo real (no de la documentación de Keycloak): a diferencia del `partial-export` vía Admin REST API (que masca los secretos de client y nunca exporta usuarios bajo ninguna combinación de flags), este mecanismo (`kc.sh export --users`) sí trae usuarios completos con credencial real (argon2), las claves de firma RSA/HMAC/AES en claro dentro de `components["org.keycloak.keys.KeyProvider"]`, y los secretos de client sin enmascarar. Es un respaldo genuino, no una plantilla — pero exactamente por eso, el archivo nunca debe versionarse en git (ya está en `.gitignore` vía `keycloak-realm/`) ni circular fuera de un canal seguro.

**Restauración:** `kc.sh import --file /ruta/al/realm_file --override true` (o el mismo archivo en el directorio de importación automática con `--import-realm` al arrancar, mismo mecanismo usado en la verificación del Paso 6) reconstruye el reino completo, usuarios y claves incluidos, contra una instancia de Keycloak nueva o vacía.

### Bootstrap del reino en un servidor de producción nuevo

El export de dev (`Vetplatform-realm.json`) **no sirve tal cual** para esto — trae los 33 usuarios de desarrollo, el secreto viejo del client de servicio y las claves de firma reales de dev en claro (ver arriba). Pero tampoco tiene sentido armar la config de producción a mano aparte: la config real (los 9 clients, los roles, los 21 flujos de autenticación, el atributo de perfil `tenant_id`, `editUsernameAllowed`) vive en ese export, y mantenerla escrita a mano en otro archivo la desincroniza en silencio apenas alguien cambie algo en dev y se olvide de replicarlo.

La solución adoptada: **derivarla con un script versionado**, no escribirla a mano.

- **`keycloak-realm/generar-realm-produccion.js`** (versionado en git — es código, sin secretos): lee `Vetplatform-realm.json` y produce `Vetplatform-realm-produccion.json` quitando exactamente tres cosas y reemplazando una:
  - `users`: vacío (producción arranca sin clínicas, igual que la base de datos — ver la sección de sembrado de plataforma).
  - `components["org.keycloak.keys.KeyProvider"]`: se borra el componente entero. Son las claves de firma RSA/HMAC/AES reales de dev en texto claro — nunca deben viajar a producción. Al importar un reino sin este componente, Keycloak genera claves nuevas solas (mismo mecanismo que al crear cualquier reino desde cero).
  - El campo `secret` del client `vetplatform-backend-service`: se borra. Es el secreto viejo de dev. Sin ese campo, Keycloak genera uno nuevo al crear el client — mismo mecanismo que "Regenerate secret" en la consola.
  - `webOrigins`/`redirectUris`/`rootUrl`/`adminUrl`/`baseUrl` del client `vetplatform-web`: de las URLs de desarrollo (`localhost:5174`, la IP de LAN) a `https://app.vetlineai.com` (por parámetro: `node generar-realm-produccion.js https://otro-dominio` si hiciera falta otro).

  Todo lo demás — roles, grupos, `clientScopes`, los 21 `authenticationFlows`, `authenticatorConfig`, `requiredActions`, el atributo de perfil `tenant_id` (vive en `components["org.keycloak.userprofile.UserProfileProvider"]`), `editUsernameAllowed` — se copia tal cual del export real, sin tocar. `kc.sh import` está pensado para aceptar un export completo como mecanismo de restauración/bootstrap, y dev/producción son instancias de Keycloak completamente separadas, así que no hay riesgo de colisión de ids entre ambas.

- **`keycloak-realm/Vetplatform-realm-produccion.json`**: el resultado ya derivado, también versionado — es el artefacto que se importa en el servidor nuevo, no hace falta tener a mano el export de dev (con datos reales de usuarios) para levantar producción. Verificado por inspección directa tras generarlo: 0 usuarios, sin el componente `KeyProvider`, sin el campo `secret` en `vetplatform-backend-service`, `vetplatform-web` apuntando a `https://app.vetlineai.com`, los 21 flujos y los 7 roles de realm intactos.

  Volver a correr el script (y commitear el `.json` resultante) cada vez que cambie a propósito algo estructural en el reino de dev — un client nuevo, un flujo nuevo, un atributo de perfil nuevo — para que el archivo de producción no quede desactualizado.

`.gitignore` se ajustó de `keycloak-realm/` (toda la carpeta) a `keycloak-realm/Vetplatform-realm.json` (solo el export de dev con datos reales) — es lo único de esa carpeta que no debe versionarse; el script y el archivo derivado sí, porque no contienen usuarios, secretos ni claves de firma reales.

**Procedimiento en el servidor nuevo:**
1. `kc.sh import --file /ruta/Vetplatform-realm-produccion.json` (sin `--override` — es un reino nuevo, no una restauración sobre uno existente) o vía `--import-realm` al arrancar con el archivo en el directorio de importación automática.
2. Consola → reino `Vetplatform` → Clients → `vetplatform-backend-service` → Credentials: confirmar que hay un secreto generado (si por algún motivo no lo hay, "Regenerate secret" desde ahí — mismo procedimiento ya documentado arriba). Copiar ese valor a `KEYCLOAK_SERVICE_CLIENT_SECRET` en `.env.prod`.
3. Confirmar que las claves de firma son nuevas, no las de dev: Consola → Realm settings → Keys — deberían tener `kid` distintos a los del reino de dev.
4. Crear el primer `super_admin` de plataforma — no viene en el export de Keycloak (0 usuarios, a propósito) ni en ninguna semilla de base (`staff_plataforma` arranca vacía). Ver la sección siguiente para el procedimiento completo.

## Primer administrador de plataforma (`staff_plataforma`)

Encontrado real 2026-08-09: producción arrancó con `staff_plataforma` vacía y sin ninguna forma de llenarla — el autoservicio (`POST /api/registro-publico`) solo da de alta clínicas, y no existe ningún endpoint que inserte una fila nueva en `staff_plataforma` (ni siquiera para que un `super_admin` ya logueado invite a otro — ver `docs/inventario-endpoints.md`). Hasta ahora esto se resolvía a mano, una sola vez, dentro de scripts de verificación descartables de esta sesión (`backend/src/scripts/verificar_agentes_paises_v2.ts`, escenario 6) — nunca quedó documentado como procedimiento real.

**Qué hace falta, conceptualmente:** dos partes vinculadas por `keycloak_user_id`, ninguna sirve sola.
- **En Keycloak** (reino `Vetplatform`): un usuario con el rol de **realm** `SUPER_ADMIN`. Sin este rol en el token, el frontend rechaza el login con "Tu usuario no tiene un rol reconocido en Vetline Ai" ANTES de llegar a pedirle nada al backend (`useAuth.tsx` lee `realm_access.roles` del token).
- **En la base de la app**: una fila en `staff_plataforma` con `rol = 'super_admin'` y `keycloak_user_id` apuntando al `sub` de ese usuario. Esto es lo que efectivamente autoriza cada request — `middleware/auth.ts::resolverPrincipal` resuelve `SELECT id, rol FROM staff_plataforma WHERE keycloak_user_id = $1` con el `sub` del token ya validado; sin fila, el backend no reconoce al usuario aunque el login en Keycloak haya funcionado.

`password_hash` (`NOT NULL`, heredada de antes de Keycloak — migración 011) no participa de nada de esto: nunca se lee para autenticar. Cualquier valor la satisface.

**Comando** (agregado esta sesión, ver más abajo por qué convenía): `backend/src/crearAdminPlataforma.ts`, con 3 variables de entorno puestas SOLO para esa corrida (no son variables del servidor, no viven en `.env.prod`):
```bash
ADMIN_PLATAFORMA_EMAIL=admin@vetlineai.com \
ADMIN_PLATAFORMA_NOMBRE="Nombre Apellido" \
ADMIN_PLATAFORMA_PASSWORD='una contraseña real, elegida acá' \
node dist/crearAdminPlataforma.js
```
(`npm run crear-admin-plataforma` con `ts-node` en dev.) Hace exactamente las dos partes de arriba en orden — crea el usuario en Keycloak con `crearUsuarioKeycloak(..., rol: "SUPER_ADMIN")` (mismo helper que ya usan el registro público y la invitación de médicos, sin `tenantId` porque staff no pertenece a ninguna clínica) y después inserta la fila en `staff_plataforma` con ese `keycloak_user_id` — revirtiendo la creación en Keycloak si el `INSERT` llega a fallar, para no dejar un usuario huérfano. Es **idempotente por email**: si ya existe una fila con ese email, no hace nada y lo dice.

**Si hiciera falta a mano en vez de con el comando** (SQL exacto, una vez que el usuario ya existe en Keycloak — Consola → Users → Add user, con el rol de realm `SUPER_ADMIN` asignado en la pestaña Role mapping):
```sql
INSERT INTO staff_plataforma (nombre, email, password_hash, rol, keycloak_user_id)
VALUES ('Nombre Apellido', 'admin@vetlineai.com', 'no-usado-keycloak', 'super_admin', '<sub del usuario en Keycloak>');
```
El `sub` es el `id` que muestra la consola de Keycloak en Users → (el usuario) → arriba del todo, o el último segmento de la URL de esa pantalla.

**¿Conviene que sea un comando versionado en vez de un procedimiento manual?** Sí, y ya quedó así (`backend/src/crearAdminPlataforma.ts` + `npm run crear-admin-plataforma[:prod]`) — por lo mismo que ya se aplicó a migraciones y sembrado en este mismo despliegue: un paso que solo se hace "a mano, una vez" en la práctica se hace distinto cada vez (el propio hallazgo de esta sesión viene de que no había ningún registro de cómo se había hecho antes), y en un incidente real (perder acceso al único `super_admin`) es exactamente el momento en que menos conviene estar reconstruyendo el procedimiento de memoria. Con el comando, además, correrlo dos veces por error no crea un segundo admin ni dos usuarios de Keycloak sueltos.

**Fuera de alcance, anotado a propósito:** esto resuelve el primer `super_admin`. Seguís sin tener forma de agregar un segundo miembro de staff (`soporte` o un `super_admin` adicional) más que repitiendo este mismo comando a mano — no hay ningún endpoint autenticado tipo "invitar staff" (el mismo patrón que ya existe para médicos, `invitaciones_medico`, no tiene equivalente acá). Vale la pena si el equipo de plataforma crece más allá de una persona, pero no se construyó ahora sin que se pida explícitamente.

**El `README.md` del repo está desactualizado** — describe una "Fase 1" sin Keycloak ("JWT propio, NO Keycloak todavía"), sin motor de crédito, sin motor de cobros, sin la mayoría de los módulos que hoy son el grueso del sistema. Las instrucciones de arranque que sí describe (crear la base a mano, aplicar `001_init.sql`) tampoco reflejan que Postgres y Keycloak hoy son contenedores externos en una red compartida, ni que hay 40 migraciones más después de la 001. Vale la pena reescribirlo — hoy induce a error a cualquiera que lo siga literalmente.
