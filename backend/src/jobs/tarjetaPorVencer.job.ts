import cron from "node-cron";
import { Pool } from "pg";
import { pool } from "../db";
import { enviarCorreoTransaccional, obtenerAdminClinica, urlMedioPago } from "../correos";

// ---------------------------------------------------------------------
// Correo 4 (tarjeta por vencer) — prompt_code_correos_y_logo. Es el
// correo de mejor rendimiento porque evita el problema en vez de
// comunicarlo, así que la anticipación es un parámetro de plataforma
// (cobro.aviso_vencimiento_dias) y no un valor cableado.
//
// Un aviso por método de pago (metodos_pago.aviso_vencimiento_enviado_en,
// migración 042) — sin esa marca el job diario mandaría el mismo correo
// todos los días hasta que se reemplace la tarjeta.
// ---------------------------------------------------------------------

async function leerAvisoVencimientoDias(db: Pool): Promise<number> {
  const result = await db.query(`SELECT valor FROM parametros_plataforma WHERE clave = 'cobro.aviso_vencimiento_dias'`);
  return result.rows[0]?.valor != null ? Number(result.rows[0].valor) : 20;
}

export async function ejecutarJobTarjetaPorVencer(db: Pool): Promise<{ evaluadas: number; avisadas: number }> {
  const avisoDias = await leerAvisoVencimientoDias(db);

  const candidatos = await db.query(
    `SELECT mp.id AS metodo_id, mp.tenant_id, mp.marca, mp.ultimos4, mp.vencimiento_mes, mp.vencimiento_anio,
            t.zona_horaria, s.periodo_fin
     FROM metodos_pago mp
     JOIN tenants t ON t.id = mp.tenant_id
     LEFT JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE mp.predeterminado = true AND mp.estado = 'activo'
       AND mp.aviso_vencimiento_enviado_en IS NULL
       AND (make_date(mp.vencimiento_anio, mp.vencimiento_mes, 1) + interval '1 month' - interval '1 day')
             BETWEEN now() AND now() + ($1 || ' days')::interval`,
    [avisoDias]
  );

  let avisadas = 0;
  for (const fila of candidatos.rows) {
    try {
      const admin = await obtenerAdminClinica(db, fila.tenant_id);
      if (!admin) continue;

      const vencimiento = `${String(fila.vencimiento_mes).padStart(2, "0")}/${fila.vencimiento_anio}`;
      const proximoCobroFecha = fila.periodo_fin
        ? new Intl.DateTimeFormat("es", {
            timeZone: fila.zona_horaria ?? "America/Costa_Rica",
            day: "2-digit",
            month: "long",
            year: "numeric",
          }).format(new Date(fila.periodo_fin))
        : null;

      const { correoEnviadoId } = await enviarCorreoTransaccional(db, fila.tenant_id, admin.email, "tarjeta_por_vencer", {
        marca: fila.marca,
        ultimos4: fila.ultimos4,
        vencimiento,
        proximoCobroFecha,
        enlace: urlMedioPago(),
      });

      if (correoEnviadoId) {
        await db.query(`UPDATE metodos_pago SET aviso_vencimiento_enviado_en = now() WHERE id = $1`, [fila.metodo_id]);
        avisadas++;
      }
    } catch (err) {
      console.error(`[tarjetaPorVencer.job] Error procesando el método de pago ${fila.metodo_id}`, err);
    }
  }

  return { evaluadas: candidatos.rows.length, avisadas };
}

// Una vez al día alcanza — la anticipación se mide en días, no en horas.
export function iniciarJobTarjetaPorVencer() {
  cron.schedule("0 8 * * *", () => {
    ejecutarJobTarjetaPorVencer(pool).catch((err) => console.error("[tarjetaPorVencer.job] Error en el job", err));
  });
}
