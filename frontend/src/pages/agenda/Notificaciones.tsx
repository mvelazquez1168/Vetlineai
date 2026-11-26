import { PageHeader } from "../../components/ui";
import { useEffect, useState } from "react";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { useAuth } from "../../hooks/useAuth";
import { formatearFechaRelativa } from "../../lib/formatFecha";
import { Notificacion, TipoNotificacion, notificacionesApi } from "../../lib/workspaceApi";

const TIPO_LABEL: Record<TipoNotificacion, string> = {
  recordatorio_cita: "Recordatorio de cita",
  desparasitacion_proxima: "Desparasitación próxima",
  seguimiento_faltante: "Seguimiento faltante",
  vacunacion_proxima: "Vacunación próxima",
  seguimiento_posterior_consulta: "Seguimiento posterior a la consulta",
  agenda_dia_siguiente: "Agenda del día siguiente",
  confirmacion_cita: "Confirmación de cita",
  cita_cancelada_o_reprogramada: "Cita cancelada o reprogramada",
  informe_disponible: "Informe clínico disponible",
};

// Etiqueta corta para la columna Tipo de la tabla — el filtro de arriba
// usa el nombre completo (TIPO_LABEL), la celda de la tabla usa esta
// versión abreviada, igual que en el mockup.
const TIPO_LABEL_CORTO: Record<TipoNotificacion, string> = {
  recordatorio_cita: "Recordatorio",
  desparasitacion_proxima: "Desparasitación",
  seguimiento_faltante: "Seguimiento",
  vacunacion_proxima: "Vacunación",
  seguimiento_posterior_consulta: "Seguimiento posterior",
  agenda_dia_siguiente: "Agenda del día",
  confirmacion_cita: "Confirmación",
  cita_cancelada_o_reprogramada: "Cancelación/reprogramación",
  informe_disponible: "Informe disponible",
};

const TIPO_BADGE: Record<TipoNotificacion, BadgeVariant> = {
  recordatorio_cita: "info",
  desparasitacion_proxima: "warning",
  seguimiento_faltante: "error",
  vacunacion_proxima: "warning",
  seguimiento_posterior_consulta: "info",
  agenda_dia_siguiente: "neutral",
  confirmacion_cita: "success",
  cita_cancelada_o_reprogramada: "error",
  informe_disponible: "success",
};

const DESTINATARIO_TIPO_LABEL: Record<Notificacion["destinatario_tipo"], string> = {
  propietario: "Propietario",
  medico: "Médico",
};

// Herramienta de verificación interna (Fase D) — todavía no hay envío
// real (Resend queda para una fase posterior), así que todo lo que se ve
// acá queda en estado "Simulada". Sirve para confirmar que el job diario
// está disparando los 3 tipos de notificación correctamente.
export function Notificaciones() {
  const { zonaHoraria } = useAuth();
  const [notificaciones, setNotificaciones] = useState<Notificacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<TipoNotificacion | "">("");

  useEffect(() => {
    notificacionesApi
      .listar(filtroTipo ? { tipo: filtroTipo } : {})
      .then((data) => setNotificaciones(data.notificaciones))
      .catch((err) => {
        console.error("Error al listar notificaciones:", err);
        setError(err instanceof Error ? err.message : "No pudimos cargar las notificaciones.");
      });
  }, [filtroTipo]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        titulo="Notificaciones de la plataforma"
        subtitulo="Historial de alertas y recordatorios automáticos generados por los agentes de IA."
        icono="campana"
        modulo="agenda"
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        </div>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-black/10 bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted">
          <span
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-text-muted text-[9px] leading-none"
            aria-hidden="true"
          >
            i
          </span>
          Modo Simulación Activo
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { value: "" as const, label: "Todas" },
            { value: "recordatorio_cita" as const, label: TIPO_LABEL.recordatorio_cita },
            { value: "desparasitacion_proxima" as const, label: TIPO_LABEL.desparasitacion_proxima },
            { value: "seguimiento_faltante" as const, label: TIPO_LABEL.seguimiento_faltante },
          ]
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFiltroTipo(opt.value)}
            className={[
              "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              filtroTipo === opt.value
                ? "bg-primary text-white"
                : "border border-black/10 bg-surface text-text-muted hover:bg-black/5",
            ].join(" ")}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {!error && notificaciones === null && <p className="text-sm text-text-muted">Cargando…</p>}

      {!error && notificaciones !== null && notificaciones.length === 0 && (
        <p className="text-sm text-text-muted">Todavía no se generó ninguna notificación.</p>
      )}

      {!error && notificaciones !== null && notificaciones.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-black/5 bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-xs font-bold uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Destinatario</th>
                <th className="px-4 py-3">Asunto</th>
                <th className="px-4 py-3">Fecha de creación</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {notificaciones.map((n) => (
                <tr key={n.id} className="border-b border-black/5 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge variant={TIPO_BADGE[n.tipo]}>{TIPO_LABEL_CORTO[n.tipo]}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <p className="font-semibold text-text-primary">{n.destinatario_nombre ?? "—"}</p>
                    <p className="text-xs text-text-muted">{DESTINATARIO_TIPO_LABEL[n.destinatario_tipo]}</p>
                  </td>
                  <td className="px-4 py-3 text-text-primary">{n.contenido}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                    {formatearFechaRelativa(n.creado_en, zonaHoraria)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      title={
                        n.estado === "simulada"
                          ? "Generada por el sistema pero no enviada realmente todavía — el envío real se habilita en una fase posterior."
                          : undefined
                      }
                    >
                      <Badge variant="neutral" dot>
                        {n.estado === "simulada" ? "Simulada" : n.estado === "enviada" ? "Enviada" : "Fallida"}
                      </Badge>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-start gap-2 border-t border-black/5 px-4 py-3 text-xs text-text-muted">
            <span
              className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-text-muted text-[9px] leading-none"
              aria-hidden="true"
            >
              i
            </span>
            <p>
              Las notificaciones en estado <span className="font-semibold text-text-primary">Simulada</span> se
              generan para verificación interna del flujo clínico. El envío real (correo electrónico) se
              habilitará en una fase posterior.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
