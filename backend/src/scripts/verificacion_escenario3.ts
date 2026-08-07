// Escenario 3 — corregir correo, vía el endpoint HTTP real (login real +
// PUT /api/admin/mi-correo), no la función interna sola.
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificacion_escenario3.ts
import { pool } from "../db";
import { config } from "../config";
import { obtenerTokenParaUsuario } from "../keycloakAdmin";

const EMAIL_ACTUAL = "mvelazquez+verifcorreo1@solutechit.com";
const PASSWORD = "ClaveSegura2026!";
const EMAIL_NUEVO = "mvelazquez+verifcorreo1corregido@solutechit.com";

async function main() {
  console.log("Iniciando sesión real como", EMAIL_ACTUAL, "...");
  const tokens = await obtenerTokenParaUsuario(EMAIL_ACTUAL, PASSWORD);
  console.log("Login OK.");

  const antes = await pool.query(
    `SELECT email, correo_verificado_en, keycloak_user_id FROM personas WHERE email = $1`,
    [EMAIL_ACTUAL]
  );
  console.log("\nAntes:", antes.rows[0]);

  const resp = await fetch("http://localhost:4000/api/admin/mi-correo", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.access_token}` },
    body: JSON.stringify({ email: EMAIL_NUEVO }),
  });
  console.log("\nPUT /api/admin/mi-correo status:", resp.status);
  console.log(await resp.json());

  const despues = await pool.query(
    `SELECT email, correo_verificado_en, correo_rebotado_en, token_verificacion_correo, keycloak_user_id FROM personas WHERE email = $1`,
    [EMAIL_NUEVO]
  );
  console.log("\nDespués (personas, buscado por el correo NUEVO):", despues.rows[0]);

  if (despues.rows[0]?.keycloak_user_id) {
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
    const kcUser = await fetch(`${config.keycloakAdminUrl}/users/${despues.rows[0].keycloak_user_id}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const usuario = await kcUser.json();
    console.log("\nKeycloak tras el cambio:", { username: usuario.username, email: usuario.email, emailVerified: usuario.emailVerified });
  }

  console.log("\nProbando que ahora se puede iniciar sesión con el correo NUEVO...");
  try {
    await obtenerTokenParaUsuario(EMAIL_NUEVO, PASSWORD);
    console.log("=> Login con el correo nuevo: OK.");
  } catch (err) {
    console.log("=> Login con el correo nuevo FALLÓ:", err instanceof Error ? err.message : err);
  }

  console.log("\nProbando que el correo VIEJO ya NO sirve para iniciar sesión...");
  try {
    await obtenerTokenParaUsuario(EMAIL_ACTUAL, PASSWORD);
    console.log("=> Login con el correo viejo: seguía funcionando (inesperado).");
  } catch (err) {
    console.log("=> Login con el correo viejo ya no funciona (esperado).");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
