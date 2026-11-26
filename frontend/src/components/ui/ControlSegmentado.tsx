import { Icono } from "./Icono";

// ---------------------------------------------------------------------
// CONTROL SEGMENTADO — prompt 01c, sección 4.
//
// Para elegir una de pocas opciones excluyentes: la duración de una
// cita, su prioridad, el período de un reporte.
//
// LA ELEGIDA VA RELLENA, no apenas teñida. El relevamiento encontró la
// versión de antes: borde del color de acento y fondo al 10 %. A simple
// vista, en una pantalla con otras cinco cosas teñidas de lo mismo, no
// se distinguía cuál estaba elegida, y la consecuencia de equivocarse
// era agendar una cita de 15 minutos creyendo que eran 45.
//
// Y LLEVA UN ✓, porque el color no puede ser la única señal: quien no
// distingue el acento del gris necesita algo más que el relleno, y la
// guía rectora lo exige en §4.1.
// ---------------------------------------------------------------------

export interface OpcionSegmentada<T extends string | number> {
  valor: T;
  etiqueta: string;
  /** Tiñe la opción elegida con un color de estado en vez del primario. */
  tono?: "primario" | "aviso" | "error";
}

export interface ControlSegmentadoProps<T extends string | number> {
  etiqueta: string;
  opciones: OpcionSegmentada<T>[];
  valor: T;
  onCambio: (valor: T) => void;
}

const RELLENO: Record<string, string> = {
  primario: "bg-primary text-sobre-primary",
  aviso: "bg-warning text-text-primary",
  error: "bg-error text-white",
};

export function ControlSegmentado<T extends string | number>({
  etiqueta,
  opciones,
  valor,
  onCambio,
}: ControlSegmentadoProps<T>) {
  return (
    <div role="group" aria-label={etiqueta}>
      <p className="text-sm font-semibold text-text-primary">{etiqueta}</p>
      <div className="mt-1.5 flex gap-2">
        {opciones.map((o) => {
          const elegida = o.valor === valor;
          return (
            <button
              key={String(o.valor)}
              type="button"
              aria-pressed={elegida}
              onClick={() => onCambio(o.valor)}
              className={[
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition-colors",
                elegida
                  ? `border-transparent ${RELLENO[o.tono ?? "primario"]}`
                  : "border-black/10 text-text-muted hover:bg-black/5",
              ].join(" ")}
            >
              {elegida && <Icono nombre="check" tamano={14} />}
              {o.etiqueta}
            </button>
          );
        })}
      </div>
    </div>
  );
}
