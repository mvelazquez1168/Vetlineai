// ---------------------------------------------------------------------
// Anotar vs consultar, Paso 2/3 — igual que contextoCaso.ts, este bloque va
// como system ADICIONAL después del bloque cacheado (system_prompt +
// documentos), sin cache_control, y NUNCA como mensajes previos del
// usuario: los bloques de tipo='informacion' se excluyen a propósito del
// array `messages` que arma el historial de conversación (ver
// workspace.routes.ts) — acá se presentan como un único bloque de datos
// del caso, agrupado y en orden cronológico.
//
// "Pendientes" = mensajes con tipo='informacion' e incorporada=false. El
// corte es por esa marca explícita, no por fecha relativa a la última
// respuesta: si se dedujera por fecha, una información agregada mientras
// una llamada anterior todavía está generando (varios segundos) quedaría
// del lado equivocado del corte — su creado_en sería anterior al de la
// respuesta que la sucede, pero el modelo nunca la vio. La marca se pone
// explícitamente, solo sobre las filas que efectivamente se mandaron, solo
// después de que la llamada a Claude respondió con éxito (ver
// workspace.routes.ts) — así una llamada que falla deja la información
// pendiente para el próximo intento en vez de perderla.
// ---------------------------------------------------------------------

export interface InformacionPendiente {
  id: string;
  contenido: string;
  creado_en: Date;
}

export function construirBloqueInformacionRegistrada(
  pendientes: InformacionPendiente[],
  zonaHoraria: string
): string {
  if (pendientes.length === 0) return "";

  // Fecha además de hora — un seguimiento normal puede abarcar varios
  // días, y sin la fecha dos observaciones de días distintos a la misma
  // hora serían indistinguibles en el bloque.
  const formateador = new Intl.DateTimeFormat("es", {
    timeZone: zonaHoraria,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const lineas = pendientes.map((p) => `- [${formateador.format(p.creado_en)}] ${p.contenido}`);

  return (
    "Información clínica registrada por el médico desde tu última respuesta — " +
    "no son turnos de conversación, son datos del caso que tenés que incorporar " +
    "a tu análisis:\n\n" +
    lineas.join("\n")
  );
}

// Se usa como último turno de usuario cuando el médico analiza el caso sin
// escribir texto nuevo (solo con información pendiente). Fijo y siempre
// idéntico a propósito — no varía con el contenido del caso, para no
// introducir variabilidad en la respuesta del modelo por un texto que ni
// siquiera escribió el médico. Nunca se persiste como fila de `mensajes`:
// no es lo que el médico dijo, es el disparador técnico que la Messages
// API exige (el último turno tiene que ser de rol "user").
export const TEXTO_DISPARADOR_ANALISIS = "Analizá el caso con la información registrada.";
