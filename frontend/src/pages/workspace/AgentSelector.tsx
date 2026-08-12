import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { NotificacionesPersonalesBell } from "../../components/NotificacionesPersonalesBell";
import { useAuth } from "../../hooks/useAuth";
import { AgenteResumen, workspaceApi } from "../../lib/workspaceApi";

export function AgentSelector() {
  const navigate = useNavigate();
  const { logout, esAdminClinica } = useAuth();

  const [nombrePersona, setNombrePersona] = useState<string>("");
  const [nombreTenant, setNombreTenant] = useState<string>("");
  const [agentes, setAgentes] = useState<AgenteResumen[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        const [meData, agentesData] = await Promise.all([
          workspaceApi.obtenerMe(),
          workspaceApi.listarAgentes(),
        ]);
        if (cancelado) return;
        setNombrePersona(meData.persona?.persona_nombre ?? "");
        setNombreTenant(meData.persona?.tenant_nombre ?? "");
        setAgentes(agentesData.agentes);
      } catch {
        if (!cancelado) setError("No pudimos cargar tus agentes. Intentá de nuevo.");
      } finally {
        if (!cancelado) setIsLoading(false);
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, []);

  // "Dr. Carlos García" -> "Dr. García" para el saludo, tal como en el diseño.
  const apellidoSaludo = nombrePersona.split(" ").slice(-1)[0] ?? "";
  const prefijo = nombrePersona.startsWith("Dr.") || nombrePersona.startsWith("Dra.")
    ? nombrePersona.split(" ")[0]
    : "Dr.";

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-text-muted">
        Cargando…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-8 py-16">
      <div className="flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <div className="h-3 w-3 rounded-full bg-white" />
          </div>
          <span className="text-lg font-bold text-primary">Vetline Ai</span>
        </div>
        <div className="flex items-center gap-5">
          {esAdminClinica && (
            <Link to="/admin" className="text-sm font-semibold text-accent hover:underline">
              Panel de administración
            </Link>
          )}
          <Link to="/agenda" className="text-sm font-semibold text-accent hover:underline">
            Agenda
          </Link>
          <Link to="/workspace/casos-sin-actividad" className="text-sm font-semibold text-accent hover:underline">
            Casos sin actividad
          </Link>
          <NotificacionesPersonalesBell />
          <button onClick={logout} className="text-sm text-text-muted hover:text-primary">
            Cerrar sesión
          </button>
        </div>
      </div>

      <h1 className="mt-16 font-display text-5xl text-primary">
        Bienvenido, {prefijo} {apellidoSaludo}
      </h1>
      <p className="mt-4 max-w-xl text-center text-text-muted">
        Selecciona tu área de trabajo para activar el copiloto clínico de inteligencia
        artificial.
      </p>

      {error && <p className="mt-6 text-sm text-error">{error}</p>}

      {!error && agentes.length === 0 && (
        <div className="mt-12 max-w-md rounded-2xl border border-black/5 bg-surface p-8 text-center">
          <h3 className="text-lg font-bold text-primary">Todavía no tenés agentes asignados</h3>
          <p className="mt-2 text-sm text-text-muted">
            Tenés acceso a la plataforma, pero ningún agente clínico está habilitado para vos
            todavía. Pedile al administrador de tu clínica que te asigne uno desde Gestión de
            Médicos.
          </p>
        </div>
      )}

      <div className="mt-12 grid w-full max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {agentes.map((agente) => {
          const disponible = agente.estado_catalogo === "disponible";
          return (
            <button
              key={agente.id}
              disabled={!disponible}
              onClick={() => navigate(`/workspace/agentes/${agente.id}`)}
              className={[
                "flex flex-col items-start rounded-2xl border bg-surface p-6 text-left transition-shadow",
                disponible
                  ? "border-black/5 hover:border-accent hover:shadow-md"
                  : "cursor-not-allowed border-black/5 opacity-60",
              ].join(" ")}
            >
              <div className="flex w-full items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  ●
                </div>
                {!disponible && <Badge variant="info">Próximamente</Badge>}
              </div>
              <h3 className="mt-4 text-lg font-bold text-primary">{agente.nombre}</h3>
              <p className="mt-2 text-sm text-text-muted">{agente.descripcion}</p>

              <div className="mt-6 flex w-full items-center justify-between border-t border-black/5 pt-4">
                {disponible ? (
                  <>
                    <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                      {agente.casos_activos} casos activos
                    </span>
                    <span className="text-sm font-semibold text-accent">Ingresar al área →</span>
                  </>
                ) : (
                  <span className="text-sm text-text-muted">No disponible</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {nombreTenant && (
        <p className="mt-12 text-sm text-text-muted">{nombreTenant}</p>
      )}
    </div>
  );
}
