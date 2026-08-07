import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { formatearFechaRelativa } from "../lib/formatFecha";
import { NotificacionMia, notificacionesApi } from "../lib/workspaceApi";

// Campanita de notificaciones PERSONALES (dirigidas al médico logueado,
// ver notificaciones.routes.ts GET /mias) — distinta a propósito de
// NotificacionBell.tsx (esa es de límite de uso/facturación, tenant-wide,
// solo admin_clinica) y del Panel de Notificaciones bajo Agenda (esa es
// la auditoría completa de la clínica). No comparte lógica de filtrado
// con ninguna de las dos, ver prompt_notificaciones_campanita.md.
//
// Sin polling ni WebSocket a propósito (QUÉ NO HACER del prompt): el
// conteo se carga una vez al montar el componente, y se actualiza
// localmente cuando el usuario marca algo como leído — nunca solo
// mostrando "actualización en vivo".
export function NotificacionesPersonalesBell() {
  const { rol, esAdminClinica, zonaHoraria } = useAuth();
  const [notificaciones, setNotificaciones] = useState<NotificacionMia[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Solo el rol médico puede ser destinatario_tipo='medico' hoy — evita
    // un fetch que siempre devolvería vacío para otros roles (ej.
    // super_admin, sin tenant).
    if (rol !== "medico" && rol !== "admin_clinica") return;
    notificacionesApi
      .listarMias()
      .then((data) => {
        setNotificaciones(data.notificaciones);
        setNoLeidas(data.no_leidas);
      })
      .catch((err) => console.error("Error al cargar tus notificaciones:", err));
  }, [rol]);

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

  const marcarLeida = async (id: string) => {
    setNotificaciones((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    setNoLeidas((prev) => Math.max(0, prev - 1));
    try {
      await notificacionesApi.marcarLeida(id);
    } catch (err) {
      console.error("Error al marcar la notificación como leída:", err);
    }
  };

  if (rol !== "medico" && rol !== "admin_clinica") return null;

  return (
    <div className="relative" ref={contenedorRef}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-black/5"
        aria-label="Tus notificaciones"
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
        <div className="absolute right-0 z-20 mt-2 w-96 rounded-2xl border border-black/5 bg-surface shadow-xl">
          <div className="px-4 py-3">
            <p className="font-bold text-text-primary">Tus notificaciones</p>
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {notificaciones.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <span className="text-2xl" aria-hidden="true">
                  🔔
                </span>
                <p className="text-sm text-text-muted">No tenés notificaciones pendientes.</p>
              </div>
            ) : (
              notificaciones.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.leida && marcarLeida(n.id)}
                  className={[
                    "flex w-full items-start gap-2 border-t border-black/5 px-4 py-3 text-left transition-colors first:border-t-0",
                    n.leida ? "text-text-muted" : "bg-accent/5 text-text-primary",
                  ].join(" ")}
                >
                  {!n.leida && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                  <div className={n.leida ? "pl-4" : ""}>
                    <p className="text-sm font-medium">{n.asunto}</p>
                    <p className="mt-0.5 text-xs">{n.contenido}</p>
                    <p className="mt-1 text-xs text-text-muted">{formatearFechaRelativa(n.creado_en, zonaHoraria)}</p>
                  </div>
                </button>
              ))
            )}
          </div>

          {esAdminClinica && (
            <div className="border-t border-black/5 px-4 py-2.5">
              <Link
                to="/agenda/notificaciones"
                onClick={() => setAbierto(false)}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Ver todas →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
