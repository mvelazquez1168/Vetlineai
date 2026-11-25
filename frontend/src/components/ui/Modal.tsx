import React from "react";

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
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  ancho = "md",
}: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        // `max-h-[90vh] overflow-y-auto`: con los anchos grandes el
        // contenido ya puede pasarse de alto, y sin esto el pie del
        // modal queda fuera de la pantalla sin forma de llegar.
        className={[
          "max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-surface p-8 shadow-xl",
          ANCHOS[ancho],
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title" className="text-xl font-bold text-primary">
          {title}
        </h2>
        {description && <p className="mt-3 text-sm text-text-muted">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-8 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}
