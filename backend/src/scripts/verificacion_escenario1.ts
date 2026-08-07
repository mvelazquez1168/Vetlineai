import { pool } from "../db";
import { config } from "../config";

async function main() {
  const persona = await pool.query(
    `SELECT p.id, p.email, p.keycloak_user_id, p.correo_verificado_en, p.token_verificacion_correo,
            p.token_verificacion_expira_en, t.id AS tenant_id, t.credito_prueba_otorgado_en, s.credito_pactado_usd
     FROM personas p
     JOIN tenants t ON t.id = p.tenant_id
     JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE p.email = $1`,
    ["mvelazquez+verifcorreo1@solutechit.com"]
  );
  console.log("=== persona/tenant ===");
  console.log(persona.rows[0]);

  const correo = await pool.query(
    `SELECT tipo, destinatario, resultado, proveedor_message_id, enviado_en FROM correos_enviados
     WHERE destinatario = $1 ORDER BY enviado_en DESC LIMIT 3`,
    ["mvelazquez+verifcorreo1@solutechit.com"]
  );
  console.log("\n=== correos_enviados ===");
  console.table(correo.rows);

  if (persona.rows[0]?.keycloak_user_id) {
    const t = await fetch(
      `${config.keycloakAdminUrl.replace("/admin/realms/", "/realms/")}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.keycloakServiceClientId,
          client_secret: config.keycloakServiceClientSecret,
        }),
      }
    );
    const { access_token } = (await t.json()) as { access_token: string };
    const kcUser = await fetch(`${config.keycloakAdminUrl}/users/${persona.rows[0].keycloak_user_id}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const usuario = await kcUser.json();
    console.log("\n=== Keycloak ===");
    console.log({ username: usuario.username, email: usuario.email, emailVerified: usuario.emailVerified });
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
