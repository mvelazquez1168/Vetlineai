// ---------------------------------------------------------------------
// PLURALES, ESCRITOS COMO SE HABLA — prompt 01c, sección 7.
//
// El relevamiento encontró la forma «cargo(s)», «1 aprobación(es)»,
// «0 lote(s)». Nadie escribe así en castellano: es una forma de no
// decidir, y se la deja pagar al que lee. Acá se decide.
//
// `cero` existe porque «0 productos bajo el mínimo» es correcto pero
// mucho peor que «ningún producto bajo el mínimo» cuando la frase es
// justamente una buena noticia.
// ---------------------------------------------------------------------

export function plural(
  cantidad: number,
  singular: string,
  pluralForma: string,
  opciones?: { cero?: string }
): string {
  if (cantidad === 0 && opciones?.cero) return opciones.cero;
  return `${cantidad} ${cantidad === 1 ? singular : pluralForma}`;
}
