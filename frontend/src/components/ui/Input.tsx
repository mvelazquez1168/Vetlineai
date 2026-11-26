import React, { useId } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id, ...rest }, ref) => {
    // DEFECTO QUE ESTO CIERRA: cuando no venia ni `id` ni `name`, el
    // htmlFor quedaba vacio y la etiqueta no apuntaba a nada —
    // clickearla no enfocaba el campo y un lector de pantalla no podia
    // decir de que campo se trata. `useId` da un id estable por
    // instancia, asi que la asociacion existe siempre sin obligar a
    // cada pantalla a inventar un id.
    const generado = useId();
    const inputId = id ?? rest.name ?? generado;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-semibold text-text-primary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            "rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary",
            "placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
            error ? "border-error" : "",
            className,
          ].join(" ")}
          {...rest}
        />
        {error && <span className="text-xs text-error">{error}</span>}
      </div>
    );
  }
);
Input.displayName = "Input";
