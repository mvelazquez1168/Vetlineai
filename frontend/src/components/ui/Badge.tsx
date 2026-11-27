import React from "react";

export type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
  /**
   * Qué significa la etiqueta, al pasar el puntero.
   *
   * Una etiqueta de una palabra —«histórico», «sin clasificar»— no
   * alcanza para explicarse sola, y poner la explicación al lado llena
   * la fila. Es texto, no decoración: va también al lector de pantalla.
   */
  title?: string;
}

// Los nombres de variante son genéricos por diseño: el mismo Badge sirve
// para "Activo"/"Habilitado" (success), "Solicitud pendiente" (warning),
// "Rechazada" (error), "Próximamente"/"Investigación en curso" (info o
// neutral), sin acoplar el componente a un dominio específico.
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning",
  error: "bg-error/15 text-error",
  info: "bg-info/15 text-info",
  neutral: "bg-text-muted/15 text-text-muted",
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  info: "bg-info",
  neutral: "bg-text-muted",
};

export function Badge({
  variant = "neutral",
  children,
  dot = false,
  className = "",
  title,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
        VARIANT_CLASSES[variant],
        className,
      ].join(" ")}
    >
      {dot && <span className={["h-1.5 w-1.5 rounded-full", DOT_CLASSES[variant]].join(" ")} />}
      {children}
    </span>
  );
}
