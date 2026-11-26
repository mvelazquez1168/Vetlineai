import { PageHeader } from "../../components/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { formatearFecha } from "../../lib/formatFecha";
import { useAuth } from "../../hooks/useAuth";
import { ApiError } from "../../lib/api";
import { adminApi, AgenteAdmin, ConteoCupos, EstadoSuscripcionResumen, MotivoRechazoCupo } from "../../lib/adminApi";
import { plural } from "../../lib/plural";

// Implementación de pantallas, prompt 2, paso 3 — Mis agentes. Reemplaza
// la pantalla vieja de "Solicitar activación" (dada de baja, ver flujo de
// suscripción — los agentes se agregan cambiando de plan) por la gestión
// real de cupos del flujo A: habilitar/deshabilitar/eliminar, freno
// anti-rotación con motivo estructurado del backend, y la sección de
// agentes desactivados con sus casos conservados.

export function Agentes() {
  const { zonaHoraria } = useAuth();
  const [agentes, setAgentes] = useState<AgenteAdmin[]>([]);
  const [cupos, setCupos] = useState<ConteoCupos | null>(null);
  const [estadoSuscripcion, setEstadoSuscripcion] = useState<EstadoSuscripcionResumen | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [agenteParaDesactivar, setAgenteParaDesactivar] = useState<AgenteAdmin | null>(null);
  const [rechazoDesactivar, setRechazoDesactivar] = useState<{ error: string; motivo?: MotivoRechazoCupo; disponibleDesde?: string } | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [catalogoAbierto, setCatalogoAbierto] = useState(false);

  const cargar = () => {
    setIsLoading(true);
    Promise.all([adminApi.listarAgentes(), adminApi.obtenerCupos(), adminApi.obtenerEstadoSuscripcion()])
      .then(([agentesData, cuposData, estadoSuscripcionData]) => {
        setAgentes(agentesData.agentes);
        setCupos(cuposData.cupos);
        setEstadoSuscripcion(estadoSuscripcionData);
      })
      .finally(() => setIsLoading(false));
  };

  // Ajustes de recorrido, Paso 6 — mismo criterio que en Medicos.tsx: en
  // prueba se CONTRATA, con plan pago se CAMBIA.
  const enPrueba = estadoSuscripcion?.estado === "prueba";

  useEffect(cargar, []);

  const abrirDesactivar = async (agente: AgenteAdmin) => {
    setAgenteParaDesactivar(agente);
    setRechazoDesactivar(null);
    // El límite de un cambio por período solo se conoce intentando — no
    // hay un endpoint de "puedo o no puedo" separado, así que se pre-valida
    // con un intento real solo cuando el admin confirma (ver
    // confirmarDesactivar). Acá el modal ya abre en su variante normal.
  };

  const confirmarDesactivar = async () => {
    if (!agenteParaDesactivar) return;
    setProcesando(true);
    setErrorAccion(null);
    try {
      await adminApi.deshabilitarAgente(agenteParaDesactivar.id);
      setAgenteParaDesactivar(null);
      cargar();
    } catch (err) {
      if (err instanceof ApiError) {
        const data = err.data as { error: string; motivo?: MotivoRechazoCupo; disponibleDesde?: string } | null;
        setRechazoDesactivar(data ?? { error: err.message });
      } else {
        setErrorAccion(err instanceof Error ? err.message : "No se pudo desactivar el agente.");
      }
    } finally {
      setProcesando(false);
    }
  };

  const habilitar = async (agente: AgenteAdmin) => {
    setProcesando(true);
    setErrorAccion(null);
    try {
      await adminApi.habilitarAgente(agente.id);
      cargar();
    } catch (err) {
      setErrorAccion(err instanceof Error ? err.message : "No se pudo habilitar el agente.");
    } finally {
      setProcesando(false);
    }
  };

  const activos = agentes.filter((a) => a.estado_tenant === "habilitado");
  const desactivados = agentes.filter((a) => a.estado_tenant === "deshabilitado");
  const sinCupo = cupos?.agentesDisponibles != null && cupos.agentesDisponibles <= 0;

  return (
    <div>
      <PageHeader
        titulo="Mis agentes"
        icono="agente"
        modulo="ia"
      />
      <div className="flex items-start justify-between">
        <div>
          {cupos && (
            <p className="mt-1 text-text-muted">
              {cupos.agentesEnUso} de {cupos.agentesContratados ?? "∞"} agentes en uso
              {cupos.agentesDisponibles != null && ` · ${Math.max(cupos.agentesDisponibles, 0)} disponibles`}
            </p>
          )}
        </div>
        {!sinCupo && cupos?.agentesDisponibles != null && cupos.agentesDisponibles > 0 && (
          <Button onClick={() => setCatalogoAbierto(true)}>+ agregar agente</Button>
        )}
      </div>

      {errorAccion && (
        <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">
          {errorAccion}
        </div>
      )}

      {cupos && cupos.agentesExceso > 0 && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-semibold text-warning">
            Tiene {plural(cupos.agentesExceso, "agente", "agentes")} más de los que incluye su plan.
          </p>
          <p className="mt-1 text-text-muted">
            El uso no se interrumpe — para ajustarlo, deshabilitá alguno o cambiá a un plan superior.
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="mt-6 text-text-muted">Cargando…</p>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {activos.map((agente) => {
              // agentes_paises_v2, Paso 2/5: un agente en mantenimiento no
              // puede ser desactivado por la clínica (liberaría el cupo por
              // algo temporal) — el diseño quita el menú de acciones por
              // completo en vez de dejarlo visible-pero-deshabilitado.
              if (agente.estado === "mantenimiento") {
                return (
                  <div
                    key={agente.id}
                    className="rounded-2xl border border-warning/40 bg-warning/5 p-6"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/15 text-warning">
                        ⚠
                      </div>
                      <span className="text-xs font-semibold text-warning">
                        Disponible al finalizar el mantenimiento
                      </span>
                    </div>
                    <h3 className="mt-4 text-lg font-bold text-primary">{agente.nombre}</h3>
                    <p className="mt-2 line-clamp-2 text-sm text-text-muted">{agente.descripcion}</p>
                    {agente.motivo_mantenimiento && (
                      <p className="mt-2 text-sm text-warning">
                        Motivo: {agente.motivo_mantenimiento}
                        {agente.retorno_estimado && (
                          <>
                            <br />
                            Retorno: {agente.retorno_estimado}
                          </>
                        )}
                      </p>
                    )}
                    <div className="mt-6 flex items-center justify-between border-t border-black/5 pt-4">
                      <p className="text-sm text-text-muted">{agente.casos_count} casos procesados</p>
                      <Badge variant="warning" dot>
                        En mantenimiento
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-text-muted">El cupo del plan sigue ocupado</p>
                  </div>
                );
              }
              return (
                <div key={agente.id} className="rounded-2xl border border-black/5 bg-surface p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                      ●
                    </div>
                    <Badge variant="success" dot>
                      Activo
                    </Badge>
                  </div>
                  <h3 className="mt-4 text-lg font-bold text-primary">{agente.nombre}</h3>
                  <p className="mt-2 line-clamp-2 text-sm text-text-muted">{agente.descripcion}</p>
                  <div className="mt-6 flex items-center justify-between border-t border-black/5 pt-4">
                    <p className="text-sm text-text-muted">{agente.casos_count} casos procesados</p>
                    <button
                      type="button"
                      onClick={() => abrirDesactivar(agente)}
                      className="text-sm font-semibold text-error hover:underline"
                    >
                      Desactivar
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Sin cupos disponibles: bloque que invita a cambiar de plan
                en vez de la tarjeta de agregar (paso 3). */}
            {sinCupo ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 bg-background p-6 text-center">
                <p className="text-sm font-semibold text-text-primary">
                  {enPrueba ? "Todos los cupos de la prueba están en uso" : "Todos los cupos de tu plan están en uso"}
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  {enPrueba
                    ? "Para agregar más agentes, contratá un plan."
                    : "Para agregar más agentes, cambiá a un plan superior."}
                </p>
                <Link to="/admin/plan-consumo/cambiar-plan" className="mt-3">
                  <Button variant="secondary">{enPrueba ? "Contratar un plan" : "Ver planes"}</Button>
                </Link>
              </div>
            ) : (
              cupos?.agentesDisponibles != null &&
              Array.from({ length: cupos.agentesDisponibles }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCatalogoAbierto(true)}
                  className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/20 bg-background p-6 text-center text-accent transition-colors hover:border-accent hover:bg-accent/5"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-xl">
                    +
                  </span>
                  <span className="mt-3 text-sm font-semibold">Agregar agente</span>
                </button>
              ))
            )}
          </div>

          {desactivados.length > 0 && (
            <div className="mt-10">
              <h2 className="text-xs font-bold uppercase tracking-wide text-text-muted">Agentes desactivados</h2>
              <div className="mt-3 divide-y divide-black/5 rounded-2xl border border-black/5 bg-surface">
                {desactivados.map((agente) => (
                  <div key={agente.id} className="flex items-center justify-between gap-4 p-5 opacity-70">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-black/5 text-text-muted">
                        ●
                      </div>
                      <div>
                        <p className="font-bold text-text-primary">{agente.nombre}</p>
                        <p className="text-sm text-text-muted">{agente.descripcion}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="neutral">Solo lectura</Badge>
                      <p className="whitespace-nowrap text-sm text-text-muted">
                        {agente.casos_count} casos conservados
                      </p>
                      <button
                        type="button"
                        onClick={() => habilitar(agente)}
                        disabled={procesando || (cupos?.agentesDisponibles != null && cupos.agentesDisponibles <= 0)}
                        className="text-sm font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline"
                      >
                        Habilitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Catálogo para llenar un cupo vacío — agentes que este tenant
          todavía no tiene habilitados (nunca contratados, o desactivados
          y sin aparecer en "Agentes desactivados" porque esa sección ya
          ofrece su propio botón Habilitar — este modal cubre el caso de
          un agente que nunca se contrató, estado_tenant null). */}
      <Modal
        open={catalogoAbierto}
        onClose={() => setCatalogoAbierto(false)}
        title="Agregar agente"
        description="Elija un agente del catálogo para ocupar el cupo disponible."
      >
        <div className="max-h-80 divide-y divide-black/5 overflow-y-auto">
          {agentes
            .filter(
              (a) =>
                a.estado_tenant !== "habilitado" &&
                a.estado_catalogo === "disponible" &&
                // Un agente discontinuado solo puede volver a agregarse si
                // esta clínica ya lo tuvo antes (estado_tenant no nulo) —
                // si nunca lo tuvo, no aparece como opción.
                (a.estado !== "discontinuado" || a.estado_tenant === "deshabilitado")
            )
            .map((agente) => (
              <div key={agente.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold text-text-primary">{agente.nombre}</p>
                  <p className="text-sm text-text-muted">{agente.descripcion}</p>
                </div>
                <Button
                  variant="secondary"
                  disabled={procesando}
                  onClick={async () => {
                    await habilitar(agente);
                    setCatalogoAbierto(false);
                  }}
                >
                  Agregar
                </Button>
              </div>
            ))}
          {agentes.filter((a) => a.estado_tenant !== "habilitado" && a.estado_catalogo === "disponible").length === 0 && (
            <p className="py-6 text-center text-sm text-text-muted">No hay más agentes disponibles en el catálogo.</p>
          )}
        </div>
      </Modal>

      {/* Modal de desactivación — dos variantes decididas por el motivo
          estructurado que devuelve el backend, no por lógica del frontend. */}
      <Modal
        open={!!agenteParaDesactivar}
        onClose={() => setAgenteParaDesactivar(null)}
        title={`Desactivar agente — ${agenteParaDesactivar?.nombre ?? ""}`}
        description="El agente dejará de estar disponible para casos nuevos. Los casos existentes siguen consultables en modo lectura. El cupo se libera inmediatamente."
        footer={
          rechazoDesactivar?.motivo === "freno_anti_rotacion" ? (
            <>
              <Button variant="secondary" onClick={() => setAgenteParaDesactivar(null)}>
                Cerrar
              </Button>
              <Button disabled className="cursor-not-allowed opacity-50">
                Desactivar agente
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setAgenteParaDesactivar(null)}>
                Cancelar
              </Button>
              <Button onClick={confirmarDesactivar} disabled={procesando}>
                {procesando ? "Desactivando…" : "Desactivar agente"}
              </Button>
            </>
          )
        }
      >
        {rechazoDesactivar?.motivo === "freno_anti_rotacion" ? (
          <div className="rounded-xl border border-error/30 bg-error/5 p-4 text-sm">
            <p className="font-semibold text-error">Cambio no disponible</p>
            <p className="mt-1 text-text-muted">
              Solo se permite un cambio de agente por período de facturación, ya se realizó uno en este período.
              {rechazoDesactivar.disponibleDesde &&
                ` Podrás desactivar un agente a partir del ${formatearFecha(rechazoDesactivar.disponibleDesde, zonaHoraria, { day: "2-digit", month: "long", year: "numeric" })}.`}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-semibold text-warning">Atención</p>
            <p className="mt-1 text-text-muted">Solo se permite un cambio de agente por período de facturación.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
