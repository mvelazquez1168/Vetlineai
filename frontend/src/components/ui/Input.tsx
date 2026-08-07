import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id, ...rest }, ref) => {
    const inputId = id ?? rest.name;

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
