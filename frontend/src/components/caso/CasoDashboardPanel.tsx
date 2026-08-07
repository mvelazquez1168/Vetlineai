import { ReactNode } from "react";
import { Badge, BadgeVariant } from "../ui/Badge";
import { ProgressBar } from "../ui/ProgressBar";
import { Derivacion } from "../../lib/workspaceApi";
import { formatearHora } from "../../lib/formatFecha";

const SEVERIDAD_BADGE: Record<string, BadgeVariant> = {
  estable: "success",
  en_observacion: "info",
  investigacion_en_curso: "warning",
  requiere_derivacion: "error",
  critico: "error",
};

const SEVERIDAD_LABEL: Record<string, string> = {
  estable: "Estable",
  en_observacion: "En observación",
  investigacion_en_curso: "Investigación en curso",
  requiere_derivacion: "Requiere derivación",
  critico: "Crítico",
};

interface CasoDashboardPanelProps {
  detalle: { severidad: string; confianza_diagnostica: number | null };
  derivacion: Derivacion | null;
  ultimaActualizacion?: string | null;
  zonaHoraria?: string | null;
  // Paso 2 de prompt_code_dashboards_informes — señal de que hay
  // actividad en el caso posterior a ultimaActualizacion. Es solo una
  // indicación: no bloquea "Actualizar Dashboard", el médico decide.
  informacionPosteriorAlDashboard?: boolean;
  // Contenido adicional debajo del panel estático — usado por
  // CasoWorkspace.tsx para el Dashboard real de GCIS (loading/error/
  // sin_datos/DashboardGcisPanel), que vive en la misma columna del
  // grid. CasoDetalleAdmin.tsx no lo pasa y sigue exactamente igual.
  children?: ReactNode;
}

// Extraído de CasoWorkspace.tsx para reusar el mismo panel (Estado
// clínico, Confianza diagnóstica, Alerta de derivación) en la vista de
// solo lectura del admin de clínica.
export function CasoDashboardPanel({
  detalle,
  derivacion,
  ultimaActualizacion,
  zonaHoraria,
  informacionPosteriorAlDashboard,
  children,
}: CasoDashboardPanelProps) {
  return (
    <aside className="min-h-0 space-y-4 overflow-y-auto border-l border-black/5 bg-surface p-6">
      {ultimaActualizacion && (
        <div>
          <p className="text-xs text-text-muted">
            Última actualización: {formatearHora(ultimaActualizacion, zonaHoraria)}
          </p>
          {informacionPosteriorAlDashboard && (
            <p className="mt-1 text-xs font-semibold text-warning">
              Hay información del caso registrada después de esta actualización.
            </p>
          )}
        </div>
      )}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Estado clínico</h3>
        <Badge variant={SEVERIDAD_BADGE[detalle.severidad] ?? "neutral"} className="mt-2">
          {SEVERIDAD_LABEL[detalle.severidad] ?? detalle.severidad}
        </Badge>
      </div>

      {detalle.confianza_diagnostica != null && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Confianza diagnóstica
          </h3>
          <p className="mt-1 text-2xl font-bold text-primary">{detalle.confianza_diagnostica}%</p>
          <ProgressBar value={detalle.confianza_diagnostica} className="mt-2" />
        </div>
      )}

      {derivacion && (
        <div className="rounded-xl border border-error/30 bg-error/5 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-error">⚠ Alerta de derivación</p>
          <p className="mt-1 text-sm font-semibold text-text-primary">
            {derivacion.especialidad_sugerida}
          </p>
          <p className="mt-1 text-xs text-text-muted">{derivacion.motivo}</p>
        </div>
      )}

      {children}
    </aside>
  );
}
