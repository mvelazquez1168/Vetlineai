// ---------------------------------------------------------------------
// LA PUNTUACIÓN DICTADA — prompt 07d, fase 1.
//
// El motor de voz devuelve «punto» como una palabra más. Acá se cambia
// por el signo, con el espaciado que corresponde.
//
// Vive en su propio módulo, sin React, por una razón práctica: así se
// puede correr y verificar sin un navegador. La parte del dictado que
// necesita micrófono no se puede probar en automático; esta sí, y es
// donde están las reglas que se pueden equivocar.
//
// EL ORDEN IMPORTA: «punto y aparte» tiene que probarse antes que
// «punto», o la frase larga nunca se reconoce. Por eso es una lista y
// no un objeto.
// ---------------------------------------------------------------------

const PUNTUACION: Array<[RegExp, string]> = [
  [/\s*\b(punto y aparte|punto aparte)\b\s*/gi, ".\n\n"],
  [/\s*\b(nueva línea|nueva linea|salto de línea|salto de linea)\b\s*/gi, "\n"],
  [/\s*\b(punto y coma)\b\s*/gi, "; "],
  [/\s*\b(punto y seguido|punto seguido|punto)\b\s*/gi, ". "],
  [/\s*\b(dos puntos)\b\s*/gi, ": "],
  [/\s*\b(coma)\b\s*/gi, ", "],
  [/\s*\b(signo de interrogación|signo de interrogacion)\b\s*/gi, "? "],
];

export function aplicarPuntuacionDictada(texto: string): string {
  let salida = texto;
  for (const [patron, signo] of PUNTUACION) salida = salida.replace(patron, signo);
  // Mayúscula después de punto: el motor devuelve todo en minúscula
  // cuando la frase se cortó por puntuación dictada y no por una pausa.
  salida = salida.replace(/([.!?]\s+|\n+)(\p{Ll})/gu, (_m, sep: string, letra: string) =>
    sep + letra.toUpperCase()
  );
  return salida;
}
