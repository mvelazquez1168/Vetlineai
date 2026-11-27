import { PoolClient } from "pg";
import {
  cerrarSesionesUsuarioKeycloak,
  habilitarUsuarioKeycloak,
} from "../keycloakAdmin";
import { olvidarPermisos } from "../permisos";

// ---------------------------------------------------------------------
// LAS PERSONAS DE LA CLÍNICA: sus roles, su estado — prompt 04, sección 2.
//
// DESACTIVAR ES TRES COSAS, NO UNA. Hasta ahora era un
// `UPDATE personas SET estado` y nada más, y eso dejaba a la persona
// trabajando:
//
//   1. el estado en nuestra base, que es lo que mira `resolverPrincipal`
//      —y no lo miraba, ese era el defecto—;
//   2. **deshabilitarla en Keycloak**, porque si no puede pedir un token
//      nuevo y volver a entrar;
//   3. **revocar sus sesiones**, para que el token que ya tiene en la
//      mano deje de servir ahora y no cuando expire.
//
// Las tres en el mismo acto. Hacer solo la 3 la saca y la deja volver a
// entrar; hacer solo la 1 y la 2 la deja trabajando hasta que su token
// expire.
// ---------------------------------------------------------------------

export interface PersonaDeLaClinica {
  id: string;
  nombre: string;
  email: string;
  estado: string;
  colegiatura: string | null;
  /** La universidad y el año, que es lo que `personas` sí tiene. */
  universidad_egreso: string | null;
  anio_graduacion: number | null;
  roles: string[];
  creado_en: string;
  /**
   * CUÁNDO ENTRÓ POR ÚLTIMA VEZ — pedido por el prompt y **no
   * disponible**: `personas` no tiene esa columna y nadie la escribe.
   * Se devuelve `null` en vez de inventar un valor, y queda anotado en
   * el informe: registrarlo es agregar una escritura en cada
   * autenticación, que es una decisión de rendimiento y no un detalle de
   * esta pantalla.
   */
  ultimo_acceso: null;
  citas_futuras: number;
}

export async function personasDeLaClinica(db: PoolClient): Promise<PersonaDeLaClinica[]> {
  const r = await db.query<PersonaDeLaClinica>(
    `SELECT p.id, p.nombre, p.email, p.estado, p.colegiatura,
            p.universidad_egreso, p.anio_graduacion, p.creado_en::text,
            COALESCE(
              (SELECT array_agg(pr.rol ORDER BY r.orden)
                 FROM persona_roles pr JOIN roles r ON r.codigo = pr.rol
                WHERE pr.persona_id = p.id),
              '{}'
            ) AS roles,
            NULL::text AS ultimo_acceso,
            -- LAS CITAS FUTURAS, para avisar al desactivar: el prompt
            -- pide que queden señaladas para reasignar.
            (SELECT count(*) FROM citas c
              WHERE c.medico_id = p.id
                AND c.fecha >= CURRENT_DATE
                AND c.estado IN ('programada', 'confirmada'))::int AS citas_futuras
       FROM personas p
      ORDER BY p.estado, p.nombre`
  );
  return r.rows;
}

export class CambioDeRolesImposible extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CambioDeRolesImposible";
  }
}

/**
 * Los roles de una persona, reemplazados por los que se le pasan.
 *
 * Reemplaza y no agrega: la pantalla manda el conjunto completo, que es
 * lo que el usuario ve marcado. Un «agregar» obligaría a una segunda
 * llamada para quitar, y dejaría la pantalla y la base contando cosas
 * distintas si una de las dos falla.
 */
export async function asignarRoles(
  db: PoolClient,
  personaId: string,
  roles: string[],
  porQuien?: string
): Promise<{ roles: string[] }> {
  const existe = await db.query<{ estado: string }>(
    `SELECT estado FROM personas WHERE id = $1`,
    [personaId]
  );
  if (existe.rows.length === 0) throw new CambioDeRolesImposible("Esa persona no existe.");

  const validos = await db.query<{ codigo: string }>(
    `SELECT codigo FROM roles WHERE codigo = ANY($1::varchar[])`,
    [roles]
  );
  if (validos.rows.length !== roles.length) {
    const conocidos = new Set(validos.rows.map((f) => f.codigo));
    const malos = roles.filter((r) => !conocidos.has(r));
    throw new CambioDeRolesImposible(`Estos roles no existen: ${malos.join(", ")}.`);
  }
  if (roles.length === 0) {
    // UNA PERSONA SIN ROLES PUEDE ENTRAR Y NO VER NADA, que es la peor
    // forma de estar desactivado: parece un error del sistema. Si no
    // tiene que entrar, se la desactiva.
    throw new CambioDeRolesImposible(
      "Una persona necesita al menos un rol. Si no debe entrar, desactivala."
    );
  }

  // EL ÚLTIMO ADMINISTRADOR NO SE QUEDA SIN SU ROL. Es el mismo
  // razonamiento que no poder desactivarlo: una clínica sin
  // administrador activo no puede volver a tener uno sin que alguien
  // entre a la base.
  if (!roles.includes("admin_clinica")) {
    await exigirQueQuedeUnAdmin(db, personaId);
  }

  await db.query(`DELETE FROM persona_roles WHERE persona_id = $1`, [personaId]);
  for (const rol of roles) {
    await db.query(
      `INSERT INTO persona_roles (persona_id, rol, asignado_por) VALUES ($1,$2,$3)`,
      [personaId, rol, porQuien ?? null]
    );
  }

  // LOS BOOLEANOS DERIVADOS SE ACTUALIZAN EN EL MISMO ACTO. Son
  // derivados, no una segunda fuente: si se dejaran viejos, los 100
  // chequeos que todavía los usan dirían lo contrario que los roles.
  await db.query(
    `UPDATE personas
        SET es_medico = $2, es_admin_clinica = $3
      WHERE id = $1`,
    [personaId, roles.includes("medico"), roles.includes("admin_clinica")]
  );

  // La caché de permisos vive 30 segundos; el cambio tiene que verse en
  // la próxima solicitud, así que se invalida a mano.
  olvidarPermisos(personaId);
  return { roles };
}

async function exigirQueQuedeUnAdmin(db: PoolClient, excepto: string): Promise<void> {
  const otros = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM persona_roles pr
       JOIN personas p ON p.id = pr.persona_id
      WHERE pr.rol = 'admin_clinica' AND p.estado = 'activo' AND p.id <> $1`,
    [excepto]
  );
  if (Number(otros.rows[0].n) === 0) {
    throw new CambioDeRolesImposible(
      "Es la única persona con el rol de administrador activa en la clínica. Dale ese rol a alguien más antes de quitárselo."
    );
  }
}

export interface ResultadoDesactivar {
  id: string;
  nombre: string;
  estado: string;
  /** Lo que hay que reasignar: el prompt pide avisarlo. */
  citasFuturas: number;
  /** Qué pasó en Keycloak, para poder decirlo en la pantalla. */
  keycloak: "deshabilitado" | "sin_usuario" | "falló";
  keycloakDetalle?: string;
}

/**
 * Desactiva a una persona: en la base, en Keycloak y revocando sus
 * sesiones.
 *
 * NO BORRA NADA. Sus atenciones, cobros y movimientos se conservan con
 * su autoría, que es lo que hace que el expediente siga siendo
 * verificable.
 *
 * SI KEYCLOAK FALLA, LA DESACTIVACIÓN EN LA BASE QUEDA IGUAL, y se
 * informa. Es la decisión incómoda: dejarla activa «porque Keycloak no
 * respondió» mantendría dentro a alguien que el administrador acaba de
 * sacar, y nuestro `resolverPrincipal` ya la bloquea. Lo que no se puede
 * es decir que salió todo bien.
 */
export async function desactivarPersona(
  db: PoolClient,
  personaId: string,
  porQuien?: string
): Promise<ResultadoDesactivar> {
  const r = await db.query<{
    id: string;
    nombre: string;
    keycloak_user_id: string | null;
    estado: string;
  }>(`SELECT id, nombre, keycloak_user_id, estado FROM personas WHERE id = $1`, [personaId]);
  if (r.rows.length === 0) throw new CambioDeRolesImposible("Esa persona no existe.");
  if (r.rows[0].id === porQuien) {
    // Nadie se desactiva a sí mismo: se quedaría afuera en la siguiente
    // solicitud, y es un error del que no se puede volver sin otra
    // persona.
    throw new CambioDeRolesImposible("No podés desactivarte a vos mismo.");
  }
  await exigirQueQuedeUnAdmin(db, personaId);

  const citas = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM citas
      WHERE medico_id = $1 AND fecha >= CURRENT_DATE
        AND estado IN ('programada', 'confirmada')`,
    [personaId]
  );

  await db.query(
    `UPDATE personas SET estado = 'inactivo' WHERE id = $1`,
    [personaId]
  );
  await db.query(`DELETE FROM persona_roles WHERE persona_id = $1`, [personaId]);
  await db.query(
    `UPDATE personas SET es_medico = false, es_admin_clinica = false WHERE id = $1`,
    [personaId]
  );
  olvidarPermisos(personaId);

  let keycloak: ResultadoDesactivar["keycloak"] = "sin_usuario";
  let detalle: string | undefined;
  const kcId = r.rows[0].keycloak_user_id;
  if (kcId) {
    try {
      // EL ORDEN IMPORTA: primero deshabilitar y después cerrar
      // sesiones. Al revés, entre el logout y el disable hay una ventana
      // en la que puede volver a entrar.
      await habilitarUsuarioKeycloak(kcId, false);
      await cerrarSesionesUsuarioKeycloak(kcId);
      keycloak = "deshabilitado";
    } catch (err) {
      keycloak = "falló";
      detalle = err instanceof Error ? err.message : "error desconocido";
    }
  }

  return {
    id: r.rows[0].id,
    nombre: r.rows[0].nombre,
    estado: "inactivo",
    citasFuturas: Number(citas.rows[0].n),
    keycloak,
    keycloakDetalle: detalle,
  };
}

/** Reactivar: el camino inverso, con los roles que se le vuelvan a dar. */
export async function reactivarPersona(
  db: PoolClient,
  personaId: string,
  roles: string[],
  porQuien?: string
): Promise<{ estado: string; keycloak: string }> {
  const r = await db.query<{ keycloak_user_id: string | null }>(
    `SELECT keycloak_user_id FROM personas WHERE id = $1`,
    [personaId]
  );
  if (r.rows.length === 0) throw new CambioDeRolesImposible("Esa persona no existe.");

  await db.query(
    `UPDATE personas SET estado = 'activo' WHERE id = $1`,
    [personaId]
  );
  await asignarRoles(db, personaId, roles, porQuien);

  let keycloak = "sin_usuario";
  if (r.rows[0].keycloak_user_id) {
    try {
      await habilitarUsuarioKeycloak(r.rows[0].keycloak_user_id, true);
      keycloak = "habilitado";
    } catch (err) {
      keycloak = `falló: ${err instanceof Error ? err.message : "error"}`;
    }
  }
  return { estado: "activo", keycloak };
}
