import { ReactNode, useEffect, useRef, useState } from "react";
import { Icono, NombreIcono } from "./Icono";

// ---------------------------------------------------------------------
// MenuAcciones — el menú de acciones de una fila de tabla.
//
// POR QUÉ UN MENÚ Y NO CUATRO BOTONES EN LA FILA: cuatro botones por
// fila en una tabla de veinticinco filas son cien botones en pantalla,
// y la fila deja de poder leerse. El menú deja a la vista lo que la
// fila dice y pone a un clic lo que se puede hacer con ella.
//
// Mismo comportamiento que `MenuExportar` y que los combobox del
// sistema: cierra al clickear afuera y con Escape, para que un menú no
// se sienta distinto de otro. Las acciones `peligrosa` se pintan con el
// color de error y van separadas abajo.
// ---------------------------------------------------------------------

export interface AccionDeMenu {
  etiqueta: string;
  icono?: NombreIcono;
  onClick: () => void;
  peligrosa?: boolean;
  deshabilitada?: boolean;
  /** Se muestra en gris abajo de la etiqueta: para qué sirve. */
  ayuda?: string;
}

export interface MenuAccionesProps {
  acciones: AccionDeMenu[];
  /** Qué se ve en el disparador. Por defecto, los tres puntos. */
  etiqueta?: ReactNode;
  className?: string;
}

export function MenuAcciones({ acciones, etiqueta, className = "" }: MenuAccionesProps) {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", afuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  const visibles = acciones.filter((a) => !a.peligrosa);
  const peligrosas = acciones.filter((a) => a.peligrosa);

  const renderAccion = (a: AccionDeMenu, i: number) => (
    <button
      key={`${a.etiqueta}-${i}`}
      type="button"
      role="menuitem"
      disabled={a.deshabilitada}
      onClick={() => {
        setAbierto(false);
        a.onClick();
      }}
      className={[
        "flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-background",
        a.peligrosa ? "text-error" : "text-text-primary",
        a.deshabilitada ? "cursor-not-allowed opacity-40 hover:bg-transparent" : "",
      ].join(" ")}
    >
      {a.icono && <Icono nombre={a.icono} tamano={16} className="mt-0.5 shrink-0" />}
      <span>
        {a.etiqueta}
        {a.ayuda && <span className="block text-xs text-text-muted">{a.ayuda}</span>}
      </span>
    </button>
  );

  return (
    <div ref={contenedor} className={["relative", className].join(" ")}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label="Acciones"
        onClick={() => setAbierto((a) => !a)}
        className="rounded-lg border border-black/10 px-2 py-1 text-sm text-text-muted hover:bg-background hover:text-primary"
      >
        {etiqueta ?? "···"}
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-black/5 bg-surface py-1 shadow-xl"
        >
          {visibles.map(renderAccion)}
          {peligrosas.length > 0 && visibles.length > 0 && (
            <div className="my-1 border-t border-black/5" />
          )}
          {peligrosas.map(renderAccion)}
        </div>
      )}
    </div>
  );
}
