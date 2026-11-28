import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";

// ---------------------------------------------------------------------
// LA CAPA DE UN MODAL: el fondo, el foco y CUÁNDO SE CIERRA.
//
// DEFECTO QUE ESTO CIERRA, y era de todo el sistema: en Finanzas ›
// Gastos › Registrar un gasto, un clic fuera del modal lo cerraba y se
// perdía lo escrito. No era un descuido de esa pantalla: `Modal.tsx`
// cerraba en el clic sobre el fondo —lo usan más de cuarenta pantallas—
// y otros once componentes se armaban su propio fondo copiando el mismo
// `onClick={onClose}`.
//
// LA REGLA, que ahora vive en un solo lugar:
//
//   * UN MODAL CON FORMULARIO O ACCIÓN NO SE CIERRA CON UN CLIC AFUERA.
//     Nunca. No hay forma de distinguir «quise cerrar» de «se me fue el
//     clic al costado», y una de las dos cuesta diez minutos de trabajo.
//   * UN MODAL DE CONSULTA —la cronología, la paleta de comandos, la
//     vista previa de un archivo— SÍ se cierra con el clic afuera: no
//     hay nada que perder y cerrarlo así es más rápido que buscar la X.
//   * CON CAMBIOS SIN GUARDAR, cerrar por Esc o por la X PREGUNTA. Sin
//     cambios, cierra sin molestar: una confirmación que aparece siempre
//     se vuelve un trámite y se contesta sin leerla.
//
// El tipo por omisión es `formulario`, que es el caso seguro: un modal
// nuevo que se olvide de declarar su tipo no va a perder lo que alguien
// escribió. El de consulta se pide explícitamente.
//
// ADEMÁS, lo que ningún modal del sistema hacía: **el foco queda
// adentro** mientras está abierto y **vuelve al botón que lo abrió** al
// cerrarse. Sin eso, el tabulador se va al fondo de la página detrás del
// modal y quien navega con teclado queda tecleando en el vacío.
// ---------------------------------------------------------------------

export type TipoModal = "formulario" | "consulta";

export interface CapaModalProps {
  /** Lo que se llama cuando el modal efectivamente se cierra. */
  onClose: () => void;
  /**
   * `formulario` (por omisión): no cierra con el clic afuera.
   * `consulta`: solo lectura, cierra con el clic afuera.
   */
  tipo?: TipoModal;
  /**
   * Si hay algo escrito y sin guardar. Con esto en `true`, cerrar
   * pregunta antes. Un modal que no lo pasa cierra directo, que es lo
   * correcto cuando no hay nada que perder.
   */
  hayCambios?: boolean;
  /**
   * Qué hacer con «Guardar» cuando hay cambios sin guardar (guía §4.7).
   *
   * Con esto, la pregunta al cerrar ofrece las TRES salidas: Guardar,
   * Descartar y Seguir editando. Sin esto ofrece dos, que es lo honesto
   * cuando guardar desde acá no tiene sentido —falta un campo
   * obligatorio, o el modal no sabe guardar nada por su cuenta—.
   */
  onGuardar?: () => Promise<void> | void;
  /** Arriba para la paleta de comandos; centrado para todo lo demás. */
  alineacion?: "centro" | "arriba";
  /** La capa Z, cuando el modal va encima de otro. */
  z?: string;
  /** Clases del contenedor de la caja (ancho, alto, padding). */
  className?: string;
  /** El contenido: la caja del modal, con su encabezado y su pie. */
  children: React.ReactNode;
  /** Qué nombra el modal, para lectores de pantalla. */
  etiquetaAria?: string;
  /**
   * Para los que ya manejan Esc por su cuenta (la paleta de comandos
   * tiene su propio teclado). Evita que Esc se procese dos veces.
   */
  sinManejarEsc?: boolean;
}

export function CapaModal({
  onClose,
  tipo = "formulario",
  hayCambios = false,
  onGuardar,
  alineacion = "centro",
  z = "z-50",
  className = "",
  children,
  etiquetaAria,
  sinManejarEsc = false,
}: CapaModalProps) {
  const caja = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);
  const [preguntando, setPreguntando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // LAS OTRAS TRES VÍAS DE SALIDA (guía §4.7). Este componente ya cubre
  // X, Escape y el clic afuera; lo que no puede ver es que alguien toque
  // el menú detrás del modal, use el atrás del navegador, o recargue la
  // pestaña. Eso lo cubre el hook, UNA VEZ, para los 102 modales.
  const { dialogo: dialogoDeSalida } = useCambiosSinGuardar({
    hayCambios,
    onGuardar,
    queSePierde: "Lo que escribiste en este formulario se va a perder si salís ahora.",
  });

  /** Cierra, o pregunta si hay algo escrito sin guardar. */
  const intentarCerrar = useCallback(() => {
    if (hayCambios) {
      setPreguntando(true);
      return;
    }
    onClose();
  }, [hayCambios, onClose]);

  // El foco: se guarda quién lo tenía, se mete adentro, y al cerrarse
  // vuelve a donde estaba.
  useEffect(() => {
    focoAnterior.current = document.activeElement as HTMLElement | null;
    const primero = caja.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    primero?.focus();
    return () => {
      // `focus()` sobre un elemento que ya no está en el documento no
      // hace nada y no rompe: pasa cuando el modal cierra la pantalla
      // que lo abrió.
      focoAnterior.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sinManejarEsc) {
        // Si la confirmación está abierta, Esc la cierra a ella y deja
        // el modal de abajo abierto: un modal encima de otro no cierra
        // el de abajo.
        if (preguntando) {
          setPreguntando(false);
          return;
        }
        e.stopPropagation();
        intentarCerrar();
        return;
      }

      if (e.key !== "Tab" || !caja.current) return;
      // EL FOCO NO SE VA DEL MODAL. Sin esto, el tabulador recorre la
      // página de atrás, que para quien ve el modal no existe.
      const enfocables = Array.from(
        caja.current.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (enfocables.length === 0) return;
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      } else if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      }
    };
    document.addEventListener("keydown", alTeclear, true);
    return () => document.removeEventListener("keydown", alTeclear, true);
  }, [intentarCerrar, preguntando, sinManejarEsc]);

  return (
    <div
      className={[
        "fixed inset-0 flex justify-center bg-primary/60 p-4",
        alineacion === "arriba" ? "items-start pt-[12vh]" : "items-center",
        z,
      ].join(" ")}
      role="dialog"
      aria-modal="true"
      aria-label={etiquetaAria}
      // EL CLIC AFUERA cierra SOLO en los de consulta. En los de
      // formulario no se hace nada a propósito: ni cerrar, ni preguntar.
      // Preguntar en cada clic al costado sería un diálogo cada dos
      // minutos.
      onClick={tipo === "consulta" ? () => intentarCerrar() : undefined}
    >
      <div
        ref={caja}
        className={className}
        // El clic adentro no sube al fondo. Hace falta igual en los de
        // formulario: el fondo no cierra, pero el de consulta sí, y la
        // caja es la misma.
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>

      {preguntando && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-primary/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Descartar los cambios"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
            <h3 className="text-lg font-bold text-primary">Hay cambios sin guardar</h3>
            <p className="mt-2 text-sm text-text-muted">
              Lo que escribiste en este formulario se va a perder si cerrás ahora.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setPreguntando(false)}
                disabled={guardando}
                className="min-h-11 rounded-lg border border-black/10 px-4 text-sm font-semibold text-text-primary hover:bg-black/5 disabled:opacity-50"
              >
                Seguir editando
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreguntando(false);
                  onClose();
                }}
                disabled={guardando}
                className="min-h-11 rounded-lg bg-error px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                Descartar
              </button>
              {/* La tercera salida (guía §4.7). Solo si el modal sabe
                  guardar: si guardar falla, NO se cierra y el usuario se
                  queda con sus datos y con el error. */}
              {onGuardar && (
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => {
                    setGuardando(true);
                    void Promise.resolve(onGuardar())
                      .then(() => {
                        setPreguntando(false);
                        onClose();
                      })
                      .finally(() => setGuardando(false));
                  }}
                  className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-sobre-primary hover:opacity-90 disabled:opacity-50"
                >
                  {guardando ? "Guardando…" : "Guardar y cerrar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {dialogoDeSalida}
    </div>
  );
}
