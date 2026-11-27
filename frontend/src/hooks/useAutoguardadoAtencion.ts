import { useCallback, useEffect, useRef, useState } from "react";
import { atencionApi } from "../lib/expedienteApi";
import { ApiError } from "../lib/api";

// ---------------------------------------------------------------------
// EL AUTOGUARDADO DE LA ATENCIÓN — anexo 07-03, A4.
//
// Salió de `AtencionActual.tsx`, donde eran veinte líneas que hacían
// bien lo fácil y mal lo difícil:
//
//   * si el PATCH fallaba, los campos YA se habían sacado del buffer:
//     se perdían, y lo único que quedaba era un toast rojo;
//   * el indicador decía «Guardando…» y nada más — no había forma de
//     saber si lo último llegó;
//   * cerrar la pestaña dentro de los 1200 ms del debounce perdía lo
//     último tecleado;
//   * dos sesiones sobre la misma atención se pisaban en silencio.
//
// LO QUE ESTE HOOK GARANTIZA:
//
//   1. NADA SE PIERDE EN SILENCIO. Lo pendiente se re-encola si el
//      guardado falla, y se reintenta al recuperar la conexión.
//   2. EL ESTADO SE VE. Guardando, guardado hace N s, sin conexión, o
//      conflicto.
//   3. CERRAR LA PESTAÑA NO PIERDE. Se fuerza el guardado en
//      `beforeunload` y al ocultarse la pestaña.
//   4. DOS SESIONES NO SE PISAN. La versión viaja en cada guardado; si
//      el servidor dice 409, se avisa y el médico elige.
//
// EL BORRADOR LOCAL. Lo que todavía no llegó al servidor se guarda en
// el dispositivo, por atención y por usuario, y se borra al subirlo.
// Es el texto PROPIO todavía no enviado —no una copia de lo que
// contestó el servidor—, que es lo que lo distingue de cachear la API:
// la decisión del service worker (`/api` en NetworkOnly, para no servir
// datos clínicos viejos) no se toca y sigue valiendo.
// ---------------------------------------------------------------------

const DEBOUNCE_MS = 1200;

export type EstadoGuardado =
  | { tipo: "limpio" }
  | { tipo: "pendiente" }
  | { tipo: "guardando" }
  | { tipo: "guardado"; cuando: number }
  | { tipo: "sin_conexion" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "conflicto"; valoresDelServidor: Record<string, unknown>; versionActual: number };

function claveLocal(atencionId: string, personaId: string): string {
  return `vetline:borrador:${atencionId}:${personaId}`;
}

/** Lo que quedó sin subir en este dispositivo, si quedó algo. */
export function leerBorradorLocal(
  atencionId: string,
  personaId: string
): Record<string, unknown> | null {
  try {
    const crudo = localStorage.getItem(claveLocal(atencionId, personaId));
    return crudo ? (JSON.parse(crudo) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function borrarBorradorLocal(atencionId: string, personaId: string): void {
  try {
    localStorage.removeItem(claveLocal(atencionId, personaId));
  } catch {
    /* sin localStorage el autoguardado funciona igual, solo sin red de seguridad */
  }
}

export interface Autoguardado {
  estado: EstadoGuardado;
  /** Registra un cambio de campo; se sube con debounce. */
  guardarCampo: (campo: string, valor: unknown) => void;
  /** Sube ya lo pendiente. Se llama antes de cerrar la atención. */
  vaciarPendientes: () => Promise<void>;
  /** Resuelve un conflicto quedándose con lo del servidor. */
  aceptarDelServidor: () => void;
  /** Resuelve un conflicto reescribiendo lo propio encima. */
  reintentarPisando: () => Promise<void>;
}

export function useAutoguardadoAtencion({
  atencionId,
  personaId,
  version,
  onGuardado,
  onCampoLocal,
}: {
  atencionId: string | null;
  personaId: string;
  /** La versión que trajo la última carga del detalle. */
  version: number;
  /** Para que la pantalla actualice su versión y su copia. */
  onGuardado: (version: number) => void;
  /** Actualización optimista en la pantalla. */
  onCampoLocal: (campo: string, valor: unknown) => void;
}): Autoguardado {
  const [estado, setEstado] = useState<EstadoGuardado>({ tipo: "limpio" });
  const pendientes = useRef<Record<string, unknown>>({});
  const temporizador = useRef<number | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;

  const persistirLocal = useCallback(() => {
    if (!atencionId) return;
    try {
      const hay = Object.keys(pendientes.current).length > 0;
      if (hay) {
        localStorage.setItem(claveLocal(atencionId, personaId), JSON.stringify(pendientes.current));
      } else {
        localStorage.removeItem(claveLocal(atencionId, personaId));
      }
    } catch {
      /* ver borrarBorradorLocal */
    }
  }, [atencionId, personaId]);

  const subir = useCallback(async () => {
    if (!atencionId) return;
    const campos = { ...pendientes.current };
    if (Object.keys(campos).length === 0) return;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setEstado({ tipo: "sin_conexion" });
      return;
    }

    setEstado({ tipo: "guardando" });
    try {
      const r = await atencionApi.guardar(atencionId, { ...campos, version: versionRef.current });
      // SOLO AHORA se sacan del buffer: si el guardado falla, siguen
      // ahí. Esto es lo que antes se hacía al revés.
      for (const campo of Object.keys(campos)) {
        if (pendientes.current[campo] === campos[campo]) delete pendientes.current[campo];
      }
      persistirLocal();
      versionRef.current = r.version;
      onGuardado(r.version);
      setEstado({ tipo: "guardado", cuando: Date.now() });
    } catch (err) {
      const e = err as ApiError & { data?: { codigo?: string; valores?: Record<string, unknown>; versionActual?: number } };
      if (e?.data?.codigo === "CONFLICTO_DE_VERSION") {
        setEstado({
          tipo: "conflicto",
          valoresDelServidor: e.data.valores ?? {},
          versionActual: e.data.versionActual ?? versionRef.current,
        });
        return;
      }
      // Lo pendiente NO se toca: se reintenta al volver la conexión o
      // al siguiente cambio.
      persistirLocal();
      setEstado({
        tipo: typeof navigator !== "undefined" && !navigator.onLine ? "sin_conexion" : "error",
        mensaje: (err as Error).message,
      } as EstadoGuardado);
    }
  }, [atencionId, onGuardado, persistirLocal]);

  const guardarCampo = useCallback(
    (campo: string, valor: unknown) => {
      if (!atencionId) return;
      onCampoLocal(campo, valor);
      pendientes.current[campo] = valor;
      persistirLocal();
      setEstado((e) => (e.tipo === "conflicto" ? e : { tipo: "pendiente" }));
      if (temporizador.current) window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => void subir(), DEBOUNCE_MS);
    },
    [atencionId, onCampoLocal, persistirLocal, subir]
  );

  const vaciarPendientes = useCallback(async () => {
    if (temporizador.current) window.clearTimeout(temporizador.current);
    await subir();
  }, [subir]);

  // CERRAR LA PESTAÑA NO PUEDE PERDER LO ÚLTIMO. `beforeunload` no
  // espera promesas, así que lo que de verdad salva el texto es el
  // borrador local; la subida se intenta igual por si llega.
  useEffect(() => {
    const alCerrar = () => {
      persistirLocal();
      if (Object.keys(pendientes.current).length > 0) void subir();
    };
    const alOcultarse = () => {
      if (document.visibilityState === "hidden") alCerrar();
    };
    window.addEventListener("beforeunload", alCerrar);
    document.addEventListener("visibilitychange", alOcultarse);
    return () => {
      window.removeEventListener("beforeunload", alCerrar);
      document.removeEventListener("visibilitychange", alOcultarse);
    };
  }, [persistirLocal, subir]);

  // Al volver la conexión se reintenta solo: el médico no tiene que
  // acordarse de volver a tocar el campo.
  useEffect(() => {
    const alVolver = () => {
      if (Object.keys(pendientes.current).length > 0) void subir();
    };
    window.addEventListener("online", alVolver);
    const alCaerse = () => setEstado({ tipo: "sin_conexion" });
    window.addEventListener("offline", alCaerse);
    return () => {
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", alCaerse);
    };
  }, [subir]);

  const aceptarDelServidor = useCallback(() => {
    pendientes.current = {};
    persistirLocal();
    setEstado({ tipo: "limpio" });
  }, [persistirLocal]);

  const reintentarPisando = useCallback(async () => {
    setEstado((e) => {
      if (e.tipo === "conflicto") versionRef.current = e.versionActual;
      return { tipo: "pendiente" };
    });
    await subir();
  }, [subir]);

  return { estado, guardarCampo, vaciarPendientes, aceptarDelServidor, reintentarPisando };
}
