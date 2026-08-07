// Agrega la IP de la red local a las Redirect URIs y Web Origins del
// client público "vetplatform-web" en Keycloak, conservando las de
// localhost — necesario para que el navegador del teléfono pueda
// autenticar (prompt_code_optimizacion_contexto / bloque LAN, pedido
// explícito del usuario 2026-08-07).
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/agregar_redirect_uri_lan.ts
import { config } from "../config";

const REALM_URL = config.keycloakAdminUrl.replace("/admin/realms/", "/realms/");
const TOKEN_ENDPOINT = `${REALM_URL}/protocol/openid-connect/token`;
const NUEVA_URI_REDIRECT = "http://192.168.100.94:5174/*";
const NUEVO_ORIGEN_WEB = "http://192.168.100.94:5174";

async function tokenServicio(): Promise<string> {
  const r = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.keycloakServiceClientId,
      client_secret: config.keycloakServiceClientSecret,
    }),
  });
  if (!r.ok) {
    throw new Error(`No se pudo obtener el token de servicio (HTTP ${r.status}): ${await r.text()}`);
  }
  const d = (await r.json()) as { access_token: string };
  return d.access_token;
}

async function main() {
  const token = await tokenServicio();
  const auth = { Authorization: `Bearer ${token}` };

  const clientsResp = await fetch(`${config.keycloakAdminUrl}/clients?clientId=${config.keycloakClientId}`, {
    headers: auth,
  });
  if (!clientsResp.ok) {
    console.error(`No se pudo listar el client (HTTP ${clientsResp.status}):`, await clientsResp.text());
    process.exit(1);
  }
  const clients = (await clientsResp.json()) as any[];
  const cliente = clients[0];
  if (!cliente) {
    console.error(`No se encontró el client "${config.keycloakClientId}"`);
    process.exit(1);
  }

  console.log("=== Antes ===");
  console.log("redirectUris:", cliente.redirectUris);
  console.log("webOrigins:", cliente.webOrigins);

  const redirectUris: string[] = Array.isArray(cliente.redirectUris) ? cliente.redirectUris : [];
  const webOrigins: string[] = Array.isArray(cliente.webOrigins) ? cliente.webOrigins : [];

  const nuevoRedirectUris = redirectUris.includes(NUEVA_URI_REDIRECT)
    ? redirectUris
    : [...redirectUris, NUEVA_URI_REDIRECT];
  const nuevoWebOrigins = webOrigins.includes(NUEVO_ORIGEN_WEB) ? webOrigins : [...webOrigins, NUEVO_ORIGEN_WEB];

  if (nuevoRedirectUris.length === redirectUris.length && nuevoWebOrigins.length === webOrigins.length) {
    console.log("\nYa estaban agregadas — nada que hacer.");
    process.exit(0);
  }

  const putResp = await fetch(`${config.keycloakAdminUrl}/clients/${cliente.id}`, {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...cliente,
      redirectUris: nuevoRedirectUris,
      webOrigins: nuevoWebOrigins,
    }),
  });

  if (!putResp.ok) {
    console.error(`\nFALLÓ el PUT (HTTP ${putResp.status}):`, await putResp.text());
    console.error(
      "\nProbablemente el service account no tiene el rol manage-clients de realm-management " +
        "(hoy solo tiene manage-users, según el comentario en keycloakAdmin.ts) — hay que agregarlo " +
        "en la consola de Keycloak antes de reintentar, o hacer este cambio a mano ahí."
    );
    process.exit(1);
  }

  const verifResp = await fetch(`${config.keycloakAdminUrl}/clients/${cliente.id}`, { headers: auth });
  const clienteVerificado = (await verifResp.json()) as any;
  console.log("\n=== Después (confirmado con un GET real) ===");
  console.log("redirectUris:", clienteVerificado.redirectUris);
  console.log("webOrigins:", clienteVerificado.webOrigins);

  const ok =
    clienteVerificado.redirectUris.includes(NUEVA_URI_REDIRECT) &&
    clienteVerificado.webOrigins.includes(NUEVO_ORIGEN_WEB) &&
    redirectUris.every((u) => clienteVerificado.redirectUris.includes(u)) &&
    webOrigins.every((o) => clienteVerificado.webOrigins.includes(o));

  console.log(`\n${ok ? "TODO OK — se agregó la IP de red y se conservaron las de localhost" : "HAY UN PROBLEMA — revisar arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
