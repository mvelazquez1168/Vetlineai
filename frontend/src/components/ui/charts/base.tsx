import { ReactNode } from "react";
import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ALTO_CHART_POR_DEFECTO, formatearNumero } from "./tipos";

// ---------------------------------------------------------------------
// Las piezas que comparten los cinco charts: colores de eje, grilla,
// tooltip y estado vacío. Están acá para que los cinco se vean como un
// solo sistema — si cada uno eligiera su gris de grilla, dos charts
// vecinos en el mismo dashboard se verían de dos productos distintos.
//
// Todos los valores salen de los tokens de `tailwind.config.js`. Recharts
// pinta SVG con atributos, no con clases, así que acá hacen falta los
// hex: son los MISMOS que los tokens, y están nombrados para que se vea
// de dónde vienen.
// ---------------------------------------------------------------------

/** = text-muted. Ejes y etiquetas. */
export const COLOR_EJE = "#5A6B82";
/** = black/5, la línea de la grilla y los bordes de las tarjetas. */
export const COLOR_GRILLA = "#0000000d";
/** = surface. Fondo del tooltip. */
export const COLOR_SUPERFICIE = "#FFFFFF";
/** = text-primary. */
export const COLOR_TEXTO = "#121E36";

export const ESTILO_EJE = { fontSize: 12, fill: COLOR_EJE } as const;

export function EjeX({ dataKey = "etiqueta" }: { dataKey?: string }) {
  return (
    <XAxis
      dataKey={dataKey}
      tick={ESTILO_EJE}
      stroke={COLOR_GRILLA}
      tickLine={false}
      axisLine={{ stroke: COLOR_GRILLA }}
    />
  );
}

export function EjeY({ formatear = formatearNumero }: { formatear?: (v: number) => string }) {
  return (
    <YAxis
      tick={ESTILO_EJE}
      stroke={COLOR_GRILLA}
      tickLine={false}
      axisLine={false}
      tickFormatter={formatear}
      width={56}
    />
  );
}

export function Grilla() {
  return <CartesianGrid stroke={COLOR_GRILLA} vertical={false} />;
}

export function TooltipChart({ formatear = formatearNumero }: { formatear?: (v: number) => string }) {
  return (
    <Tooltip
      formatter={(valor) => formatear(Number(valor))}
      contentStyle={{
        backgroundColor: COLOR_SUPERFICIE,
        border: "1px solid rgba(0,0,0,0.05)",
        borderRadius: "0.75rem",
        fontSize: 12,
        color: COLOR_TEXTO,
        boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      }}
      // Sin este cursor, recharts pinta un rectángulo gris opaco sobre la
      // barra señalada y tapa justamente el dato que se está mirando.
      cursor={{ fill: "rgba(0,0,0,0.04)" }}
    />
  );
}

export function LeyendaChart() {
  return <Legend wrapperStyle={{ fontSize: 12, color: COLOR_EJE }} iconType="circle" iconSize={8} />;
}

/**
 * Envoltorio común: resuelve el alto, el ancho responsivo y el estado
 * vacío. Un chart sin datos NO se dibuja — un eje vacío se lee como
 * "cero" cuando en realidad es "no hay nada cargado", que es distinto.
 */
export function MarcoChart({
  alto = ALTO_CHART_POR_DEFECTO,
  vacio,
  mensajeVacio = "No hay datos para este período.",
  className = "",
  children,
}: {
  alto?: number;
  vacio: boolean;
  mensajeVacio?: string;
  className?: string;
  children: ReactNode;
}) {
  if (vacio) {
    return (
      <div
        className={["flex items-center justify-center text-sm text-text-muted", className].join(" ")}
        style={{ height: alto }}
      >
        {mensajeVacio}
      </div>
    );
  }
  return (
    <div className={className} style={{ height: alto }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as any}
      </ResponsiveContainer>
    </div>
  );
}

/** Cursor de mano solo si el chart es clickeable, para no mentir sobre la interacción. */
export function cursorSegunClic(alClic: unknown): string | undefined {
  return alClic ? "pointer" : undefined;
}
