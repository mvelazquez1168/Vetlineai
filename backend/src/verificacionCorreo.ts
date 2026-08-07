import { Pool, PoolClient } from "pg";
import { enviarCorreoTransaccional, urlVerificarCorreo } from "./correos";
import { marcarEmailVerificadoKeycloak, cambiarEmailUsuarioKeycloak } from "./keycloakAdmin";
import { otorgarCreditoPruebaSiCorresponde } from "./registroPrueba";

// ---------------------------------------------------------------------
// Prompt de verificación de correo del administrador — módulo único,
// mismo criterio que medicoAgente.ts/tarifas.ts. Cubre las Capas 2-4: el
// admin de clínica genera y confirma un token propio (no el flujo nativo
// de Keycloak — ver backend/keycloak/CONFIGURACION_MANUAL.md), Resend
// informa el rebote por webhook, y el crédito de prueba queda retenido
// hasta que se confirme. El médico invitado NUNCA pasa por acá — su
// enlace de invitación ya prueba que lo recibió.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

const VIGENCIA_HORAS = 72;

/**
 * Genera un token nuevo (invalida cualquiera anterior) y dispara el
 * correo de verificación. Se usa tanto al registrarse como al reenviar
 * (Capa 3, tras corregir el correo).
 */
export async function generarYEnviarVerificacion(
  db: EjecutorSql,
  personaId: string,
  tenantId: string,
  email: string,
  nombreClinica: string
): Promise<void> {
  const tokenResult = await db.query(
    `UPDATE personas
     SET token_verificacion_correo = gen_random_uuid(),
         token_verificacion_expira_en = now() + ($2 || ' hours')::interval
     WHERE id = $1
     RETURNING token_verificacion_correo`,
    [personaId, VIGENCIA_HORAS]
  );
  const token = tokenResult.rows[0].token_verificacion_correo as string;

  await enviarCorreoTransaccional(db, tenantId, email, "verificacion_correo", {
    nombreClinica,
    enlace: urlVerificarCorreo(token),
    vigenciaHoras: VIGENCIA_HORAS,
  });
}

export type MotivoConfirmacionFallida = "token_invalido" | "token_vencido";

/**
 * Confirma la verificación a partir del token del enlace. Sincroniza
 * Keycloak (emailVerified) y reintenta el otorgamiento del crédito de
 * prueba — puede que ya estuviera todo lo demás listo (colegiatura) y
 * solo faltara esto.
 */
export async function confirmarVerificacionPorToken(
  db: PoolClient,
  token: string
): Promise<{ ok: true } | { ok: false; motivo: MotivoConfirmacionFallida }> {
  const personaResult = await db.query(
    `SELECT id, tenant_id, keycloak_user_id, token_verificacion_expira_en
     FROM personas WHERE token_verificacion_correo = $1`,
    [token]
  );
  const persona = personaResult.rows[0];
  if (!persona) return { ok: false, motivo: "token_invalido" };
  if (new Date(persona.token_verificacion_expira_en) < new Date()) {
    return { ok: false, motivo: "token_vencido" };
  }

  await db.query(
    `UPDATE personas
     SET correo_verificado_en = now(), correo_rebotado_en = NULL,
         token_verificacion_correo = NULL, token_verificacion_expira_en = NULL
     WHERE id = $1`,
    [persona.id]
  );

  if (persona.keycloak_user_id) {
    await marcarEmailVerificadoKeycloak(persona.keycloak_user_id, true).catch((err) =>
      console.error(`verificacionCorreo: no se pudo sincronizar emailVerified en Keycloak (persona ${persona.id})`, err)
    );
  }

  await otorgarCreditoPruebaSiCorresponde(db, persona.tenant_id).catch((err) =>
    console.error(`verificacionCorreo: no se pudo otorgar el crédito de prueba tras verificar (persona ${persona.id})`, err)
  );

  return { ok: true };
}

/**
 * Capa 2 — procesa un rebote reportado por el webhook de Resend
 * (webhooks.routes.ts). Correlaciona por proveedor_message_id (exacto,
 * no por destinatario adivinado — ver migración 039) para marcar la fila
 * de correos_enviados; el efecto sobre personas.correo_rebotado_en solo
 * aplica cuando el correo que rebotó era justamente el de verificación
 * (los demás tipos quedan igual de auditados en correos_enviados, pero
 * ninguna otra capa de este prompt depende de su rebote todavía).
 */
export async function procesarRebote(db: EjecutorSql, proveedorMessageId: string): Promise<void> {
  const result = await db.query(
    `UPDATE correos_enviados SET rebotado_en = now()
     WHERE proveedor_message_id = $1 AND rebotado_en IS NULL
     RETURNING destinatario, tipo`,
    [proveedorMessageId]
  );
  const fila = result.rows[0];
  if (!fila || fila.tipo !== "verificacion_correo") return;

  await db.query(
    `UPDATE personas SET correo_rebotado_en = now()
     WHERE email = $1 AND es_admin_clinica = true AND correo_verificado_en IS NULL`,
    [fila.destinatario]
  );
}

export type MotivoCambioCorreoFallido = "correo_en_uso";

/**
 * Capa 3 — cambia el correo del propio administrador. Actualiza DB +
 * Keycloak (username=email, requiere editUsernameAllowed=true en el
 * reino — ver backend/keycloak/CONFIGURACION_MANUAL.md), limpia el
 * rebote y reenvía la verificación. El llamador (endpoint) es quien
 * garantiza que personaId sea el del propio token — este módulo no
 * vuelve a chequear eso.
 */
export async function cambiarCorreoAdmin(
  db: PoolClient,
  personaId: string,
  tenantId: string,
  nombreClinica: string,
  nuevoEmail: string
): Promise<{ ok: true } | { ok: false; motivo: MotivoCambioCorreoFallido }> {
  const existente = await db.query(`SELECT 1 FROM personas WHERE email = $1 AND id != $2`, [nuevoEmail, personaId]);
  if (existente.rows.length > 0) {
    return { ok: false, motivo: "correo_en_uso" };
  }

  const personaResult = await db.query(`SELECT keycloak_user_id FROM personas WHERE id = $1`, [personaId]);
  const keycloakUserId = personaResult.rows[0]?.keycloak_user_id as string | null;

  if (keycloakUserId) {
    await cambiarEmailUsuarioKeycloak(keycloakUserId, nuevoEmail);
  }

  await db.query(
    `UPDATE personas
     SET email = $1, correo_rebotado_en = NULL, correo_verificado_en = NULL
     WHERE id = $2`,
    [nuevoEmail, personaId]
  );

  await generarYEnviarVerificacion(db, personaId, tenantId, nuevoEmail, nombreClinica);

  return { ok: true };
}
