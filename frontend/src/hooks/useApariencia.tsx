import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getStoredToken, useAuth } from "./useAuth";
import { apiFetch } from "../lib/api";

// ---------------------------------------------------------------------
// EL TEMA DE LA CLÍNICA EN EL NAVEGADOR — prompt 01c, sección 2.
//
// Este hook NO calcula el tema. Lo calcula el servidor (`backend/src/tema.ts`)
// y acá solo se aplican las variables CSS que vienen. El motivo es el
// que el prompt pide explícitamente: una sola fuente del cálculo. Si el
// navegador derivara sus propios tonos, la vista previa de la pantalla
// de configuración y la interfaz real podrían discrepar, y el que
// discrepa siempre es el que nadie mira.
//
// POR QUÉ NO HAY RE-RENDER AL CAMBIAR EL TEMA: lo único que cambia son
// variables CSS en el elemento raíz. React no vuelve a montar nada; el
// navegador repinta. Es lo que pide la sección 7.
//
// EL DESTELLO lo resuelve el script de `index.html`, que corre antes de
// que esto exista. Acá se GUARDA lo aplicado para que ese script tenga
// qué leer la próxima vez.
// ---------------------------------------------------------------------

export interface TemaCalculado {
  primarioElegido: string;
  primario: string;
  ajustado: boolean;
  contrasteConBlanco: number;
  sobrePrimario: string;
  primarioHover: string;
  primarioSuave: string;
  primarioOscuro: string;
  primarioBorde: string;
}

export interface Apariencia {
  primario: string;
  tema: "marca" | "sereno" | "vibrante";
  logoUrl: string | null;
  nombreClinica: string;
  calculado: TemaCalculado;
}

const CLAVE = "vetline:apariencia";

function variablesDe(t: TemaCalculado): Record<string, string> {
  const triple = (hex: string) => {
    const n = hex.replace("#", "");
    return `${parseInt(n.slice(0, 2), 16)} ${parseInt(n.slice(2, 4), 16)} ${parseInt(n.slice(4, 6), 16)}`;
  };
  return {
    "--color-primary": triple(t.primario),
    "--color-primary-hover": triple(t.primarioHover),
    "--color-primary-suave": triple(t.primarioSuave),
    "--color-primary-oscuro": triple(t.primarioOscuro),
    "--color-primary-borde": triple(t.primarioBorde),
    "--color-sobre-primary": triple(t.sobrePrimario),
  };
}

/**
 * Aplica un tema al documento. Exportada porque la vista previa de la
 * pantalla de Apariencia la usa para mostrar el color mientras se
 * elige, y después restaura el guardado.
 */
export function aplicarTema(
  calculado: TemaCalculado,
  tema: string,
  opciones: { recordar?: boolean; tenantId?: string | null } = {}
): void {
  const vars = variablesDe(calculado);
  for (const [clave, valor] of Object.entries(vars)) {
    document.documentElement.style.setProperty(clave, valor);
  }
  document.documentElement.setAttribute("data-tema", tema);
  if (opciones.recordar) {
    try {
      localStorage.setItem(
        CLAVE,
        JSON.stringify({ variables: vars, tema, tenantId: opciones.tenantId ?? null })
      );
    } catch {
      /* sin localStorage, solo se pierde el anti-destello */
    }
  }
}

interface Contexto {
  apariencia: Apariencia | null;
  cargando: boolean;
  /** Para que la pantalla de configuración refresque después de guardar. */
  recargar: () => Promise<void>;
  /** Color del módulo, para los íconos. Acá porque es del tema. */
  colorDeModulo: (modulo: string) => string;
}

const ContextoApariencia = createContext<Contexto>({
  apariencia: null,
  cargando: true,
  recargar: async () => {},
  colorDeModulo: () => "text-primary",
});

const COLOR_MODULO: Record<string, string> = {
  caja: "text-modulo-caja",
  ventas: "text-modulo-caja",
  inventario: "text-modulo-inventario",
  agenda: "text-modulo-agenda",
  facturacion: "text-modulo-facturacion",
  pacientes: "text-modulo-pacientes",
  propietarios: "text-modulo-pacientes",
  expediente: "text-modulo-pacientes",
  casos: "text-modulo-ia",
  ia: "text-modulo-ia",
  admin: "text-modulo-admin",
  crm: "text-modulo-agenda",
};

export function AparienciaProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [apariencia, setApariencia] = useState<Apariencia | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    // Sin sesión no hay clínica: las pantallas públicas se quedan con el
    // tema por defecto, que es lo correcto —el login no es de nadie—.
    if (!user) {
      setCargando(false);
      return;
    }
    try {
      const r = await apiFetch<Apariencia>("/admin/apariencia", { token: getStoredToken() });
      setApariencia(r);
      aplicarTema(r.calculado, r.tema, { recordar: true, tenantId: user.tenantId ?? null });
    } catch {
      // Si no se puede leer, la interfaz queda con el tema por defecto.
      // No se bloquea nada por un color.
      setApariencia(null);
    } finally {
      setCargando(false);
    }
  }, [user]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Si el usuario cambió de clínica, lo guardado es de la anterior: se
  // borra para que el script de arranque no pinte con el color ajeno.
  useEffect(() => {
    if (!user) return;
    try {
      const guardado = localStorage.getItem(CLAVE);
      if (guardado) {
        const t = JSON.parse(guardado) as { tenantId?: string | null };
        if (t.tenantId && user.tenantId && t.tenantId !== user.tenantId) {
          localStorage.removeItem(CLAVE);
        }
      }
    } catch {
      /* nada */
    }
  }, [user]);

  const valor = useMemo<Contexto>(
    () => ({
      apariencia,
      cargando,
      recargar: cargar,
      colorDeModulo: (modulo: string) => COLOR_MODULO[modulo] ?? "text-primary",
    }),
    [apariencia, cargando, cargar]
  );

  return <ContextoApariencia.Provider value={valor}>{children}</ContextoApariencia.Provider>;
}

export function useApariencia(): Contexto {
  return useContext(ContextoApariencia);
}
