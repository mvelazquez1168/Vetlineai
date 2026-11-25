import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icono, NombreIcono } from "./Icono";

// ---------------------------------------------------------------------
// Toast — el aviso efímero que el proyecto no tenía.
//
// Hasta ahora había tres mecanismos y ninguno servía para "listo,
// guardado": barras persistentes arriba del área de trabajo (para
// estados que duran, como la ventana de purga), las campanas (para
// notificaciones que se acumulan), y mensajes inline dentro de la
// pantalla. Para el resultado de una acción, lo inline obliga a que cada
// pantalla invente dónde ponerlo, y en un modal que se cierra al guardar
// no hay dónde: el mensaje se va con el modal.
//
// UN SOLO PROVEEDOR Y UN SOLO HOOK. `useToast()` es la única forma de
// mostrar uno; no se exporta el componente de la lista ni el estado.
//
// ACCESIBILIDAD: el contenedor es `role="status"` con `aria-live="polite"`,
// así que un lector de pantalla anuncia el aviso sin interrumpir lo que
// la persona esté haciendo. Los errores usan `assertive`, porque ahí sí
// hay que interrumpir.
// ---------------------------------------------------------------------

export type VarianteToast = "exito" | "aviso" | "error";

interface Toast {
  id: number;
  variante: VarianteToast;
  mensaje: string;
}

const ESTILO: Record<VarianteToast, { clases: string; icono: NombreIcono }> = {
  exito: { clases: "border-success/30 bg-success/15 text-text-primary", icono: "check" },
  aviso: { clases: "border-warning/40 bg-warning/20 text-text-primary", icono: "aviso" },
  error: { clases: "border-error/30 bg-error/15 text-text-primary", icono: "aviso" },
};

// Un aviso de error se lee más despacio que un "guardado", y además
// suele traer texto que importa.
const DURACION_MS: Record<VarianteToast, number> = { exito: 3500, aviso: 5000, error: 6500 };

interface ToastContextValue {
  mostrar: (variante: VarianteToast, mensaje: string) => void;
  exito: (mensaje: string) => void;
  aviso: (mensaje: string) => void;
  error: (mensaje: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const siguienteId = useRef(1);

  const cerrar = useCallback((id: number) => {
    setToasts((previos) => previos.filter((t) => t.id !== id));
  }, []);

  const mostrar = useCallback(
    (variante: VarianteToast, mensaje: string) => {
      const id = siguienteId.current++;
      setToasts((previos) => [...previos, { id, variante, mensaje }]);
      // `setTimeout` y no una animación con callback: si la pestaña pasa
      // a segundo plano, una animación se pausa y el aviso queda pegado.
      setTimeout(() => cerrar(id), DURACION_MS[variante]);
    },
    [cerrar]
  );

  const valor = useMemo<ToastContextValue>(
    () => ({
      mostrar,
      exito: (mensaje: string) => mostrar("exito", mensaje),
      aviso: (mensaje: string) => mostrar("aviso", mensaje),
      error: (mensaje: string) => mostrar("error", mensaje),
    }),
    [mostrar]
  );

  return (
    <ToastContext.Provider value={valor}>
      {children}
      {/* z-[100]: por encima de los modales (z-50), porque el caso más
          común es confirmar algo que se hizo DENTRO de un modal. */}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl",
              ESTILO[t.variante].clases,
            ].join(" ")}
            aria-live={t.variante === "error" ? "assertive" : undefined}
          >
            <span className="mt-0.5 flex-shrink-0">
              <Icono nombre={ESTILO[t.variante].icono} tamano={16} />
            </span>
            <p className="flex-1">{t.mensaje}</p>
            <button
              type="button"
              onClick={() => cerrar(t.id)}
              className="flex-shrink-0 text-text-muted hover:text-text-primary"
              aria-label="Cerrar aviso"
            >
              <Icono nombre="cerrar" tamano={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast debe usarse dentro de <ToastProvider>.");
  }
  return ctx;
}
