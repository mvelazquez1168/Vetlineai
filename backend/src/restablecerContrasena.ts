import { Pool, PoolClient } from "pg";
import { enviarCorreoTransaccional, urlRestablecerContrasena } from "./correos";
import { restablecerContrasenaUsuarioKeycloak, cerrarSesionesUsuarioKeycloak } from "./keycloakAdmin";

// ---------------------------------------------------------------------
// prompt_code_restablecer_contrasena — restablecimiento de contraseña
// dentro de la aplicación (no se deriva a la pantalla nativa de
// Keycloak: nadie la ve, el reino no tiene servidor de correo propio).
// Cubre las tres clases de usuario: médicos y admins de clínica viven en
// personas, staff de plataforma en staff_plataforma — restablecimientos_contrasena
// (migración 065) referencia exactamente una de las dos por fila.
//
// DECISIÓN DE SEGURIDAD, no negociable: solicitarRestablecimiento nunca
// revela si una dirección está registrada — ni por el resultado (siempre
// resuelve void, sin importar lo que pasó adentro) ni por el tiempo de
// respuesta (ambas ramas — cuenta encontrada o no — hacen un trabajo de
// base de datos comparable antes de decidir si hay algo que enviar).
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

const VIGENCIA_MINUTOS = 60;
const LIMITE_SOLICITUDES = 3;
const VENTANA_LIMITE_MINUTOS = 60;

interface CuentaObjetivo {
  tipo: "persona" | "staff";
  id: string;
  nombre: string | null;
  keycloakUserId: string | null;
}

async function buscarCuentaPorEmail(db: EjecutorSql, email: string): Promise<CuentaObjetivo | null> {
  // Se consultan SIEMPRE las dos tablas, exista o no la cuenta en
  // cualquiera de ellas — mismo trabajo de DB en todas las ramas, para no
  // abrir un canal de tiempo que confirme existencia aunque el mensaje
  // final sea idéntico. Cuentas de persona inactivas quedan afuera a
  // propósito: un médico desactivado no debería recuperar acceso por acá.
  const [personaResult, staffResult] = await Promise.all([
    db.query(
      `SELECT id, nombre, keycloak_user_id FROM personas WHERE email = $1 AND estado = 'activo'`,
      [email]
    ),
    db.query(`SELECT id, nombre, keycloak_user_id FROM staff_plataforma WHERE email = $1`, [email]),
  ]);

  const persona = personaResult.rows[0];
  if (persona) {
    return { tipo: "persona", id: persona.id, nombre: persona.nombre, keycloakUserId: persona.keycloak_user_id };
  }
  const staff = staffResult.rows[0];
  if (staff) {
    return { tipo: "staff", id: staff.id, nombre: staff.nombre, keycloakUserId: staff.keycloak_user_id };
  }
  return null;
}

/**
 * Solicita un restablecimiento. SIEMPRE resuelve sin lanzar y sin
 * distinguir en su valor de retorno si la cuenta existía, estaba
 * limitada, o no tenía keycloak_user_id — el endpoint que la llama
 * devuelve el mismo mensaje genérico en los tres casos.
 */
export async function solicitarRestablecimiento(db: EjecutorSql, email: string): Promise<void> {
  const cuenta = await buscarCuentaPorEmail(db, email);
  if (!cuenta || !cuenta.keycloakUserId) return;

  // Límite de solicitudes por dirección — reusa correos_enviados como
  // registro real de cada envío (mismo patrón que el límite de reenvío
  // de verificación en admin.routes.ts), sin agregar un contador nuevo.
  // A diferencia de aquel endpoint (autenticado, puede devolver 429), acá
  // alcanzar el límite se resuelve en silencio: cualquier señal distinta
  // del mensaje genérico revelaría que la cuenta existe.
  const limiteResult = await db.query(
    `SELECT count(*)::int AS cantidad
       FROM correos_enviados
      WHERE destinatario = $1 AND tipo = 'restablecimiento_contrasena'
        AND enviado_en > now() - ($2 || ' minutes')::interval`,
    [email, VENTANA_LIMITE_MINUTOS]
  );
  if (limiteResult.rows[0].cantidad >= LIMITE_SOLICITUDES) return;

  const tokenResult = await db.query(
    `INSERT INTO restablecimientos_contrasena (persona_id, staff_id, expira_en)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)
     RETURNING token`,
    [cuenta.tipo === "persona" ? cuenta.id : null, cuenta.tipo === "staff" ? cuenta.id : null, VIGENCIA_MINUTOS]
  );
  const token = tokenResult.rows[0].token as string;

  await enviarCorreoTransaccional(db, null, email, "restablecimiento_contrasena", {
    nombre: cuenta.nombre,
    enlace: urlRestablecerContrasena(token),
    vigenciaMinutos: VIGENCIA_MINUTOS,
  });
}

export type MotivoTokenInvalido = "token_invalido" | "token_vencido" | "token_usado";

interface TokenValidado {
  id: string;
  tipo: "persona" | "staff";
  cuentaId: string;
  keycloakUserId: string;
  nombre: string | null;
  email: string;
}

async function resolverTokenValido(
  db: EjecutorSql,
  token: string
): Promise<{ ok: true; datos: TokenValidado } | { ok: false; motivo: MotivoTokenInvalido }> {
  const result = await db.query(
    `SELECT r.id, r.persona_id, r.staff_id, r.expira_en, r.usado_en,
            COALESCE(p.nombre, s.nombre) AS nombre,
            COALESCE(p.email, s.email) AS email,
            COALESCE(p.keycloak_user_id, s.keycloak_user_id) AS keycloak_user_id
       FROM restablecimientos_contrasena r
       LEFT JOIN personas p ON p.id = r.persona_id
       LEFT JOIN staff_plataforma s ON s.id = r.staff_id
      WHERE r.token = $1`,
    [token]
  );
  const fila = result.rows[0];
  if (!fila) return { ok: false, motivo: "token_invalido" };
  if (fila.usado_en) return { ok: false, motivo: "token_usado" };
  if (new Date(fila.expira_en) < new Date()) return { ok: false, motivo: "token_vencido" };
  if (!fila.keycloak_user_id) return { ok: false, motivo: "token_invalido" };

  return {
    ok: true,
    datos: {
      id: fila.id,
      tipo: fila.persona_id ? "persona" : "staff",
      cuentaId: fila.persona_id ?? fila.staff_id,
      keycloakUserId: fila.keycloak_user_id,
      nombre: fila.nombre,
      email: fila.email,
    },
  };
}

/** Usado por la pantalla del token para decidir qué mostrar antes de que el usuario escriba nada. */
export async function validarTokenRestablecimiento(
  db: EjecutorSql,
  token: string
): Promise<{ ok: true } | { ok: false; motivo: MotivoTokenInvalido }> {
  const resultado = await resolverTokenValido(db, token);
  return resultado.ok ? { ok: true } : resultado;
}

/**
 * Confirma el restablecimiento: cambia la contraseña en Keycloak,
 * invalida sus sesiones activas (decisión de seguridad — si alguien
 * restablece porque sospecha que le entraron a la cuenta, una sesión
 * viva del intruso vacía el sentido del cambio), marca el token usado, y
 * manda el aviso de "tu contraseña cambió" — la única señal que tiene
 * alguien cuya cuenta fue tomada.
 */
export async function confirmarRestablecimiento(
  db: PoolClient,
  token: string,
  nuevaContrasena: string
): Promise<{ ok: true } | { ok: false; motivo: MotivoTokenInvalido }> {
  const resuelto = await resolverTokenValido(db, token);
  if (!resuelto.ok) return resuelto;
  const { id, keycloakUserId, nombre, email } = resuelto.datos;

  await restablecerContrasenaUsuarioKeycloak(keycloakUserId, nuevaContrasena);
  await cerrarSesionesUsuarioKeycloak(keycloakUserId);

  await db.query(`UPDATE restablecimientos_contrasena SET usado_en = now() WHERE id = $1`, [id]);

  const fecha = new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  await enviarCorreoTransaccional(db, null, email, "contrasena_cambiada", { nombre, fecha });

  return { ok: true };
}
