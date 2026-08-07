# Inventario 4 — Stack y configuración

## Versiones

| Componente | Versión |
|---|---|
| Node.js (backend y frontend) | 20 (`node:20-alpine`, ambos `Dockerfile` de desarrollo) |
| TypeScript | ^5.5.3 (backend y frontend) |
| React | ^18.3.1 |
| PostgreSQL | 17 — **externo al `docker-compose.yml` de este proyecto**, corre en un contenedor propio (`postgres17`) en la red compartida `postgres_default`. Este repo no lo levanta ni lo versiona. |

Keycloak (autenticación) es igualmente **externo** — no aparece en `docker-compose.yml`, se asume corriendo en la misma red `postgres_default` con alias `keycloak`, puerto 8080. Su reino, clientes y roles se configuran a mano en la consola (ver comentarios en `backend/src/keycloakAdmin.ts`); no hay export/import versionado del reino en este repo.

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
| `@stripe/react-stripe-js` + `@stripe/stripe-js` | ^2.8.0 / ^4.5.0 | **Sin uso real** — no hay ningún `import` de ninguno de los dos en `frontend/src`. Resto muerto del flujo de registro con Stripe, reemplazado por Tilopay. `VITE_STRIPE_PUBLISHABLE_KEY` (definida en `docker-compose.yml`) tampoco se lee en ningún lado del código actual — candidatos a eliminar los dos paquetes y la env var. |

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
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | No | Modelo de facturación anterior. Sin ellas, esas rutas devuelven un error claro en vez de tumbar el arranque. |
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
| `VITE_STRIPE_PUBLISHABLE_KEY` | — | Definida en `docker-compose.yml` pero **no se lee en ningún archivo del frontend** — ver dependencias muertas arriba. |

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
| `npm run dev` | `ts-node-dev --respawn --transpile-only src/index.ts` — desarrollo, hot reload. **Es el único camino usado hoy** (el `Dockerfile` de backend corre `npm run dev`, no hay imagen de producción). |
| `npm run build` | `tsc -p tsconfig.json` — compila a `dist/`. No hay ningún `Dockerfile` ni pipeline que lo use todavía. |
| `npm run start` | `node dist/index.js` — asume que `build` ya corrió. Sin uso real hoy (no hay imagen de producción que lo invoque). |
| `npm run migrate` | Aplica **todas** las migraciones de `src/migrations/` en orden, siempre desde la 001. **No es incremental** — reintenta migraciones ya aplicadas, lo que falla contra cualquiera que no sea idempotente (la mayoría no lo son). En la práctica, las migraciones nuevas de esta sesión se aplicaron a mano, una por una, con scripts descartables en `src/scripts/` — ver el relevamiento de reproducibilidad del ambiente (memoria de proyecto, fuera de este inventario) para el detalle completo de esta brecha. |
| `npm run seed` | `ts-node --transpile-only src/seed/seed.ts` — datos de ejemplo de desarrollo (tenant, agentes, usuarios, casos). No toca `system_prompt` de agentes ni contenido real de la Base de Conocimiento — eso vive solo en la base viva (mismo relevamiento). |

### Frontend (`frontend/package.json`)

| Comando | Qué hace |
|---|---|
| `npm run dev` | `vite` — servidor de desarrollo. Único camino usado hoy (`Dockerfile` corre esto). |
| `npm run build` | `tsc -b && vite build` — build de producción. Sin pipeline que lo consuma todavía. |
| `npm run preview` | Sirve el build de producción localmente. Sin uso documentado. |

### Docker

| Comando | Qué hace |
|---|---|
| `docker compose up --build` | Levanta `backend` + `frontend` (ambos en modo desarrollo, hot reload vía volumen montado). Asume que Postgres y Keycloak ya están corriendo en la red externa `postgres_default`. |
| `docker compose exec backend npm run seed` | Siembra datos de ejemplo contra la base ya migrada. |
| `docker compose down` | Baja los dos servicios. |

**No hay comando ni Dockerfile de producción real** (build multi-stage, `npm run build` + `npm run start`) — ambos `Dockerfile` están marcados explícitamente como "imagen de DESARROLLO" en su propio comentario de cabecera. Es una brecha real: el camino a producción todavía no existe en este repo.

**El `README.md` del repo está desactualizado** — describe una "Fase 1" sin Keycloak ("JWT propio, NO Keycloak todavía"), sin motor de crédito, sin motor de cobros, sin la mayoría de los módulos que hoy son el grueso del sistema. Las instrucciones de arranque que sí describe (crear la base a mano, aplicar `001_init.sql`) tampoco reflejan que Postgres y Keycloak hoy son contenedores externos en una red compartida, ni que hay 40 migraciones más después de la 001. Vale la pena reescribirlo — hoy induce a error a cualquiera que lo siga literalmente.
