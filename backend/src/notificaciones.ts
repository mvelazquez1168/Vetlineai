import { Pool, PoolClient } from "pg";
import { anotarCorreoDeNotificacion } from "./crm/mensajeria";
import { puedeEnviar } from "./crm/consentimientos";
import { DatosPlantilla, TipoCorreo, enviarCorreoTransaccional } from "./correos";
import { AdjuntoEmail } from "./email";

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
  datos: DatosPlantilla[T],
  adjuntos?: AdjuntoEmail[]
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

    const { correoEnviadoId, resultado } = await enviarCorreoTransaccional(
      db,
      tenantId,
      email,
      tipo,
      datos,
      adjuntos
    );
    if (resultado === "no_configurado") return; // Resend no configurado: se mantiene 'simulada'.
    // `enviada_en` solo cuando salió de verdad: en una fallida queda en
    // NULL, que es la verdad. La rama de WhatsApp la escribe igual —ahí
    // se descubrió que la columna no existía (migración 148)—.
    await db.query(
      `UPDATE notificaciones
          SET estado = $2, correo_enviado_id = $3,
              enviada_en = CASE WHEN $2 = 'enviada' THEN now() ELSE enviada_en END
        WHERE id = $1`,
      [notificacionId, resultado === "enviado" ? "enviada" : "fallida", correoEnviadoId]
    );
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
  /**
   * Lo que viaja con el correo. Va acá y no en `datosCorreo` por lo
   * mismo que en `enviarCorreoTransaccional`: la plantilla dice qué se
   * escribe y esto qué se acompaña. Lo necesita la receta (prompt 07c),
   * que sin su PDF es un correo que no sirve para nada.
   */
  adjuntos?: AdjuntoEmail[];
}

// Inserta la notificación (registro interno — campanita, historial) y
// dispara el envío real. Devuelve el id de la notificación creada.
export async function emitirNotificacion<T extends TipoCorreo>(
  db: EjecutorSql,
  params: EmitirNotificacionParams<T>
): Promise<string> {
  // EL PUNTO ÚNICO ANTES DE ENVIAR (prompt 03, sección 5).
  //
  // Solo para el cliente final: un aviso a un MÉDICO de la clínica no
  // es un mensaje de marketing ni necesita su consentimiento — es parte
  // de su trabajo, y la agenda del día siguiente tiene que llegarle a
  // las 20:30 si así está configurada.
  //
  // El registro interno (la campanita, el historial) se escribe IGUAL
  // cuando el envío queda bloqueado: la clínica tiene que poder ver que
  // había algo para avisar y por qué no salió. Lo que no sale es el
  // correo.
  //
  // EL CANAL YA NO ESTÁ FIJO EN CORREO (anexo 07-03, B4). Lo resuelve
  // `puedeEnviar` recorriendo los canales consentidos, empezando por el
  // preferido del cliente. Hasta acá, la preferencia que la clínica
  // cargaba en la ficha no influía en NADA: todas las notificaciones
  // del sistema —citas, recetas, preventivos, informes— salían por
  // correo igual.
  let bloqueo: string | null = null;
  let canalElegido: "correo" | "whatsapp" = "correo";
  let canalAlternativo = false;
  if (params.destinatarioTipo === "propietario") {
    const veredicto = await puedeEnviar(db, {
      tenantId: params.tenantId,
      propietarioId: params.destinatarioId,
      pacienteId: params.pacienteId ?? null,
      finalidad: "salud",
      tipo: params.tipo,
    });
    if (!veredicto.puede) {
      bloqueo = veredicto.explicacion ?? veredicto.motivo ?? "sin motivo";
    } else {
      canalElegido = veredicto.canal;
      canalAlternativo = veredicto.canalAlternativo === true;
    }
  }

  // EL CANAL QUE DE VERDAD SE VA A USAR (prompt 10a).
  //
  // DEFECTO QUE ESTO CIERRA: esta columna existe desde el 03 con un
  // CHECK de un solo valor ('correo') y el INSERT no la escribía nunca.
  // Desde que el anexo 07-03 despacha por WhatsApp, **todo aviso enviado
  // por WhatsApp quedó registrado como «correo»**: la columna decía algo
  // que no era cierto. La migración 153 extiende el CHECK y acá se
  // escribe lo que se va a usar.
  const insertado = await db.query(
    `INSERT INTO notificaciones
       (tenant_id, tipo, destinatario_tipo, destinatario_id, caso_id, paciente_id, cita_id, cuidado_preventivo_id, asunto, contenido, canal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      canalElegido,
    ]
  );
  const notificacionId = insertado.rows[0].id as string;

  if (bloqueo) {
    await db.query(`UPDATE notificaciones SET estado = 'fallida', error = $2 WHERE id = $1`, [
      notificacionId,
      `No se envió: ${bloqueo}`,
    ]);
    await anotarCorreoDeNotificacion(db as PoolClient, params.tenantId, {
      propietarioId: params.destinatarioId,
      pacienteId: params.pacienteId ?? null,
      tipo: params.tipo,
      estado: "bloqueado",
      motivo: bloqueo,
    });
    console.log(`[notificaciones] ${params.tipo} no salió: ${bloqueo}`);
    return notificacionId;
  }

  // EL DESPACHO, POR EL CANAL DEL VEREDICTO.
  //
  // WhatsApp va por `crm/mensajeria.ts`, que es el único que tiene
  // proveedor (simulado en desarrollo, con el setter que se niega a
  // usar uno real sin ENVIOS_REALES=1). El correo sigue por donde
  // siempre, con su plantilla y su marca de clínica: el mensaje de
  // WhatsApp es texto, no tiene plantilla HTML, y por eso NO se puede
  // mandar lo mismo por los dos lados.
  if (canalElegido === "whatsapp") {
    const { enviarMensaje } = await import("./crm/mensajeria");
    await enviarMensaje(db as PoolClient, params.tenantId, {
      propietarioId: params.destinatarioId,
      pacienteId: params.pacienteId ?? null,
      canal: "whatsapp",
      finalidad: "salud",
      tipo: params.tipo,
      texto: `${params.asunto}\n\n${params.contenido}`,
    });
    await db.query(`UPDATE notificaciones SET estado = 'enviada', enviada_en = now() WHERE id = $1`, [
      notificacionId,
    ]);
    if (canalAlternativo) {
      console.log(
        `[notificaciones] ${params.tipo} salió por WhatsApp y no por el canal preferido del cliente.`
      );
    }
    return notificacionId;
  }

  await enviarNotificacionPorCorreo(
    db,
    params.tenantId,
    notificacionId,
    params.destinatarioTipo,
    params.destinatarioId,
    params.tipo,
    params.datosCorreo,
    params.adjuntos
  );

  // El correo, anotado en el registro del CRM: es sobre esa tabla que se
  // cuentan el tope y la ventana de duplicados.
  if (params.destinatarioTipo === "propietario") {
    const envio = await db.query<{ estado: string; correo_enviado_id: string | null }>(
      `SELECT estado, correo_enviado_id FROM notificaciones WHERE id = $1`,
      [notificacionId]
    );
    await anotarCorreoDeNotificacion(db as PoolClient, params.tenantId, {
      propietarioId: params.destinatarioId,
      pacienteId: params.pacienteId ?? null,
      tipo: params.tipo,
      estado: envio.rows[0]?.estado === "fallida" ? "fallido" : "enviado",
      correoEnviadoId: envio.rows[0]?.correo_enviado_id ?? null,
    });
  }

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
  | "informe_disponible_activo"
  | "cumpleanos_activo";

export async function avisoActivo(db: EjecutorSql, tenantId: string, columna: ColumnaAvisoActivo): Promise<boolean> {
  const result = await db.query(
    `SELECT COALESCE((SELECT ${columna} FROM configuracion_notificaciones WHERE tenant_id = $1), true) AS activo`,
    [tenantId]
  );
  return result.rows[0].activo;
}
