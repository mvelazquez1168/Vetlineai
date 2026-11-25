import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { CasoDashboardPanel } from "../../components/caso/CasoDashboardPanel";
import { CerrarCasoModal } from "../../components/caso/CerrarCasoModal";
import { MensajesLista } from "../../components/caso/MensajesLista";
import { ReabrirCasoModal } from "../../components/caso/ReabrirCasoModal";
import { useAuth } from "../../hooks/useAuth";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { CasoAdminDetalle, adminApi } from "../../lib/adminApi";
import { Derivacion, Mensaje, workspaceApi } from "../../lib/workspaceApi";

const ESTADO_BADGE: Record<string, BadgeVariant> = {
  triage: "neutral",
  en_curso: "warning",
  completado: "success",
};

// Vista de solo lectura para el admin de clínica: mismos componentes de
// burbujas de mensaje y panel de dashboard que usa CasoWorkspace.tsx, sin
// caja de mensaje nuevo — el admin no participa de la conversación clínica,
// solo la supervisa. El banner de arriba deja explícito que este acceso
// queda auditado (ver GET /admin/casos/:id en el backend).
export function CasoDetalleAdmin() {
  const { casoId } = useParams<{ casoId: string }>();
  const { zonaHoraria } = useAuth();

  const [caso, setCaso] = useState<CasoAdminDetalle | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [derivacion, setDerivacion] = useState<Derivacion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cerrarCasoAbierto, setCerrarCasoAbierto] = useState(false);
  const [reabrirCasoAbierto, setReabrirCasoAbierto] = useState(false);

  useEffect(() => {
    if (!casoId) return;
    setIsLoading(true);
    adminApi
      .obtenerCaso(casoId)
      .then((data) => {
        setCaso(data.caso);
        setMensajes(data.mensajes);
        setDerivacion(data.derivacion);
      })
      .finally(() => setIsLoading(false));
  }, [casoId]);

  const abrirArchivo = async (archivoId: string) => {
    const blob = await workspaceApi.obtenerArchivo(archivoId);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-text-muted">Cargando…</div>;
  }

  if (!caso) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-text-muted">
        <p>Caso no encontrado.</p>
        <Link to="/admin/casos" className="font-semibold text-accent hover:underline">
          ← Volver a Casos Clínicos
        </Link>
      </div>
    );
  }

  return (
    <div className="grid h-screen grid-cols-[1fr_0.9fr] bg-background">
      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="bg-warning/15 px-8 py-3 text-sm font-semibold text-warning">
          Estás viendo este caso como administrador de clínica — esta acción queda registrada.
        </div>

        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/5 bg-surface px-8 py-4">
          <div>
            <Link to="/admin/casos" className="text-sm font-semibold text-accent hover:underline">
              ← Casos Clínicos
            </Link>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-primary">
              {caso.paciente_nombre} — {caso.especie} ({caso.sexo}
              {caso.edad_anios ? `, ${caso.edad_anios}a` : ""})
              <Badge variant={ESTADO_BADGE[caso.estado] ?? "neutral"}>{caso.estado.replace("_", " ")}</Badge>
            </h2>
            <p className="text-xs text-text-muted">Caso N.º {caso.numero_expediente}</p>
            <p className="text-sm text-text-muted">{caso.motivo}</p>
            {caso.estado === "completado" && (
              <p className="mt-1 text-xs text-text-muted">
                Cerrado el {formatearFechaCorta(caso.cerrado_en!, zonaHoraria)}
                {caso.cerrado_por_nombre ? ` por ${caso.cerrado_por_nombre}` : ""} · Desenlace: {caso.desenlace}
              </p>
            )}
            {caso.reabierto_en && (
              <p className="mt-1 text-xs text-text-muted">
                Reabierto el {formatearFechaCorta(caso.reabierto_en, zonaHoraria)}
                {caso.reabierto_por_nombre ? ` por ${caso.reabierto_por_nombre}` : ""}
                {caso.motivo_reapertura ? ` — Motivo: ${caso.motivo_reapertura}` : ""}
              </p>
            )}
          </div>
          <div className="text-right text-sm text-text-muted">
            <p>
              Médico: <span className="font-semibold text-text-primary">{caso.medico_nombre}</span>
            </p>
            <p>
              Agente: <span className="font-semibold text-text-primary">{caso.agente_nombre}</span>
            </p>
            {caso.estado !== "completado" ? (
              <Button
                variant="secondary"
                onClick={() => setCerrarCasoAbierto(true)}
                className="mt-2 px-3 py-2 text-xs"
              >
                Cerrar caso
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setReabrirCasoAbierto(true)}
                className="mt-2 px-3 py-2 text-xs"
              >
                Reabrir caso
              </Button>
            )}
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-8 py-6">
          <MensajesLista mensajes={mensajes} onAbrirArchivo={abrirArchivo} />
        </div>
      </main>

      <CasoDashboardPanel detalle={caso} derivacion={derivacion} zonaHoraria={zonaHoraria} />

      {cerrarCasoAbierto && casoId && (
        <CerrarCasoModal
          pacienteNombre={caso.paciente_nombre}
          pacienteEstado={caso.paciente_estado}
          onClose={() => setCerrarCasoAbierto(false)}
          cerrar={(data) => adminApi.cerrarCaso(casoId, data)}
          onCerrado={(casoActualizado) => {
            setCaso((prev) => (prev ? { ...prev, ...casoActualizado } : prev));
            setCerrarCasoAbierto(false);
          }}
        />
      )}

      {reabrirCasoAbierto && casoId && (
        <ReabrirCasoModal
          onClose={() => setReabrirCasoAbierto(false)}
          reabrir={(motivo) => adminApi.reabrirCaso(casoId, motivo)}
          onReabierto={(casoActualizado) => {
            setCaso((prev) => (prev ? { ...prev, ...casoActualizado } : prev));
            setReabrirCasoAbierto(false);
          }}
        />
      )}
    </div>
  );
}
