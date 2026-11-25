// ---------------------------------------------------------------------
// Contrato común de los charts. Vive aparte de los componentes para que
// una pantalla pueda tipar sus datos sin importar ningún chart (y, de
// paso, sin arrastrar recharts a ese módulo).
//
// LA REGLA DE ESTE DIRECTORIO: `recharts` se importa SOLO acá adentro.
// Ninguna pantalla la importa. Igual que con los íconos, el motivo es
// poder cambiarla: una librería de charts se elige una vez y se
// reemplaza cuando deja de alcanzar, y con 4 dashboards importándola
// directamente eso ya no se puede hacer.
// ---------------------------------------------------------------------

/** Un punto de una serie categórica: una barra, un sector, un punto de línea. */
export interface PuntoDato {
  /** Lo que se muestra en el eje o la leyenda. */
  etiqueta: string;
  valor: number;
  /**
   * Color explícito. Si no viene, el chart usa la paleta por índice.
   * Las líneas de negocio SIEMPRE lo pasan, con `colorDeLinea()`, para
   * que la consulta sea del mismo color en todas las pantallas.
   */
  color?: string;
  /**
   * Lo que el drill-down necesita para saber a dónde ir: un id de línea
   * de negocio, un id de producto, una fecha. El chart no lo interpreta,
   * solo lo devuelve en el clic.
   */
  clave?: string;
}

/** Una serie con nombre, para charts de varias series (apiladas, multilinea). */
export interface SerieDato {
  nombre: string;
  color?: string;
  clave?: string;
  /** Un valor por cada etiqueta del eje, en el mismo orden que `etiquetas`. */
  valores: number[];
}

/**
 * Manejador de clic por elemento. El drill-down es obligatorio en toda
 * la aplicación (guía rectora §4.4: "un clic en una barra, un sector o
 * una tarjeta lleva a la lista filtrada que la compone"), así que es
 * parte del contrato de todos los charts, no una extra de algunos.
 *
 * Es opcional en el tipo porque hay charts decorativos (un sparkline
 * dentro de una KpiCard que ya es clickeable por sí misma), pero si una
 * pantalla muestra un chart de datos sin esto, le falta el drill-down.
 */
export type AlClicElemento = (punto: {
  etiqueta: string;
  valor: number;
  clave?: string;
  /** Nombre de la serie, en los charts que tienen más de una. */
  serie?: string;
}) => void;

export interface PropsChartBase {
  /** Alto en px. Los charts no tienen alto propio: lo decide la pantalla. */
  alto?: number;
  alClic?: AlClicElemento;
  /** Formatea el valor en el tooltip y en los ejes (moneda, porcentaje, unidades). */
  formatearValor?: (valor: number) => string;
  className?: string;
  /** Qué decir cuando no hay datos. Los charts no se dibujan vacíos. */
  mensajeVacio?: string;
}

export const ALTO_CHART_POR_DEFECTO = 260;

/** Formato por defecto: entero con separador de miles, en es-CR. */
export function formatearNumero(valor: number): string {
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 }).format(valor);
}
