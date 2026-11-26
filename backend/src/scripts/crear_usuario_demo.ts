// Crea un usuario DESECHABLE de demostración (admin de clínica) en
// Keycloak y en `personas`, con una contraseña conocida.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/crear_usuario_demo.ts <tenantId> <email> <password> "<nombre>"
//
// Existe para no tener que tocar la contraseña de un usuario que ya
// usa alguien: restablecer credenciales ajenas "para probar" ya rompió
// un acceso real una vez. Un usuario nuevo y descartable no le quita el
// acceso a nadie.
//
// Nace como admin de clínica y NO como médico (`es_medico = false`): así
// no consume un cupo de médico ni necesita número de colegiatura, y
// igual alcanza para ver las pantallas de gestión, que admiten tanto a
// `medico` como a `admin_clinica`.
//
// Es re-corrible: si el usuario ya existe, lo borra de Keycloak y de la
// base antes de volver a crearlo, así la contraseña que imprime es
// siempre la que sirve.
import bcrypt from "bcrypt";
import { pool } from "./../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak } from "../keycloakAdmin";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

async function main() {
  exigirEntornoDeDesarrollo("crear_usuario_demo");

  const [tenantId, email, password, nombre] = process.argv.slice(2);
  if (!tenantId || !email || !password || !nombre) {
    console.error(
      'Uso: npx ts-node --transpile-only src/scripts/crear_usuario_demo.ts <tenantId> <email> <password> "<nombre>"'
    );
    process.exit(1);
  }

  const t = await pool.query<{ nombre: string }>(`SELECT nombre FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  if (t.rows.length === 0) {
    console.error(`No existe ninguna clínica con el id ${tenantId}.`);
    process.exit(1);
  }

  const previo = await pool.query<{ id: string; keycloak_user_id: string | null }>(
    `SELECT id, keycloak_user_id FROM personas WHERE email = $1`,
    [email]
  );
  if (previo.rows.length > 0) {
    if (previo.rows[0].keycloak_user_id) {
      await eliminarUsuarioKeycloak(previo.rows[0].keycloak_user_id);
    }
    await pool.query(`DELETE FROM personas WHERE id = $1`, [previo.rows[0].id]);
    console.log(`Se borró el usuario de demostración anterior (${email}).`);
  }

  const keycloakUserId = await crearUsuarioKeycloak({
    email,
    nombreCompleto: nombre,
    password,
    tenantId,
    rol: "ADMIN",
  });

  // El hash local ya no se usa para entrar (el login es por Keycloak),
  // pero la columna es NOT NULL y dejarla con un valor imposible de usar
  // sería peor que ponerle el mismo password: si algún día volviera a
  // haber login local, un hash que no corresponde a nada daría un error
  // incomprensible en vez de "contraseña incorrecta".
  const hash = await bcrypt.hash(password, 10);

  const p = await pool.query<{ id: string }>(
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico,
                           keycloak_user_id, correo_verificado_en)
     VALUES ($1, $2, $3, $4, true, false, $5, now())
     RETURNING id`,
    [tenantId, nombre, email, hash, keycloakUserId]
  );

  console.log("");
  console.log(`Clínica:    ${t.rows[0].nombre} (${tenantId})`);
  console.log(`Persona:    ${p.rows[0].id}`);
  console.log(`Keycloak:   ${keycloakUserId}`);
  console.log(`Usuario:    ${email}`);
  console.log(`Contraseña: ${password}`);
  console.log(`Rol:        admin de clínica (es_medico = false)`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
