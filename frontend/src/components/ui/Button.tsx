import React from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-secondary focus-visible:outline-primary",
  secondary:
    "bg-transparent border border-primary text-primary hover:bg-primary/5 focus-visible:outline-primary",
  danger: "bg-error text-white hover:bg-error/90 focus-visible:outline-error",
  ghost: "bg-transparent text-accent hover:underline focus-visible:outline-accent",
};

export function Button({
  variant = "primary",
  fullWidth = false,
  className = "",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
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
