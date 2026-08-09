import "dotenv/config";
import { Pool } from "pg";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, KeycloakUsuarioExistenteError } from "./keycloakAdmin";

// Bootstrap del primer super_admin de plataforma. No existe ningún flujo de
// registro para este perfil (el autoservicio es solo para clínicas, ver
// registro.routes.ts) y staff_plataforma no tiene ningún endpoint que
// inserte filas nuevas — hoy la única forma de crear uno es a mano, y no
// estaba documentado en ningún lado. Este script hace lo mismo que se venía
// haciendo a mano en scripts de verificación descartables de esta sesión
// (ver backend/src/scripts/verificar_agentes_paises_v2.ts, escenario 6):
// crea el usuario en Keycloak con el rol de realm SUPER_ADMIN y la fila en
// staff_plataforma vinculada por keycloak_user_id — pero versionado, no
// descartable, e idempotente (correrlo dos veces con el mismo email no
// duplica nada).
//
// Uso: node dist/crearAdminPlataforma.js (producción) o ts-node
// --transpile-only src/crearAdminPlataforma.ts (dev), con estas 3
// variables de entorno seteadas SOLO para esta invocación puntual (no son
// variables del servidor — no viven en config.ts a propósito, este script
// no arranca el backend):
//   ADMIN_PLATAFORMA_EMAIL=admin@vetlineai.com
//   ADMIN_PLATAFORMA_NOMBRE="Nombre Apellido"
//   ADMIN_PLATAFORMA_PASSWORD=<contraseña real, elegida por quien lo corre>
//
// password_hash sigue siendo NOT NULL en staff_plataforma pero ya no se
// usa para autenticar desde la migración 011 (Keycloak resuelve todo por
// keycloak_user_id) — el valor que se inserta es un literal sin sentido a
// propósito, mismo patrón que el script de verificación de referencia.

function requireEnvLocal(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name}. Este script necesita ADMIN_PLATAFORMA_EMAIL, ADMIN_PLATAFORMA_NOMBRE y ADMIN_PLATAFORMA_PASSWORD seteadas solo para esta corrida.`
    );
  }
  return value;
}

async function main() {
  const email = requireEnvLocal("ADMIN_PLATAFORMA_EMAIL");
  const nombre = requireEnvLocal("ADMIN_PLATAFORMA_NOMBRE");
  const password = requireEnvLocal("ADMIN_PLATAFORMA_PASSWORD");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const existente = await pool.query(`SELECT id FROM staff_plataforma WHERE email = $1`, [email]);
    if (existente.rows.length > 0) {
      console.log(`Ya existe un staff_plataforma con email ${email} (id ${existente.rows[0].id}) — no se crea de nuevo.`);
      return;
    }

    console.log(`Creando usuario en Keycloak (${email}, rol de realm SUPER_ADMIN)...`);
    let keycloakUserId: string;
    try {
      keycloakUserId = await crearUsuarioKeycloak({
        email,
        nombreCompleto: nombre,
        password,
        rol: "SUPER_ADMIN",
        // Sin tenantId: staff de plataforma no pertenece a ninguna clínica.
      });
    } catch (err) {
      if (err instanceof KeycloakUsuarioExistenteError) {
        throw new Error(
          `${err.message} Existe en Keycloak pero no en staff_plataforma — revisar a mano en la consola de Keycloak antes de reintentar (puede ser una corrida anterior que falló a mitad de camino).`
        );
      }
      throw err;
    }

    console.log(`Usuario de Keycloak creado (id ${keycloakUserId}). Insertando en staff_plataforma...`);
    try {
      const staff = await pool.query(
        `INSERT INTO staff_plataforma (nombre, email, password_hash, rol, keycloak_user_id)
         VALUES ($1, $2, 'no-usado-keycloak', 'super_admin', $3)
         RETURNING id`,
        [nombre, email, keycloakUserId]
      );
      console.log(`\n✅ Listo. staff_plataforma.id = ${staff.rows[0].id}, keycloak_user_id = ${keycloakUserId}.`);
    } catch (err) {
      // No dejar un usuario huérfano en Keycloak si el INSERT falla (ej.
      // una corrida concurrente que ganó la carrera contra el email UNIQUE).
      await eliminarUsuarioKeycloak(keycloakUserId).catch(() => {});
      throw err;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
