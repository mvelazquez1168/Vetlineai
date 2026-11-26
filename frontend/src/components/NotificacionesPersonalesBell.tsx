import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { adminApi, NotificacionUso } from "../lib/adminApi";
import { formatearFecha, formatearFechaRelativa } from "../lib/formatFecha";
import { NotificacionMia, notificacionesApi } from "../lib/workspaceApi";

// ---------------------------------------------------------------------
// LA ÚNICA CAMPANA DEL SISTEMA — prompt 01c, sección 2.
//
// Antes había dos, una al lado de la otra en el mismo encabezado: esta
// (notificaciones personales del usuario logueado) y `NotificacionBell`
// (avisos de consumo del plan, de todo el tenant, solo del
// administrador). Dos campanas contiguas no son dos funciones: son una
// pregunta, "¿en cuál miro?".
//
// SE UNIFICARON SIN PERDER NINGUNO DE LOS DOS FLUJOS. El panel tiene dos
// secciones con su título, y el contador suma las dos: un aviso de que la
// clínica llegó al 100% del plan no puede quedar sin campana solo porque
// ahora haya una sola.
//
// Sin polling a propósito en lo personal (QUÉ NO HACER del prompt de
// notificaciones). Los avisos de consumo sí se refrescan cada 30s, que es
// como ya venían.
// ---------------------------------------------------------------------

const UMBRAL_LABEL: Record<string, string> = {
  "80_plan": "80% del plan",
  "100_plan": "100% del plan",
  limite_propio: "Límite propio",
};

const INTERVALO_REFRESCO_MS = 30_000;

export function NotificacionesPersonalesBell() {
  const { rol, esAdminClinica, zonaHoraria } = useAuth();
  const [notificaciones, setNotificaciones] = useState<NotificacionMia[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [uso, setUso] = useState<NotificacionUso[]>([]);
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
    // Los avisos de consumo son del tenant y los expone una ruta de
    // administración: pedirlos como médico devuelve 403, así que no se
    // piden.
    if (!esAdminClinica) return;
    const cargar = () =>
      adminApi
        .listarNotificaciones()
        .then((data) => setUso(data.notificaciones))
        .catch((err) => console.error("Error al cargar los avisos de consumo:", err));
    cargar();
    const intervalo = setInterval(cargar, INTERVALO_REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [esAdminClinica]);

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

  const usoNoLeidas = uso.filter((n) => !n.leida).length;
  const pendientes = noLeidas + usoNoLeidas;

  const marcarLeida = async (id: string) => {
    setNotificaciones((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    setNoLeidas((prev) => Math.max(0, prev - 1));
    try {
      await notificacionesApi.marcarLeida(id);
    } catch (err) {
      console.error("Error al marcar la notificación como leída:", err);
    }
  };

  const marcarUsoLeida = async (id: string) => {
    setUso((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    try {
      await adminApi.marcarNotificacionLeida(id);
    } catch (err) {
      console.error("Error al marcar el aviso como leído:", err);
    }
  };

  if (rol !== "medico" && rol !== "admin_clinica") return null;

  return (
    <div className="relative" ref={contenedorRef}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-black/5"
        aria-label={pendientes > 0 ? `Notificaciones: ${pendientes} sin leer` : "Notificaciones"}
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
        {pendientes > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
            {pendientes > 9 ? "9+" : pendientes}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 z-20 mt-2 w-96 rounded-2xl border border-black/5 bg-surface shadow-xl">
          <div className="px-4 py-3">
            <p className="font-bold text-text-primary">Notificaciones</p>
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {notificaciones.length === 0 && uso.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <p className="text-sm text-text-muted">No tiene notificaciones pendientes.</p>
              </div>
            ) : null}

            {notificaciones.length > 0 && (
              <>
                <p className="border-t border-black/5 bg-black/[0.02] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Para usted
                </p>
                {notificaciones.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => !n.leida && marcarLeida(n.id)}
                    className={[
                      "flex w-full items-start gap-2 border-t border-black/5 px-4 py-3 text-left transition-colors",
                      n.leida ? "text-text-muted" : "bg-accent/5 text-text-primary",
                    ].join(" ")}
                  >
                    {!n.leida && (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent"
                        aria-hidden="true"
                      />
                    )}
                    <div className={n.leida ? "pl-4" : ""}>
                      <p className="text-sm font-medium">{n.asunto}</p>
                      <p className="mt-0.5 text-xs">{n.contenido}</p>
                      <p className="mt-1 text-xs text-text-muted">
                        {formatearFechaRelativa(n.creado_en, zonaHoraria)}
                      </p>
                    </div>
                  </button>
                ))}
              </>
            )}

            {uso.length > 0 && (
              <>
                <p className="border-t border-black/5 bg-black/[0.02] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Del plan y el consumo
                </p>
                {uso.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => !n.leida && marcarUsoLeida(n.id)}
                    className={[
                      "flex w-full flex-col gap-1 border-t border-black/5 px-4 py-3 text-left transition-colors",
                      n.leida ? "text-text-muted" : "bg-accent/5 text-text-primary",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-accent">
                        {UMBRAL_LABEL[n.umbral] ?? n.umbral}
                      </span>
                      {!n.leida && (
                        <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
                      )}
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
                ))}
              </>
            )}
          </div>

          {esAdminClinica && (
            <div className="flex items-center gap-4 border-t border-black/5 px-4 py-2.5">
              <Link
                to="/agenda/notificaciones"
                onClick={() => setAbierto(false)}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Ver todas →
              </Link>
              <Link
                to="/admin/plan-consumo"
                onClick={() => setAbierto(false)}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Plan y consumo →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
