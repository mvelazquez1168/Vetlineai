import { useEffect, useState } from "react";
import { Select } from "./Select";

// ---------------------------------------------------------------------
// Ajustes del recorrido de prueba, Bloque 1 — un solo componente de
// filtros para Clínicas, Facturas, Cancelaciones, Consumo por clínica
// (y, con menos categorías, Pagos/Nuevas Clínicas, que ya usaban el
// mismo patrón ad hoc localmente). Todo lo que filtra pasa por acá para
// que las cinco pantallas se comporten igual — nunca cinco
// implementaciones que después divergen.
//
// La búsqueda de texto se debounce (300ms) antes de avisar al padre —
// todos los filtros de acá terminan pegándole al backend (nunca
// filtrando un array ya cargado, por consistencia), así que no tiene
// sentido mandar una request por cada tecla.
// ---------------------------------------------------------------------

export interface FiltroBarSelectOption {
  value: string;
  label: string;
}

export interface FiltroBarSelect {
  value: string;
  onChange: (value: string) => void;
  // opciones[0] es la opción "Todos" (value: "") — el propio llamador la arma.
  opciones: FiltroBarSelectOption[];
}

export interface FiltroBarProps {
  busqueda: string;
  onBusqueda: (value: string) => void;
  placeholderBusqueda: string;
  selects?: FiltroBarSelect[];
  desde?: string;
  hasta?: string;
  onDesde?: (value: string) => void;
  onHasta?: (value: string) => void;
  // Por defecto separa del contenido de arriba (mt-6) — el caso de uso
  // más común, un bloque de filtros debajo de un título. Cuando se
  // embebe dentro de otro layout que ya resuelve el espaciado (ej. una
  // fila junto a un título), el llamador pasa "" para no duplicarlo.
  className?: string;
}

export function FiltroBar({
  busqueda,
  onBusqueda,
  placeholderBusqueda,
  selects,
  desde,
  hasta,
  onDesde,
  onHasta,
  className = "mt-6",
}: FiltroBarProps) {
  const [textoLocal, setTextoLocal] = useState(busqueda);

  // Si el padre resetea la búsqueda desde afuera (ej. al cambiar de tab),
  // el campo local se mantiene sincronizado.
  useEffect(() => setTextoLocal(busqueda), [busqueda]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (textoLocal !== busqueda) onBusqueda(textoLocal);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoLocal]);

  return (
    <div className={["flex flex-wrap items-end gap-4", className].join(" ")}>
      {onDesde && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Desde</label>
          <input
            type="date"
            value={desde ?? ""}
            onChange={(e) => onDesde(e.target.value)}
            className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      )}
      {onHasta && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Hasta</label>
          <input
            type="date"
            value={hasta ?? ""}
            onChange={(e) => onHasta(e.target.value)}
            className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      )}
      <div className="min-w-[220px] flex-1">
        <input
          type="search"
          value={textoLocal}
          onChange={(e) => setTextoLocal(e.target.value)}
          placeholder={placeholderBusqueda}
          className="w-full rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>
      {selects?.map((s, i) => (
        <Select
          key={i}
          value={s.value}
          onChange={(e) => s.onChange(e.target.value)}
          options={s.opciones}
        />
      ))}
    </div>
  );
}
