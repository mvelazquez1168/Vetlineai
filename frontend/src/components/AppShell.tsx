import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BackdropMenuMovil } from "./BackdropMenuMovil";
import { BarraVentanaPurga } from "./BarraVentanaPurga";
import { BarraVerificacionCorreo } from "./BarraVerificacionCorreo";
import { NotificacionesPersonalesBell } from "./NotificacionesPersonalesBell";
import { Icono, NombreIcono } from "./ui";
import { useApariencia } from "../hooks/useApariencia";
import { useAuth } from "../hooks/useAuth";
import { useMenuColapsable } from "../hooks/useMenuColapsable";
import { useModulos } from "../hooks/useModulos";

// ---------------------------------------------------------------------
// EL MARCO ÚNICO — prompt 01c, sección 1.
//
// Antes había cuatro: `AdminLayout` con menú lateral, `SeccionLayout`
// con un «← Volver» y sin menú, `AgendaLayout` igual más sus pestañas, y
// las pantallas de Vetline Ai sin marco. De 63 pantallas autenticadas,
// 41 no tenían menú (ver `docs/diseno/relevamiento-marco.md`). Al pasar
// de Casos a Inventario parecía otro producto.
//
// Este es el único para toda la clínica. Las pantallas de plataforma
// (`/platform-admin`) se quedan con el suyo a propósito: ahí se
// administran TODAS las clínicas, y mostrar el color de una sería
// engañoso.
//
// EL MENÚ ES POR GRUPOS Y CON ÍCONOS, y cada opción se muestra según
// `tenant_modulos` y el rol. Un grupo sin opciones visibles no aparece:
// una clínica sin el módulo de caja no tiene por qué ver un grupo
// «Comercial» vacío.
// ---------------------------------------------------------------------

// El tipo de modulo sale de `useAuth`: es el que `tieneModulo` acepta y
// el que el backend conoce. Declarar uno propio aca significaba que el
// menu podia pedir un modulo que no existe.
import type { Modulo } from "../hooks/useAuth";

interface Opcion {
  to: string;
  etiqueta: string;
  icono: NombreIcono;
  /** El módulo que la habilita. Sin módulo, siempre visible. */
  modulo?: Modulo;
  /** `true` si solo la ve un administrador de clínica. */
  soloAdmin?: boolean;
  /** `true` si solo la ve un médico. */
  soloMedico?: boolean;
  /** De dónde sale el contador, cuando tiene. */
  contador?: "citasHoy" | "casosPendientes" | "aprobaciones";
}

interface Grupo {
  titulo: string;
  opciones: Opcion[];
}

// Los nombres y el orden salen del relevamiento: cada opción de hoy está
// acá, ubicada en el grupo más natural. Lo que cambió de nombre se anota
// en el informe —«Clínica» pasa a «Clínica y usuarios», «Facturación»
// (la de la suscripción) pasa a «Facturación de la suscripción» para no
// confundirla con la electrónica—.
const GRUPOS: Grupo[] = [
  {
    titulo: "",
    opciones: [{ to: "/inicio", etiqueta: "Inicio", icono: "inicio" }],
  },
  {
    titulo: "Clínica",
    opciones: [
      { to: "/agenda", etiqueta: "Agenda", icono: "cita", contador: "citasHoy" },
      { to: "/pacientes", etiqueta: "Pacientes", icono: "paciente" },
      { to: "/admin/propietarios", etiqueta: "Propietarios", icono: "propietario" },
    ],
  },
  {
    titulo: "Comercial",
    opciones: [
      { to: "/ventas", etiqueta: "Caja", icono: "caja", modulo: "ventas", contador: "aprobaciones" },
      {
        to: "/facturacion",
        etiqueta: "Facturación electrónica",
        icono: "comprobante",
        modulo: "facturacion",
      },
      { to: "/inventario", etiqueta: "Inventario", icono: "inventario", modulo: "inventario" },
    ],
  },
  {
    titulo: "Inteligencia",
    opciones: [
      { to: "/admin/casos", etiqueta: "Casos clínicos", icono: "clinico", contador: "casosPendientes" },
      { to: "/admin/casos-sin-actividad", etiqueta: "Casos sin actividad", icono: "hora" },
      { to: "/admin/agentes", etiqueta: "Agentes IA", icono: "agente", soloAdmin: true },
      { to: "/workspace", etiqueta: "Área de trabajo", icono: "medico", soloMedico: true },
    ],
  },
  {
    titulo: "Administración",
    opciones: [
      { to: "/admin/reporte-atenciones", etiqueta: "Reportes", icono: "reportes" },
      { to: "/admin/medicos", etiqueta: "Médicos", icono: "personas", soloAdmin: true },
      { to: "/admin/clinica", etiqueta: "Clínica y usuarios", icono: "clinica", soloAdmin: true },
      { to: "/admin/notificaciones", etiqueta: "Notificaciones", icono: "campana", soloAdmin: true },
      { to: "/admin/plan-consumo", etiqueta: "Plan y consumo", icono: "plan", soloAdmin: true },
      {
        to: "/admin/facturacion",
        etiqueta: "Facturación de la suscripción",
        icono: "comprobante",
        soloAdmin: true,
      },
      { to: "/clinic", etiqueta: "Estado de Vetline Clinic", icono: "panel", modulo: "expediente" },
    ],
  },
];

/** La ruta legible de la barra superior: «Comercial › Inventario». */
function rutaLegible(pathname: string): string[] {
  for (const g of GRUPOS) {
    for (const o of g.opciones) {
      if (pathname === o.to || pathname.startsWith(o.to + "/")) {
        return g.titulo ? [g.titulo, o.etiqueta] : [o.etiqueta];
      }
    }
  }
  return [];
}

const CLAVE_GRUPOS = "vetline:menu-grupos";
const CLAVE_COLAPSADO = "vetline:menu-colapsado";

export function AppShell() {
  const { user, logout, esMedico, esAdminClinica } = useAuth();
  const { tieneModulo } = useModulos();
  const { apariencia, colorDeModulo } = useApariencia();
  const { abierto, alternar, cerrar } = useMenuColapsable();
  const ubicacion = useLocation();

  // El estado de los grupos y del modo colapsado se recuerda POR
  // USUARIO, que es lo que pide el prompt: quien trabaja en caja todo el
  // día no quiere volver a plegar «Inteligencia» cada mañana.
  const [plegados, setPlegados] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_GRUPOS) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [colapsado, setColapsado] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CLAVE_COLAPSADO) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_GRUPOS, JSON.stringify(plegados));
      localStorage.setItem(CLAVE_COLAPSADO, colapsado ? "1" : "0");
    } catch {
      /* sin localStorage, solo no se recuerda */
    }
  }, [plegados, colapsado]);

  const visibles = useMemo(
    () =>
      GRUPOS.map((g) => ({
        ...g,
        opciones: g.opciones.filter((o) => {
          if (o.modulo && !tieneModulo(o.modulo)) return false;
          if (o.soloAdmin && !esAdminClinica) return false;
          if (o.soloMedico && !esMedico) return false;
          return true;
        }),
      })).filter((g) => g.opciones.length > 0),
    [tieneModulo, esAdminClinica, esMedico]
  );

  const migas = rutaLegible(ubicacion.pathname);
  const anchoMenu = colapsado ? "w-16" : "w-64";

  return (
    <div className="flex min-h-screen bg-background">
      {abierto && <BackdropMenuMovil onClick={cerrar} />}

      {/* ------------------------------------------------- Menú lateral */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-40 flex flex-shrink-0 flex-col justify-between",
          "overflow-y-auto bg-primary text-sobre-primary transition-all duration-200",
          anchoMenu,
          abierto ? "translate-x-0" : "-translate-x-full",
          "md:static md:translate-x-0",
        ].join(" ")}
      >
        <div className={colapsado ? "p-3" : "p-5"}>
          {/* El logo y el nombre de la clínica. Sin logo cargado, un
              ícono con el color primario: nunca un hueco. */}
          <Link to="/inicio" className="flex items-center gap-3" onClick={cerrar}>
            {apariencia?.logoUrl ? (
              <img
                src={apariencia.logoUrl}
                alt={apariencia.nombreClinica}
                className="h-9 w-9 flex-shrink-0 rounded-lg bg-surface object-contain p-0.5"
              />
            ) : (
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-sobre-primary/15">
                <Icono nombre="clinica" tamano={20} className="text-sobre-primary" />
              </span>
            )}
            {!colapsado && (
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold leading-tight">
                  {apariencia?.nombreClinica ?? "Vetline"}
                </span>
                <span className="block text-xs text-sobre-primary/75">Vetline</span>
              </span>
            )}
          </Link>

          <nav className="mt-6 flex flex-col gap-4" aria-label="Menú principal">
            {visibles.map((g) => {
              const plegado = plegados.includes(g.titulo) && !colapsado;
              return (
                <div key={g.titulo || "inicio"}>
                  {g.titulo && !colapsado && (
                    <button
                      type="button"
                      onClick={() =>
                        setPlegados((p) =>
                          p.includes(g.titulo) ? p.filter((x) => x !== g.titulo) : [...p, g.titulo]
                        )
                      }
                      className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-sobre-primary/75 hover:text-sobre-primary"
                      aria-expanded={!plegado}
                    >
                      {g.titulo}
                      <Icono nombre={plegado ? "chevron-abajo" : "chevron-arriba"} tamano={14} />
                    </button>
                  )}
                  {!plegado && (
                    <div className="mt-1 flex flex-col gap-0.5" onClick={cerrar}>
                      {g.opciones.map((o) => (
                        <NavLink
                          key={o.to}
                          to={o.to}
                          title={colapsado ? o.etiqueta : undefined}
                          className={({ isActive }) =>
                            [
                              "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                              colapsado ? "justify-center" : "",
                              isActive
                                ? "bg-sobre-primary/15 text-sobre-primary"
                                : "text-sobre-primary/80 hover:bg-sobre-primary/10 hover:text-sobre-primary",
                            ].join(" ")
                          }
                        >
                          <Icono nombre={o.icono} tamano={20} className="flex-shrink-0" />
                          {!colapsado && <span className="truncate">{o.etiqueta}</span>}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className={["border-t border-sobre-primary/10", colapsado ? "p-3" : "p-5"].join(" ")}>
          {!colapsado && (
            <>
              {/* `AuthUser` no trae el nombre: el token lleva el id, el
                  rol y la zona horaria. Se muestra el rol, que es lo que
                  esta disponible sin una llamada mas; el nombre completo
                  vive en la pantalla de la clinica. */}
              <p className="truncate text-sm font-semibold">
                {esAdminClinica && esMedico
                  ? "Administracion y medicina"
                  : esAdminClinica
                    ? "Administracion de la clinica"
                    : "Medicina"}
              </p>
              <p className="text-xs text-sobre-primary/75">Sesión activa</p>
            </>
          )}
          <div className={["mt-3 flex items-center gap-2", colapsado ? "flex-col" : ""].join(" ")}>
            <button
              type="button"
              onClick={logout}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-sobre-primary/10 px-3 text-sm font-medium hover:bg-sobre-primary/20"
            >
              <Icono nombre="salir" tamano={16} />
              {!colapsado && "Cerrar sesión"}
            </button>
            {/* El modo de solo íconos. En pantalla angosta no tiene
                sentido: ahí el menú es un cajón. */}
            <button
              type="button"
              onClick={() => setColapsado((c) => !c)}
              aria-label={colapsado ? "Expandir el menú" : "Colapsar el menú"}
              className="hidden min-h-11 items-center rounded-lg bg-sobre-primary/10 px-2 hover:bg-sobre-primary/20 md:flex"
            >
              <Icono
                nombre={colapsado ? "chevron-derecha" : "chevron-izquierda"}
                tamano={16}
              />
            </button>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------ Contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-black/5 bg-surface px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={alternar}
            aria-label="Abrir el menú"
            className="-ml-1 flex min-h-11 items-center rounded-lg px-2 text-text-muted hover:bg-black/5 md:hidden"
          >
            <Icono nombre="menu" tamano={20} />
          </button>

          {/* La ruta de la pantalla. No es un «volver»: es dónde estoy. */}
          <nav aria-label="Ubicación" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 text-sm">
              {migas.map((m, i) => (
                <li key={m} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-text-muted">›</span>}
                  <span
                    className={
                      i === migas.length - 1
                        ? "truncate font-semibold text-text-primary"
                        : "truncate text-text-muted"
                    }
                  >
                    {m}
                  </span>
                </li>
              ))}
            </ol>
          </nav>

          {/* El buscador de la paleta que ya existe. Acá solo se anuncia:
              el componente vive una sola vez, arriba del router. */}
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
              )
            }
            className="hidden min-h-11 items-center gap-2 rounded-lg border border-black/10 px-3 text-sm text-text-muted hover:bg-black/5 sm:flex"
          >
            <Icono nombre="buscar" tamano={16} />
            Buscar
            <kbd className="rounded border border-black/10 bg-background px-1.5 text-xs">Ctrl K</kbd>
          </button>

          {/* UNA SOLA CAMPANA. Antes Casos mostraba dos: una del layout y
              otra de la pantalla. */}
          <NotificacionesPersonalesBell />
        </header>

        <BarraVerificacionCorreo />
        <BarraVentanaPurga />

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** El color del ícono de un módulo, para que lo use `PageHeader`. */
export function useColorDeModulo(modulo: string): string {
  const { colorDeModulo } = useApariencia();
  return colorDeModulo(modulo);
}
