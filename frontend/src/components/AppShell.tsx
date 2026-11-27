import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BackdropMenuMovil } from "./BackdropMenuMovil";
import { urlDeArchivo } from "../lib/api";
import { pantallasDisponibles } from "../lib/pantallaDeEntrada";
import { BarraVentanaPurga } from "./BarraVentanaPurga";
import { BarraVerificacionCorreo } from "./BarraVerificacionCorreo";
import { NotificacionesPersonalesBell } from "./NotificacionesPersonalesBell";
import { Icono, LimiteDeError, NombreIcono } from "./ui";
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
  /**
   * EL PERMISO QUE LA HACE VISIBLE (prompt 04).
   *
   * Antes eran dos banderas, `soloAdmin` y `soloMedico`, que preguntaban
   * por los dos booleanos de `personas`. Con ocho roles eso ya no
   * alcanza: la recepción no es administradora y tiene que ver la agenda
   * y los clientes; la caja tiene que ver la caja y no los costos.
   *
   * Sin permiso, la opción es visible para todo el personal.
   *
   * NO ES LA AUTORIZACIÓN: cada ruta del backend la vuelve a resolver con
   * `exigirPermiso`. Esto es para no ofrecer un botón que va a dar 403.
   */
  permiso?: string;
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
      { to: "/agenda", etiqueta: "Agenda", icono: "cita", contador: "citasHoy", permiso: "agenda.ver" },
      { to: "/pacientes", etiqueta: "Pacientes", icono: "paciente", permiso: "cliente.ver" },
      { to: "/admin/propietarios", etiqueta: "Propietarios", icono: "propietario", permiso: "cliente.ver" },
    ],
  },
  {
    titulo: "Comercial",
    opciones: [
      {
        to: "/ventas",
        etiqueta: "Caja",
        icono: "caja",
        modulo: "ventas",
        contador: "aprobaciones",
        permiso: "caja.ver",
      },
      {
        to: "/facturacion",
        etiqueta: "Facturación electrónica",
        icono: "comprobante",
        modulo: "facturacion",
        permiso: "facturacion.ver",
      },
      {
        to: "/inventario",
        etiqueta: "Inventario",
        icono: "inventario",
        modulo: "inventario",
        permiso: "inventario.ver",
      },
      // Finanzas (prompt 10a). Va en «Comercial» y no en
      // «Administración» porque es plata que entra y sale, como la caja
      // y la facturación: quien trabaja en eso las mira juntas.
      {
        to: "/finanzas",
        etiqueta: "Finanzas",
        icono: "reportes",
        modulo: "finanzas",
        permiso: "finanzas.ver",
      },
    ],
  },
  {
    titulo: "Inteligencia",
    opciones: [
      { to: "/admin/casos", etiqueta: "Casos clínicos", icono: "clinico", contador: "casosPendientes" },
      { to: "/admin/casos-sin-actividad", etiqueta: "Casos sin actividad", icono: "hora" },
      {
        to: "/admin/agentes",
        etiqueta: "Agentes IA",
        icono: "agente",
        permiso: "agentes.administrar",
      },
      {
        to: "/workspace",
        etiqueta: "Área de trabajo",
        icono: "medico",
        permiso: "expediente.escribir",
      },
    ],
  },
  {
    titulo: "Administración",
    opciones: [
      {
        // Prompt 12: el dashboard de la clínica y el de los médicos. El
        // reporte de atenciones sigue estando en su ruta y se llega
        // desde acá; no se duplica el nombre «Reportes» en el menú.
        to: "/reportes",
        etiqueta: "Reportes",
        icono: "reportes",
        permiso: "reportes.ver",
      },
      {
        to: "/admin/personas",
        etiqueta: "Personal de la clínica",
        icono: "personas",
        permiso: "personas.administrar",
      },
      { to: "/admin/roles", etiqueta: "Roles y permisos", icono: "ajustes" },
      { to: "/admin/politicas", etiqueta: "Políticas", icono: "ajustes" },
      {
        to: "/admin/configuracion-agenda",
        etiqueta: "Configuración de la agenda",
        icono: "cita",
        permiso: "agenda.ver",
      },
      // Prompt 11. Sin permiso propio: cada pestaña tiene el suyo y lo
      // que no se puede hacer no muestra su botón. Pedir un permiso para
      // entrar dejaría a la recepción sin poder leer los procedimientos
      // que la clínica escribió para ella.
      {
        to: "/admin/administracion",
        etiqueta: "Catálogos, personal y cumplimiento",
        icono: "ajustes",
      },
      {
        to: "/admin/medicos",
        etiqueta: "Médicos e invitaciones",
        icono: "medico",
        permiso: "personas.administrar",
      },
      {
        to: "/admin/clinica",
        etiqueta: "Clínica y usuarios",
        icono: "clinica",
        permiso: "clinica.configurar",
      },
      {
        to: "/admin/notificaciones",
        etiqueta: "Notificaciones",
        icono: "campana",
        permiso: "clinica.configurar",
      },
      // Anexo 07-03, B1. La lista la puede ver todo el personal —es la
      // recepción la que reconoce al cliente repetido— y el botón de
      // unificar aparece solo para el administrador, dentro de la
      // pantalla.
      {
        to: "/admin/duplicados",
        etiqueta: "Posibles duplicados",
        icono: "propietario",
        permiso: "cliente.ver",
      },
      {
        to: "/admin/plan-consumo",
        etiqueta: "Plan y consumo",
        icono: "plan",
        permiso: "clinica.configurar",
      },
      {
        to: "/admin/facturacion",
        etiqueta: "Facturación de la suscripción",
        icono: "comprobante",
        permiso: "clinica.configurar",
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
  const { user, logout, esMedico, esAdminClinica, puede, modulos, pantallaInicio, elegirPantallaInicio } =
    useAuth();
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
          if (o.permiso && !puede(o.permiso)) return false;
          return true;
        }),
      })).filter((g) => g.opciones.length > 0),
    [tieneModulo, puede]
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
                src={urlDeArchivo(apariencia.logoUrl) ?? ""}
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

              {/* LA PANTALLA DE ENTRADA, elegida por el usuario (prompt
                  01c). Va acá, en su bloque, y no en una pantalla de
                  preferencias: es una sola decisión y abrir una pantalla
                  entera para una decisión es como no tenerla.

                  «La que corresponda» no es un valor más de la lista: es
                  volver a que la decida el sistema, que es lo correcto
                  el día que la clínica habilita caja y aparece Inicio. */}
              <label className="mt-3 block text-xs text-sobre-primary/75" htmlFor="pantalla-entrada">
                Al entrar, ir a
              </label>
              <select
                id="pantalla-entrada"
                value={pantallaInicio ?? ""}
                onChange={(e) => void elegirPantallaInicio(e.target.value || null)}
                className="mt-1 min-h-11 w-full rounded-lg border border-sobre-primary/20 bg-sobre-primary/10 px-2 text-sm text-sobre-primary"
              >
                <option value="" className="text-text-primary">
                  La que corresponda
                </option>
                {pantallasDisponibles({ esMedico, esAdminClinica, modulos }).map((p) => (
                  <option key={p.ruta} value={p.ruta} className="text-text-primary">
                    {p.etiqueta}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className={["mt-3 flex items-center gap-2", colapsado ? "flex-col" : ""].join(" ")}>
            <button
              type="button"
              onClick={logout}
              // Con el menu colapsado este boton queda solo con el
              // icono, asi que el nombre accesible va siempre: ponerlo
              // solo cuando esta colapsado seria un nombre que aparece
              // y desaparece.
              aria-label="Cerrar sesión"
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
          {/* EL MARCO SOBREVIVE A LA PANTALLA (defecto del 2026-11-27).
              Si la pantalla explota, el menú y la navegación siguen en
              pie y se puede ir a otra parte, en vez de quedar con la
              página en blanco. La `key` es la ruta: al navegar, el
              límite se rearma solo. */}
          <LimiteDeError key={ubicacion.pathname} ambito="esta pantalla">
            <Outlet />
          </LimiteDeError>
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
