// Relevamiento de Paso 1 — prompt_code_verificacion_correo.md. Solo lectura
// contra la Admin API de Keycloak, no modifica nada.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/relevamiento_keycloak_verificacion.ts
import { config } from "../config";

async function main() {
  const tokenEndpoint = `${config.keycloakAdminUrl.replace("/admin/realms/", "/realms/")}/protocol/openid-connect/token`;
  const tokenResp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.keycloakServiceClientId,
      client_secret: config.keycloakServiceClientSecret,
    }),
  });
  const { access_token } = (await tokenResp.json()) as { access_token: string };

  const realmResp = await fetch(config.keycloakAdminUrl, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const realm = await realmResp.json();

  console.log("=== editUsernameAllowed ===");
  console.log(realm.editUsernameAllowed);

  console.log("\n=== verifyEmail / registrationEmailAsUsername / loginWithEmailAllowed / duplicateEmailsAllowed ===");
  console.log({
    verifyEmail: realm.verifyEmail,
    registrationEmailAsUsername: realm.registrationEmailAsUsername,
    loginWithEmailAllowed: realm.loginWithEmailAllowed,
    duplicateEmailsAllowed: realm.duplicateEmailsAllowed,
    resetPasswordAllowed: realm.resetPasswordAllowed,
  });

  console.log("\n=== smtpServer ===");
  console.log(JSON.stringify(realm.smtpServer, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
