import { ReactNode } from "react";
import { Card } from "../ui/Card";

// ---------------------------------------------------------------------
// Un bloque de dashboard: título, salvedad y acción, sobre una `Card`.
//
// `Card` es solo el contenedor —borde, fondo, sombra— y no tiene título
// a propósito. Los dashboards necesitan los tres elementos en el mismo
// orden en veinte bloques, así que vive acá y no repetido en cada uno:
// la salvedad («3 ítems sin costo») es parte del bloque, no un adorno, y
// si cada pantalla la dibujara a su manera terminaría en tres lugares
// distintos del recuadro.
// ---------------------------------------------------------------------

export interface BloqueProps {
  titulo: string;
  /** La salvedad del bloque: qué queda afuera, qué falta configurar. */
  descripcion?: string;
  /** El control del bloque: alternar «por ingresos / por margen». */
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Bloque({ titulo, descripcion, acciones, children, className }: BloqueProps) {
  return (
    <Card className={className}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted">{titulo}</h3>
          {descripcion && <p className="mt-1 text-xs text-text-muted">{descripcion}</p>}
        </div>
        {acciones}
      </div>
      {children}
    </Card>
  );
}
