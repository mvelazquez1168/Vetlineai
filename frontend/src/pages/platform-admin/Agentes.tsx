import { useEffect, useState } from "react";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { AgenteCatalogoCompleto, EstadoAgente, platformAdminApi } from "../../lib/platformAdminApi";

// agentes_paises_v2, Paso 5 — se conserva la grilla de tarjetas existente
// (no se convierte a tabla, decisión explícita) y se le agregan los 3
// estados operativos (activo/discontinuado/mantenimiento), independientes
// de estado_catalogo (disponible/proximamente, editable en el modal
// "Editar" de siempre).

const ESTADO_BADGE: Record<EstadoAgente, { label: string; variant: BadgeVariant }> = {
  activo: { label: "Activo", variant: "success" },
  discontinuado: { label: "Discontinuado", variant: "neutral" },
  mantenimiento: { label: "En mantenimiento", variant: "warning" },
};

export function Agentes() {
  const [agentes, setAgentes] = useState<AgenteCatalogoCompleto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [agenteEditar, setAgenteEditar] = useState<AgenteCatalogoCompleto | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const [especialidadEdit, setEspecialidadEdit] = useState("");
  const [descripcionEdit, setDescripcionEdit] = useState("");
  const [iconoEdit, setIconoEdit] = useState("");
  const [estadoEdit, setEstadoEdit] = useState<"disponible" | "proximamente">("proximamente");
  const [guardando, setGuardando] = useState(false);
  const [errorEdit, setErrorEdit] = useState<string | null>(null);

  // "+ Nuevo Agente" queda deliberadamente sin conectar a ningún endpoint
  // en esta fase — la creación desde cero se implementa más adelante.
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false);

  // Discontinuar / mantenimiento / reactivar — estado operativo.
  const [agenteDiscontinuar, setAgenteDiscontinuar] = useState<AgenteCatalogoCompleto | null>(null);
  const [agenteMantenimiento, setAgenteMantenimiento] = useState<AgenteCatalogoCompleto | null>(null);
  const [motivoMantenimiento, setMotivoMantenimiento] = useState("");
  const [retornoEstimado, setRetornoEstimado] = useState("");
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    platformAdminApi
      .listarAgentesCatalogo()
      .then((data) => setAgentes(data.agentes))
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const abrirEditar = (a: AgenteCatalogoCompleto) => {
    setAgenteEditar(a);
    setNombreEdit(a.nombre);
    setEspecialidadEdit(a.especialidad ?? "");
    setDescripcionEdit(a.descripcion ?? "");
    setIconoEdit(a.icono ?? "");
    setEstadoEdit(a.estado_catalogo);
    setErrorEdit(null);
  };

  const cerrarEditar = () => {
    setAgenteEditar(null);
    setErrorEdit(null);
  };

  const guardarEdicion = async () => {
    if (!agenteEditar || !nombreEdit.trim()) return;
    setGuardando(true);
    setErrorEdit(null);
    try {
      await platformAdminApi.editarAgenteCatalogo(agenteEditar.id, {
        nombre: nombreEdit.trim(),
        especialidad: especialidadEdit.trim() || undefined,
        descripcion: descripcionEdit.trim() || undefined,
        icono: iconoEdit.trim() || undefined,
        estado: estadoEdit,
      });
      cerrarEditar();
      cargar();
    } catch (err: any) {
      setErrorEdit(err?.message ?? "No pudimos guardar los cambios.");
    } finally {
      setGuardando(false);
    }
  };

  const confirmarDiscontinuar = async () => {
    if (!agenteDiscontinuar) return;
    setCambiandoEstado(true);
    setErrorEstado(null);
    try {
      await platformAdminApi.cambiarEstadoAgente(agenteDiscontinuar.id, { estado: "discontinuado" });
      setAgenteDiscontinuar(null);
      cargar();
    } catch (err: any) {
      setErrorEstado(err?.message ?? "No se pudo discontinuar el agente.");
    } finally {
      setCambiandoEstado(false);
    }
  };

  const abrirMantenimiento = (a: AgenteCatalogoCompleto) => {
    setAgenteMantenimiento(a);
    setMotivoMantenimiento("");
    setRetornoEstimado("");
    setErrorEstado(null);
  };

  const confirmarMantenimiento = async () => {
    if (!agenteMantenimiento || !motivoMantenimiento.trim()) return;
    setCambiandoEstado(true);
    setErrorEstado(null);
    try {
      await platformAdminApi.cambiarEstadoAgente(agenteMantenimiento.id, {
        estado: "mantenimiento",
        motivoMantenimiento: motivoMantenimiento.trim(),
        retornoEstimado: retornoEstimado || undefined,
      });
      setAgenteMantenimiento(null);
      cargar();
    } catch (err: any) {
      setErrorEstado(err?.message ?? "No se pudo poner el agente en mantenimiento.");
    } finally {
      setCambiandoEstado(false);
    }
  };

  const reactivar = async (a: AgenteCatalogoCompleto) => {
    setCambiandoEstado(true);
    setErrorEstado(null);
    try {
      await platformAdminApi.cambiarEstadoAgente(a.id, { estado: "activo" });
      cargar();
    } catch (err: any) {
      setErrorEstado(err?.message ?? "No se pudo reactivar el agente.");
    } finally {
      setCambiandoEstado(false);
    }
  };

  const agentesEnMantenimiento = agentes.filter((a) => a.estado === "mantenimiento");

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Catálogo de Agentes</h1>
          <p className="text-text-muted">Agentes de IA disponibles en toda la plataforma.</p>
        </div>
        <Button onClick={() => setModalNuevoAbierto(true)}>+ Nuevo Agente</Button>
      </div>

      {errorEstado && (
        <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">{errorEstado}</div>
      )}

      {/* Un banner por cada agente en mantenimiento — decisión explícita:
          no se resume en uno solo, cada uno lleva su propio motivo/retorno. */}
      {agentesEnMantenimiento.map((a) => (
        <div
          key={a.id}
          className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-error/30 bg-error/5 p-4"
        >
          <div className="flex items-center gap-3">
            <span className="text-error">⚠</span>
            <div>
              <p className="text-sm font-bold text-text-primary">
                Agente en mantenimiento: {a.nombre}{" "}
                <Badge variant="error" className="ml-1 align-middle">
                  Mantenimiento
                </Badge>
              </p>
              <p className="text-sm text-text-muted">
                {a.motivo_mantenimiento}
                {a.retorno_estimado && ` · Retorno estimado: ${a.retorno_estimado}`}
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => reactivar(a)} disabled={cambiandoEstado}>
            Reactivar
          </Button>
        </div>
      ))}

      <div className="mt-6">
        {isLoading ? (
          <p className="text-text-muted">Cargando…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agentes.map((a) => {
              const estadoBadge = ESTADO_BADGE[a.estado];
              return (
                <Card key={a.id} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                      {a.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={a.estado_catalogo === "disponible" ? "success" : "info"}>
                        {a.estado_catalogo === "disponible" ? "Disponible" : "Próximamente"}
                      </Badge>
                      <Badge variant={estadoBadge.variant}>{estadoBadge.label}</Badge>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-primary">{a.nombre}</h3>
                    {a.especialidad && <p className="text-sm text-accent">{a.especialidad}</p>}
                  </div>

                  <p className="flex-1 text-sm text-text-muted">{a.descripcion || "Sin descripción."}</p>

                  {a.estado === "mantenimiento" && a.motivo_mantenimiento && (
                    <p className="text-xs text-warning">
                      Motivo: {a.motivo_mantenimiento}
                      {a.retorno_estimado && ` · Retorno: ${a.retorno_estimado}`}
                    </p>
                  )}

                  <p className="text-xs text-text-muted">
                    {a.clinicas_activas} {Number(a.clinicas_activas) === 1 ? "clínica" : "clínicas"} habilitada(s) ·{" "}
                    {a.casos_totales} casos totales
                  </p>

                  <div className="flex flex-wrap gap-2 border-t border-black/5 pt-3">
                    <Button variant="secondary" onClick={() => abrirEditar(a)}>
                      Editar
                    </Button>
                    {a.estado === "activo" && (
                      <>
                        <button
                          type="button"
                          onClick={() => abrirMantenimiento(a)}
                          className="text-sm font-semibold text-warning hover:underline"
                        >
                          Mantenimiento
                        </button>
                        <button
                          type="button"
                          onClick={() => setAgenteDiscontinuar(a)}
                          className="text-sm font-semibold text-error hover:underline"
                        >
                          Discontinuar
                        </button>
                      </>
                    )}
                    {a.estado !== "activo" && (
                      <button
                        type="button"
                        onClick={() => reactivar(a)}
                        disabled={cambiandoEstado}
                        className="text-sm font-semibold text-accent hover:underline"
                      >
                        Reactivar
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={!!agenteEditar}
        onClose={cerrarEditar}
        title="Editar agente"
        description="Cambios visibles de inmediato en todo el catálogo global."
        footer={
          <>
            <Button variant="secondary" onClick={cerrarEditar}>
              Cancelar
            </Button>
            <Button onClick={guardarEdicion} disabled={guardando || !nombreEdit.trim()}>
              {guardando ? "Guardando…" : "Guardar cambios"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Nombre" value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} />
          <Input
            label="Especialidad"
            value={especialidadEdit}
            onChange={(e) => setEspecialidadEdit(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Descripción</label>
            <textarea
              className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              rows={3}
              value={descripcionEdit}
              onChange={(e) => setDescripcionEdit(e.target.value)}
            />
          </div>
          <Input
            label="Icono (identificador)"
            value={iconoEdit}
            onChange={(e) => setIconoEdit(e.target.value)}
          />
          <Select
            label="Estado en el catálogo"
            value={estadoEdit}
            onChange={(e) => setEstadoEdit(e.target.value as "disponible" | "proximamente")}
            options={[
              { value: "proximamente", label: "Próximamente" },
              { value: "disponible", label: "Disponible (las clínicas ya pueden solicitarlo)" },
            ]}
          />
          {errorEdit && <p className="text-sm text-error">{errorEdit}</p>}
        </div>
      </Modal>

      <Modal
        open={modalNuevoAbierto}
        onClose={() => setModalNuevoAbierto(false)}
        title="Nuevo agente"
        description="La creación de agentes desde cero todavía no está conectada — esta pantalla se completa en una fase posterior."
        footer={
          <Button variant="secondary" onClick={() => setModalNuevoAbierto(false)}>
            Cerrar
          </Button>
        }
      >
        <p className="text-sm text-text-muted">
          Por ahora, para agregar un agente nuevo al catálogo global contactá al equipo de desarrollo.
        </p>
      </Modal>

      <Modal
        open={!!agenteDiscontinuar}
        onClose={() => setAgenteDiscontinuar(null)}
        title={`Discontinuar agente — ${agenteDiscontinuar?.especialidad || agenteDiscontinuar?.nombre || ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAgenteDiscontinuar(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmarDiscontinuar} disabled={cambiandoEstado}>
              {cambiandoEstado ? "Discontinuando…" : "Discontinuar agente"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {Number(agenteDiscontinuar?.clinicas_activas ?? 0) > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              {agenteDiscontinuar?.clinicas_activas} clínicas tienen este agente habilitado. Seguirán usándolo sin
              cambios.
            </div>
          )}
          <p className="text-sm text-text-muted">
            El agente dejará de aparecer como opción de contratación para nuevas clínicas y se removerá de la
            selección para el período de prueba gratuita. Las clínicas que ya lo tengan asignado no se verán
            afectadas y podrán continuar operándolo normalmente.
          </p>
          <p className="text-sm text-text-muted">
            Las clínicas que alguna vez lo tuvieron habilitado podrán volver a activarlo en cualquier momento.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!agenteMantenimiento}
        onClose={() => setAgenteMantenimiento(null)}
        title={`Poner en mantenimiento — ${agenteMantenimiento?.nombre ?? ""}`}
        description="La generación con este agente se detiene para todas las clínicas mientras dure. El cupo del plan sigue ocupado."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAgenteMantenimiento(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarMantenimiento} disabled={cambiandoEstado || !motivoMantenimiento.trim()}>
              {cambiandoEstado ? "Guardando…" : "Poner en mantenimiento"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Motivo (obligatorio)</label>
            <textarea
              className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              rows={3}
              value={motivoMantenimiento}
              onChange={(e) => setMotivoMantenimiento(e.target.value)}
              placeholder="ej. Actualización de base de conocimiento"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Retorno estimado (opcional)</label>
            <input
              type="date"
              value={retornoEstimado}
              onChange={(e) => setRetornoEstimado(e.target.value)}
              className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
