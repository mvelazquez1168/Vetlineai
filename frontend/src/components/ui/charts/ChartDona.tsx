import { Cell, Pie, PieChart } from "recharts";
import { colorPorIndice } from "../../../lib/paletaDatos";
import { LeyendaChart, MarcoChart, TooltipChart, cursorSegunClic } from "./base";
import { PropsChartBase, PuntoDato, formatearNumero } from "./tipos";

// ChartDona — composición de un total. Dona y no torta: el agujero del
// centro da lugar al total, que es el dato que la gente busca primero, y
// los sectores finos se comparan mejor por longitud de arco que por área.
//
// Advertencia de uso, no de implementación: con más de 6 sectores una
// dona deja de poder leerse. Si hay más, lo correcto es agrupar en
// "otros" en la consulta y ofrecer el drill-down, no agregar colores.
export interface ChartDonaProps extends PropsChartBase {
  datos: PuntoDato[];
  /** Texto grande en el centro. Normalmente el total ya formateado. */
  centro?: string;
  /** Etiqueta chica debajo del total. */
  centroDetalle?: string;
}

export function ChartDona({
  datos,
  centro,
  centroDetalle,
  alto = 260,
  alClic,
  formatearValor = formatearNumero,
  className,
  mensajeVacio,
}: ChartDonaProps) {
  // Un sector de valor 0 no se dibuja pero sí ocupa lugar en la leyenda
  // y recibe un color, así que se descarta: deja la leyenda diciendo
  // cosas que no se ven en el chart.
  const visibles = datos.filter((d) => d.valor > 0);

  return (
    <MarcoChart alto={alto} vacio={visibles.length === 0} mensajeVacio={mensajeVacio} className={className}>
      <PieChart>
        <TooltipChart formatear={formatearValor} />
        <LeyendaChart />
        <Pie
          data={visibles}
          dataKey="valor"
          nameKey="etiqueta"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={1}
          cursor={cursorSegunClic(alClic)}
        >
          {visibles.map((d, i) => (
            <Cell
              key={d.etiqueta}
              fill={d.color ?? colorPorIndice(i)}
              onClick={() => alClic?.({ etiqueta: d.etiqueta, valor: d.valor, clave: d.clave })}
            />
          ))}
          {centro && (
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-text-primary text-xl font-bold"
            >
              {centro}
            </text>
          )}
          {centro && centroDetalle && (
            <text
              x="50%"
              y="50%"
              dy="1.6em"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-text-muted text-xs"
            >
              {centroDetalle}
            </text>
          )}
        </Pie>
      </PieChart>
    </MarcoChart>
  );
}
