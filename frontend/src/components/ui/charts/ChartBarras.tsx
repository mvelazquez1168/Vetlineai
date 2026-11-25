import { Bar, BarChart, Cell } from "recharts";
import { colorPorIndice } from "../../../lib/paletaDatos";
import { EjeX, EjeY, Grilla, LeyendaChart, TooltipChart, cursorSegunClic } from "./base";
import { PropsChartBase, PuntoDato, SerieDato, formatearNumero } from "./tipos";
import { MarcoChart } from "./base";

// ---------------------------------------------------------------------
// ChartBarras — vertical u horizontal, simple o apilada.
//
// Un solo componente para las cuatro variantes en vez de cuatro: las
// cuatro son el mismo chart con otra orientación o otra forma de los
// datos, y tener cuatro archivos garantiza que el tooltip de uno termine
// distinto del de otro.
//
// Clic por elemento: cada barra devuelve su etiqueta, su valor, su
// `clave` (lo que el drill-down necesita) y, en las apiladas, el nombre
// de la serie. Sin eso un dashboard no puede llevar de la barra a la
// lista que la compone, que es obligatorio en esta aplicación.
// ---------------------------------------------------------------------

export interface ChartBarrasProps extends PropsChartBase {
  /** Barras simples: un dato por barra. Excluyente con `series`. */
  datos?: PuntoDato[];
  /** Barras apiladas o agrupadas: varias series sobre las mismas etiquetas. */
  series?: SerieDato[];
  /** Etiquetas del eje, obligatorias cuando se usan `series`. */
  etiquetas?: string[];
  /** "vertical" = barras que crecen hacia arriba (por defecto). */
  orientacion?: "vertical" | "horizontal";
  /** Solo con `series`: apiladas (una barra por etiqueta) o agrupadas (una al lado de otra). */
  apiladas?: boolean;
}

export function ChartBarras({
  datos,
  series,
  etiquetas,
  orientacion = "vertical",
  apiladas = false,
  alto,
  alClic,
  formatearValor = formatearNumero,
  className,
  mensajeVacio,
}: ChartBarrasProps) {
  const esMultiserie = Array.isArray(series) && series.length > 0;

  // Recharts quiere un arreglo de objetos planos. Las dos formas de
  // entrada se normalizan a eso acá, no en cada pantalla.
  const filas = esMultiserie
    ? (etiquetas ?? []).map((etiqueta, i) => {
        const fila: Record<string, string | number> = { etiqueta };
        for (const s of series!) fila[s.nombre] = s.valores[i] ?? 0;
        return fila;
      })
    : (datos ?? []).map((d) => ({ etiqueta: d.etiqueta, valor: d.valor }));

  const vacio = filas.length === 0;
  const horizontal = orientacion === "horizontal";

  return (
    <MarcoChart alto={alto} vacio={vacio} mensajeVacio={mensajeVacio} className={className}>
      <BarChart data={filas} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <Grilla />
        {/* En horizontal los ejes se invierten: el de categorías pasa a
            ser el vertical. Es el detalle que más se olvida al hacer un
            chart horizontal a mano. */}
        {horizontal ? <EjeY formatear={formatearValor} /> : <EjeX />}
        {horizontal ? <EjeX /> : <EjeY formatear={formatearValor} />}
        <TooltipChart formatear={formatearValor} />
        {esMultiserie && <LeyendaChart />}

        {esMultiserie
          ? series!.map((s, i) => (
              <Bar
                key={s.nombre}
                dataKey={s.nombre}
                stackId={apiladas ? "apilada" : undefined}
                fill={s.color ?? colorPorIndice(i)}
                radius={apiladas ? 0 : 4}
                cursor={cursorSegunClic(alClic)}
                onClick={(datoBarra: any) =>
                  alClic?.({
                    etiqueta: String(datoBarra?.payload?.etiqueta ?? ""),
                    valor: Number(datoBarra?.payload?.[s.nombre] ?? 0),
                    clave: s.clave,
                    serie: s.nombre,
                  })
                }
              />
            ))
          : (
              <Bar dataKey="valor" radius={4} cursor={cursorSegunClic(alClic)}>
                {/* Una Cell por barra: es la única forma de que cada
                    barra lleve SU color (el fijo de su línea de negocio)
                    en vez de un color único para toda la serie. */}
                {(datos ?? []).map((d, i) => (
                  <Cell
                    key={d.etiqueta}
                    fill={d.color ?? colorPorIndice(i)}
                    onClick={() => alClic?.({ etiqueta: d.etiqueta, valor: d.valor, clave: d.clave })}
                  />
                ))}
              </Bar>
            )}
      </BarChart>
    </MarcoChart>
  );
}
