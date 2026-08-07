import { useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { adminApi, NotificacionUso } from "../lib/adminApi";
import { formatearFecha } from "../lib/formatFecha";

const UMBRAL_LABEL: Record<string, string> = {
  "80_plan": "80% del plan",
  "100_plan": "100% del plan",
  limite_propio: "Límite propio",
};

// Refresco periódico simple — no hay WebSocket/push en esta fase, así que
// la campanita se actualiza sola cada 30s mientras la pantalla está abierta.
const INTERVALO_REFRESCO_MS = 30_000;

export function NotificacionBell() {
  const { zonaHoraria } = useAuth();
  const [notificaciones, setNotificaciones] = useState<NotificacionUso[]>([]);
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  const cargar = () => {
    adminApi.listarNotificaciones().then((data) => setNotificaciones(data.notificaciones));
  };

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, INTERVALO_REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const onClickFuera = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, [abierto]);

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  const marcarLeida = async (id: string) => {
    setNotificaciones((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    await adminApi.marcarNotificacionLeida(id);
  };

  const marcarTodas = async () => {
    setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
    await adminApi.marcarTodasLeidas();
  };

  return (
    <div className="relative" ref={contenedorRef}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-black/5"
        aria-label="Notificaciones"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>
        {noLeidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 z-20 mt-2 w-96 rounded-2xl border border-black/5 bg-surface p-2 shadow-xl">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="font-bold text-text-primary">Notificaciones</p>
            {noLeidas > 0 && (
              <button
                type="button"
                onClick={marcarTodas}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notificaciones.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-text-muted">
                No hay notificaciones todavía.
              </p>
            ) : (
              notificaciones.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.leida && marcarLeida(n.id)}
                  className={[
                    "flex w-full flex-col gap-1 rounded-xl px-3 py-3 text-left transition-colors",
                    n.leida ? "text-text-muted" : "bg-accent/5 text-text-primary",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-accent">
                      {UMBRAL_LABEL[n.umbral] ?? n.umbral}
                    </span>
                    {!n.leida && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent" />}
                  </div>
                  <p className="text-sm">{n.mensaje}</p>
                  <span className="text-xs text-text-muted">
                    {formatearFecha(n.fecha, zonaHoraria, {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
