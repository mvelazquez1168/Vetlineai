import { useCallback, useEffect, useState } from "react";
import { BlockerFunction, useBlocker } from "react-router-dom";

// ---------------------------------------------------------------------
// NUNCA SE PIERDEN DATOS AL SALIR DE UNA PANTALLA — guía rectora, §4.7.
//
// Todo formulario y todo modal con campos pregunta **Guardar**,
// **Descartar** o **Seguir editando** si se intenta salir con cambios
// sin guardar, por CUALQUIER vía:
//
//   · el menú, la miga de pan, el enlace de volver  → `useBlocker`
//   · atrás del navegador o del teléfono            → `useBlocker`
//   · cerrar el modal con X, Escape o clic afuera   → `CapaModal`
//   · recargar o cerrar la pestaña                  → `beforeunload`
//
// LAS TRES VÍAS SON TRES MECANISMOS DISTINTOS y por eso esto existe una
// sola vez. Quien las implemente por pantalla va a cubrir una o dos:
// `beforeunload` es el que todos recuerdan y el que menos pasa.
//
// LO QUE EL NAVEGADOR NO DEJA HACER, y hay que saberlo: al recargar o
// cerrar la pestaña, el diálogo lo dibuja el navegador con su propio
// texto («¿Seguro que querés salir?») y NO se puede ofrecer «Guardar».
// Es una decisión de los navegadores, no una limitación nuestra. En las
// otras tres vías el diálogo es el nuestro y sí ofrece guardar.
//
// LAS PANTALLAS CON AUTOGUARDADO no usan esto mientras no tengan nada
// pendiente: la atención se guarda sola y preguntar sería mentir. Si
// queda un guardado en vuelo, pasan `hayCambios` en `true` y entonces sí
// se avisa.
// ---------------------------------------------------------------------

export interface CambiosSinGuardar {
  /** Si hay algo escrito y todavía no guardado. */
  hayCambios: boolean;
  /**
   * Qué hacer con «Guardar». Sin esto el diálogo ofrece solo
   * «Descartar» y «Seguir editando», que es lo correcto cuando guardar
   * desde acá no tiene sentido (por ejemplo, falta un campo obligatorio
   * y el guardado fallaría).
   */
  onGuardar?: () => Promise<void> | void;
  /** Qué se está por perder, en una frase. Para el diálogo. */
  queSePierde?: string;
}

export interface ResultadoCambiosSinGuardar {
  /** El diálogo. Se pone en el árbol de la pantalla y se dibuja solo cuando hace falta. */
  dialogo: React.ReactNode;
  /** Si en este momento hay una salida detenida esperando respuesta. */
  preguntando: boolean;
}

export function useCambiosSinGuardar({
  hayCambios,
  onGuardar,
  queSePierde,
}: CambiosSinGuardar): ResultadoCambiosSinGuardar {
  const [guardando, setGuardando] = useState(false);

  // --- 1. La navegación dentro de la app ----------------------------
  //
  // `useBlocker` SOLO existe con el router de datos. Por eso `main.tsx`
  // usa `createBrowserRouter`: con `<BrowserRouter>` no hay forma de
  // interceptar un clic en el menú.
  const bloqueo = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        hayCambios && currentLocation.pathname !== nextLocation.pathname,
      [hayCambios]
    )
  );

  // --- 2. Recargar o cerrar la pestaña ------------------------------
  useEffect(() => {
    if (!hayCambios) return;
    const alSalir = (e: BeforeUnloadEvent) => {
      // La forma que piden los navegadores. El texto lo pone el
      // navegador; lo nuestro solo decide si pregunta o no.
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [hayCambios]);

  const preguntando = bloqueo.state === "blocked";

  const guardarYSeguir = async () => {
    if (!onGuardar) return;
    setGuardando(true);
    try {
      await onGuardar();
      // Recién acá se deja pasar: si guardar falló, la navegación NO
      // sigue y el usuario se queda con sus datos y con el error.
      bloqueo.proceed?.();
    } finally {
      setGuardando(false);
    }
  };

  const dialogo = preguntando ? (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-primary/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Hay cambios sin guardar"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h3 className="text-lg font-bold text-primary">Hay cambios sin guardar</h3>
        <p className="mt-2 text-sm text-text-muted">
          {queSePierde ?? "Lo que escribiste en esta pantalla se va a perder si salís ahora."}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => bloqueo.reset?.()}
            disabled={guardando}
            className="min-h-11 rounded-lg border border-black/10 px-4 text-sm font-semibold text-text-primary hover:bg-black/5 disabled:opacity-50"
          >
            Seguir editando
          </button>
          <button
            type="button"
            onClick={() => bloqueo.proceed?.()}
            disabled={guardando}
            className="min-h-11 rounded-lg bg-error px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Descartar
          </button>
          {onGuardar && (
            <button
              type="button"
              onClick={() => void guardarYSeguir()}
              disabled={guardando}
              className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-sobre-primary hover:opacity-90 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar y salir"}
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return { dialogo, preguntando };
}
