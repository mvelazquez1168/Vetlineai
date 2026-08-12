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
