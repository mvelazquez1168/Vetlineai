import { ReactNode, useState } from "react";

export interface CollapsibleSectionProps {
  titulo: string;
  defaultAbierto?: boolean;
  // Ignora el estado interno y renderiza siempre expandido — usado por el
  // export a HTML estático (ver exportarDashboardHtml.tsx): ahí no hay
  // runtime de React para reaccionar al click, así que una sección que
  // arranca colapsada (ej. Zona 4) quedaría con su contenido ausente del
  // documento exportado, no solo oculto visualmente.
  forzarAbierto?: boolean;
  children: ReactNode;
  className?: string;
}

// No existía nada equivalente en el sistema de componentes — Card.tsx es
// un contenedor estático sin expandir/colapsar. Genérico a propósito para
// que lo puedan reusar otras pantallas, no solo el Dashboard de GCIS.
export function CollapsibleSection({
  titulo,
  defaultAbierto = true,
  forzarAbierto = false,
  children,
  className = "",
}: CollapsibleSectionProps) {
  const [abiertoState, setAbiertoState] = useState(defaultAbierto);
  const abierto = forzarAbierto || abiertoState;

  return (
    <div className={["rounded-2xl border border-black/5 bg-surface", className].join(" ")}>
      <button
        type="button"
        onClick={() => setAbiertoState((prev) => !prev)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wide text-primary">{titulo}</span>
        <span
          className={["text-text-muted transition-transform", abierto ? "rotate-180" : ""].join(" ")}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {abierto && <div className="space-y-4 border-t border-black/5 p-5">{children}</div>}
    </div>
  );
}
