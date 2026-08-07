import { Navigate } from "react-router-dom";
import { misRoles, Rol, useAuth } from "../hooks/useAuth";

export interface ProtectedRouteProps {
  allowedRoles: Rol[];
  children: React.ReactNode;
}

/**
 * Redirige a /login si no hay sesión válida, y a /unauthorized si el rol
 * de la sesión no corresponde a esta zona. Se usa para envolver cada uno
 * de los tres grupos de rutas (workspace, admin, platform-admin).
 */
export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-text-muted">
        Cargando sesión…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Una persona puede tener más de un rol a la vez (admin_clinica y médico,
  // caso normal en una clínica chica) — se chequea contra TODOS los roles
  // que tiene, no solo user.rol (que es únicamente su pantalla de aterrizaje).
  const tieneAcceso = misRoles(user).some((r) => allowedRoles.includes(r));
  if (!tieneAcceso) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}
