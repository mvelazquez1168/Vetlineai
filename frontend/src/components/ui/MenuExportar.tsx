import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Icono } from "./Icono";

// ---------------------------------------------------------------------
// MenuExportar — Excel y PDF.
//
// ALCANCE DE HOY, a propósito: este archivo es SOLO el componente y su
// contrato. La exportación de verdad (Excel con datos tipados, PDF con
// logo y los filtros aplicados, todo generado en el backend respetando
// tenant y permisos) llega en el prompt de dashboards. Acá se fija la
// forma para que ese prompt no tenga que inventar la interfaz y para que
// las pantallas que ya existen puedan adoptarlo cuando haya endpoint.
//
// POR QUÉ EL CONTRATO ES `onExportar(formato)` Y NO UNA URL: la
// exportación tiene que salir del backend con los filtros que están
// aplicados EN ESE MOMENTO, y eso lo sabe la pantalla, no este
// componente. Si acá hubiera una URL, el día que una pantalla agregue un
// filtro, la exportación lo ignoraría en silencio y nadie lo notaría —
// el archivo bajaría igual, con otros datos.
//
// `pendiente` deja el botón ocupado mientras el backend arma el archivo:
// un Excel de varios miles de filas tarda, y sin esto la gente aprieta
// tres veces y dispara tres generaciones.
// ---------------------------------------------------------------------

export type FormatoExportacion = "excel" | "pdf";

export interface MenuExportarProps {
  /** Lo dispara la pantalla, que es la que conoce los filtros aplicados. */
  onExportar: (formato: FormatoExportacion) => void | Promise<void>;
  /** Qué formatos ofrecer. Por defecto los dos. */
  formatos?: FormatoExportacion[];
  /** Deshabilita el menú, p. ej. mientras la tabla está cargando o vacía. */
  deshabilitado?: boolean;
  className?: string;
}

const ETIQUETA: Record<FormatoExportacion, { texto: string; icono: "excel" | "pdf" }> = {
  excel: { texto: "Descargar Excel", icono: "excel" },
  pdf: { texto: "Descargar PDF", icono: "pdf" },
};

export function MenuExportar({
  onExportar,
  formatos = ["excel", "pdf"],
  deshabilitado = false,
  className = "",
}: MenuExportarProps) {
  const [abierto, setAbierto] = useState(false);
  const [pendiente, setPendiente] = useState<FormatoExportacion | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  // Cerrar al clickear afuera y con Escape — mismo comportamiento que
  // los combobox del sistema (CountryCombobox, BreedCombobox), para que
  // un menú no se sienta distinto de otro.
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

  const exportar = async (formato: FormatoExportacion) => {
    setAbierto(false);
    setPendiente(formato);
    try {
      await onExportar(formato);
    } finally {
      setPendiente(null);
    }
  };

  return (
    <div ref={contenedor} className={["relative", className].join(" ")}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setAbierto((a) => !a)}
        disabled={deshabilitado || pendiente !== null}
        aria-haspopup="menu"
        aria-expanded={abierto}
      >
        <Icono nombre="descargar" tamano={16} />
        {pendiente ? "Generando…" : "Exportar"}
        <Icono nombre="chevron-abajo" tamano={16} />
      </Button>

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-black/5 bg-surface py-1 shadow-xl"
        >
          {formatos.map((formato) => (
            <button
              key={formato}
              type="button"
              role="menuitem"
              onClick={() => void exportar(formato)}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-text-primary hover:bg-background"
            >
              <Icono nombre={ETIQUETA[formato].icono} tamano={16} />
              {ETIQUETA[formato].texto}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
