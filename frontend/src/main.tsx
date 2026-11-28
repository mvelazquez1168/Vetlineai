import React from "react";
import ReactDOM from "react-dom/client";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router-dom";
import { rutasDeLaApp } from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { AparienciaProvider } from "./hooks/useApariencia";
import { PaletaComandos } from "./components/PaletaComandos";
import { PwaPrompts } from "./components/PwaPrompts";
import { ToastProvider } from "./components/ui/Toast";
import "./index.css";

// ---------------------------------------------------------------------
// EL ROUTER DE DATOS — regla 4.7 de la guía («nunca se pierden datos al
// salir de una pantalla»).
//
// Antes era `<BrowserRouter>` + `<Routes>`. El cambio existe por una
// sola razón: `useBlocker`, lo único que permite interceptar una
// navegación interna para preguntar «Guardar, Descartar o Seguir
// editando», SOLO funciona con el router de datos. Con `<BrowserRouter>`
// la regla se habría quedado en `beforeunload`, que cubre cerrar y
// recargar la pestaña pero no el caso más común: tocar otra opción del
// menú con el formulario a medio llenar.
//
// El árbol de rutas es el mismo de siempre (`rutasDeLaApp` en App.tsx),
// convertido con `createRoutesFromElements`. Hay un verificador que
// comprueba que cada ruta siga resolviendo al mismo componente
// (`npm run verificar-rutas`).
// ---------------------------------------------------------------------

/**
 * Lo que vive dentro del router y acompaña a toda pantalla.
 *
 * `PaletaComandos` usa `useNavigate` y `useLocation`, así que no puede
 * quedar fuera del router. Los proveedores (sesión, apariencia, toasts)
 * sí quedan fuera: ninguno usa hooks de router, y afuera sobreviven a
 * cualquier cambio de ruta sin volver a montarse.
 */
function MarcoDeLaApp() {
  return (
    <>
      <Outlet />
      {/* Una sola vez, arriba del router: así Ctrl/Cmd+K y los atajos
          funcionan en las tres zonas (workspace, admin, agenda) sin que
          ningún layout tenga que acordarse de incluirlo. Se dibuja solo
          para sesiones de clínica. */}
      <PaletaComandos />
      <PwaPrompts />
    </>
  );
}

export const router = createBrowserRouter(
  createRoutesFromElements(<Route element={<MarcoDeLaApp />}>{rutasDeLaApp}</Route>)
);

// ToastProvider va DENTRO de AuthProvider y envolviendo al router: los
// toasts se disparan desde cualquier pantalla (y algunas necesitan la
// sesión para decidir qué decir), y tienen que sobrevivir a un cambio de
// ruta — un "guardado" que se pierde porque la pantalla navegó es
// justamente el caso que el toast viene a resolver.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      {/* El tema de la clinica va DENTRO de AuthProvider —necesita saber
          de que clinica es la sesion— y ENVOLVIENDO al router, para que
          cualquier pantalla pueda leer el logo, el nombre y el color del
          modulo. No re-renderiza: aplica variables CSS. */}
      <AparienciaProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AparienciaProvider>
    </AuthProvider>
  </React.StrictMode>
);
