import { ReactNode } from "react";
import { Icono, NombreIcono } from "./Icono";

// ---------------------------------------------------------------------
// EmptyState — un vacío que dice QUÉ HACER, no solo que está vacío.
//
// Antes cada pantalla escribía su propio párrafo gris, y `Table` traía
// el suyo por dentro ("No hay datos para mostrar.", que no le dice nada
// a nadie). La diferencia que importa no es visual: un vacío sin acción
// deja al usuario sin saber si el sistema está roto, si le falta un
// permiso o si simplemente todavía no cargó nada.
//
// Por eso `accion` es parte del contrato. No es obligatoria —un
// resultado de búsqueda vacío no tiene acción, hay que cambiar la
// búsqueda— pero tenerla en las props obliga a pensar si corresponde.
// ---------------------------------------------------------------------

export interface EmptyStateProps {
  icono?: NombreIcono;
  titulo: string;
  /** Una o dos frases: por qué está vacío y qué puede hacer. */
  texto?: string;
  /** El botón de salida, cuando hay una. */
  accion?: ReactNode;
  className?: string;
}

export function EmptyState({ icono, titulo, texto, accion, className = "" }: EmptyStateProps) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-black/5 bg-surface px-6 py-12 text-center",
        className,
      ].join(" ")}
    >
      {icono && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background text-text-muted">
          <Icono nombre={icono} tamano={24} />
        </span>
      )}
      <p className="text-base font-semibold text-text-primary">{titulo}</p>
      {texto && <p className="max-w-md text-sm text-text-muted">{texto}</p>}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  );
}
