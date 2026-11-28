import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
// ---------------------------------------------------------------------
// REESCRITO EL 2026-11-27 por tres defectos que Miguel vio en pantalla:
//
//   1. EL FONDO ERA SEMITRANSPARENTE (`bg-success/15`, `bg-warning/20`).
//      Sobre el oscurecido de un modal se veía rosado y sin contraste;
//      sobre una tabla se leía el texto de la fila A TRAVÉS del aviso.
//      Ahora el fondo es la superficie opaca, con una barra de color a
//      la izquierda y el ícono en color: el color sigue estando y el
//      texto se lee siempre.
//
//      Por qué no un fondo sólido de color con texto blanco: `warning`
//      rgb(180 120 20) da 3,72:1 contra el blanco y no llega a AA. Con
//      la superficie opaca y `text-primary` el contraste es ~16:1 en
//      los tres temas, sin excepciones por variante.
//
//   2. QUEDABA POR DEBAJO DEL MODAL. Ahora va en un PORTAL a `body` y en
//      una capa propia por encima de todo (z-[200]): más alta que los
//      modales (z-50), que la confirmación anidada (z-[100]) y que el
//      diálogo de cambios sin guardar (z-[120]).
//
//   3. DOS AVISOS IGUALES SE APILABAN. Un cierre de atención con el
//      backend caído mostró dos veces el mismo mensaje. Ahora el mismo
//      texto no se repite: se renueva el que ya está.
//
// Y UNA REGLA NUEVA: los errores NO se cierran solos. Un "guardado" que
// se va en cuatro segundos está bien; un error que se va antes de que
// la persona termine de leerlo es un error que no se reportó.
// ---------------------------------------------------------------------

export type VarianteToast = "exito" | "aviso" | "error" | "info";

interface Toast {
  id: number;
  variante: VarianteToast;
  mensaje: string;
}

const ESTILO: Record<VarianteToast, { barra: string; icono: NombreIcono; color: string }> = {
  exito: { barra: "border-l-success", icono: "check", color: "text-success" },
  aviso: { barra: "border-l-warning", icono: "aviso", color: "text-warning" },
  error: { barra: "border-l-error", icono: "aviso", color: "text-error" },
  info: { barra: "border-l-info", icono: "info", color: "text-info" },
};

/**
 * Cuánto dura cada uno. `null` = hasta que lo cierren.
 *
 * Los errores se quedan: son los únicos que piden una decisión, y son
 * los que más cuesta leer a tiempo.
 */
const DURACION_MS: Record<VarianteToast, number | null> = {
  exito: 4500,
  info: 4500,
  aviso: 5000,
  error: null,
};

interface ToastContextValue {
  mostrar: (variante: VarianteToast, mensaje: string) => void;
  exito: (mensaje: string) => void;
  aviso: (mensaje: string) => void;
  error: (mensaje: string) => void;
  info: (mensaje: string) => void;
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
      let id = 0;
      setToasts((previos) => {
        // EL MISMO TEXTO NO SE REPITE. Dos peticiones que fallan por lo
        // mismo son un problema, no dos.
        const ya = previos.find((t) => t.mensaje === mensaje && t.variante === variante);
        if (ya) {
          id = ya.id;
          return previos;
        }
        id = siguienteId.current++;
        return [...previos, { id, variante, mensaje }];
      });

      const duracion = DURACION_MS[variante];
      if (duracion !== null) {
        // `setTimeout` y no una animación con callback: si la pestaña
        // pasa a segundo plano, una animación se pausa y el aviso queda
        // pegado.
        setTimeout(() => cerrar(id), duracion);
      }
    },
    [cerrar]
  );

  const valor = useMemo<ToastContextValue>(
    () => ({
      mostrar,
      exito: (mensaje: string) => mostrar("exito", mensaje),
      aviso: (mensaje: string) => mostrar("aviso", mensaje),
      error: (mensaje: string) => mostrar("error", mensaje),
      info: (mensaje: string) => mostrar("info", mensaje),
    }),
    [mostrar]
  );

  const lista = (
    // EN PORTAL Y EN LA CAPA MÁS ALTA. Dentro del árbol, un ancestro con
    // `transform` o `backdrop-filter` —cualquier modal con desenfoque—
    // crea un bloque contenedor nuevo y el `fixed` deja de ser de la
    // ventana: el aviso termina atrapado detrás del oscurecido.
    //
    // ACCESIBILIDAD: `role="status"` con `aria-live="polite"` anuncia
    // sin interrumpir; los errores usan `assertive`, porque ahí sí hay
    // que interrumpir.
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            // `bg-surface` OPACO, nunca una transparencia: el aviso tapa
            // lo que hay debajo en vez de mezclarse con ello.
            "pointer-events-auto flex items-start gap-3 rounded-xl border border-black/10 border-l-4",
            "bg-surface px-4 py-3 text-sm text-text-primary shadow-2xl",
            ESTILO[t.variante].barra,
          ].join(" ")}
          aria-live={t.variante === "error" ? "assertive" : undefined}
        >
          <span className={["mt-0.5 flex-shrink-0", ESTILO[t.variante].color].join(" ")}>
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
  );

  return (
    <ToastContext.Provider value={valor}>
      {children}
      {typeof document !== "undefined" ? createPortal(lista, document.body) : lista}
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
