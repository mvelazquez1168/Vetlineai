// Relevamiento de Paso 1 — prompt_code_verificacion_correo.md. Confirma si
// emailVerified (a diferencia de username) se puede togglear vía Admin
// REST API pese a editUsernameAllowed=false — son campos distintos, pero
// mejor confirmarlo que asumirlo. Usuario descartable, se borra al final.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/relevamiento_keycloak_emailverified.ts
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
  const email = "qa.relevamiento.emailverified@example.com";

  const crear = await fetch(`${config.keycloakAdminUrl}/users`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ username: email, email, enabled: true, emailVerified: false }),
  });
  const id = crear.headers.get("Location")?.split("/").pop();
  console.log("Creado con emailVerified=false, id =", id);

  const put = await fetch(`${config.keycloakAdminUrl}/users/${id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ emailVerified: true }),
  });
  console.log("PUT emailVerified=true status:", put.status);

  const leer = await fetch(`${config.keycloakAdminUrl}/users/${id}`, { headers: auth });
  const usuario = await leer.json();
  console.log("emailVerified tras el PUT:", usuario.emailVerified);

  await fetch(`${config.keycloakAdminUrl}/users/${id}`, { method: "DELETE", headers: auth });
  console.log("Limpiado.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
