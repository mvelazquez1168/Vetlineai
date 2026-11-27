import bcrypt from "bcrypt";
import { Pool, PoolClient } from "pg";
import { enviarCorreoTransaccional, urlInvitacion } from "./correos";
import { crearUsuarioKeycloak, KeycloakUsuarioExistenteError } from "./keycloakAdmin";
import { obtenerConteoCupos } from "./cupos";
import { otorgarCreditoPruebaSiCorresponde } from "./registroPrueba";

// ---------------------------------------------------------------------
// Pantallas faltantes, Prompt A — invitación y alta de médicos.
// Reemplaza el alta directa con contraseña de desarrollo fija por un
// enlace de un solo uso con vencimiento. `estado` en la tabla solo
// distingue 'pendiente'/'aceptada'/'cancelada' — 'vencida' es un estado
// DERIVADO (pendiente + vence_en < now()), calculado acá en vez de con un
// job que actualice filas, mismo criterio que el estado de vencimiento de
// metodos_pago en el prompt de pantallas de pago.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

const VIGENCIA_DIAS = 7;

export type EstadoInvitacion = "pendiente" | "aceptada" | "cancelada" | "vencida";

export interface Invitacion {
  id: string;
  tenantId: string;
  email: string;
  nombre: string | null;
  token: string;
  estado: EstadoInvitacion;
  creadaEn: string;
  venceEn: string;
  aceptadaEn: string | null;
  /** Los roles que va a tener al aceptar (prompt 04). */
  roles: string[];
}

/** Si entre esos roles está el de médico. Decide dos cosas: si consume
 *  cupo del plan y si hace falta la colegiatura. */
export function invitaAUnMedico(roles: string[]): boolean {
  return roles.includes("medico");
}

function estadoEfectivo(row: { estado: string; vence_en: string | Date }): EstadoInvitacion {
  if (row.estado === "aceptada") return "aceptada";
  if (row.estado === "cancelada") return "cancelada";
  return new Date(row.vence_en) < new Date() ? "vencida" : "pendiente";
}

function mapearFila(row: any): Invitacion {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    nombre: row.nombre ?? null,
    token: row.token,
    estado: estadoEfectivo(row),
    creadaEn: row.creada_en,
    venceEn: row.vence_en,
    aceptadaEn: row.aceptada_en,
    roles: row.roles ?? ["medico"],
  };
}

async function enviarEmailInvitacion(
  db: EjecutorSql,
  tenantId: string,
  email: string,
  nombreClinica: string,
  token: string,
  nombreMedico: string | null
): Promise<void> {
  await enviarCorreoTransaccional(db, tenantId, email, "invitacion_medico", {
    nombreClinica,
    enlace: urlInvitacion(token),
    vigenciaDias: VIGENCIA_DIAS,
    nombreMedico,
  });
}

// Cuenta como "reservando cupo" toda invitación cuyo estado efectivo sea
// 'pendiente' — ni aceptadas (ya son médicos, cuentan en obtenerConteoCupos)
// ni canceladas/vencidas (liberaron el cupo).
//
// SOLO LAS DE MÉDICO (prompt 04). El plan se cobra por médico, así que
// invitar a la recepción o a la caja no puede comerse el cupo de un
// veterinario. Antes del 04 toda invitación era de médico y la cuenta
// daba igual; con ocho roles, contarlas todas significaría que una
// clínica con un plan de dos médicos no puede invitar a su recepcionista.
export async function contarInvitacionesPendientes(db: EjecutorSql, tenantId: string): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) FROM invitaciones_medico
     WHERE tenant_id = $1 AND estado = 'pendiente' AND vence_en >= now()
       AND 'medico' = ANY(roles)`,
    [tenantId]
  );
  return Number(result.rows[0].count);
}

export interface ConteoCuposMedicos {
  medicosContratados: number;
  medicosActivos: number;
  invitacionesPendientes: number;
  disponibles: number;
}

export async function obtenerConteoCuposMedicos(db: EjecutorSql, tenantId: string): Promise<ConteoCuposMedicos | null> {
  const conteo = await obtenerConteoCupos(db, tenantId);
  if (!conteo) return null;
  const invitacionesPendientes = await contarInvitacionesPendientes(db, tenantId);
  return {
    medicosContratados: conteo.medicosContratados,
    medicosActivos: conteo.medicosActivos,
    invitacionesPendientes,
    disponibles: conteo.medicosDisponibles - invitacionesPendientes,
  };
}

export type ResultadoCrearInvitacion =
  | { ok: true; invitacion: Invitacion }
  | { ok: false; motivo: "sin_cupo" };

// Se llama tanto desde el panel de admin (invitar médico) como desde el
// registro público (cuando el registrante no es médico) — un solo camino
// para crear invitaciones, así el enlace real y el conteo de cupo nunca
// pueden divergir entre los dos puntos de entrada.
export async function crearInvitacion(
  db: EjecutorSql,
  tenantId: string,
  nombreClinica: string,
  invitadoPor: string | null,
  email: string,
  nombre?: string | null,
  /**
   * Los roles con los que nace esa persona. Por omisión, médico: es lo
   * que esta función hacía antes del 04 y lo que el registro público
   * sigue necesitando cuando invita al veterinario de la clínica.
   */
  roles: string[] = ["medico"]
): Promise<ResultadoCrearInvitacion> {
  // EL CUPO SE MIRA SOLO SI ES UN MÉDICO: es lo que se cobra.
  if (invitaAUnMedico(roles)) {
    const conteo = await obtenerConteoCuposMedicos(db, tenantId);
    if (conteo && conteo.disponibles <= 0) {
      return { ok: false, motivo: "sin_cupo" };
    }
  }

  const result = await db.query(
    `INSERT INTO invitaciones_medico (tenant_id, email, nombre, invitado_por, vence_en, roles)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6::varchar[])
     RETURNING id, tenant_id, email, nombre, token, estado, creada_en, vence_en, aceptada_en, roles`,
    [tenantId, email, nombre?.trim() || null, invitadoPor, VIGENCIA_DIAS, roles]
  );
  const invitacion = mapearFila(result.rows[0]);
  await enviarEmailInvitacion(db, tenantId, email, nombreClinica, invitacion.token, invitacion.nombre);
  return { ok: true, invitacion };
}

export async function listarInvitacionesPendientes(db: EjecutorSql, tenantId: string): Promise<Invitacion[]> {
  const result = await db.query(
    `SELECT id, tenant_id, email, nombre, token, estado, creada_en, vence_en, aceptada_en, roles
     FROM invitaciones_medico
     WHERE tenant_id = $1 AND estado = 'pendiente' AND vence_en >= now()
     ORDER BY creada_en DESC`,
    [tenantId]
  );
  return result.rows.map(mapearFila);
}

export type ResultadoAccionInvitacion =
  | { ok: true; invitacion: Invitacion }
  | { ok: false; motivo: "no_encontrada" | "ya_no_pendiente" };

export async function reenviarInvitacion(
  db: EjecutorSql,
  tenantId: string,
  invitacionId: string,
  nombreClinica: string
): Promise<ResultadoAccionInvitacion> {
  const result = await db.query(
    `SELECT id, tenant_id, email, nombre, token, estado, creada_en, vence_en, aceptada_en, roles
     FROM invitaciones_medico WHERE id = $1 AND tenant_id = $2`,
    [invitacionId, tenantId]
  );
  const fila = result.rows[0];
  if (!fila) return { ok: false, motivo: "no_encontrada" };
  const invitacion = mapearFila(fila);
  if (invitacion.estado !== "pendiente") return { ok: false, motivo: "ya_no_pendiente" };

  await enviarEmailInvitacion(db, tenantId, invitacion.email, nombreClinica, invitacion.token, invitacion.nombre);
  return { ok: true, invitacion };
}

export async function cancelarInvitacion(
  db: EjecutorSql,
  tenantId: string,
  invitacionId: string
): Promise<ResultadoAccionInvitacion> {
  const result = await db.query(
    `UPDATE invitaciones_medico SET estado = 'cancelada', cancelada_en = now()
     WHERE id = $1 AND tenant_id = $2 AND estado = 'pendiente' AND vence_en >= now()
     RETURNING id, tenant_id, email, nombre, token, estado, creada_en, vence_en, aceptada_en`,
    [invitacionId, tenantId]
  );
  if (result.rows.length === 0) {
    // Puede ser que no exista, o que ya no esté pendiente — no importa
    // distinguir acá, cancelar algo que ya no es cancelable es el mismo
    // no-op informativo para quien lo pide.
    return { ok: false, motivo: "ya_no_pendiente" };
  }
  return { ok: true, invitacion: mapearFila(result.rows[0]) };
}

export interface InvitacionPublica {
  estado: EstadoInvitacion | "no_encontrada";
  email?: string;
  nombre?: string | null;
  nombreClinica?: string;
  /** Los roles con los que va a nacer (prompt 04). */
  roles?: string[];
  /** Sus nombres, para decirle a qué la invitan. */
  rolesNombres?: string[];
  /** Si hay que pedirle la colegiatura. */
  esMedico?: boolean;
}

export async function obtenerInvitacionPorToken(db: EjecutorSql, token: string): Promise<InvitacionPublica> {
  const result = await db.query(
    `SELECT im.estado, im.vence_en, im.email, im.nombre, im.roles,
            t.nombre AS tenant_nombre,
            -- Los nombres de los roles, para decirle a qué la invitan.
            (SELECT array_agg(r.nombre ORDER BY r.orden)
               FROM roles r WHERE r.codigo = ANY(im.roles)) AS roles_nombres
     FROM invitaciones_medico im JOIN tenants t ON t.id = im.tenant_id
     WHERE im.token = $1`,
    [token]
  );
  const fila = result.rows[0];
  if (!fila) return { estado: "no_encontrada" };
  return {
    estado: estadoEfectivo(fila),
    email: fila.email,
    nombre: fila.nombre,
    nombreClinica: fila.tenant_nombre,
    roles: fila.roles ?? ["medico"],
    rolesNombres: fila.roles_nombres ?? [],
    // Para que la pantalla sepa si pedir la colegiatura: pedírsela a la
    // recepción es lo que hacía imposible invitarla.
    esMedico: invitaAUnMedico(fila.roles ?? ["medico"]),
  };
}

export type ResultadoAceptarInvitacion =
  | { ok: true; email: string; password: string }
  | { ok: false; motivo: EstadoInvitacion | "no_encontrada" | "keycloak_existente" };

// Transacción completa (persona + Keycloak + invitación + crédito de
// prueba) en el mismo cliente `db` que ya viene con la transacción
// abierta desde el router — mismo patrón que registro.routes.ts.
export async function aceptarInvitacion(
  db: PoolClient,
  token: string,
  datos: { nombre: string; colegiatura?: string | null; password: string }
): Promise<ResultadoAceptarInvitacion> {
  const invitacionResult = await db.query(
    `SELECT id, tenant_id, email, estado, vence_en, roles
       FROM invitaciones_medico WHERE token = $1 FOR UPDATE`,
    [token]
  );
  const fila = invitacionResult.rows[0];
  if (!fila) return { ok: false, motivo: "no_encontrada" };
  const estado = estadoEfectivo(fila);
  if (estado !== "pendiente") return { ok: false, motivo: estado };

  // password_hash ya no se usa para autenticar (ver migración 011 — la
  // sesión real vive en Keycloak) pero se guarda igual por consistencia
  // de columna con el resto de `personas`.
  const passwordHash = await bcrypt.hash(datos.password, 10);
  // LOS ROLES DE LA INVITACIÓN SON LOS DE LA PERSONA (prompt 04). Los
  // dos booleanos se escriben derivados de ellos: siguen existiendo y
  // los lee medio backend, pero la fuente son los roles.
  const roles: string[] = fila.roles ?? ["medico"];
  const esMedico = invitaAUnMedico(roles);
  const esAdmin = roles.includes("admin_clinica");
  // LA COLEGIATURA ES DEL MÉDICO. Pedírsela a la recepción era lo que
  // hacía imposible invitarla: no tiene número de colegio porque no es
  // veterinaria. El CHECK de `personas` dice lo mismo.
  const colegiatura = esMedico ? datos.colegiatura ?? null : null;
  const personaResult = await db.query(
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico, colegiatura)
     VALUES ($1, $2, $3, $4, $6, $7, $5)
     RETURNING id`,
    [fila.tenant_id, datos.nombre, fila.email, passwordHash, colegiatura, esAdmin, esMedico]
  );
  const personaId = personaResult.rows[0].id;

  // El disparador de la 143 ya sembró los roles derivados de los dos
  // booleanos; acá se escriben los de verdad, que pueden ser más
  // —recepción y caja a la vez— y los de aquel son un subconjunto.
  for (const rol of roles) {
    await db.query(
      `INSERT INTO persona_roles (persona_id, rol) VALUES ($1, $2)
       ON CONFLICT (persona_id, rol) DO NOTHING`,
      [personaId, rol]
    );
  }

  let keycloakUserId: string;
  try {
    keycloakUserId = await crearUsuarioKeycloak({
      email: fila.email,
      nombreCompleto: datos.nombre,
      password: datos.password,
      tenantId: fila.tenant_id,
      // EL ROL DE KEYCLOAK NO ES EL ROL DE LA CLÍNICA. Keycloak solo
      // distingue ADMIN de VETERINARIO, y lo que puede hacer alguien
      // sale de `persona_roles` en cada solicitud. Se manda ADMIN cuando
      // la invitación incluye administrador —es lo que decide a dónde
      // aterriza el frontend— y VETERINARIO para todo el resto del
      // personal, que es el rol «de clínica» que el frontend reconoce.
      rol: esAdmin ? "ADMIN" : "VETERINARIO",
    });
  } catch (err) {
    if (err instanceof KeycloakUsuarioExistenteError) {
      return { ok: false, motivo: "keycloak_existente" };
    }
    throw err;
  }

  await db.query(`UPDATE personas SET keycloak_user_id = $1 WHERE id = $2`, [keycloakUserId, personaId]);
  await db.query(
    `UPDATE invitaciones_medico SET estado = 'aceptada', aceptada_en = now(), persona_id = $1 WHERE id = $2`,
    [personaId, fila.id]
  );

  // Paso 4 del prompt — la contrapartida de la regla anti-farming: si la
  // clínica quedó en prueba sin crédito porque el registrante no era
  // médico, este es el momento en que el primer veterinario colegiado
  // confirma su alta. Idempotente (no-op si ya se otorgó).
  //
  // SOLO SI QUIEN ACEPTÓ ES MÉDICO (prompt 04): con invitaciones de
  // recepción, darle el crédito de prueba a cualquiera que acepte sería
  // abrir exactamente el agujero que esa regla cierra.
  if (esMedico) {
    await otorgarCreditoPruebaSiCorresponde(db, fila.tenant_id);
  }

  return { ok: true, email: fila.email, password: datos.password };
}
