import { useEffect, useMemo, useRef, useState } from "react";
import { Pais, paisesApi } from "../../lib/paisesApi";

export interface CountryComboboxProps {
  label?: string;
  value: string | null;
  onChange: (codigoIso: string) => void;
  error?: string;
}

/**
 * Combobox con búsqueda en vivo contra el catálogo de países. No admite
 * texto libre: si el usuario escribe algo que no matchea ninguna opción y
 * sale del campo sin seleccionar, el texto vuelve al último país válido.
 */
export function CountryCombobox({ label, value, onChange, error }: CountryComboboxProps) {
  const [paises, setPaises] = useState<Pais[]>([]);
  const [query, setQuery] = useState("");
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    paisesApi.listar().then((data) => setPaises(data.paises));
  }, []);

  const seleccionado = useMemo(
    () => paises.find((p) => p.codigo_iso === value) ?? null,
    [paises, value]
  );

  // Sincroniza el texto visible con el país seleccionado (por ejemplo, al
  // cargar datos existentes desde el backend, antes de cualquier tipeo).
  useEffect(() => {
    setQuery(seleccionado?.nombre ?? "");
  }, [seleccionado]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
        setQuery(seleccionado?.nombre ?? "");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [seleccionado]);

  const filtrados = useMemo(() => {
    // Sin tildes de ambos lados: "Mexi" tiene que encontrar "México".
    const normalizar = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
    const q = normalizar(query);
    if (!q || q === normalizar(seleccionado?.nombre ?? "")) return paises;
    return paises.filter((p) => normalizar(p.nombre).includes(q));
  }, [paises, query, seleccionado]);

  const seleccionar = (pais: Pais) => {
    onChange(pais.codigo_iso);
    setQuery(pais.nombre);
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
        placeholder="Buscar país…"
        autoComplete="off"
      />
      {abierto && filtrados.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-black/10 bg-surface shadow-lg">
          {filtrados.map((p) => (
            <li key={p.codigo_iso}>
              <button
                type="button"
                onClick={() => seleccionar(p)}
                className={[
                  "block w-full px-4 py-2 text-left text-sm hover:bg-accent/10",
                  p.codigo_iso === value ? "font-semibold text-primary" : "text-text-primary",
                ].join(" ")}
              >
                {p.nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}
