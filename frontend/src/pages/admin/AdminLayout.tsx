import { Link, NavLink, Outlet } from "react-router-dom";
import { BackdropMenuMovil } from "../../components/BackdropMenuMovil";
import { BarraVentanaPurga } from "../../components/BarraVentanaPurga";
import { BarraVerificacionCorreo } from "../../components/BarraVerificacionCorreo";
import { BotonMenuMovil } from "../../components/BotonMenuMovil";
import { NotificacionBell } from "../../components/NotificacionBell";
import { NotificacionesPersonalesBell } from "../../components/NotificacionesPersonalesBell";
import { useAuth } from "../../hooks/useAuth";
import { useMenuColapsable } from "../../hooks/useMenuColapsable";
import { useModulos } from "../../hooks/useModulos";

const NAV_ITEMS = [
  { to: "/admin/medicos", label: "Médicos" },
  { to: "/admin/casos", label: "Casos" },
  { to: "/admin/casos-sin-actividad", label: "Casos sin actividad" },
  { to: "/admin/propietarios", label: "Propietarios" },
  // Núcleo, no un módulo de Vetline Clinic: siempre visible.
  { to: "/pacientes", label: "Pacientes" },
  { to: "/agenda", label: "Agenda" },
  { to: "/admin/agentes", label: "Agentes IA" },
  { to: "/admin/plan-consumo", label: "Plan y consumo" },
  { to: "/admin/clinica", label: "Clínica" },
  { to: "/admin/notificaciones", label: "Notificaciones" },
  { to: "/admin/reporte-atenciones", label: "Reporte de Atenciones" },
  { to: "/admin/facturacion", label: "Facturación" },
];

export function AdminLayout() {
  const { logout, esMedico } = useAuth();
  const { abierto, alternar, cerrar } = useMenuColapsable();
  // Único hook por el que se pregunta por un módulo de Vetline Clinic.
  // La entrada del menú no aparece si la clínica no lo tiene habilitado;
  // el backend igual responde 403 si alguien fuerza la URL.
  const { tieneModulo } = useModulos();

  return (
    <div className="flex min-h-screen bg-background">
      {abierto && <BackdropMenuMovil onClick={cerrar} />}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-shrink-0 flex-col justify-between overflow-y-auto bg-primary p-6 text-white transition-transform duration-200",
          abierto ? "translate-x-0" : "-translate-x-full",
          "md:static md:translate-x-0",
        ].join(" ")}
      >
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
              <div className="h-3 w-3 rounded-full bg-white" />
            </div>
            <div>
              <p className="font-bold leading-tight">Vetline Ai</p>
              <p className="text-xs text-white/60">AI ADMIN</p>
            </div>
          </div>

          <nav className="mt-10 flex flex-col gap-1" onClick={cerrar}>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
            {tieneModulo("expediente") && (
              <NavLink
                to="/clinic"
                className={({ isActive }) =>
                  [
                    "mt-3 rounded-lg border-t border-white/10 px-4 py-2.5 pt-4 text-sm font-medium transition-colors",
                    isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5",
                  ].join(" ")
                }
              >
                Vetline Clinic
              </NavLink>
            )}
            {/* Facturación electrónica. Entrada propia y no una pestaña
                dentro de Vetline Clinic: es la sección que se usa a
                diario, y esconderla un nivel abajo la vuelve dos clics
                para lo más frecuente. */}
            {tieneModulo("facturacion") && (
              <NavLink
                to="/facturacion"
                className={({ isActive }) =>
                  [
                    "rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5",
                  ].join(" ")
                }
              >
                Facturación electrónica
              </NavLink>
            )}
            {esMedico && (
              <Link
                to="/workspace"
                className="mt-3 rounded-lg border-t border-white/10 px-4 py-2.5 pt-4 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
              >
                Área de trabajo (médico) →
              </Link>
            )}
          </nav>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="text-sm font-semibold">Admin de clínica</p>
          <button onClick={logout} className="mt-2 text-sm text-white/60 hover:text-white">
            Cerrar sesión
          </button>
          <Link
            to="/legal"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block text-xs text-white/40 hover:text-white/70"
          >
            Términos y Condiciones · Política de Privacidad
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-10">
        <div className="mb-4 flex items-center gap-3 md:hidden">
          <BotonMenuMovil onClick={alternar} />
          <span className="text-sm font-semibold text-primary">Vetline Ai</span>
        </div>
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex-1 space-y-3">
            <BarraVerificacionCorreo />
            <BarraVentanaPurga />
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <NotificacionesPersonalesBell />
            <NotificacionBell />
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
