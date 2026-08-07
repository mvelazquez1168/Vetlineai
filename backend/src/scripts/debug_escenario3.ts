import { pool } from "../db";

async function main() {
  const r = await pool.query(
    `SELECT id, email, correo_verificado_en, correo_rebotado_en, token_verificacion_correo, keycloak_user_id
     FROM personas WHERE email ILIKE '%verifcorreo1%'`
  );
  console.log(r.rows);
  await pool.end();
}
main();
