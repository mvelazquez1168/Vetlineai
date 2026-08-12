// Zona horaria de referencia para vistas que no tienen un tenant activo
// (ej. Base de Conocimiento en Platform Admin, que no pertenece a ninguna
// clínica) — coincide con el default de tenants.zona_horaria en el backend.
export const ZONA_HORARIA_PLATAFORMA = "America/Costa_Rica";

/**
 * Único punto de formateo de fecha/hora del frontend. Nunca concatenar
 * strings ni usar toLocaleDateString/toLocaleTimeString sueltos — todos
 * pasan por acá, con una zona horaria explícita (nunca implícita/UTC).
 */
export function formatearFecha(
  fecha: string,
  zonaHoraria: string | null | undefined,
  opciones: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("es", {
    timeZone: zonaHoraria ?? ZONA_HORARIA_PLATAFORMA,
    ...opciones,
  }).format(new Date(fecha));
}

export function formatearFechaCorta(fecha: string, zonaHoraria: string | null | undefined): string {
  return formatearFecha(fecha, zonaHoraria, { day: "2-digit", month: "short", year: "numeric" });
}

export function formatearHora(fecha: string, zonaHoraria: string | null | undefined): string {
  return formatearFecha(fecha, zonaHoraria, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// El día calendario de "ahora" en la zona horaria de la clínica — NUNCA
// `new Date().toISOString().slice(0, 10)`, que da el día en UTC. Bug real:
// en Costa Rica (UTC-6) eso hace que todo lo posterior a las 6pm locales
// caiga en el día siguiente (ver bug de reporte de atenciones vacío).
export function fechaHoyEnZona(zonaHoraria: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria ?? ZONA_HORARIA_PLATAFORMA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// "Hoy, 09:30 AM" / "Ayer, 04:15 PM" / fecha completa para cualquier otro
// día — la comparación de "es hoy/ayer" se hace en la zona horaria del
// tenant (nunca la del navegador), con locale en-CA como clave yyyy-mm-dd
// solo para comparar días, nunca para mostrarse.
export function formatearFechaRelativa(fecha: string, zonaHoraria: string | null | undefined): string {
  const zona = zonaHoraria ?? ZONA_HORARIA_PLATAFORMA;
  const claveDia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

  const hoy = claveDia(new Date());
  const ayer = claveDia(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const fechaObj = new Date(fecha);
  const dia = claveDia(fechaObj);
  const hora = new Intl.DateTimeFormat("es", { timeZone: zona, hour: "2-digit", minute: "2-digit" }).format(fechaObj);

  if (dia === hoy) return `Hoy, ${hora}`;
  if (dia === ayer) return `Ayer, ${hora}`;
  return formatearFecha(fecha, zonaHoraria, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
