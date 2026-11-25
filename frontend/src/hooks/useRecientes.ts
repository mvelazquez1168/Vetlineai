import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------
// Recientes — los últimos pacientes y pantallas que esta persona visitó.
//
// Son lo que la paleta muestra cuando está VACÍA, que es el caso más
// frecuente: se abre con Ctrl+K para volver a algo que se estaba
// mirando, no para buscar algo nuevo.
//
// localStorage y no backend, a propósito: es una preferencia local de
// navegación, no un dato de la clínica. Guardarlo en la base implicaría
// una tabla con escrituras en cada navegación para algo que no se
// comparte entre dispositivos ni le sirve a nadie más. La clave incluye
// el id de usuario para que dos personas que comparten una máquina de
// recepción no se vean los recientes entre sí.
// ---------------------------------------------------------------------

const MAXIMO = 6;

export interface Reciente {
  tipo: "paciente" | "pantalla";
  /** Ruta a la que volver. */
  a: string;
  titulo: string;
  detalle?: string;
}

function clave(userId: string | null): string {
  return `vetplatform_recientes_${userId ?? "anonimo"}`;
}

function leer(userId: string | null): Reciente[] {
  try {
    const crudo = localStorage.getItem(clave(userId));
    if (!crudo) return [];
    const valor = JSON.parse(crudo);
    return Array.isArray(valor) ? (valor as Reciente[]) : [];
  } catch {
    return [];
  }
}

export function useRecientes(userId: string | null) {
  const [recientes, setRecientes] = useState<Reciente[]>([]);

  useEffect(() => setRecientes(leer(userId)), [userId]);

  const registrar = useCallback(
    (reciente: Reciente) => {
      setRecientes((previos) => {
        // Se deduplica por ruta y el visitado va PRIMERO: volver a algo
        // ya reciente no tiene que crear una segunda entrada ni dejarlo
        // donde estaba.
        const sinRepetir = previos.filter((r) => r.a !== reciente.a);
        const actualizados = [reciente, ...sinRepetir].slice(0, MAXIMO);
        try {
          localStorage.setItem(clave(userId), JSON.stringify(actualizados));
        } catch {
          // Cuota llena o modo privado: los recientes son una comodidad,
          // no se rompe la navegación por esto.
        }
        return actualizados;
      });
    },
    [userId]
  );

  return { recientes, registrar };
}
