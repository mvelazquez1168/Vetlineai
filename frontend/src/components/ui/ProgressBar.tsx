export interface ProgressBarProps {
  /** 0-100. Valores fuera de rango se recortan. */
  value: number;
  className?: string;
  colorClassName?: string;
}

// Extraído del bloque "Confianza Diagnóstica" del workspace clínico —
// mismo componente reutilizado en Uso y Facturación (cupos y consumo de IA).
export function ProgressBar({ value, className = "", colorClassName = "bg-accent" }: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div className={["h-2 w-full overflow-hidden rounded-full bg-black/5", className].join(" ")}>
      <div className={["h-full", colorClassName].join(" ")} style={{ width: `${clamped}%` }} />
    </div>
  );
}
