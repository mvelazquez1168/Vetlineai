import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { RegistroAtencionModal } from "../../components/caso/RegistroAtencionModal";
import { useAuth } from "../../hooks/useAuth";
import { Cita, citasApi, EstadoCita, etiquetaEstadoCita, PrioridadCita, transicionesValidas } from "../../lib/agendaApi";
import { etiqueta } from "../../lib/etiquetas";
import { crmApi } from "../../lib/crmApi";

export interface CitaDetallePanelProps {
  cita: Cita | null;
  onClose: () => void;
  onEditar: () => void;
  onActualizada: (cita: Cita) => void;
  permitirEditar?: boolean;
}

const ESTADO_BADGE: Record<EstadoCita, BadgeVariant> = {
  programada: "info",
  confirmada: "info",
  registrada: "warning",
  en_consulta: "warning",
  completada: "success",
  cancelada: "error",
  no_show: "error",
};

const PRIORIDAD_BADGE: Record<PrioridadCita, BadgeVariant> = {
  baja: "neutral",
  normal: "info",
  alta: "warning",
  emergencia: "error",
};

// Slide-over propio — mismo patrón que RecetaPanel.tsx (fixed a la
// derecha, no el Modal centrado genérico) para el detalle de una cita.
export function CitaDetallePanel({ cita, onClose, onEditar, onActualizada, permitirEditar = true }: CitaDetallePanelProps) {
  const { esMedico, zonaHoraria } = useAuth();
  const [cambiando, setCambiando] = useState<EstadoCita | null>(null);
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [registroAtencionAbierto, setRegistroAtencionAbierto] = useState(false);
  // POR DÓNDE SE LE AVISA (anexo 07-03, B4).
  //
  // Se le pregunta al MISMO `puedeEnviar` que usa el envío, en vez de
  // mostrar la preferencia guardada: la preferencia dice lo que el
  // cliente quiere y esto dice lo que va a pasar, que no siempre es lo
  // mismo —si no consintió su canal preferido, el aviso sale por el
  // otro—. Es el dato que la recepción necesita antes de prometerle
  // «le mando un WhatsApp».
  const [aviso, setAviso] = useState<{
    puede: boolean;
    canal: string;
    alternativo: boolean;
    explicacion?: string;
  } | null>(null);
  const propietarioId = cita?.propietario_id;
  const pacienteId = cita?.paciente_id;

  useEffect(() => {
    if (!propietarioId || !pacienteId) {
      setAviso(null);
      return;
    }
    let vivo = true;
    crmApi
      .puedeEnviar(propietarioId, {
        paciente: pacienteId,
        finalidad: "salud",
        tipo: "recordatorio_cita",
      })
      .then(
        (v) =>
          vivo &&
          setAviso({
            puede: v.puede,
            canal: v.canal,
            alternativo: v.canalAlternativo === true,
            explicacion: v.explicacion,
          })
      )
      // Sin respuesta no se dice nada: inventar «sale por correo» sería
      // peor que no mostrar la línea.
      .catch(() => vivo && setAviso(null));
    return () => {
      vivo = false;
    };
  }, [propietarioId, pacienteId]);

  if (!cita) return null;

  const cambiarEstado = async (nuevoEstado: EstadoCita, motivo?: string) => {
    setCambiando(nuevoEstado);
    setError(null);
    try {
      const { cita: actualizada } = await citasApi.cambiarEstado(cita.id, nuevoEstado, motivo);
      onActualizada(actualizada);
      setPidiendoMotivo(false);
      setMotivoCancelacion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar el estado de la cita.");
    } finally {
      setCambiando(null);
    }
  };

  const transiciones = transicionesValidas(cita.estado);

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-black/10 bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
        <h2 className="text-lg font-bold text-primary">Detalle de la Cita</h2>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-error" aria-label="Cerrar">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-primary">
              {/* vetline-clinic-01, punto 3.3 — desde la cita a la ficha
                  del paciente: es el salto que la recepcion hace todo el
                  tiempo y que antes no existia. */}
              <Link to={`/pacientes/${cita.paciente_id}`} className="hover:underline">
                {cita.paciente_nombre}
              </Link>
              {cita.especie && <span className="ml-1 font-normal text-text-muted">({etiqueta(cita.especie)})</span>}
            </h3>
            {cita.propietario_nombre && <p className="text-sm text-text-muted">Propietario: {cita.propietario_nombre}</p>}
            {aviso &&
              (aviso.puede ? (
                <p className="mt-0.5 text-xs text-text-muted">
                  Se le avisa por <span className="font-semibold">{etiqueta(aviso.canal)}</span>
                  {aviso.alternativo && " (no es el canal que prefiere)"}
                </p>
              ) : (
                <p className="mt-0.5 text-xs font-semibold text-warning">
                  No se le puede avisar: {aviso.explicacion ?? "sin canal disponible"}
                </p>
              ))}
          </div>
          <Badge variant={ESTADO_BADGE[cita.estado]}>{etiquetaEstadoCita(cita.estado)}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-4 rounded-2xl border border-black/10 bg-background p-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase text-text-muted">Médico</p>
            <p className="mt-0.5 font-medium text-text-primary">{cita.medico_nombre ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-text-muted">Sala</p>
            <p className="mt-0.5 font-medium text-text-primary">{cita.sala_nombre ?? "Sin asignar"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-text-muted">Fecha</p>
            <p className="mt-0.5 font-medium text-text-primary">{cita.fecha}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-text-muted">Horario</p>
            <p className="mt-0.5 font-medium text-text-primary">
              {cita.hora_inicio.slice(0, 5)} – {cita.hora_fin.slice(0, 5)} ({cita.duracion_minutos}m)
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-text-muted">Prioridad</p>
            <Badge variant={PRIORIDAD_BADGE[cita.prioridad]} className="mt-1">
              {cita.prioridad}
            </Badge>
          </div>
        </div>

        {cita.motivo_consulta && (
          <div>
            <p className="text-xs font-semibold uppercase text-text-muted">Motivo de consulta</p>
            <p className="mt-1 text-sm text-text-primary">{cita.motivo_consulta}</p>
          </div>
        )}

        {cita.estado === "cancelada" && cita.motivo_cancelacion && (
          <div className="rounded-xl border border-error/30 bg-error/5 p-3 text-sm text-error">
            Motivo de cancelación: {cita.motivo_cancelacion}
          </div>
        )}

        {error && <p className="text-sm text-error">{error}</p>}

        {transiciones.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase text-text-muted">Cambiar estado</p>
            {pidiendoMotivo ? (
              <div className="mt-2 space-y-2 rounded-lg border border-black/10 p-3">
                <label className="text-xs font-semibold text-text-primary">Motivo de la cancelación</label>
                <textarea
                  className="w-full rounded-lg border border-black/10 bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  rows={2}
                  value={motivoCancelacion}
                  onChange={(e) => setMotivoCancelacion(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setPidiendoMotivo(false)}>
                    Volver
                  </Button>
                  <Button variant="danger" onClick={() => cambiarEstado("cancelada", motivoCancelacion)} disabled={cambiando === "cancelada"}>
                    {cambiando === "cancelada" ? "Cancelando…" : "Confirmar cancelación"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {transiciones.map((estado) =>
                  estado === "cancelada" ? (
                    <Button key={estado} variant="danger" onClick={() => setPidiendoMotivo(true)}>
                      Cancelar cita
                    </Button>
                  ) : (
                    <Button
                      key={estado}
                      variant="secondary"
                      onClick={() => cambiarEstado(estado)}
                      disabled={cambiando !== null}
                    >
                      {cambiando === estado ? "Guardando…" : etiquetaEstadoCita(estado)}
                    </Button>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3 border-t border-black/5 p-6">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cerrar
        </Button>
        {permitirEditar && cita.estado !== "completada" && cita.estado !== "cancelada" && cita.estado !== "no_show" && (
          <Button onClick={onEditar} className="flex-1">
            Editar
          </Button>
        )}
        {/* prompt_code_registro_atencion.md, Paso 6 — "desde la agenda,
            sobre la cita del día". La cita ya existe acá, no hace falta
            resolverla: se abre el registro directo. */}
        {esMedico && cita.estado !== "cancelada" && cita.estado !== "no_show" && (
          <Button onClick={() => setRegistroAtencionAbierto(true)} className="flex-1">
            Registrar atención
          </Button>
        )}
      </div>

      {registroAtencionAbierto && (
        <RegistroAtencionModal
          citaId={cita.id}
          pacienteId={cita.paciente_id}
          pacienteNombre={cita.paciente_nombre ?? "Paciente"}
          especie={cita.especie ?? "Canino"}
          zonaHoraria={zonaHoraria}
          onClose={() => setRegistroAtencionAbierto(false)}
        />
      )}
    </div>
  );
}
