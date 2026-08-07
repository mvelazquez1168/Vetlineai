import { useEffect, useMemo, useRef, useState } from "react";
import { Raza, razasApi } from "../../lib/razasApi";

export interface BreedComboboxProps {
  label?: string;
  especie: "canina" | "felina";
  value: string | null;
  onChange: (razaId: string) => void;
  error?: string;
}

/**
 * Combobox con búsqueda en vivo contra el catálogo de razas, filtrado por
 * especie — mismo patrón que CountryCombobox (no admite texto libre; si
 * el usuario escribe algo que no matchea ninguna opción y sale del campo
 * sin seleccionar, el texto vuelve a la última raza válida).
 */
export function BreedCombobox({ label, especie, value, onChange, error }: BreedComboboxProps) {
  const [razas, setRazas] = useState<Raza[]>([]);
  const [query, setQuery] = useState("");
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    razasApi.listar(especie).then((data) => setRazas(data.razas));
  }, [especie]);

  const seleccionada = useMemo(() => razas.find((r) => r.id === value) ?? null, [razas, value]);

  useEffect(() => {
    setQuery(seleccionada?.nombre ?? "");
  }, [seleccionada]);

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

  const filtradas = useMemo(() => {
    const normalizar = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
    const q = normalizar(query);
    if (!q || q === normalizar(seleccionada?.nombre ?? "")) return razas;
    return razas.filter((r) => normalizar(r.nombre).includes(q));
  }, [razas, query, seleccionada]);

  const seleccionar = (raza: Raza) => {
    onChange(raza.id);
    setQuery(raza.nombre);
    setAbierto(false);
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
        onFocus={() => setAbierto(true)}
        placeholder="Buscar raza…"
        autoComplete="off"
      />
      {abierto && filtradas.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-black/10 bg-surface shadow-lg">
          {filtradas.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => seleccionar(r)}
                className={[
                  "block w-full px-4 py-2 text-left text-sm hover:bg-accent/10",
                  r.id === value ? "font-semibold text-primary" : "text-text-primary",
                ].join(" ")}
              >
                {r.nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}
