# Configuración manual del reino Keycloak (`Vetplatform`)

Este archivo existe porque parte de la configuración de Keycloak vive **solo en el
servidor**, no en ningún archivo versionado — si el ambiente se levanta de nuevo en
otro servidor, nadie va a recordar reaplicarla. Mismo problema que el relevado para
`system_prompt`/`tarifas_modelo` (ver memoria de sesión "reproducibilidad"), aplicado
acá a la configuración del reino de Keycloak.

No se resuelve acá el problema de fondo (automatizar la creación del reino) — eso
queda pendiente, igual que la consolidación de semillas. Este archivo es la
constancia mínima de qué hay que reaplicar a mano y por qué.

## Qué se configura a mano y dónde

| Config | Dónde se hace | Por qué no está en código |
|---|---|---|
| Cliente de servicio `vetplatform-backend-service` (confidencial, service account con rol `manage-users` de `realm-management`) | Consola Keycloak → Clients | Se crea una vez por ambiente; sus credenciales van a `docker-compose.yml` (`KEYCLOAK_SERVICE_CLIENT_ID`/`SECRET`), pero el cliente en sí no se recrea por código. |
| Cliente público `vetplatform-web` | Consola Keycloak → Clients | Igual que arriba — flujo de Direct Access Grant habilitado para el login. |
| Roles de realm `VETERINARIO` / `ADMIN` / `SUPER_ADMIN` | Consola Keycloak → Realm roles | `keycloakAdmin.ts` los asigna por nombre, pero no los crea. |
| **`editUsernameAllowed = true`** | Configuración del reino (`Realm Settings`) | Ver abajo — cambiado el 2026-08-06 vía Admin REST API, prompt de verificación de correo. |

## Cambio del 2026-08-06 — `editUsernameAllowed`

Por defecto el reino tenía `editUsernameAllowed = false`. Se confirmó **empíricamente**
(no solo leyendo el flag) que esa restricción también bloquea al Admin REST API, no
solo a las consolas de usuario/admin: un intento de `PUT /admin/realms/Vetplatform/users/{id}`
con un `username` distinto devuelve `400 error-user-attribute-read-only`.

Como en este reino `username = email` siempre (ver `crearUsuarioKeycloak` en
`backend/src/keycloakAdmin.ts`), sin este flag es imposible que un administrador
corrija su correo (Capa 3 del prompt de verificación de correo) sin borrar y
recrear el usuario de Keycloak — lo cual cambia `personas.keycloak_user_id` e
invalida la sesión igual, sin ganar nada.

**Se habilitó `editUsernameAllowed = true`** vía `PUT /admin/realms/Vetplatform`
(script re-corrible: `backend/src/scripts/keycloak_habilitar_edit_username.ts`).

### El flag habilita la capacidad — el control es de la aplicación

Con `editUsernameAllowed = true`, cualquier punto que exponga edición de usuario
en Keycloak (incluida la propia consola de administración de Keycloak, si alguien
con acceso a ella edita usuarios a mano) *podría* cambiar el username de cualquiera.
La aplicación es la que restringe **quién** puede hacerlo y **cuándo**: solo
`PUT /api/admin/mi-correo`, solo el administrador de clínica autenticado, y solo
sobre su propio registro (`personas.id` del token, nunca un `id` recibido por
parámetro). No hay ningún otro endpoint que exponga cambio de username/email de
Keycloak — ver `backend/src/verificacionCorreo.ts`.

### Si el ambiente se levanta en otro servidor

Reaplicar corriendo (una vez, contra el reino nuevo):

```bash
docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/keycloak_habilitar_edit_username.ts
```

Es idempotente — si ya está en `true`, no hace nada.

## Snapshot de referencia (no autoritativo, solo para comparar)

Tomado el 2026-08-06 vía `GET /admin/realms/Vetplatform`, solo los campos relevantes
para reproducibilidad (se omite todo lo demás del export completo a propósito, para
no versionar nada que pueda incluir un secreto):

```json
{
  "editUsernameAllowed": true,
  "verifyEmail": false,
  "registrationEmailAsUsername": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": false,
  "smtpServer": {}
}
```

`verifyEmail: false` y `smtpServer: {}` son intencionales — la verificación de
correo del administrador NO usa el flujo nativo de Keycloak (que requeriría
configurar su propio SMTP, una segunda reputación de dominio para mantener). Usa
Resend con un módulo propio (`backend/src/verificacionCorreo.ts`) y sincroniza el
flag `emailVerified` de cada usuario a mano cuando corresponde — ver ese archivo.
