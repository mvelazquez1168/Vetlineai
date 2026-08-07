import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

const NAV_ITEMS = [
  { to: "/platform-admin/dashboard", label: "Dashboard" },
  { to: "/platform-admin/clinicas", label: "Clínicas" },
  { to: "/platform-admin/agentes", label: "Agentes" },
  { to: "/platform-admin/base-conocimiento", label: "Base de Conocimiento", soloSenior: true },
  { to: "/platform-admin/auditoria", label: "Auditoría", soloSuperAdmin: true },
  { to: "/platform-admin/facturacion", label: "Facturación", soloSuperAdmin: true },
  { to: "/platform-admin/legal", label: "Legal", soloSuperAdmin: true },
  { to: "/platform-admin/tarifas", label: "Tarifas por token", soloSuperAdmin: true },
  { to: "/platform-admin/parametros", label: "Parámetros", soloSuperAdmin: true },
  { to: "/platform-admin/paises", label: "Directorio de países", soloSuperAdmin: true },
  { to: "/platform-admin/consumo-clinicas", label: "Consumo por clínica", soloSuperAdmin: true },
];

export function PlatformAdminLayout() {
  const { logout, rol } = useAuth();

  // 'soporte' básico no ve Base de Conocimiento; Legal es todavía más
  // restrictivo (ni siquiera soporte_senior) — oculto del sidebar en ambos
  // casos, no solo bloqueado a nivel de ruta (ver ProtectedRoute en App.tsx).
  const navItems = NAV_ITEMS.filter(
    (item) =>
      (!item.soloSenior || rol !== "soporte") &&
      (!item.soloSuperAdmin || rol === "super_admin")
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary py-2 text-center text-xs font-bold uppercase tracking-widest text-white/80">
        Platform Admin • Privileged Access
      </div>

      <div className="flex">
        <aside className="flex h-[calc(100vh-32px)] w-64 flex-shrink-0 flex-col justify-between bg-primary p-6 text-white">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                <div className="h-3 w-3 rounded-full bg-white" />
              </div>
              <div>
                <p className="font-bold leading-tight">Vetline Ai</p>
                <p className="text-xs text-white/60">PLATFORM TEAM</p>
              </div>
            </div>

            <nav className="mt-10 flex flex-col gap-1">
              {navItems.map((item) => (
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
            </nav>
          </div>

          <div className="border-t border-white/10 pt-4">
            <p className="text-sm font-semibold">Soporte Nivel 3</p>
            <button onClick={logout} className="mt-2 text-sm text-white/60 hover:text-white">
              Cerrar sesión
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
