import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { CapaModal } from "../ui/CapaModal";
import { citasApi } from "../../lib/agendaApi";
import { fechaHoyEnZona } from "../../lib/formatFecha";
import { workspaceApi } from "../../lib/workspaceApi";

interface CandidatoCita {
  id: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  caso_id: string | null;
}

interface ResolverCitaModalProps {
  pacienteId: string;
  medicoId: string;
  // Si viene y ya hay una cita de hoy ligada a este caso, se resuelve
  // directo sin mostrar nada — es la puerta "desde el caso" reusando lo
  // que ya está agendado, en vez de preguntar de nuevo.
  casoId?: string;
  zonaHoraria: string | null | undefined;
  motivoSugerido?: string;
  onResuelto: (citaId: string) => void;
  onClose: () => void;
}

function horaActualRedondeada(): string {
  const ahora = new Date();
  const minutos = ahora.getMinutes() < 30 ? 30 : 0;
  const hora = ahora.getMinutes() < 30 ? ahora.getHours() : (ahora.getHours() + 1) % 24;
  return `${String(hora).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

// prompt_code_registro_atencion.md, Paso 2 — "un paciente que llega sin
// turno no es una excepción a resolver por otro camino: se le crea la
// cita en el momento, desde la misma pantalla". Puerta compartida por
// "desde el caso" y "desde el paciente" — la agenda ya resuelve la cita
// del día sola, no necesita este paso.
export function ResolverCitaModal({
  pacienteId,
  medicoId,
  casoId,
  zonaHoraria,
  motivoSugerido,
  onResuelto,
  onClose,
}: ResolverCitaModalProps) {
  const [cargando, setCargando] = useState(true);
  const [candidatos, setCandidatos] = useState<CandidatoCita[]>([]);
  const [modo, setModo] = useState<"elegir" | "crear">("crear");
  const [citaSeleccionadaId, setCitaSeleccionadaId] = useState<string | null>(null);
  const [horaInicio, setHoraInicio] = useState(horaActualRedondeada());
  const [duracionMinutos, setDuracionMinutos] = useState(30);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    workspaceApi
      .listarTodasCitasDeHoy(pacienteId, medicoId, zonaHoraria ?? null)
      .then((citas) => {
        if (cancelado) return;
        if (casoId) {
          const yaLigada = citas.find((c) => c.caso_id === casoId);
          if (yaLigada) {
            onResuelto(yaLigada.id);
            return;
          }
        }
        const sinCaso = citas.filter((c) => c.caso_id === null);
        setCandidatos(sinCaso);
        setModo(sinCaso.length > 0 ? "elegir" : "crear");
        setCargando(false);
      })
      .catch(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacienteId, medicoId, casoId, zonaHoraria]);

  const elegirCita = async (citaId: string) => {
    setProcesando(true);
    setError(null);
    try {
      if (casoId) {
        await citasApi.vincularCaso(citaId, casoId);
      }
      onResuelto(citaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos vincular la cita.");
    } finally {
      setProcesando(false);
    }
  };

  const crearYResolver = async () => {
    if (!horaInicio) return;
    setProcesando(true);
    setError(null);
    try {
      const { cita } = await citasApi.crear({
        pacienteId,
        medicoId,
        fecha: fechaHoyEnZona(zonaHoraria ?? null),
        horaInicio,
        duracionMinutos,
        motivoConsulta: motivoSugerido || undefined,
        casoId: casoId ?? undefined,
      });
      onResuelto(cita.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la cita.");
    } finally {
      setProcesando(false);
    }
  };

  return (
    <CapaModal
      onClose={onClose}
      tipo="formulario"
      // Hay algo que perder cuando ya se eligió una cita o se tocó la
      // hora o la duración de la que se va a crear.
      hayCambios={
        citaSeleccionadaId !== null ||
        horaInicio !== horaActualRedondeada() ||
        duracionMinutos !== 30
      }
      z="z-[70]"
      className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl"
    >
        <h3 className="text-base font-bold text-primary">¿Sobre qué cita registrás esta atención?</h3>
        <p className="mt-1 text-sm text-text-muted">
          La atención siempre se registra sobre una cita — si el paciente llegó sin turno, se la creamos acá mismo.
        </p>

        {cargando ? (
          <p className="mt-4 text-sm text-text-muted">Cargando…</p>
        ) : (
          <>
            {candidatos.length > 0 && (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setModo("elegir")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    modo === "elegir" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
                  }`}
                >
                  Elegir cita de hoy ({candidatos.length})
                </button>
                <button
                  type="button"
                  onClick={() => setModo("crear")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    modo === "crear" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
                  }`}
                >
                  Crear cita ahora
                </button>
              </div>
            )}

            {modo === "elegir" && candidatos.length > 0 && (
              <div className="mt-3 space-y-2">
                {candidatos.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCitaSeleccionadaId(c.id);
                      elegirCita(c.id);
                    }}
                    disabled={procesando}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      citaSeleccionadaId === c.id ? "border-accent bg-accent/5" : "border-black/10 hover:border-accent/40"
                    }`}
                  >
                    {String(c.hora_inicio).slice(0, 5)} – {String(c.hora_fin).slice(0, 5)}
                  </button>
                ))}
              </div>
            )}

            {modo === "crear" && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-muted">Hora de inicio</label>
                    <input
                      type="time"
                      className="mt-1 w-full rounded-lg border border-black/10 bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                      value={horaInicio}
                      onChange={(e) => setHoraInicio(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted">Duración (min)</label>
                    <input
                      type="number"
                      className="mt-1 w-full rounded-lg border border-black/10 bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                      value={duracionMinutos}
                      onChange={(e) => setDuracionMinutos(Number(e.target.value) || 30)}
                    />
                  </div>
                </div>
                <Button fullWidth onClick={crearYResolver} disabled={procesando || !horaInicio}>
                  {procesando ? "Creando…" : "Crear cita y continuar"}
                </Button>
              </div>
            )}
          </>
        )}

        {error && <p className="mt-3 text-xs text-error">{error}</p>}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose} disabled={procesando}>
            Cancelar
          </Button>
        </div>
    </CapaModal>
  );
}
