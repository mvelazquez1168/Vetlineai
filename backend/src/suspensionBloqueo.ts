import { Pool, PoolClient } from "pg";

type EjecutorSql = Pool | PoolClient;
import { enviarCorreoTransaccional, obtenerAdminClinica, urlSoporte } from "./correos";

// ---------------------------------------------------------------------
// Vetline_Ai_Suspension_Bloqueo.md, secciones 3.2 y 5 — las 4 acciones
// manuales de ciclo de vida que ejecuta Platform Admin. Todas exigen
// motivo obligatorio (validado por el caller, el router) y quedan
// registradas en clinica_eventos_ciclo_vida con el estado anterior y
// posterior — no hay forma de aplicarlas sin dejar rastro.
//
// Corren siempre contra el `pool` admin (bypass de RLS) porque las llama
// un router de Platform Admin (super_admin, sin tenant propio) — mismo
// patrón que platformConsumoClinicas.routes.ts.
// ---------------------------------------------------------------------

export type TipoEventoCicloVida =
  | "suspension_manual"
  | "reactivacion"
  | "bloqueo"
  | "desbloqueo"
  | "entrada_ventana_cierre"
  | "cancelacion_ventana_cierre"
  | "cierre_efectivo";

async function obtenerSuscripcion(db: EjecutorSql, tenantId: string): Promise<{ id: string; estado: string } | null> {
  const result = await db.query(
    `SELECT s.id, s.estado FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id WHERE t.id = $1`,
    [tenantId]
  );
  return result.rows[0] ?? null;
}

async function registrarEvento(
  db: EjecutorSql,
  tenantId: string,
  tipoEvento: TipoEventoCicloVida,
  motivo: string | null,
  estadoAnterior: string | null,
  estadoNuevo: string | null,
  ejecutadoPor: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO clinica_eventos_ciclo_vida (tenant_id, tipo_evento, motivo, estado_anterior, estado_nuevo, ejecutado_por)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, tipoEvento, motivo, estadoAnterior, estadoNuevo, ejecutadoPor]
  );
}

export class TransicionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "TransicionInvalidaError";
  }
}

// Cuántos usuarios de la clínica van a perder acceso — el modal de
// confirmación del bloqueo lo muestra antes de aplicarlo (spec 5.2:
// "confirmación con la cantidad de usuarios que quedarán sin acceso").
export async function contarUsuariosActivos(db: EjecutorSql, tenantId: string): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS n FROM personas WHERE tenant_id = $1 AND estado = 'activo'`,
    [tenantId]
  );
  return result.rows[0].n;
}

// 3.2 — Suspensión manual. Solo desde activa/morosa (un problema
// comercial que todavía no había escalado por impago automático). Los
// efectos son idénticos a la suspensión automática: no otorga crédito
// nuevo, el acceso clínico no se toca.
export async function suspenderManualmente(
  db: EjecutorSql,
  tenantId: string,
  motivo: string,
  ejecutadoPor: string
): Promise<void> {
  const suscripcion = await obtenerSuscripcion(db, tenantId);
  if (!suscripcion) throw new TransicionInvalidaError("Clínica no encontrada.");
  if (!["activa", "morosa"].includes(suscripcion.estado)) {
    throw new TransicionInvalidaError(`No se puede suspender una clínica en estado "${suscripcion.estado}".`);
  }

  await db.query(`UPDATE suscripciones SET estado = 'suspendida', suspendida_manualmente = true WHERE id = $1`, [
    suscripcion.id,
  ]);
  await registrarEvento(db, tenantId, "suspension_manual", motivo, suscripcion.estado, "suspendida", ejecutadoPor);

  const admin = await obtenerAdminClinica(db, tenantId);
  if (admin) {
    await enviarCorreoTransaccional(db, tenantId, admin.email, "cuenta_suspendida_manual", {
      motivo,
      enlace: urlSoporte(),
    });
  }
}

// 3.2 — Reactivación manual. "Una suspensión manual no se levanta sola
// con un cobro exitoso" — el contador de períodos también se resetea acá,
// mismo criterio que confirmarCobroSuscripcionExitoso.
export async function reactivarManualmente(
  db: EjecutorSql,
  tenantId: string,
  motivo: string,
  ejecutadoPor: string
): Promise<void> {
  const suscripcion = await obtenerSuscripcion(db, tenantId);
  if (!suscripcion) throw new TransicionInvalidaError("Clínica no encontrada.");
  if (suscripcion.estado !== "suspendida") {
    throw new TransicionInvalidaError(`No se puede reactivar una clínica en estado "${suscripcion.estado}".`);
  }

  await db.query(
    `UPDATE suscripciones SET estado = 'activa', periodos_suspendida_consecutivos = 0, suspendida_manualmente = false WHERE id = $1`,
    [suscripcion.id]
  );
  await registrarEvento(db, tenantId, "reactivacion", motivo, "suspendida", "activa", ejecutadoPor);
}

// 5 — Bloqueo. Excepcional (abuso/fraude/incumplimiento), no una
// escalada de la morosidad. Impide el acceso a la plataforma (ver
// middleware/auth.ts) sin eliminar datos. Guarda el estado anterior para
// que el desbloqueo pueda volver ahí, no forzar 'activa'.
export async function bloquear(db: EjecutorSql, tenantId: string, motivo: string, ejecutadoPor: string): Promise<void> {
  const suscripcion = await obtenerSuscripcion(db, tenantId);
  if (!suscripcion) throw new TransicionInvalidaError("Clínica no encontrada.");
  if (["bloqueada", "cancelada", "finalizada"].includes(suscripcion.estado)) {
    throw new TransicionInvalidaError(`No se puede bloquear una clínica en estado "${suscripcion.estado}".`);
  }

  await db.query(`UPDATE suscripciones SET estado = 'bloqueada', estado_antes_bloqueo = $1 WHERE id = $2`, [
    suscripcion.estado,
    suscripcion.id,
  ]);
  await registrarEvento(db, tenantId, "bloqueo", motivo, suscripcion.estado, "bloqueada", ejecutadoPor);

  const admin = await obtenerAdminClinica(db, tenantId);
  if (admin) {
    await enviarCorreoTransaccional(db, tenantId, admin.email, "cuenta_bloqueada", {
      motivo,
      enlaceSoporte: urlSoporte(),
    });
  }
}

// 5.3 — Desbloqueo. Vuelve al estado en que estaba antes del bloqueo, NO
// necesariamente a 'activa' — si estaba suspendida o morosa antes de
// bloquearse, sigue estándolo después de desbloquearse.
export async function desbloquear(db: EjecutorSql, tenantId: string, motivo: string, ejecutadoPor: string): Promise<void> {
  const suscripcion = await obtenerSuscripcion(db, tenantId);
  if (!suscripcion) throw new TransicionInvalidaError("Clínica no encontrada.");
  if (suscripcion.estado !== "bloqueada") {
    throw new TransicionInvalidaError(`No se puede desbloquear una clínica en estado "${suscripcion.estado}".`);
  }

  const estadoAntesResult = await db.query(`SELECT estado_antes_bloqueo FROM suscripciones WHERE id = $1`, [
    suscripcion.id,
  ]);
  const estadoDestino: string = estadoAntesResult.rows[0]?.estado_antes_bloqueo ?? "activa";

  await db.query(`UPDATE suscripciones SET estado = $1, estado_antes_bloqueo = NULL WHERE id = $2`, [
    estadoDestino,
    suscripcion.id,
  ]);
  await registrarEvento(db, tenantId, "desbloqueo", motivo, "bloqueada", estadoDestino, ejecutadoPor);
}

export interface EventoCicloVida {
  id: string;
  tipoEvento: TipoEventoCicloVida;
  motivo: string | null;
  estadoAnterior: string | null;
  estadoNuevo: string | null;
  ejecutadoPorNombre: string | null;
  ejecutadoEn: string;
}

// Historial para la pantalla de detalle de clínica (Platform Admin) —
// "quién, cuándo, motivo, estado antes y después" (spec sección 8).
export async function listarHistorialCicloVida(db: EjecutorSql, tenantId: string): Promise<EventoCicloVida[]> {
  const result = await db.query(
    `SELECT e.id, e.tipo_evento, e.motivo, e.estado_anterior, e.estado_nuevo, e.ejecutado_en,
            sp.nombre AS ejecutado_por_nombre
     FROM clinica_eventos_ciclo_vida e
     LEFT JOIN staff_plataforma sp ON sp.id = e.ejecutado_por
     WHERE e.tenant_id = $1
     ORDER BY e.ejecutado_en DESC
     LIMIT 50`,
    [tenantId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    tipoEvento: r.tipo_evento,
    motivo: r.motivo,
    estadoAnterior: r.estado_anterior,
    estadoNuevo: r.estado_nuevo,
    ejecutadoPorNombre: r.ejecutado_por_nombre ?? "Sistema",
    ejecutadoEn: r.ejecutado_en,
  }));
}
