import React from "react";
import { CapaModal, TipoModal } from "./CapaModal";

// ---------------------------------------------------------------------
// Modal con ancho configurable.
//
// POR QUÉ IMPORTA: este componente era `max-w-md` fijo, y por eso 8
// modales del proyecto están escritos a mano copiando sus clases de
// superposición — no porque quisieran verse distinto, sino porque su
// formulario no entra en 448px. Con `ancho` dejan de tener motivo para
// existir por separado (su migración queda listada en el reporte, no se
// hace acá).
//
// COMPATIBILIDAD: `ancho` por defecto es "md", que es exactamente el
// `max-w-md` que había. Los 16 usos existentes no cambian de aspecto ni
// necesitan tocar nada.
// ---------------------------------------------------------------------

export type AnchoModal = "sm" | "md" | "lg" | "xl";

const ANCHOS: Record<AnchoModal, string> = {
  sm: "max-w-sm", // 384px — una confirmación de una línea
  md: "max-w-md", // 448px — el default histórico
  lg: "max-w-2xl", // 672px — un formulario de dos columnas
  xl: "max-w-4xl", // 896px — una tabla o una lista larga adentro
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Ancho máximo. "md" (448px) es el default y el comportamiento anterior. */
  ancho?: AnchoModal;
  /**
   * `formulario` (por omisión) **no se cierra con el clic afuera**;
   * `consulta` sí. El default es el seguro: un modal que se olvide de
   * declarar su tipo no va a perder lo que alguien escribió.
   *
   * CAMBIO DE COMPORTAMIENTO, a propósito: hasta el 2026-11-27 este
   * componente cerraba en el clic sobre el fondo, y eso perdía lo
   * escrito en más de cuarenta pantallas. El defecto se reportó desde
   * Finanzas › Gastos › Registrar un gasto.
   */
  tipo?: TipoModal;
  /**
   * Si el formulario tiene algo escrito y sin guardar. Con esto, cerrar
   * por Esc o por la X pregunta antes de descartar.
   */
  hayCambios?: boolean;
  /** Ver `CapaModal`: agrega «Guardar y cerrar» a la pregunta de salida. */
  onGuardar?: () => Promise<void> | void;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  ancho = "md",
  tipo = "formulario",
  hayCambios = false,
  onGuardar,
}: ModalProps) {
  if (!open) return null;

  // EL FONDO, EL FOCO Y CUÁNDO SE CIERRA los decide `CapaModal`, que es
  // el único lugar del sistema donde está esa regla.
  return (
    <CapaModal
      onClose={onClose}
      tipo={tipo}
      hayCambios={hayCambios}
      onGuardar={onGuardar}
      etiquetaAria={title}
      // `max-h-[90vh] overflow-y-auto`: con los anchos grandes el
      // contenido ya puede pasarse de alto, y sin esto el pie del
      // modal queda fuera de la pantalla sin forma de llegar.
      className={[
        "max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-surface p-8 shadow-xl",
        ANCHOS[ancho],
      ].join(" ")}
    >
      <>
        {/* ENCABEZADO Y PIE PEGADOS (prompt 01c, seccion 4). La caja
            entera tiene scroll —hace falta para que el pie no quede
            fuera de la pantalla—, y eso hacia que en un modal largo el
            titulo se fuera hacia arriba y el pie no se viera hasta el
            final. Ahora el contenido se desplaza en medio. */}
        <div className="sticky top-0 z-10 -mx-8 -mt-8 flex items-start justify-between gap-3 bg-surface px-8 pb-3 pt-8">
          <h2 id="modal-title" className="text-xl font-bold text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-black/5"
          >
            ✕
          </button>
        </div>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        {footer && (
          <div className="sticky bottom-0 -mx-8 -mb-8 mt-8 flex justify-end gap-3 bg-surface px-8 pb-8 pt-4">
            {footer}
          </div>
        )}
      </>
    </CapaModal>
  );
}
