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
import { buscarUsuarioKeycloakPorEmail, crearUsuarioKeycloak, eliminarUsuarioKeycloak } from "../keycloakAdmin";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

async function main() {
  exigirEntornoDeDesarrollo("crear_usuario_demo");

  const [tenantId, email, password, nombre, rolPedido] = process.argv.slice(2);
  // EL ROL ES UN ARGUMENTO y no dos scripts: "medico" crea a la persona
  // como administradora Y médica. El rol en este sistema no es
  // excluyente —ver el bug del rol binario que ya costó una sesión— y
  // un usuario de demostración que no puede escribir nada clínico no
  // sirve para revisar el expediente.
  const esMedico = (rolPedido ?? "").toLowerCase() === "medico";
  if (!tenantId || !email || !password || !nombre) {
    console.error(
      'Uso: npx ts-node src/scripts/crear_usuario_demo.ts <tenantId> <email> <password> "<nombre>" [medico]'
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

  // Huerfano: existe en Keycloak pero no en la base. Pasa cuando un
  // intento anterior creo el usuario y despues fallo el insert. Sin esto,
  // el script queda muerto para ese correo con un 409 de Keycloak.
  const huerfano = await buscarUsuarioKeycloakPorEmail(email);
  if (huerfano) {
    await eliminarUsuarioKeycloak(huerfano);
    console.log(`Se borró un usuario huérfano de Keycloak (${email}).`);
  }

  // La colegiatura es unica entre administradores (indice
  // `colegiatura_admin_unica`), asi que no puede ser una constante: con
  // DEMO-0001 fija, el SEGUNDO usuario de demostracion medico fallaba con
  // una violacion de unicidad despues de haber creado ya su usuario en
  // Keycloak, dejandolo huerfano. Se busca el primer numero libre.
  let colegiatura: string | null = null;
  if (esMedico) {
    const usadas = await pool.query<{ colegiatura: string }>(
      `SELECT colegiatura FROM personas WHERE colegiatura LIKE 'DEMO-%'`
    );
    const tomadas = new Set(usadas.rows.map((r) => r.colegiatura));
    for (let n = 1; n <= 9999 && colegiatura === null; n += 1) {
      const candidata = `DEMO-${String(n).padStart(4, "0")}`;
      if (!tomadas.has(candidata)) colegiatura = candidata;
    }
    if (colegiatura === null) {
      console.error("No queda ninguna colegiatura DEMO-#### libre.");
      process.exit(1);
    }
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
    // La colegiatura es obligatoria para un médico (CHECK en la tabla):
    // un médico sin número de colegio no puede firmar un registro.
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico,
                           colegiatura, keycloak_user_id, correo_verificado_en)
     VALUES ($1, $2, $3, $4, true, $6, $7, $5, now())
     RETURNING id`,
    [
      tenantId,
      nombre,
      email,
      hash,
      keycloakUserId,
      esMedico,
      colegiatura,
    ]
  );

  console.log("");
  console.log(`Clínica:    ${t.rows[0].nombre} (${tenantId})`);
  console.log(`Persona:    ${p.rows[0].id}`);
  console.log(`Keycloak:   ${keycloakUserId}`);
  console.log(`Usuario:    ${email}`);
  console.log(`Contraseña: ${password}`);
  console.log(
    `Rol:        admin de clínica${esMedico ? ` + médico (colegiatura ${colegiatura})` : " (es_medico = false)"}`
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
