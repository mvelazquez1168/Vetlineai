import { Link, Outlet } from "react-router-dom";
import { NotificacionesPersonalesBell } from "./NotificacionesPersonalesBell";
import { useAuth } from "../hooks/useAuth";

// ---------------------------------------------------------------------
// Chrome compartido por las secciones accesibles a médico Y admin de
// clínica, parametrizado por título.
//
// Misma forma y mismo motivo que AgendaLayout: el backend gatea los dos
// roles por igual en estos endpoints, y ninguno de los dos chrome
// existentes sirve tal cual para ambos — AdminLayout es el sidebar del
// administrador, y el médico no tiene sidebar.
//
// Nace parametrizado en vez de copiado: la primera versión era un
// `PacientesLayout` con el título cableado, y la segunda sección
// (Vetline Clinic) habría sido el mismo archivo con una palabra
// distinta. AgendaLayout queda aparte a propósito: tiene su fila de 6
// pestañas, que estas secciones no necesitan.
// ---------------------------------------------------------------------

export interface SeccionLayoutProps {
  titulo: string;
}

export function SeccionLayout({ titulo }: SeccionLayoutProps) {
  const { esMedico, esAdminClinica, logout } = useAuth();
  // Mismo criterio que AgendaLayout: esMedico/esAdminClinica y no `rol`,
  // porque `rol` es solo la pantalla de aterrizaje y alguien con los dos
  // roles tiene que volver a donde estaba trabajando.
  const volverA = esMedico ? "/workspace" : esAdminClinica ? "/admin/medicos" : "/workspace";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-black/5 bg-surface px-4 sm:px-8">
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Link to={volverA} className="text-sm text-text-muted hover:text-primary">
              ← Volver
            </Link>
            <h1 className="text-lg font-bold text-primary">{titulo}</h1>
          </div>
          <div className="flex items-center gap-2">
            <NotificacionesPersonalesBell />
            <button onClick={logout} className="text-sm text-text-muted hover:text-primary">
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <Outlet />
      </main>
    </div>
  );
}
