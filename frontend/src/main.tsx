import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { PaletaComandos } from "./components/PaletaComandos";
import { PwaPrompts } from "./components/PwaPrompts";
import { ToastProvider } from "./components/ui/Toast";
import "./index.css";

// ToastProvider va DENTRO de AuthProvider y envolviendo a App: los
// toasts se disparan desde cualquier pantalla (y algunas necesitan la
// sesión para decidir qué decir), y tienen que sobrevivir a un cambio de
// ruta — un "guardado" que se pierde porque la pantalla navegó es
// justamente el caso que el toast viene a resolver.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
          {/* Una sola vez, arriba del router: así Ctrl/Cmd+K y los
              atajos funcionan en las tres zonas (workspace, admin,
              agenda) sin que ningún layout tenga que acordarse de
              incluirlo. Se dibuja solo para sesiones de clínica. */}
          <PaletaComandos />
          <PwaPrompts />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
