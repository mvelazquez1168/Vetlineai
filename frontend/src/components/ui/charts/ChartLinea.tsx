import { Line, LineChart } from "recharts";
import { colorPorIndice } from "../../../lib/paletaDatos";
import { EjeX, EjeY, Grilla, LeyendaChart, MarcoChart, TooltipChart, cursorSegunClic } from "./base";
import { PropsChartBase, SerieDato, formatearNumero } from "./tipos";

// ChartLinea — una o varias series sobre el mismo eje. Es el chart de
// "cómo evolucionó esto en el tiempo", así que las etiquetas suelen ser
// semanas o meses ya formateados por `formatFecha` en la pantalla: este
// componente NO formatea fechas, recibe los textos listos. El motivo es
// que la zona horaria es del tenant y eso se resuelve en un solo lugar.
export interface ChartLineaProps extends PropsChartBase {
  series: SerieDato[];
  etiquetas: string[];
  /** Muestra el punto de cada dato. Útil con pocas etiquetas, ruidoso con muchas. */
  conPuntos?: boolean;
}

export function ChartLinea({
  series,
  etiquetas,
  conPuntos = false,
  alto,
  alClic,
  formatearValor = formatearNumero,
  className,
  mensajeVacio,
}: ChartLineaProps) {
  const filas = etiquetas.map((etiqueta, i) => {
    const fila: Record<string, string | number> = { etiqueta };
    for (const s of series) fila[s.nombre] = s.valores[i] ?? 0;
    return fila;
  });

  return (
    <MarcoChart alto={alto} vacio={filas.length === 0} mensajeVacio={mensajeVacio} className={className}>
      <LineChart data={filas} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <Grilla />
        <EjeX />
        <EjeY formatear={formatearValor} />
        <TooltipChart formatear={formatearValor} />
        {series.length > 1 && <LeyendaChart />}
        {series.map((s, i) => (
          <Line
            key={s.nombre}
            type="monotone"
            dataKey={s.nombre}
            stroke={s.color ?? colorPorIndice(i)}
            strokeWidth={2}
            dot={conPuntos ? { r: 3 } : false}
            activeDot={{ r: 5, cursor: cursorSegunClic(alClic) }}
            onClick={(datoPunto: any) =>
              alClic?.({
                etiqueta: String(datoPunto?.payload?.etiqueta ?? ""),
                valor: Number(datoPunto?.payload?.[s.nombre] ?? 0),
                clave: s.clave,
                serie: s.nombre,
              })
            }
          />
        ))}
      </LineChart>
    </MarcoChart>
  );
}
