// Prompt verificación de correo, Paso 0 — habilita editUsernameAllowed en
// el reino, requisito para que Capa 3 (cambiar correo) pueda actualizar el
// username (=email) vía Admin REST API. Confirmado con el usuario que la
// alternativa (borrar y recrear el usuario) no gana nada: cambia
// keycloak_user_id e invalida la sesión igual.
//
// Reejecutable: si ya está en true, no hace nada.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/keycloak_habilitar_edit_username.ts
import { config } from "../config";

const REALM_URL = config.keycloakAdminUrl.replace("/admin/realms/", "/realms/");
const TOKEN_ENDPOINT = `${REALM_URL}/protocol/openid-connect/token`;

async function token(): Promise<string> {
  const r = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.keycloakServiceClientId,
      client_secret: config.keycloakServiceClientSecret,
    }),
  });
  const d = (await r.json()) as { access_token: string };
  return d.access_token;
}

async function main() {
  const t = await token();
  const auth = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };

  const leer = await fetch(config.keycloakAdminUrl, { headers: auth });
  const realm = (await leer.json()) as Record<string, unknown>;
  console.log("editUsernameAllowed actual:", realm.editUsernameAllowed);

  if (realm.editUsernameAllowed === true) {
    console.log("Ya estaba habilitado. Nada que hacer.");
    return;
  }

  const put = await fetch(config.keycloakAdminUrl, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ ...realm, editUsernameAllowed: true }),
  });
  console.log("PUT status:", put.status);

  const releer = await fetch(config.keycloakAdminUrl, { headers: auth });
  const realmActualizado = (await releer.json()) as Record<string, unknown>;
  console.log("editUsernameAllowed ahora:", realmActualizado.editUsernameAllowed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
