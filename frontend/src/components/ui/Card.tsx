import React from "react";

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  highlighted?: boolean;
}

export function Card({ children, className = "", highlighted = false }: CardProps) {
  return (
    <div
      className={[
        "rounded-2xl bg-surface p-6 shadow-sm",
        highlighted ? "border-2 border-accent" : "border border-black/5",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h3 className={["text-lg font-semibold text-text-primary", className].join(" ")}>{children}</h3>;
}

export function CardDescription({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={["text-sm text-text-muted", className].join(" ")}>{children}</p>;
}
