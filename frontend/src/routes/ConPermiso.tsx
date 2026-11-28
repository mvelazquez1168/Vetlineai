import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { SinPermiso } from "../components/SinPermiso";

// ---------------------------------------------------------------------
// ESTA SECCIÓN PIDE ESTE PERMISO — hallazgo del 2026-11-27 por la noche.
//
// Al abrir la puerta a los seis roles nuevos, el bloque de rutas que
// decía `allowedRoles={["admin_clinica"]}` dejó de restringir: casos
// clínicos, agentes IA, plan y suscripción y la configuración de la
// clínica quedaron alcanzables por cualquier persona de la clínica. Los
// DATOS seguían protegidos —el backend resuelve el permiso en cada
// solicitud— pero la pantalla se abría, y una pantalla que no debería
// verse no debería verse.
//
// POR QUÉ ACÁ Y NO EN `ProtectedRoute`: ese envuelve la ZONA entera, y
// el permiso es de cada sección. Puesto acá, el aviso además se dibuja
// DENTRO del marco —la ruta vive en el `Outlet` del `AppShell`—, que es
// lo que pidió el prompt: nadie sale de su sistema por entrar a una
// dirección que no le toca.
//
// ES LA MISMA MATRIZ QUE EL BACKEND. Acá no se decide nada: se evita
// ofrecer una pantalla que va a contestar 403.
// ---------------------------------------------------------------------

export function ConPermiso({
  /** Uno, o varios de los que alcanza con tener alguno. */
  permiso,
  children,
}: {
  permiso: string | string[];
  children: React.ReactNode;
}) {
  const { puede } = useAuth();
  const ubicacion = useLocation();

  const pedidos = Array.isArray(permiso) ? permiso : [permiso];
  if (pedidos.some((p) => puede(p))) return <>{children}</>;

  return <SinPermiso seccion={ubicacion.pathname} enElMarco />;
}
