import { useEffect, useRef, useState } from "react";
import { ClinicaResumen, platformApi } from "../../lib/platformApi";

// ---------------------------------------------------------------------
// Ajustes del recorrido de prueba, Bloque 1 — reemplaza el <Select> de
// "Facturar manualmente": con decenas de clínicas, un desplegable deja
// de ser usable. Búsqueda contra el backend (GET /platform/clinicas?q=),
// debounced, mismo criterio de "todo pasa por el backend" que el resto
// del bloque — a diferencia de CountryCombobox (que filtra un catálogo
// fijo ya cargado entero), acá la lista de clínicas puede crecer sin
// límite práctico.
// ---------------------------------------------------------------------

export interface ClinicaComboboxProps {
  label?: string;
  value: string;
  onChange: (tenantId: string, clinica: ClinicaResumen | null) => void;
  error?: string;
}

export function ClinicaCombobox({ label, value, onChange, error }: ClinicaComboboxProps) {
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<ClinicaResumen[]>([]);
  const [seleccionada, setSeleccionada] = useState<ClinicaResumen | null>(null);
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // Si el value se limpia desde afuera (ej. al reabrir el modal), el
  // texto visible también se limpia.
  useEffect(() => {
    if (!value) {
      setSeleccionada(null);
      setQuery("");
    }
  }, [value]);

  useEffect(() => {
    if (!abierto) return;
    const t = setTimeout(() => {
      platformApi.listarClinicas({ q: query || undefined }).then((data) => setResultados(data.clinicas));
    }, 300);
    return () => clearTimeout(t);
  }, [query, abierto]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
        setQuery(seleccionada?.nombre ?? "");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [seleccionada]);

  const seleccionar = (clinica: ClinicaResumen) => {
    setSeleccionada(clinica);
    setQuery(clinica.nombre);
    setAbierto(false);
    onChange(clinica.id, clinica);
  };

  return (
    <div className="relative flex flex-col gap-1.5" ref={contenedorRef}>
      {label && <label className="text-sm font-semibold text-text-primary">{label}</label>}
      <input
        className={[
          "rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary",
          "placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
          error ? "border-error" : "",
        ].join(" ")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => {
          setAbierto(true);
          platformApi.listarClinicas({ q: query || undefined }).then((data) => setResultados(data.clinicas));
        }}
        placeholder="Buscar clínica…"
        autoComplete="off"
      />
      {abierto && resultados.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-black/10 bg-surface shadow-lg">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => seleccionar(c)}
                className={[
                  "block w-full px-4 py-2 text-left text-sm hover:bg-accent/10",
                  c.id === value ? "font-semibold text-primary" : "text-text-primary",
                ].join(" ")}
              >
                {c.nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
      {abierto && resultados.length === 0 && (
        <div className="absolute top-full z-10 mt-1 w-full rounded-lg border border-black/10 bg-surface px-4 py-2 text-sm text-text-muted shadow-lg">
          Sin resultados.
        </div>
      )}
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}
