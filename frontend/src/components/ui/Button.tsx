import React from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

// El tamaño tiene que decidirse ACÁ, no desde afuera con className: pasar
// "px-3 py-2" junto al "px-4 py-2.5" de la base no achica nada. Las dos
// clases terminan en el elemento y gana la que Tailwind emite última en la
// hoja, que es la de más valor (.px-3 sale en la línea 1917 del CSS
// generado y .px-4 en la 1922). Los 12 botones de la barra del área de
// trabajo venían pasando ese override creyendo que achicaban; de lo que
// mandaban solo se aplicaba el text-xs, porque ahí sí gana la última
// (.text-sm antes que .text-xs). Quedan 2 llamadas con el override muerto
// fuera del área de trabajo (VincularAtencionModal, CasoDetalleAdmin): no
// se tocaron porque cambiarlas altera pantallas que nadie revisó todavía.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2.5 text-sm",
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-secondary focus-visible:outline-primary",
  secondary:
    "bg-transparent border border-primary text-primary hover:bg-primary/5 focus-visible:outline-primary",
  danger: "bg-error text-white hover:bg-error/90 focus-visible:outline-error",
  ghost: "bg-transparent text-accent hover:underline focus-visible:outline-accent",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors",
        SIZE_CLASSES[size],
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        fullWidth ? "w-full" : "",
        VARIANT_CLASSES[variant],
        className,
      ].join(" ")}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
