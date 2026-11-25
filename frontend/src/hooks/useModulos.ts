import { Modulo, useAuth } from "./useAuth";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 2 — ÚNICO hook por el que una pantalla
// pregunta si un módulo de Vetline Clinic está habilitado.
//
// Ninguna pantalla lee `useAuth().modulos` directo, por el mismo motivo
// por el que ninguna lee `user.rol` para gatear (ver `misRoles` en
// useAuth.tsx): la pregunta real nunca es "cuál es la lista" sino "¿puedo
// mostrar esto?", y cada pantalla que resuelva eso por su cuenta es una
// oportunidad de resolverlo distinto.
//
// La lista viene de `GET /api/auth/me`, que la saca de `tenant_modulos`.
// Esto es solo para MOSTRAR u OCULTAR: la autorización real la hace el
// gate `requiereModulo()` del backend, que es el que responde 403. Un
// usuario que fuerce la URL de una sección oculta llega a una pantalla
// que le va a dar error del backend, no a datos.
// ---------------------------------------------------------------------

export interface UseModulos {
  /** Todos los módulos habilitados. Para una pantalla que liste capacidades, no para gatear. */
  modulos: Modulo[];
  /** La pregunta normal: ¿muestro esta sección? */
  tieneModulo: (modulo: Modulo) => boolean;
  /** true si la clínica no tiene ningún módulo de Vetline Clinic (el caso de hoy para casi todas). */
  sinModulos: boolean;
}

export function useModulos(): UseModulos {
  const { modulos } = useAuth();

  return {
    modulos,
    tieneModulo: (modulo: Modulo) => modulos.includes(modulo),
    sinModulos: modulos.length === 0,
  };
}
