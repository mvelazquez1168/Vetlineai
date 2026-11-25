// ---------------------------------------------------------------------
// LoadingState — esqueleto, no "Cargando…".
//
// El patrón que había en 40+ archivos era
// `{isLoading ? <p>Cargando…</p> : <contenido/>}`. Funciona, pero hace
// que la pantalla salte de una línea de texto a una tabla completa, y no
// da ninguna pista de cuánto va a aparecer. El esqueleto ocupa el lugar
// de lo que viene.
//
// Tres formas, que son las tres que el proyecto necesita hoy: líneas de
// texto, una grilla de tarjetas, y una tabla. No hay una cuarta "a
// medida": si una pantalla necesita otra forma, se agrega acá con un
// nombre, no se escribe un div con animate-pulse en la pantalla.
//
// `aria-busy` + un texto para lector de pantalla: visualmente el
// esqueleto comunica la espera, pero para quien no lo ve el DOM diría
// simplemente que no hay nada.
// ---------------------------------------------------------------------

export type FormaCarga = "lineas" | "tarjetas" | "tabla";

export interface LoadingStateProps {
  forma?: FormaCarga;
  /** Cuántas líneas, tarjetas o filas dibujar. */
  cantidad?: number;
  /** Para lectores de pantalla. */
  etiqueta?: string;
  className?: string;
}

const BASE_BLOQUE = "animate-pulse rounded bg-black/5";

export function LoadingState({
  forma = "lineas",
  cantidad = 3,
  etiqueta = "Cargando…",
  className = "",
}: LoadingStateProps) {
  const filas = Array.from({ length: cantidad }, (_, i) => i);

  return (
    <div className={className} aria-busy="true" aria-live="polite">
      <span className="sr-only">{etiqueta}</span>

      {forma === "lineas" && (
        <div className="space-y-3">
          {filas.map((i) => (
            // Anchos distintos: unas líneas todas iguales se leen como un
            // bloque, no como texto que está por llegar.
            <div
              key={i}
              className={`${BASE_BLOQUE} h-4`}
              style={{ width: `${100 - (i % 3) * 18}%` }}
            />
          ))}
        </div>
      )}

      {forma === "tarjetas" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filas.map((i) => (
            <div key={i} className="rounded-2xl border border-black/5 bg-surface p-6">
              <div className={`${BASE_BLOQUE} h-3 w-1/3`} />
              <div className={`${BASE_BLOQUE} mt-4 h-7 w-2/3`} />
              <div className={`${BASE_BLOQUE} mt-3 h-3 w-1/2`} />
            </div>
          ))}
        </div>
      )}

      {forma === "tabla" && (
        <div className="overflow-hidden rounded-xl border border-black/5 bg-surface">
          <div className="flex gap-6 border-b border-black/5 bg-background/60 px-6 py-3">
            {[0, 1, 2, 3].map((c) => (
              <div key={c} className={`${BASE_BLOQUE} h-3 flex-1`} />
            ))}
          </div>
          {filas.map((i) => (
            <div key={i} className="flex gap-6 border-b border-black/5 px-6 py-4 last:border-0">
              {[0, 1, 2, 3].map((c) => (
                <div key={c} className={`${BASE_BLOQUE} h-4 flex-1`} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
