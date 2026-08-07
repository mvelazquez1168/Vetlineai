import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CasoDashboardPanel } from "../../components/caso/CasoDashboardPanel";
import { MensajesLista } from "../../components/caso/MensajesLista";
import { useAuth } from "../../hooks/useAuth";
import { CasoAdminDetalle, adminApi } from "../../lib/adminApi";
import { Derivacion, Mensaje, workspaceApi } from "../../lib/workspaceApi";

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
            <h2 className="mt-1 text-lg font-bold text-primary">
              {caso.paciente_nombre} — {caso.especie} ({caso.sexo}
              {caso.edad_anios ? `, ${caso.edad_anios}a` : ""})
            </h2>
            <p className="text-xs text-text-muted">Expediente N.º {caso.numero_expediente}</p>
            <p className="text-sm text-text-muted">{caso.motivo}</p>
          </div>
          <div className="text-right text-sm text-text-muted">
            <p>
              Médico: <span className="font-semibold text-text-primary">{caso.medico_nombre}</span>
            </p>
            <p>
              Agente: <span className="font-semibold text-text-primary">{caso.agente_nombre}</span>
            </p>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-8 py-6">
          <MensajesLista mensajes={mensajes} onAbrirArchivo={abrirArchivo} />
        </div>
      </main>

      <CasoDashboardPanel detalle={caso} derivacion={derivacion} zonaHoraria={zonaHoraria} />
    </div>
  );
}
