import { Link, NavLink, Outlet } from "react-router-dom";
import { NotificacionesPersonalesBell } from "../../components/NotificacionesPersonalesBell";
import { useAuth } from "../../hooks/useAuth";

const TABS = [
  { to: "/agenda/calendario", label: "Calendario" },
  { to: "/agenda/centro-comando", label: "Centro de Comando" },
  { to: "/agenda/lista-espera", label: "Lista de Espera" },
  { to: "/agenda/horarios", label: "Configuración de Horarios" },
  { to: "/agenda/analiticas", label: "Analíticas" },
  { to: "/agenda/notificaciones", label: "Notificaciones" },
];

// Layout propio (no AdminLayout) porque este módulo es accesible tanto
// para admin_clinica como para medico (el backend gatea ambos roles por
// igual en salas/horarios/citas/lista-espera/agenda) — ninguno de los dos
// layouts existentes (AdminLayout de sidebar, o el chrome sin nav del
// médico) sirve tal cual para los dos roles a la vez.
export function AgendaLayout() {
  const { rol, logout } = useAuth();
  const volverA = rol === "admin_clinica" ? "/admin/medicos" : "/workspace";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-black/5 bg-surface px-4 sm:px-8">
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Link to={volverA} className="text-sm text-text-muted hover:text-primary">
              ← Volver
            </Link>
            <h1 className="text-lg font-bold text-primary">Agenda de Citas</h1>
          </div>
          <div className="flex items-center gap-2">
            <NotificacionesPersonalesBell />
            <button onClick={logout} className="text-sm text-text-muted hover:text-primary">
              Cerrar sesión
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto pb-2">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                [
                  "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-primary text-white" : "text-text-muted hover:bg-black/5",
                ].join(" ")
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <Outlet />
      </main>
    </div>
  );
}
