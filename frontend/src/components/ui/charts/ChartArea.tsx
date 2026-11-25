import { Area, AreaChart } from "recharts";
import { colorPorIndice } from "../../../lib/paletaDatos";
import { EjeX, EjeY, Grilla, LeyendaChart, MarcoChart, TooltipChart, cursorSegunClic } from "./base";
import { PropsChartBase, SerieDato, formatearNumero } from "./tipos";

// ChartArea — lo mismo que ChartLinea pero con el área rellena, y
// apilable. Se usa cuando lo que importa es el TOTAL además de la forma
// (ingresos acumulados por línea de negocio); si lo que importa es
// comparar las series entre sí, va ChartLinea: las áreas apiladas hacen
// difícil leer una serie que no sea la de abajo.
export interface ChartAreaProps extends PropsChartBase {
  series: SerieDato[];
  etiquetas: string[];
  apiladas?: boolean;
}

export function ChartArea({
  series,
  etiquetas,
  apiladas = true,
  alto,
  alClic,
  formatearValor = formatearNumero,
  className,
  mensajeVacio,
}: ChartAreaProps) {
  const filas = etiquetas.map((etiqueta, i) => {
    const fila: Record<string, string | number> = { etiqueta };
    for (const s of series) fila[s.nombre] = s.valores[i] ?? 0;
    return fila;
  });

  return (
    <MarcoChart alto={alto} vacio={filas.length === 0} mensajeVacio={mensajeVacio} className={className}>
      <AreaChart data={filas} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <Grilla />
        <EjeX />
        <EjeY formatear={formatearValor} />
        <TooltipChart formatear={formatearValor} />
        {series.length > 1 && <LeyendaChart />}
        {series.map((s, i) => {
          const color = s.color ?? colorPorIndice(i);
          return (
            <Area
              key={s.nombre}
              type="monotone"
              dataKey={s.nombre}
              stackId={apiladas ? "apilada" : undefined}
              stroke={color}
              // Relleno translúcido: con las áreas opacas, una serie de
              // abajo desaparece por completo detrás de la de arriba
              // cuando NO están apiladas.
              fill={color}
              fillOpacity={apiladas ? 0.85 : 0.25}
              strokeWidth={2}
              cursor={cursorSegunClic(alClic)}
              onClick={(datoPunto: any) =>
                alClic?.({
                  etiqueta: String(datoPunto?.payload?.etiqueta ?? ""),
                  valor: Number(datoPunto?.payload?.[s.nombre] ?? 0),
                  clave: s.clave,
                  serie: s.nombre,
                })
              }
            />
          );
        })}
      </AreaChart>
    </MarcoChart>
  );
}
