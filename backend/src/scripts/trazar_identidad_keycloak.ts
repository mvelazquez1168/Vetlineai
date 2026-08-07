// Traza la identidad de Keycloak para el médico reportado — atributos del
// usuario + mapeo de protocolo del cliente (para ver si "tenant_id"
// realmente sale en el access_token). Solo lectura.
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/trazar_identidad_keycloak.ts
import { config } from "../config";

const REALM_URL = config.keycloakAdminUrl.replace("/admin/realms/", "/realms/");
const TOKEN_ENDPOINT = `${REALM_URL}/protocol/openid-connect/token`;

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
  const d = (await r.json()) as { access_token: string };
  return d.access_token;
}

function decodificarJwtSinVerificar(token: string): any {
  const payload = token.split(".")[1];
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  return JSON.parse(json);
}

async function main() {
  const t = await tokenServicio();
  const auth = { Authorization: `Bearer ${t}` };
  const keycloakUserId = "10d792f3-cc5a-4ca1-b086-f5dc315b2c8d";

  console.log("=== Usuario en Keycloak (atributos) ===");
  const userResp = await fetch(`${config.keycloakAdminUrl}/users/${keycloakUserId}`, { headers: auth });
  const usuario = await userResp.json();
  console.log({ username: usuario.username, email: usuario.email, attributes: usuario.attributes });

  console.log("\n=== Client público '" + config.keycloakClientId + "' — mappers de protocolo ===");
  const clientsResp = await fetch(`${config.keycloakAdminUrl}/clients?clientId=${config.keycloakClientId}`, {
    headers: auth,
  });
  console.log("status:", clientsResp.status);
  const clients = await clientsResp.json();
  console.log("respuesta cruda:", JSON.stringify(clients).slice(0, 500));
  const clientId = clients[0]?.id;
  console.log("client interno id:", clientId);
  if (!clientId) return;

  const mappersResp = await fetch(`${config.keycloakAdminUrl}/clients/${clientId}/protocol-mappers/models`, {
    headers: auth,
  });
  const mappers = await mappersResp.json();
  console.log(
    "Mappers relevantes (tenant_id / realm roles):",
    mappers
      .filter((m: any) => m.name.toLowerCase().includes("tenant") || m.protocolMapper.includes("usermodel-attribute") || m.protocolMapper.includes("realm-role"))
      .map((m: any) => ({ name: m.name, protocolMapper: m.protocolMapper, config: m.config }))
  );
  console.log("\nTOTAL de mappers en el client:", mappers.length);
  console.log("TODOS los mappers (nombre + tipo):", mappers.map((m: any) => ({ name: m.name, protocolMapper: m.protocolMapper })));

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
