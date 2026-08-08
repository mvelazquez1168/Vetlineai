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
| `npm run migrate` | Aplica **todas** las migraciones de `src/migrations/` en orden, siempre desde la 001. **No es incremental** — reintenta migraciones ya aplicadas, lo que falla contra cualquiera que no sea idempotente (la mayoría no lo son). En la práctica, las migraciones nuevas de esta sesión se aplicaron a mano, una por una, con scripts descartables en `src/scripts/` — ver el relevamiento de reproducibilidad del ambiente (memoria de proyecto, fuera de este inventario) para el detalle completo de esta brecha. |
| `npm run seed` | `ts-node --transpile-only src/seed/seed.ts` — datos de ejemplo de desarrollo (tenant, agentes, usuarios, casos). No toca `system_prompt` de agentes ni contenido real de la Base de Conocimiento — eso vive solo en la base viva (mismo relevamiento). |

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

**No corrido todavía** — construido y verificado por partes (cada imagen compila y arranca sola, `docker compose ... config` valida la composición completa sin levantar contenedores) pero la composición completa contra Postgres/Keycloak/S3 reales queda pendiente de una verificación explícita, a pedido del usuario, antes de correrla.

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
4. Crear el usuario `SUPER_ADMIN` inicial de la plataforma (no viene en el export — el primer acceso a Platform Admin se crea a mano, una vez, igual que cualquier bootstrap de reino nuevo).

**El `README.md` del repo está desactualizado** — describe una "Fase 1" sin Keycloak ("JWT propio, NO Keycloak todavía"), sin motor de crédito, sin motor de cobros, sin la mayoría de los módulos que hoy son el grueso del sistema. Las instrucciones de arranque que sí describe (crear la base a mano, aplicar `001_init.sql`) tampoco reflejan que Postgres y Keycloak hoy son contenedores externos en una red compartida, ni que hay 40 migraciones más después de la 001. Vale la pena reescribirlo — hoy induce a error a cualquiera que lo siga literalmente.
