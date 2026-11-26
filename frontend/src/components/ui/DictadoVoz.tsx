import { useCallback, useEffect, useRef, useState } from "react";
import { Icono } from "./Icono";
import { aplicarPuntuacionDictada } from "../../lib/puntuacionDictada";

// ---------------------------------------------------------------------
// DICTADO POR VOZ — prompt 07d, fase 1.
//
// Esto NO es un dictado nuevo. Es el que Vetline Ai ya tenía en el
// workspace de casos (`CasoWorkspace.tsx`), sacado a un componente para
// que lo use también la atención. El comportamiento es el mismo: Web
// Speech API del navegador, en español, continuo, con resultados
// parciales que se van viendo mientras se habla.
//
// LAS TRES REGLAS QUE YA ESTABAN Y SE CONSERVAN:
//
//   1. EL TEXTO DICTADO SE AGREGA, nunca reemplaza. Lo que el médico
//      escribió a mano antes de tocar el micrófono sigue ahí.
//   2. SI EL NAVEGADOR NO SOPORTA DICTADO, el botón NO SE DIBUJA. Nunca
//      queda un botón deshabilitado que nadie sabe por qué no anda; en
//      su lugar hay un ícono que explica dónde sí funciona.
//   3. EL MICRÓFONO SE CIERRA al desmontar. Un micrófono abierto en una
//      pantalla que ya nadie mira es lo peor que puede pasar acá.
//
// LO QUE EL 07d AGREGA:
//
//   * PUNTUACIÓN POR VOZ: «punto», «coma», «punto y aparte», «nueva
//      línea». Sin esto, un dictado de tres frases llega como una sola
//      oración y hay que puntuarlo a mano, que es justo el tiempo que
//      el dictado venía a ahorrar.
//   * UN ATAJO (Alt+M) que vale solo para el campo que tiene el foco:
//      un atajo global tendría que adivinar en cuál de los nueve campos
//      de la atención dictar.
// ---------------------------------------------------------------------

/** Los navegadores donde la Web Speech API funciona hoy. */
export const NAVEGADORES_CON_DICTADO = "Chrome, Edge y Opera en computadora, y Chrome en Android";

export function navegadorSoportaDictado(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    )
  );
}

export interface UseDictado {
  soportado: boolean;
  grabando: boolean;
  aviso: string | null;
  alternar: () => void;
}

/**
 * El dictado de UN campo.
 *
 * `onTexto` recibe el valor completo que debe quedar en el campo: el
 * hook no sabe guardar, solo dictar. Así sirve igual para un campo con
 * autoguardado que para uno que se guarda al salir.
 */
export function useDictado(
  valorActual: () => string,
  onTexto: (valor: string) => void,
  ref?: React.RefObject<HTMLElement>
): UseDictado {
  const [grabando, setGrabando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const reconocimiento = useRef<{ stop: () => void } | null>(null);
  const base = useRef("");
  const final = useRef("");
  const soportado = navegadorSoportaDictado();

  // El micrófono se cierra al desmontar, pase lo que pase.
  useEffect(() => {
    return () => {
      reconocimiento.current?.stop();
      reconocimiento.current = null;
    };
  }, []);

  // Y también al cambiar de pestaña del navegador: dejarlo escuchando
  // mientras alguien hace otra cosa es grabar sin que se note.
  useEffect(() => {
    const alOcultarse = () => {
      if (document.hidden) reconocimiento.current?.stop();
    };
    document.addEventListener("visibilitychange", alOcultarse);
    return () => document.removeEventListener("visibilitychange", alOcultarse);
  }, []);

  const alternar = useCallback(() => {
    if (grabando) {
      reconocimiento.current?.stop();
      return;
    }
    const Ctor = ((window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>)
        .webkitSpeechRecognition) as unknown as new () => Record<string, unknown>;
    if (!Ctor) return;

    const r = new Ctor() as Record<string, unknown> & { start: () => void; stop: () => void };
    r.lang = "es-CR";
    r.continuous = true;
    r.interimResults = true;

    const previo = valorActual();
    base.current = previo && !/\s$/.test(previo) ? `${previo} ` : previo;
    final.current = "";

    r.onresult = (evento: unknown) => {
      const e = evento as { resultIndex: number; results: Array<Array<{ transcript: string }> & { isFinal: boolean }> };
      let parcial = "";
      let nuevoFinal = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const texto = e.results[i][0].transcript;
        if (e.results[i].isFinal) nuevoFinal += texto;
        else parcial += texto;
      }
      if (nuevoFinal) final.current += aplicarPuntuacionDictada(nuevoFinal);
      onTexto(base.current + final.current + parcial);
    };

    r.onerror = (evento: unknown) => {
      const e = evento as { error: string };
      setAviso(
        e.error === "not-allowed" || e.error === "permission-denied"
          ? "No se pudo acceder al micrófono: revise los permisos del navegador."
          : "Hubo un problema con el dictado. Puede seguir escribiendo normalmente."
      );
      setTimeout(() => setAviso(null), 5000);
    };

    r.onend = () => {
      setGrabando(false);
      reconocimiento.current = null;
    };

    reconocimiento.current = r;
    setGrabando(true);
    r.start();
  }, [grabando, onTexto, valorActual]);

  // EL ATAJO VALE SOLO PARA EL CAMPO CON FOCO. Con nueve campos
  // dictables en la atención, un atajo global tendría que adivinar en
  // cuál dictar; preguntarle al navegador quién tiene el foco es la
  // respuesta correcta y no hay que mantenerla.
  useEffect(() => {
    if (!soportado || !ref) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== "m") return;
      if (document.activeElement !== ref.current) return;
      e.preventDefault();
      alternar();
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [soportado, ref, alternar]);

  return { soportado, grabando, aviso, alternar };
}

/**
 * El botón del micrófono.
 *
 * Cuando el navegador no soporta dictado devuelve el ícono informativo,
 * no un botón apagado: un control que no hace nada enseña a desconfiar
 * de los controles.
 */
export function BotonDictado({
  grabando,
  soportado,
  onAlternar,
  etiquetaCampo,
}: {
  grabando: boolean;
  soportado: boolean;
  onAlternar: () => void;
  etiquetaCampo: string;
}) {
  if (!soportado) {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted"
        title={`El dictado por voz funciona en ${NAVEGADORES_CON_DICTADO}.`}
        aria-label={`El dictado por voz no está disponible en este navegador. Funciona en ${NAVEGADORES_CON_DICTADO}.`}
      >
        <Icono nombre="microfono-apagado" tamano={14} />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-pressed={grabando}
      title={grabando ? "Detener el dictado (Alt+M)" : `Dictar ${etiquetaCampo} (Alt+M)`}
      aria-label={grabando ? `Detener el dictado de ${etiquetaCampo}` : `Dictar ${etiquetaCampo}`}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        grabando
          ? "animate-pulse bg-error text-white"
          : "text-text-muted hover:bg-black/5 hover:text-primary",
      ].join(" ")}
    >
      <Icono nombre={grabando ? "microfono-apagado" : "microfono"} tamano={14} />
    </button>
  );
}

/**
 * El aviso de «micrófono abierto», visible mientras se dicta.
 *
 * El prompt lo pide siempre visible, y con razón: el botón que parpadea
 * puede quedar fuera de la pantalla al bajar en un formulario largo.
 */
export function IndicadorMicrofono({ campo }: { campo: string }) {
  return (
    <div className="franja-pegada fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-error px-4 py-2 text-sm font-semibold text-white shadow-xl">
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
      Dictando en «{campo}» — toque el micrófono o Alt+M para detener
    </div>
  );
}
