import { Line, LineChart, ResponsiveContainer } from "recharts";
import { colorPorIndice } from "../../../lib/paletaDatos";

// Sparkline — la tendencia en miniatura que va dentro de una KpiCard.
//
// Deliberadamente SIN ejes, grilla, tooltip ni leyenda: no es un chart
// chico, es un glifo. Su trabajo es decir "viene subiendo" de un vistazo;
// el número exacto ya está al lado, y el detalle está a un clic en el
// drill-down de la tarjeta. Agregarle un tooltip lo convertiría en un
// chart mal hecho.
//
// Tampoco recibe `alClic`: quien es clickeable es la tarjeta entera, y
// dos blancos de clic distintos en el mismo elemento confunden.
export interface SparklineProps {
  valores: number[];
  color?: string;
  alto?: number;
  className?: string;
}

export function Sparkline({ valores, color, alto = 36, className = "" }: SparklineProps) {
  // Con menos de dos puntos no hay línea que dibujar: una raya de un
  // punto se lee como una tendencia plana, que es una afirmación falsa.
  if (valores.length < 2) {
    return <div className={className} style={{ height: alto }} aria-hidden="true" />;
  }

  const filas = valores.map((valor, i) => ({ i, valor }));

  return (
    <div className={className} style={{ height: alto }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={filas} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Line
            type="monotone"
            dataKey="valor"
            stroke={color ?? colorPorIndice(3)}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
