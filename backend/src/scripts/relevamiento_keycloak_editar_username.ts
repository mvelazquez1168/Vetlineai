// Relevamiento de Paso 1 — prompt_code_verificacion_correo.md. Prueba
// EMPÍRICA (no solo leer el flag editUsernameAllowed): crea un usuario
// descartable en Keycloak y trata de cambiarle el username vía Admin REST
// API, para saber si la restricción del realm también aplica ahí o solo
// a las consolas de usuario/admin. Borra el usuario al final.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/relevamiento_keycloak_editar_username.ts
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

  const emailOriginal = "qa.relevamiento.username@example.com";
  const emailNuevo = "qa.relevamiento.username.nuevo@example.com";

  console.log("Creando usuario descartable...");
  const crear = await fetch(`${config.keycloakAdminUrl}/users`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      username: emailOriginal,
      email: emailOriginal,
      firstName: "QA",
      lastName: "Relevamiento",
      enabled: true,
      emailVerified: true,
    }),
  });
  if (!crear.ok) {
    console.error("No se pudo crear:", crear.status, await crear.text());
    process.exit(1);
  }
  const id = crear.headers.get("Location")?.split("/").pop();
  console.log("Creado, id =", id);

  console.log("\nIntentando PUT username+email nuevos vía Admin REST API...");
  const put = await fetch(`${config.keycloakAdminUrl}/users/${id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ username: emailNuevo, email: emailNuevo }),
  });
  console.log("PUT status:", put.status, put.ok ? "" : await put.text().catch(() => ""));

  const leer = await fetch(`${config.keycloakAdminUrl}/users/${id}`, { headers: auth });
  const usuario = await leer.json();
  console.log("\nUsuario tras el PUT:");
  console.log({ username: usuario.username, email: usuario.email });
  console.log(
    usuario.username === emailNuevo
      ? "\n=> RESULTADO: el Admin REST API SÍ pudo cambiar el username, pese a editUsernameAllowed=false."
      : "\n=> RESULTADO: el username NO cambió — editUsernameAllowed=false también bloquea al Admin REST API."
  );

  console.log("\nLimpiando...");
  await fetch(`${config.keycloakAdminUrl}/users/${id}`, { method: "DELETE", headers: auth });
  console.log("OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
