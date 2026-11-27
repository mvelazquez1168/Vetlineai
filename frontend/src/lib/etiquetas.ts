// ---------------------------------------------------------------------
// ETIQUETAS DE PRESENTACIÓN — prompt 01c, sección 6.
//
// Las enumeraciones se guardan en minúscula («canino», «hembra
// esterilizada») porque son valores, no texto. Pero en pantalla se leen
// como texto, y ahí «canino · macho» parece un error de carga.
//
// LA REGLA ES: el valor guardado no cambia; cambia cómo se muestra. Sin
// esto la alternativa es un UPDATE masivo que rompe cada comparación
// escrita contra el valor en minúscula, y hay varias.
//
// No es un diccionario cerrado a propósito. Hay enumeraciones que salen
// de catálogos por clínica (los tipos de interacción del CRM, los
// sistemas del examen físico) y una lista fija dejaría afuera lo que
// cada clínica agregue. Solo se nombran los casos donde la mayúscula
// inicial no alcanza.
// ---------------------------------------------------------------------

/** Los que no se resuelven con una mayúscula inicial. */
const EXCEPCIONES: Record<string, string> = {
  // Siglas y nombres propios que no llevan mayúscula inicial y ya está.
  sinpe: "SINPE",
  sinpe_movil: "SINPE Móvil",
  iva: "IVA",
  iah: "IAH",
  crc: "CRC",
  usd: "USD",
  // Marca registrada con mayúscula en el medio: «Whatsapp» no es el
  // nombre del producto.
  whatsapp: "WhatsApp",
};

/**
 * Una enumeración, lista para mostrar: «canino» → «Canino»,
 * «hembra_esterilizada» → «Hembra esterilizada».
 *
 * Devuelve `respaldo` (por defecto «—») cuando no hay valor: un guion
 * dice «no hay dato» y un vacío dice «la pantalla está rota».
 */
export function etiqueta(valor: string | null | undefined, respaldo = "—"): string {
  if (valor === null || valor === undefined) return respaldo;
  const limpio = valor.trim();
  if (limpio === "") return respaldo;
  const clave = limpio.toLowerCase().replace(/\s+/g, "_");
  if (EXCEPCIONES[clave]) return EXCEPCIONES[clave];
  const conEspacios = limpio.replace(/_/g, " ").toLowerCase();
  return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
}

/**
 * Varias enumeraciones unidas: «Canino · Macho».
 * Las vacías no dejan un separador suelto.
 */
export function etiquetas(valores: (string | null | undefined)[], separador = " · "): string {
  return valores
    .map((v) => (v === null || v === undefined || v.trim() === "" ? null : etiqueta(v)))
    .filter((v): v is string => v !== null)
    .join(separador);
}
