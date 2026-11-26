import cron from "node-cron";
import { Pool } from "pg";
import { pool } from "../db";
import { almacenamientoPrivado } from "../almacenamiento";

// ---------------------------------------------------------------------
// EL BARRIDO DEL AUDIO DICTADO — prompt 07d, fase 2.
//
// La regla del prompt es que el audio NO SE GUARDA después de
// transcribirlo, salvo que la clínica configure una retención. El camino
// de omisión ya cumple eso sin este job: con
// `dictado_retencion_audio_horas = 0` el audio nunca llega al
// almacenamiento.
//
// Este job es para el otro caso: la clínica que sí configuró retención.
// Sin él, «retención de 48 horas» sería una etiqueta en una pantalla y
// el audio se quedaría ahí para siempre — exactamente el tipo de nombre
// que promete algo que el código no hace.
//
// POR QUÉ CORRE CON EL POOL ADMIN: recorre todos los tenants a la vez,
// como el resto de los jobs. No hay un `app.tenant_id` que setear.
//
// LO QUE BORRA Y LO QUE NO: borra el ARCHIVO y la fila de `archivos`.
// NO borra el dictado ni su texto: el texto es parte del expediente y la
// retención es del audio, no de la consulta.
// ---------------------------------------------------------------------

export interface ResultadoBarridoAudio {
  vencidos: number;
  borrados: number;
  fallados: Array<{ dictadoId: string; detalle: string }>;
}

export async function ejecutarBarridoAudioDictado(db: Pool): Promise<ResultadoBarridoAudio> {
  const vencidos = await db.query<{ dictado_id: string; archivo_id: string; url: string }>(
    `SELECT d.id AS dictado_id, a.id AS archivo_id, a.url
       FROM exp_dictados d
       JOIN archivos a ON a.id = d.audio_archivo_id
      WHERE d.audio_borrar_despues_de IS NOT NULL
        AND d.audio_borrar_despues_de <= now()`
  );

  const resultado: ResultadoBarridoAudio = {
    vencidos: vencidos.rows.length,
    borrados: 0,
    fallados: [],
  };

  for (const fila of vencidos.rows) {
    try {
      const clave = fila.url.replace(/^\/uploads\//, "");
      await almacenamientoPrivado.eliminar(clave);
      // EL ORDEN IMPORTA: primero el objeto, después la fila. Al revés,
      // un fallo en el medio dejaría un archivo sin fila que lo nombre, y
      // nadie lo volvería a encontrar para borrarlo.
      await db.query(`UPDATE exp_dictados SET audio_archivo_id = NULL, audio_borrar_despues_de = NULL
                       WHERE id = $1`, [fila.dictado_id]);
      await db.query(`DELETE FROM archivos WHERE id = $1`, [fila.archivo_id]);
      resultado.borrados++;
    } catch (err) {
      resultado.fallados.push({ dictadoId: fila.dictado_id, detalle: (err as Error).message });
    }
  }

  if (resultado.vencidos > 0) {
    console.log(
      `[dictadoAudio.job] ${resultado.borrados}/${resultado.vencidos} audios de dictado vencidos borrados.`
    );
  }
  for (const f of resultado.fallados) {
    console.error(`[dictadoAudio.job] No se pudo borrar el audio del dictado ${f.dictadoId}: ${f.detalle}`);
  }
  return resultado;
}

// Cada hora, no una vez al día: una retención configurada en 1 hora
// tiene que significar una hora, no «hasta mañana a las 9».
export function iniciarJobAudioDictado() {
  cron.schedule("20 * * * *", () => {
    ejecutarBarridoAudioDictado(pool).catch((err) =>
      console.error("[dictadoAudio.job] Error en el job", err)
    );
  });
}
