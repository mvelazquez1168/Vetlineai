import { Pool, PoolClient } from "pg";
import { DatosPlantilla, TipoCorreo, enviarCorreoTransaccional } from "./correos";

// ---------------------------------------------------------------------
// prompt_code_notificaciones_pendientes.md — punto único de emisión.
// Antes cada disparador de notificaciones.job.ts repetía el mismo par de
// pasos (insertar en `notificaciones`, mandar el correo) por su cuenta.
// Ahora vive acá, para que también lo usen los flujos que responden a un
// hecho (citas.routes.ts, casos.routes.ts) sin que cada uno arme su
// propio envío — es la misma disciplina que ya se aplicó para el envío
// en sí (prompt_code_notificaciones.md).
//
// Tipado sobre Pool | PoolClient (mismo patrón que correos.ts y
// suspensionBloqueo.ts) porque se llama tanto desde el job diario (pool
// crudo, sin request activo) como desde handlers de ruta (req.db!, ya
// dentro de una transacción).
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

// El envío en sí — separado de emitirNotificacion() porque
// procesarRecordatoriosCita necesita su propio INSERT con
// ON CONFLICT ... DO NOTHING (dedup por índice único, no por ventana de
// tiempo como el resto) antes de llegar a este paso.
export async function enviarNotificacionPorCorreo<T extends TipoCorreo>(
  db: EjecutorSql,
  tenantId: string,
  notificacionId: string,
  destinatarioTipo: "propietario" | "medico",
  destinatarioId: string,
  tipo: T,
  datos: DatosPlantilla[T]
): Promise<void> {
  try {
    const tabla = destinatarioTipo === "propietario" ? "propietarios" : "personas";
    const destinatario = await db.query(`SELECT email FROM ${tabla} WHERE id = $1`, [destinatarioId]);
    const email = destinatario.rows[0]?.email;
    if (!email) {
      await db.query(`UPDATE notificaciones SET estado = 'fallida', error = $2 WHERE id = $1`, [
        notificacionId,
        "El destinatario no tiene correo electrónico cargado.",
      ]);
      return;
    }

    const { correoEnviadoId, resultado } = await enviarCorreoTransaccional(db, tenantId, email, tipo, datos);
    if (resultado === "no_configurado") return; // Resend no configurado: se mantiene 'simulada'.
    await db.query(`UPDATE notificaciones SET estado = $2, correo_enviado_id = $3 WHERE id = $1`, [
      notificacionId,
      resultado === "enviado" ? "enviada" : "fallida",
      correoEnviadoId,
    ]);
  } catch (err) {
    console.error(`[notificaciones] Fallo inesperado al procesar el envío de la notificación ${notificacionId}`, err);
    await db.query(`UPDATE notificaciones SET estado = 'fallida', error = $2 WHERE id = $1`, [
      notificacionId,
      err instanceof Error ? err.message : String(err),
    ]);
  }
}

export interface EmitirNotificacionParams<T extends TipoCorreo> {
  tenantId: string;
  tipo: T;
  destinatarioTipo: "propietario" | "medico";
  destinatarioId: string;
  asunto: string;
  contenido: string;
  datosCorreo: DatosPlantilla[T];
  casoId?: string | null;
  pacienteId?: string | null;
  citaId?: string | null;
  cuidadoPreventivoId?: string | null;
}

// Inserta la notificación (registro interno — campanita, historial) y
// dispara el envío real. Devuelve el id de la notificación creada.
export async function emitirNotificacion<T extends TipoCorreo>(
  db: EjecutorSql,
  params: EmitirNotificacionParams<T>
): Promise<string> {
  const insertado = await db.query(
    `INSERT INTO notificaciones
       (tenant_id, tipo, destinatario_tipo, destinatario_id, caso_id, paciente_id, cita_id, cuidado_preventivo_id, asunto, contenido)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      params.tenantId,
      params.tipo,
      params.destinatarioTipo,
      params.destinatarioId,
      params.casoId ?? null,
      params.pacienteId ?? null,
      params.citaId ?? null,
      params.cuidadoPreventivoId ?? null,
      params.asunto,
      params.contenido,
    ]
  );
  const notificacionId = insertado.rows[0].id as string;
  await enviarNotificacionPorCorreo(
    db,
    params.tenantId,
    notificacionId,
    params.destinatarioTipo,
    params.destinatarioId,
    params.tipo,
    params.datosCorreo
  );
  return notificacionId;
}

// Lee el toggle de un aviso para un tenant — configuracion_notificaciones
// puede no tener fila todavía (tenant nunca la tocó), de ahí el
// COALESCE con el default "activo" que ya usa notificaciones.job.ts.
// Columna restringida a una lista fija (nunca viene de un request) para
// no interpolar nombres de columna arbitrarios en el SQL.
export type ColumnaAvisoActivo =
  | "recordatorio_cita_activo"
  | "desparasitacion_activo"
  | "seguimiento_faltante_activo"
  | "vacunacion_activo"
  | "seguimiento_posterior_activo"
  | "agenda_dia_siguiente_activo"
  | "confirmacion_cita_activo"
  | "cancelacion_cita_activo"
  | "informe_disponible_activo";

export async function avisoActivo(db: EjecutorSql, tenantId: string, columna: ColumnaAvisoActivo): Promise<boolean> {
  const result = await db.query(
    `SELECT COALESCE((SELECT ${columna} FROM configuracion_notificaciones WHERE tenant_id = $1), true) AS activo`,
    [tenantId]
  );
  return result.rows[0].activo;
}
