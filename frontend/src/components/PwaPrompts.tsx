import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "./ui/Button";

const CLAVE_INSTALACION_DESCARTADA = "vetline_instalar_descartado";

// Heurística de "es un teléfono": no hay un media feature estándar para
// esto. beforeinstallprompt también dispara en Chrome de escritorio (ícono
// en la barra de direcciones), y el Paso 5 pide explícitamente NO mostrar
// la invitación ahí porque no aporta nada.
function esDispositivoMovil(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function InvitacionInstalar() {
  const [eventoDiferido, setEventoDiferido] = useState<EventoInstalacion | null>(null);

  useEffect(() => {
    if (localStorage.getItem(CLAVE_INSTALACION_DESCARTADA) === "1") return;
    if (!esDispositivoMovil()) return;

    const manejar = (evento: Event) => {
      evento.preventDefault();
      setEventoDiferido(evento as EventoInstalacion);
    };

    window.addEventListener("beforeinstallprompt", manejar);
    return () => window.removeEventListener("beforeinstallprompt", manejar);
  }, []);

  const descartar = () => {
    localStorage.setItem(CLAVE_INSTALACION_DESCARTADA, "1");
    setEventoDiferido(null);
  };

  const instalar = async () => {
    if (!eventoDiferido) return;
    await eventoDiferido.prompt();
    await eventoDiferido.userChoice;
    // Aceptada o rechazada en el diálogo nativo, ya cumplió su propósito —
    // no tiene sentido volver a mostrar nuestra propia invitación encima.
    setEventoDiferido(null);
  };

  if (!eventoDiferido) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-primary/10 bg-surface p-4 shadow-lg">
        <div className="flex-1 text-sm text-text-primary">
          <p className="font-semibold">Instalá Vetline Ai</p>
          <p className="text-text-muted">Accedé más rápido desde el ícono en tu pantalla de inicio.</p>
        </div>
        <Button variant="ghost" onClick={descartar} className="shrink-0 px-2">
          Ahora no
        </Button>
        <Button variant="primary" onClick={instalar} className="shrink-0">
          Instalar
        </Button>
      </div>
    </div>
  );
}

// Un médico deja la app abierta horas sin navegar — el navegador solo
// revisa si hay un service worker nuevo cuando hay una navegación real
// (o cada ~24h en segundo plano, según el motor). Sin este chequeo
// periódico, una pestaña quieta podría tardar todo el día en enterarse
// de un despliegue nuevo. 15 minutos es un intervalo razonable para el
// uso real de una clínica, sin llamar a la red constantemente.
const INTERVALO_CHEQUEO_ACTUALIZACION_MS = 15 * 60 * 1000;

function AvisoActualizacion() {
  const [ocultoPorAhora, setOcultoPorAhora] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        registration.update();
      }, INTERVALO_CHEQUEO_ACTUALIZACION_MS);
    },
  });

  if (!needRefresh || ocultoPorAhora) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-primary/10 bg-surface p-4 shadow-lg">
        <div className="flex-1 text-sm text-text-primary">
          <p className="font-semibold">Hay una versión nueva de Vetline Ai</p>
          <p className="text-text-muted">Recargá cuando te quede cómodo para actualizar.</p>
        </div>
        <Button variant="ghost" onClick={() => setOcultoPorAhora(true)} className="shrink-0 px-2">
          Más tarde
        </Button>
        <Button variant="primary" onClick={() => updateServiceWorker(true)} className="shrink-0">
          Recargar
        </Button>
      </div>
    </div>
  );
}

export function PwaPrompts() {
  return (
    <>
      <AvisoActualizacion />
      <InvitacionInstalar />
    </>
  );
}
