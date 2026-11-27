// Único punto para "hoy" en la zona horaria de la clínica — nunca
// `new Date().toISOString().slice(0, 10)`, que da el día en UTC. Bug real
// encontrado y corregido en el reporte de atenciones: en Costa Rica
// (UTC-6) eso hacía que todo lo posterior a las 6pm locales cayera en el
// día siguiente. Mismo criterio que `frontend/src/lib/formatFecha.ts`.
export function fechaHoyEnZona(zonaHoraria: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria ?? "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * La hora de la clínica, «HH:MM».
 *
 * Lo mismo que `fechaHoyEnZona` para la hora: `new
 * Date().toISOString().slice(11, 16)` da la hora UTC, así que una
 * atención sin turno abierta a las 14:30 en Costa Rica quedaba
 * registrada a las 20:30.
 */
export function horaAhoraEnZona(zonaHoraria: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zonaHoraria ?? "America/Costa_Rica",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/**
 * La zona horaria de una clínica, leída de la base.
 *
 * Para el dominio, que no recibe `req.auth`. En las rutas se usa
 * `req.auth!.zonaHoraria`, que ya viene resuelto por solicitud y no
 * cuesta una consulta.
 */
export async function zonaDeLaClinica(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ zona_horaria: string | null }> }> },
  tenantId: string
): Promise<string> {
  const r = await db.query(`SELECT zona_horaria FROM tenants WHERE id = $1`, [tenantId]);
  return r.rows[0]?.zona_horaria ?? "America/Costa_Rica";
}

/**
 * Un instante, como fecha «AAAA-MM-DD» en la zona de la clínica.
 *
 * La forma general de `fechaHoyEnZona`, para cuando la fecha a mostrar
 * no es hoy: un vencimiento, un «disponible a partir de».
 */
export function fechaEnZona(instante: Date, zonaHoraria: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria ?? "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}
