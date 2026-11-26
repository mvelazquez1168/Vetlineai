import { Sparkline } from "./charts";
import { Icono, NombreIcono } from "./Icono";

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
  /**
   * El ícono, con fondo suave (prompt 01c, sección 4). El color sale del
   * MÓDULO o del ESTADO: el ícono es lo único que se tiñe, la tarjeta
   * completa no. Teñir siete tarjetas de siete colores hace que el
   * sistema parezca siete sistemas.
   */
  icono?: NombreIcono;
  modulo?: string;
  /** Un estado gana sobre el módulo: un indicador en rojo es un rojo. */
  estado?: "exito" | "aviso" | "error" | "info";
  /** La acción opcional de la tarjeta: «Pedir», «Revisar», «Ver lotes». */
  accion?: { etiqueta: string; alClic: () => void };
}

const COLOR_ICONO_MODULO: Record<string, { texto: string; fondo: string }> = {
  caja: { texto: "text-modulo-caja", fondo: "bg-modulo-caja/10" },
  ventas: { texto: "text-modulo-caja", fondo: "bg-modulo-caja/10" },
  inventario: { texto: "text-modulo-inventario", fondo: "bg-modulo-inventario/10" },
  agenda: { texto: "text-modulo-agenda", fondo: "bg-modulo-agenda/10" },
  facturacion: { texto: "text-modulo-facturacion", fondo: "bg-modulo-facturacion/10" },
  pacientes: { texto: "text-modulo-pacientes", fondo: "bg-modulo-pacientes/10" },
  ia: { texto: "text-modulo-ia", fondo: "bg-modulo-ia/10" },
  admin: { texto: "text-modulo-admin", fondo: "bg-modulo-admin/10" },
};

const COLOR_ICONO_ESTADO: Record<string, { texto: string; fondo: string }> = {
  exito: { texto: "text-success", fondo: "bg-success/10" },
  aviso: { texto: "text-warning", fondo: "bg-warning/15" },
  error: { texto: "text-error", fondo: "bg-error/10" },
  info: { texto: "text-info", fondo: "bg-info/10" },
};

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
  icono,
  modulo,
  estado,
  accion,
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
      <div className="flex items-start gap-3">
        {icono && (
          <span
            className={[
              "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl",
              (estado ? COLOR_ICONO_ESTADO[estado] : modulo ? COLOR_ICONO_MODULO[modulo] : null)
                ?.fondo ?? "bg-primary-suave",
            ].join(" ")}
          >
            <Icono
              nombre={icono}
              tamano={20}
              className={
                (estado ? COLOR_ICONO_ESTADO[estado] : modulo ? COLOR_ICONO_MODULO[modulo] : null)
                  ?.texto ?? "text-primary"
              }
            />
          </span>
        )}
        <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{titulo}</p>
      </div>

      <div className="mt-2 flex items-end justify-between gap-4">
        <p className="text-2xl font-bold text-text-primary">{valor}</p>
        {tendencia && tendencia.length >= 2 && (
          <Sparkline valores={tendencia} className="w-24 flex-shrink-0" />
        )}
      </div>

      {/* Sin periodo anterior NO se dibuja una linea que lo diga: cuatro
          tarjetas repitiendo "sin periodo anterior para comparar" ocupan
          una franja entera para no decir nada, y entrenan a la vista a
          saltearse justo el renglon donde un dia va a haber un -38%. */}
      {variacionPorcentaje !== null && (
        <div className="mt-2 flex items-center gap-1.5 text-sm">
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
        </div>
      )}

      {detalle && <p className="mt-1 text-xs text-text-muted">{detalle}</p>}

      {accion && (
        // Un `span` con rol de botón y no un `<button>`: cuando la
        // tarjeta entera ya es un botón, un botón adentro es HTML
        // inválido y el navegador lo desarma donde menos conviene.
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            accion.alClic();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              accion.alClic();
            }
          }}
          className="mt-3 inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary hover:text-primary-hover"
        >
          {accion.etiqueta} →
        </span>
      )}
    </Contenedor>
  );
}
