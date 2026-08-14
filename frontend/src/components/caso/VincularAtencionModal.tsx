import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { citasApi } from "../../lib/agendaApi";
import { formatearFecha } from "../../lib/formatFecha";
import { AtencionSinCaso, workspaceApi } from "../../lib/workspaceApi";

interface VincularAtencionModalProps {
  casoId: string;
  pacienteId: string;
  zonaHoraria: string | null | undefined;
  onClose: () => void;
}

// Deja que el médico asocie a este caso, cuando lo estime conveniente,
// atenciones anteriores del paciente que no tenían caso al momento de
// registrarse — para que el agente las tenga en cuenta al razonar (ver
// construirBloqueAtencionesVinculadas en contextoCaso.ts). El vínculo
// real lo hace citasApi.vincularCaso (PATCH /citas/:id/caso) contra
// atencion.cita_id — esta pantalla solo lista candidatas y dispara esa
// llamada; nunca pisa un vínculo existente (el backend ya lo garantiza).
export function VincularAtencionModal({ casoId, pacienteId, zonaHoraria, onClose }: VincularAtencionModalProps) {
  const [candidatas, setCandidatas] = useState<AtencionSinCaso[] | null>(null);
  const [vinculando, setVinculando] = useState<string | null>(null);
  const [vinculadas, setVinculadas] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    workspaceApi
      .atencionesSinCaso(pacienteId)
      .then((data) => {
        if (!cancelado) setCandidatas(data.atenciones);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof Error ? err.message : "No pudimos obtener las atenciones anteriores.");
      });
    return () => {
      cancelado = true;
    };
  }, [pacienteId]);

  const vincular = async (atencion: AtencionSinCaso) => {
    setVinculando(atencion.atencion_id);
    setError(null);
    try {
      await citasApi.vincularCaso(atencion.cita_id, casoId);
      setVinculadas((prev) => new Set(prev).add(atencion.atencion_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos vincular esa atención.");
    } finally {
      setVinculando(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-black/5 px-6 py-4">
          <h2 className="text-lg font-bold text-primary">Vincular atención anterior</h2>
          <p className="mt-1 text-sm text-text-muted">
            Atenciones de este paciente que se registraron sin caso. Vinculá las que sean relevantes para
            que el agente las tenga en cuenta al analizar este caso.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && <p className="mb-3 text-sm text-error">{error}</p>}

          {candidatas === null && !error && <p className="text-sm text-text-muted">Cargando…</p>}

          {candidatas !== null && candidatas.length === 0 && (
            <p className="text-sm text-text-muted">
              Este paciente no tiene atenciones anteriores sin caso — no hay nada para vincular.
            </p>
          )}

          {candidatas !== null && candidatas.length > 0 && (
            <ul className="space-y-2">
              {candidatas.map((a) => {
                const yaVinculada = vinculadas.has(a.atencion_id);
                return (
                  <li
                    key={a.atencion_id}
                    className={`rounded-xl border px-4 py-3 ${
                      yaVinculada ? "border-accent/30 bg-accent/5" : "border-black/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary">
                          {formatearFecha(a.fecha, zonaHoraria, { day: "2-digit", month: "short", year: "numeric" })}
                          {" · "}
                          {String(a.hora_inicio).slice(0, 5)}
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {a.medico_nombre}
                          {a.peso != null && ` · Peso: ${a.peso} kg`}
                          {a.temperatura != null && ` · Temp: ${a.temperatura} °C`}
                        </p>
                        {a.nota_medica && (
                          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-text-primary">
                            {a.nota_medica}
                          </p>
                        )}
                      </div>
                      <Button
                        variant={yaVinculada ? "secondary" : "primary"}
                        onClick={() => vincular(a)}
                        disabled={yaVinculada || vinculando === a.atencion_id}
                        className="shrink-0 px-3 py-1.5 text-xs"
                      >
                        {yaVinculada ? "Vinculada" : vinculando === a.atencion_id ? "Vinculando…" : "Vincular"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-black/5 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
