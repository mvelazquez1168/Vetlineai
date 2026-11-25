import { Sparkline } from "./charts";
import { Icono } from "./Icono";

// ---------------------------------------------------------------------
// KpiCard — valor, variación contra el período anterior, y sparkline.
//
// DECISIÓN DE COLOR, que es la parte que se suele hacer mal: el color de
// la variación NO sale del signo. Que una cifra suba es bueno en
// ingresos y malo en inasistencias o en cuentas por cobrar. Por eso
// `sentido` dice qué significa subir para ESTE indicador, y el verde o
// el rojo salen de ahí. Un dashboard que pinta de verde toda flecha
// hacia arriba le miente a quien lo lee.
//
// `sentido: "neutro"` existe para los indicadores donde subir no es ni
// bueno ni malo (cantidad de atenciones, por ejemplo): la flecha se
// muestra, el color no.
//
// La tarjeta ENTERA es el blanco de clic cuando hay drill-down, no un
// enlace adentro: es lo que hace que el gesto sea el mismo en los cuatro
// niveles de dashboard.
// ---------------------------------------------------------------------

export interface KpiCardProps {
  titulo: string;
  /** Ya formateado por quien llama (moneda, porcentaje, unidades). */
  valor: string;
  /**
   * Variación relativa contra el período anterior, en porcentaje.
   * `null` cuando no hay período anterior con el que comparar — se
   * muestra "sin comparación", no un 0% que parecería "no cambió".
   */
  variacionPorcentaje?: number | null;
  /** Qué significa que este indicador suba. */
  sentido?: "subir_es_bueno" | "subir_es_malo" | "neutro";
  /** Serie corta para el sparkline. Con menos de 2 puntos no se dibuja. */
  tendencia?: number[];
  /** Texto chico debajo: el período comparado, la muestra, una salvedad. */
  detalle?: string;
  /** Drill-down. Si viene, toda la tarjeta es clickeable. */
  alClic?: () => void;
  className?: string;
}

function colorVariacion(
  variacion: number,
  sentido: NonNullable<KpiCardProps["sentido"]>
): string {
  if (sentido === "neutro" || variacion === 0) return "text-text-muted";
  const esBueno = sentido === "subir_es_bueno" ? variacion > 0 : variacion < 0;
  return esBueno ? "text-success" : "text-error";
}

export function KpiCard({
  titulo,
  valor,
  variacionPorcentaje = null,
  sentido = "subir_es_bueno",
  tendencia,
  detalle,
  alClic,
  className = "",
}: KpiCardProps) {
  const clickeable = typeof alClic === "function";
  const Contenedor = clickeable ? "button" : "div";

  return (
    <Contenedor
      {...(clickeable ? { type: "button" as const, onClick: alClic } : {})}
      className={[
        "rounded-2xl border border-black/5 bg-surface p-6 text-left shadow-sm",
        clickeable
          ? "transition-colors hover:bg-background/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          : "",
        className,
      ].join(" ")}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{titulo}</p>

      <div className="mt-2 flex items-end justify-between gap-4">
        <p className="text-2xl font-bold text-text-primary">{valor}</p>
        {tendencia && tendencia.length >= 2 && (
          <Sparkline valores={tendencia} className="w-24 flex-shrink-0" />
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-sm">
        {variacionPorcentaje === null ? (
          <span className="text-text-muted">Sin período anterior para comparar</span>
        ) : (
          <>
            <span className={colorVariacion(variacionPorcentaje, sentido)}>
              <Icono
                nombre={variacionPorcentaje >= 0 ? "tendencia-sube" : "tendencia-baja"}
                tamano={16}
              />
            </span>
            <span className={colorVariacion(variacionPorcentaje, sentido)}>
              {variacionPorcentaje > 0 ? "+" : ""}
              {variacionPorcentaje.toFixed(1)}%
            </span>
            <span className="text-text-muted">vs. período anterior</span>
          </>
        )}
      </div>

      {detalle && <p className="mt-1 text-xs text-text-muted">{detalle}</p>}
    </Contenedor>
  );
}
