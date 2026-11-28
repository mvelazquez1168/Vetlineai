import { Navigate, useLocation } from "react-router-dom";
import { misRoles, Rol, useAuth } from "../hooks/useAuth";
import { SinPermiso } from "../components/SinPermiso";

export interface ProtectedRouteProps {
  allowedRoles: Rol[];
  children: React.ReactNode;
}

// ---------------------------------------------------------------------
// LA PUERTA DE ENTRADA — defecto bloqueante del 2026-11-27.
//
// Se invitó a alguien con rol **Recepción**, aceptó la invitación y al
// entrar cayó en «No autorizado». El rechazo NO estaba en Keycloak (que
// le asigna `VETERINARIO`, el rol base que la app pide) ni en el backend
// (que resuelve roles y permisos desde `persona_roles` y respondía
// bien): estaba acá.
//
// `misRoles()` devuelve únicamente `medico` y `admin_clinica`, derivados
// de dos banderas. Una recepcionista no es ninguna de las dos, así que
// devolvía una lista vacía y la puerta se cerraba. Lo mismo para caja,
// farmacia, estética, asistente técnico y contador: los seis roles que
// el prompt 04 agregó no podían entrar al sistema.
//
// LA REGLA CORRECTA, y la que fija la guía: entra cualquier persona
// ACTIVA de la clínica que tenga un rol en la base. Lo que ve y lo que
// puede hacer lo deciden sus PERMISOS —el menú se arma con ellos y el
// backend los vuelve a resolver en cada solicitud—, no una lista de dos
// roles escrita en el frontend.
//
// Las zonas de plataforma (`/platform-admin`) siguen con su lista
// exacta: ahí el rol SÍ es la autorización, y son tres.
// ---------------------------------------------------------------------

const ROLES_DE_CLINICA: Rol[] = ["medico", "admin_clinica"];

/**
 * ¿Es personal de una clínica, con un rol de verdad?
 *
 * `tenantId` dice que la sesión es de una clínica y no de plataforma.
 * El rol puede venir de `persona_roles` (lo normal desde el 04) o de las
 * dos banderas heredadas, para sesiones viejas que todavía no traen la
 * lista de roles.
 */
function esPersonalDeLaClinica(user: {
  tenantId: string | null;
  roles?: string[];
  esMedico: boolean;
  esAdminClinica: boolean;
}): boolean {
  if (user.tenantId === null) return false;
  return (user.roles?.length ?? 0) > 0 || user.esMedico || user.esAdminClinica;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const ubicacion = useLocation();

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

  const esZonaDeClinica = allowedRoles.some((r) => ROLES_DE_CLINICA.includes(r));

  const tieneAcceso = esZonaDeClinica
    ? esPersonalDeLaClinica(user)
    : misRoles(user).some((r) => allowedRoles.includes(r));

  if (!tieneAcceso) {
    // SIN SACARLO DE LA APLICACIÓN. Si es personal de la clínica y lo
    // que no le corresponde es ESTA zona, se le dice acá mismo y se le
    // ofrece su inicio. Mandarlo a una pantalla suelta con un botón de
    // login era pedirle que vuelva a entrar para nada.
    if (esPersonalDeLaClinica(user)) {
      return <SinPermiso seccion={ubicacion.pathname} />;
    }
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}
