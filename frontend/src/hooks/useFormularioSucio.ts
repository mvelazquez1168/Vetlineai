import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------
// ¿HAY ALGO ESCRITO Y SIN GUARDAR? — el compañero de
// `useCambiosSinGuardar` (guía §4.7).
//
// El problema que resuelve: `useCambiosSinGuardar` necesita saber si hay
// cambios, y cada pantalla guarda su estado de forma distinta —una
// docena de `useState`, un objeto, un arreglo de líneas—. Comparar
// contra una copia inicial hay que escribirlo pantalla por pantalla, y
// es donde se cuela el olvido.
//
// Esto lo mira desde el DOM: cualquier `input`, `change` o edición que
// BURBUJEE desde el contenedor marcado cuenta como «se escribió algo».
// Funciona sin importar cómo guarde su estado la pantalla, y no hay
// forma de agregar un campo nuevo que quede afuera.
//
// EL CONTENEDOR SE ELIGE A PROPÓSITO, y esta es la decisión importante:
// el `ref` va en el FORMULARIO, no en la pantalla entera. Si fuera la
// pantalla, teclear en el buscador o cambiar un filtro contaría como un
// cambio sin guardar, y el aviso saltaría todo el tiempo al navegar. Un
// aviso que salta cuando no corresponde es un aviso que la gente
// aprende a ignorar, y entonces no protege nada.
//
// SE LIMPIA SOLO AL GUARDAR: `lib/api.ts` avisa con un evento cada vez
// que una escritura (POST, PATCH, PUT, DELETE) sale bien. Es una
// aproximación deliberada: si la pantalla acaba de escribir algo con
// éxito, lo que estaba tecleado ya se fue. Donde haga falta más
// precisión —dos formularios en la misma pantalla— está
// `marcarGuardado()` para decirlo a mano.
// ---------------------------------------------------------------------

/** El evento que `lib/api.ts` emite tras una escritura exitosa. */
export const EVENTO_GUARDADO = "vetline:guardado";

export interface FormularioSucio<T extends HTMLElement = HTMLDivElement> {
  /** Va en el contenedor del formulario, no en la pantalla. */
  ref: React.RefObject<T>;
  hayCambios: boolean;
  /** Para decir a mano que lo de este formulario ya se guardó. */
  marcarGuardado: () => void;
}

/**
 * ¿Este campo es un filtro o un buscador?
 *
 * Teclear en «Buscar paciente…» o cambiar el período NO es un dato que
 * se pierda: es una forma de mirar la lista. Si contara, el aviso
 * saltaría cada vez que alguien busca algo y después toca el menú, y un
 * aviso que salta cuando no corresponde es un aviso que se ignora.
 *
 * Se reconoce por tres vías, de la más explícita a la más barata:
 *   · estar dentro de algo marcado `data-sin-guardar="no"` (la barra de
 *     filtros del sistema de diseño ya lo trae);
 *   · ser un `input type="search"`;
 *   · que su etiqueta o su marcador de posición empiece con «buscar» o
 *     «filtr».
 */
function esFiltroOBusqueda(el: HTMLElement): boolean {
  if (el.closest?.('[data-sin-guardar="no"]')) return true;
  if (el instanceof HTMLInputElement && el.type === "search") return true;
  const texto = [
    el.getAttribute("data-etiqueta"),
    el.getAttribute("placeholder"),
    el.getAttribute("aria-label"),
    el.getAttribute("name"),
  ]
    .filter(Boolean)
    .join(" ");
  return /(^|\s)(buscar|búsqueda|busqueda|filtr)/i.test(texto);
}

export function useFormularioSucio<T extends HTMLElement = HTMLDivElement>(
  opciones: { limpiarAlGuardar?: boolean } = {}
): FormularioSucio<T> {
  const { limpiarAlGuardar = true } = opciones;
  const ref = useRef<T>(null);
  const [hayCambios, setHayCambios] = useState(false);

  const marcarGuardado = useCallback(() => setHayCambios(false), []);

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const alEscribir = (e: Event) => {
      const destino = e.target as HTMLElement | null;
      if (!destino || esFiltroOBusqueda(destino)) return;
      setHayCambios(true);
    };
    nodo.addEventListener("input", alEscribir);
    nodo.addEventListener("change", alEscribir);
    return () => {
      nodo.removeEventListener("input", alEscribir);
      nodo.removeEventListener("change", alEscribir);
    };
  }, []);

  useEffect(() => {
    if (!limpiarAlGuardar) return;
    const alGuardar = () => setHayCambios(false);
    window.addEventListener(EVENTO_GUARDADO, alGuardar);
    return () => window.removeEventListener(EVENTO_GUARDADO, alGuardar);
  }, [limpiarAlGuardar]);

  return { ref, hayCambios, marcarGuardado };
}
