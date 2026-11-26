// Zona horaria de referencia para vistas que no tienen un tenant activo
// (ej. Base de Conocimiento en Platform Admin, que no pertenece a ninguna
// clínica) — coincide con el default de tenants.zona_horaria en el backend.
export const ZONA_HORARIA_PLATAFORMA = "America/Costa_Rica";

/**
 * Único punto de formateo de fecha/hora del frontend. Nunca concatenar
 * strings ni usar toLocaleDateString/toLocaleTimeString sueltos — todos
 * pasan por acá, con una zona horaria explícita (nunca implícita/UTC).
 */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function formatearFecha(
  fecha: string,
  zonaHoraria: string | null | undefined,
  opciones: Intl.DateTimeFormatOptions
): string {
  // UNA FECHA DE CALENDARIO NO TIENE ZONA HORARIA, y convertirla es el
  // error. "2026-12-26" es el 26 de diciembre en todas partes; pero
  // `new Date("2026-12-26")` lo interpreta como medianoche UTC, y al
  // mostrarlo en Costa Rica (UTC-6) da el 25.
  //
  // DEFECTO REAL, visto en el catálogo de inventario: un lote que vence
  // el 26 se mostraba venciendo el 25. Pasaba en TODA columna de fecha
  // sin hora —vencimientos, fechas de aplicación, fechas de nacimiento—
  // y nadie lo notaba porque un día de diferencia no se ve raro.
  //
  // Se arregla acá y no en cada pantalla, que es para lo que existe
  // este módulo.
  if (SOLO_FECHA.test(fecha)) {
    const [anio, mes, dia] = fecha.split("-").map(Number);
    return new Intl.DateTimeFormat("es", {
      timeZone: "UTC",
      ...opciones,
    }).format(new Date(Date.UTC(anio, mes - 1, dia)));
  }
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
