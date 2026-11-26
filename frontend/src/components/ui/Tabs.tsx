import { ReactNode } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { Icono, NombreIcono } from "./Icono";

// ---------------------------------------------------------------------
// LAS PESTAÑAS DE UN MÓDULO — prompt 01c, sección 4.
//
// Reemplazan las filas de botones que en realidad son secciones: el
// relevamiento encontró NUEVE en fila en el catálogo de inventario, y
// nueve botones con el mismo peso no son una barra de acciones, son un
// menú disfrazado.
//
// LA PESTAÑA ACTIVA VA EN LA URL. Es lo que hace que recargar no pierda
// el lugar, que se pueda compartir un enlace a «Movimientos» y que el
// botón de atrás del navegador funcione. Con la pestaña en un `useState`
// nada de eso pasa.
//
// UN INDICADOR CON CONTADOR no es una pestaña: «Alertas» y
// «Aprobaciones» llevan a su pantalla y muestran cuántas hay
// pendientes. Van al costado, separados, para que no parezcan una
// sección más.
// ---------------------------------------------------------------------

export interface Pestana {
  clave: string;
  etiqueta: string;
  icono?: NombreIcono;
}

export interface TabsProps {
  pestanas: Pestana[];
  /** El parámetro de la URL. Por defecto `tab`. */
  parametro?: string;
  /** La que se muestra cuando la URL no dice nada. */
  porDefecto?: string;
  /** Los indicadores con contador, a la derecha. */
  indicadores?: ReactNode;
  children?: (activa: string) => ReactNode;
}

export function Tabs({
  pestanas,
  parametro = "tab",
  porDefecto,
  indicadores,
  children,
}: TabsProps) {
  const [parametros, setParametros] = useSearchParams();
  const pedida = parametros.get(parametro);
  // Una pestaña pedida que no existe no rompe nada: se cae a la primera.
  // Pasa con un enlace viejo después de renombrar una sección.
  const activa =
    pestanas.find((p) => p.clave === pedida)?.clave ??
    porDefecto ??
    pestanas[0]?.clave ??
    "";

  const ir = (clave: string) => {
    const siguientes = new URLSearchParams(parametros);
    siguientes.set(parametro, clave);
    // `replace` para que diez clics entre pestañas no dejen diez
    // entradas en el historial: el botón de atrás tiene que salir del
    // módulo, no recorrer las pestañas.
    setParametros(siguientes, { replace: true });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5">
        <div
          className="-mb-px flex gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Secciones"
        >
          {pestanas.map((p) => {
            const esActiva = p.clave === activa;
            return (
              <button
                key={p.clave}
                type="button"
                role="tab"
                aria-selected={esActiva}
                onClick={() => ir(p.clave)}
                className={[
                  "flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
                  esActiva
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                {p.icono && <Icono nombre={p.icono} tamano={16} />}
                {p.etiqueta}
              </button>
            );
          })}
        </div>
        {indicadores && <div className="flex items-center gap-2 pb-1">{indicadores}</div>}
      </div>
      {children && <div className="mt-4">{children(activa)}</div>}
    </div>
  );
}

/**
 * Un indicador con contador junto a las pestañas: «Alertas 3».
 *
 * Es un enlace y no una pestaña porque lleva a otra pantalla. El
 * contador en cero NO se dibuja: un cero permanente al lado de las
 * pestañas es ruido que la gente aprende a ignorar, y entonces el día
 * que diga 4 tampoco lo ve.
 */
export function IndicadorPestana({
  etiqueta,
  cantidad,
  onClick,
  icono,
  tono = "aviso",
}: {
  etiqueta: string;
  cantidad: number;
  onClick: () => void;
  icono?: NombreIcono;
  tono?: "aviso" | "neutral";
}) {
  if (cantidad <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium",
        tono === "aviso"
          ? "bg-warning/15 text-text-primary hover:bg-warning/25"
          : "bg-black/5 text-text-primary hover:bg-black/10",
      ].join(" ")}
    >
      {icono && <Icono nombre={icono} tamano={16} />}
      {etiqueta}
      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold">{cantidad}</span>
    </button>
  );
}

/**
 * LAS PESTANAS CUANDO CADA SECCION ES UNA RUTA.
 *
 * Mismo aspecto que `Tabs`, pero navegan. Hacen falta porque hay modulos
 * cuyas secciones ya eran rutas propias antes de este marco —la Agenda
 * tiene seis— y convertirlas en parametro de la URL rompería todo enlace
 * existente a `/agenda/lista-espera`. La forma es la misma para que no se
 * noten dos clases de pestanas; lo que cambia es de donde sale el estado.
 */
export function PestanasDeRuta({
  pestanas,
  indicadores,
}: {
  pestanas: { a: string; etiqueta: string; icono?: NombreIcono }[];
  indicadores?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-black/5">
      {/* Es un <nav>, NO un `role="tablist"`: estas pestanas navegan a
          otra ruta, no muestran un panel de la misma pantalla. Un
          lector de pantalla anunciando «pestaña 3 de 7» para algo que
          en realidad cambia de pagina describe mal lo que va a pasar.
          Las de `Tabs` si son tablist, porque ahi si hay paneles. */}
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Secciones del módulo">
        {pestanas.map((p) => (
          <NavLink
            key={p.a}
            to={p.a}
            end={p.a.split("/").length <= 2}
            className={({ isActive }) =>
              [
                "flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
                isActive
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-text-muted hover:text-text-primary",
              ].join(" ")
            }
          >
            {p.icono && <Icono nombre={p.icono} tamano={16} />}
            {p.etiqueta}
          </NavLink>
        ))}
      </nav>
      {indicadores && <div className="flex items-center gap-2 pb-1">{indicadores}</div>}
    </div>
  );
}
