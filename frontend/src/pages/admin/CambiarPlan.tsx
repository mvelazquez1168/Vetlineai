import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { useAuth } from "../../hooks/useAuth";
import { formatearFecha } from "../../lib/formatFecha";
import { ApiError } from "../../lib/apiError";
import {
  AgenteAdmin,
  EstadoSuscripcionResumen,
  Medico,
  PlanCatalogo,
  PlanConsumo,
  adminApi,
} from "../../lib/adminApi";
import { CotizacionUpgrade, pagosApi } from "../../lib/pagosApi";
import { plural } from "../../lib/plural";

// Implementación de pantallas, prompt 2, paso 4 — Cambiar plan.
// Pantallas de pago, paso 5 — completa el upgrade, que hasta ahora
// quedaba visible-deshabilitado con nota "Próximamente" (recarga y
// autorecarga ya tienen pantalla propia, ver Plan y consumo /
// Medio de pago). El downgrade sigue igual: 2 pasos con validación real
// hecha por el backend al enviar.

type Paso = "catalogo" | "seleccion" | "confirmacion";
type EstadoUpgrade = "idle" | "cotizando" | "confirmando" | "procesando" | "exito" | "fallo";

const MOTIVO_LABEL_UPGRADE: Record<string, string> = {
  fondos_insuficientes: "La tarjeta no tiene fondos suficientes.",
  tarjeta_rechazada: "La tarjeta fue rechazada por el banco emisor.",
  error_desconocido: "Ocurrió un error inesperado al procesar el cobro.",
};

export function CambiarPlan() {
  const { zonaHoraria } = useAuth();
  const navigate = useNavigate();

  const [actual, setActual] = useState<PlanConsumo | null>(null);
  const [estadoSuscripcion, setEstadoSuscripcion] = useState<EstadoSuscripcionResumen | null>(null);
  const [planes, setPlanes] = useState<PlanCatalogo[]>([]);
  const [agentes, setAgentes] = useState<AgenteAdmin[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paso, setPaso] = useState<Paso>("catalogo");
  const [planDestino, setPlanDestino] = useState<PlanCatalogo | null>(null);
  const [agentesSeleccionados, setAgentesSeleccionados] = useState<Set<string>>(new Set());
  const [medicosSeleccionados, setMedicosSeleccionados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const [confirmarCancelacion, setConfirmarCancelacion] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [errorCancelacion, setErrorCancelacion] = useState<string | null>(null);

  const [estadoUpgrade, setEstadoUpgrade] = useState<EstadoUpgrade>("idle");
  const [planUpgrade, setPlanUpgrade] = useState<PlanCatalogo | null>(null);
  const [cotizacion, setCotizacion] = useState<CotizacionUpgrade | null>(null);
  const [errorUpgrade, setErrorUpgrade] = useState<string | null>(null);
  const [motivoFalla, setMotivoFalla] = useState<string | undefined>(undefined);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      adminApi.obtenerPlanConsumo(),
      adminApi.listarPlanes(),
      adminApi.listarAgentes(),
      adminApi.listarMedicos(),
      adminApi.obtenerEstadoSuscripcion(),
    ])
      .then(([planConsumo, catalogoResp, agentesResp, medicosResp, estadoSuscripcionResp]) => {
        setActual(planConsumo);
        setPlanes(catalogoResp.planes);
        setAgentes(agentesResp.agentes.filter((a) => a.estado_tenant === "habilitado"));
        setMedicos(medicosResp.medicos.filter((m) => m.estado === "activo"));
        setEstadoSuscripcion(estadoSuscripcionResp);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar los planes."))
      .finally(() => setIsLoading(false));
  }, []);

  const iniciarSeleccion = (plan: PlanCatalogo) => {
    setPlanDestino(plan);
    // Preseleccionados: todo lo que hoy está activo, hasta el límite del
    // plan destino cuando corresponde (el admin destildará el resto).
    setAgentesSeleccionados(new Set(agentes.slice(0, plan.agentesIncluidos ?? agentes.length).map((a) => a.id)));
    setMedicosSeleccionados(new Set(medicos.slice(0, plan.medicosIncluidos).map((m) => m.id)));
    setErrorEnvio(null);
    setPaso("seleccion");
  };

  const toggleAgente = (id: string) => {
    setAgentesSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMedico = (id: string) => {
    setMedicosSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cabeAgentes = planDestino ? agentesSeleccionados.size <= (planDestino.agentesIncluidos ?? Infinity) : false;
  const cabeMedicos = planDestino ? medicosSeleccionados.size <= planDestino.medicosIncluidos : false;
  const seleccionValida = cabeAgentes && cabeMedicos;

  const confirmarDowngrade = async () => {
    if (!planDestino) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      await adminApi.solicitarDowngrade({
        planDestinoId: planDestino.id,
        agentesConservados: Array.from(agentesSeleccionados),
        medicosConservados: Array.from(medicosSeleccionados),
      });
      navigate("/admin/plan-consumo");
    } catch (err) {
      setErrorEnvio(err instanceof ApiError ? err.message : "No pudimos programar el cambio de plan.");
    } finally {
      setEnviando(false);
    }
  };

  const iniciarUpgrade = async (plan: PlanCatalogo) => {
    setPlanUpgrade(plan);
    setEstadoUpgrade("cotizando");
    setErrorUpgrade(null);
    try {
      const { cotizacion: c } = await pagosApi.cotizarUpgrade(plan.id);
      setCotizacion(c);
      setEstadoUpgrade("confirmando");
    } catch (err) {
      setErrorUpgrade(err instanceof ApiError ? err.message : "No pudimos calcular el costo del upgrade.");
      setEstadoUpgrade("idle");
      setPlanUpgrade(null);
    }
  };

  const confirmarUpgrade = async () => {
    if (!planUpgrade) return;
    setEstadoUpgrade("procesando");
    try {
      const resultado = await pagosApi.ejecutarUpgrade(planUpgrade.id);
      if (resultado.exitoCobro) {
        setCotizacion(resultado.cotizacion ?? cotizacion);
        setEstadoUpgrade("exito");
      } else {
        setMotivoFalla(resultado.motivoFalla);
        setErrorUpgrade(resultado.mensajeError ?? null);
        setEstadoUpgrade("fallo");
      }
    } catch (err) {
      setMotivoFalla(undefined);
      setErrorUpgrade(err instanceof ApiError ? err.message : "No pudimos procesar el cobro.");
      setEstadoUpgrade("fallo");
    }
  };

  const cerrarModalUpgrade = () => {
    const fueExitoso = estadoUpgrade === "exito";
    setEstadoUpgrade("idle");
    setPlanUpgrade(null);
    setCotizacion(null);
    setErrorUpgrade(null);
    setMotivoFalla(undefined);
    if (fueExitoso) {
      adminApi.obtenerPlanConsumo().then(setActual);
    }
  };

  const cancelarSuscripcion = async () => {
    setCancelando(true);
    setErrorCancelacion(null);
    try {
      await adminApi.cancelarSuscripcion();
      navigate("/admin/plan-consumo");
    } catch (err) {
      setErrorCancelacion(err instanceof ApiError ? err.message : "No pudimos cancelar la suscripción.");
    } finally {
      setCancelando(false);
    }
  };

  const { superiores, inferiores } = useMemo(() => {
    if (!actual) return { superiores: [] as PlanCatalogo[], inferiores: [] as PlanCatalogo[] };
    return {
      superiores: planes.filter((p) => p.orden > actual.plan.orden),
      inferiores: planes.filter((p) => p.orden < actual.plan.orden),
    };
  }, [planes, actual]);

  if (isLoading) return <p className="text-text-muted">Cargando…</p>;
  if (error || !actual) return <p className="text-error">{error ?? "No se encontró el plan."}</p>;

  // Ajustes de recorrido, Paso 6 — en prueba todavía no hay ningún plan
  // pago del que "cambiar": el título tiene que hablar de contratar.
  const enPrueba = estadoSuscripcion?.estado === "prueba";

  return (
    <div>
      <Link to="/admin/plan-consumo" className="text-sm font-medium text-accent hover:underline">
        ← Volver a Plan y consumo
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-primary">{enPrueba ? "Contratar un plan" : "Cambiar plan"}</h1>

      {paso === "catalogo" && (
        <>
          {actual.cambioPendiente && (
            <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm text-text-muted">
              Ya tiene un cambio programado. Cancélelo desde{" "}
              <Link to="/admin/plan-consumo" className="font-semibold text-accent hover:underline">
                Plan y consumo
              </Link>{" "}
              antes de solicitar uno nuevo.
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {planes.map((plan) => {
              const esActual = plan.id === actual.plan.id;
              const esSuperior = superiores.some((p) => p.id === plan.id);
              const esInferior = inferiores.some((p) => p.id === plan.id);
              return (
                <Card key={plan.id} highlighted={esActual}>
                  {esActual && (
                    <Badge variant="info" className="mb-2">
                      Plan actual
                    </Badge>
                  )}
                  <CardTitle>{plan.nombre}</CardTitle>
                  <p className="mt-2 text-2xl font-bold text-primary">USD {plan.precioMensualUsd.toFixed(2)}</p>
                  <p className="text-xs text-text-muted">por mes</p>
                  <ul className="mt-4 space-y-1 text-sm text-text-muted">
                    <li>{plan.agentesIncluidos ?? "Todos los"} agentes</li>
                    <li>{plan.medicosIncluidos} médicos</li>
                    <li>USD {plan.creditoIaUsd.toFixed(2)} de crédito IA / período</li>
                  </ul>

                  {esActual && (
                    <Button variant="secondary" disabled className="mt-4 w-full">
                      Plan actual
                    </Button>
                  )}
                  {esSuperior && (
                    <Button
                      className="mt-4 w-full"
                      disabled={estadoUpgrade !== "idle"}
                      onClick={() => iniciarUpgrade(plan)}
                    >
                      {estadoUpgrade === "cotizando" && planUpgrade?.id === plan.id ? "Calculando…" : "Elegir este plan"}
                    </Button>
                  )}
                  {esInferior && (
                    <Button
                      variant="secondary"
                      className="mt-4 w-full"
                      disabled={!!actual.cambioPendiente}
                      onClick={() => iniciarSeleccion(plan)}
                    >
                      Elegir este plan
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>

          {errorUpgrade && estadoUpgrade === "idle" && <p className="mt-4 text-sm text-error">{errorUpgrade}</p>}

          <div className="mt-10 rounded-xl border border-black/5 p-4">
            <p className="text-sm text-text-muted">
              ¿Necesitás más agentes, médicos o crédito de los que ofrece tu plan actual? Elija un plan superior
              arriba, o{" "}
              <Link to="/admin/plan-consumo/recargar" className="font-semibold text-accent hover:underline">
                recargue su saldo
              </Link>{" "}
              sin cambiar de plan.
            </p>
          </div>

          <div className="mt-10 border-t border-black/5 pt-6 text-right">
            <button
              onClick={() => setConfirmarCancelacion(true)}
              className="text-sm text-text-muted underline hover:text-error"
            >
              Cancelar mi suscripción
            </button>
          </div>
        </>
      )}

      {paso === "seleccion" && planDestino && (
        <Card className="mt-6">
          <CardTitle>Elija qué conservar al pasar a {planDestino.nombre}</CardTitle>
          <p className="mt-1 text-sm text-text-muted">
            Lo que no selecciones quedará desactivado (no eliminado) cuando el cambio entre en vigencia.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2">
            <div>
              <p className={["text-sm font-semibold", cabeAgentes ? "text-text-primary" : "text-error"].join(" ")}>
                Agentes: {agentesSeleccionados.size} / {planDestino.agentesIncluidos ?? "∞"}
              </p>
              <div className="mt-3 space-y-2">
                {agentes.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm text-text-muted">
                    <input
                      type="checkbox"
                      checked={agentesSeleccionados.has(a.id)}
                      onChange={() => toggleAgente(a.id)}
                    />
                    {a.nombre}
                  </label>
                ))}
                {agentes.length === 0 && <p className="text-sm text-text-muted">No hay agentes habilitados.</p>}
              </div>
            </div>

            <div>
              <p className={["text-sm font-semibold", cabeMedicos ? "text-text-primary" : "text-error"].join(" ")}>
                Médicos: {medicosSeleccionados.size} / {planDestino.medicosIncluidos}
              </p>
              <div className="mt-3 space-y-2">
                {medicos.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-text-muted">
                    <input
                      type="checkbox"
                      checked={medicosSeleccionados.has(m.id)}
                      onChange={() => toggleMedico(m.id)}
                    />
                    {m.nombre}
                  </label>
                ))}
                {medicos.length === 0 && <p className="text-sm text-text-muted">No hay médicos activos.</p>}
              </div>
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <Button variant="secondary" onClick={() => setPaso("catalogo")}>
              Volver
            </Button>
            <Button disabled={!seleccionValida} onClick={() => setPaso("confirmacion")}>
              Continuar
            </Button>
          </div>
        </Card>
      )}

      {paso === "confirmacion" && planDestino && (
        <Card className="mt-6">
          <CardTitle>Confirmar cambio a {planDestino.nombre}</CardTitle>
          <div className="mt-4 space-y-2 text-sm text-text-muted">
            <p>
              Fecha efectiva:{" "}
              <span className="font-semibold text-text-primary">
                {formatearFecha(actual.plan.renovacion, zonaHoraria, { day: "2-digit", month: "long", year: "numeric" })}
              </span>{" "}
              (fin del período actual)
            </p>
            <p>
              Nuevo precio: <span className="font-semibold text-text-primary">USD {planDestino.precioMensualUsd.toFixed(2)} / mes</span>
            </p>
            <p>
              Quedarán activos {plural(agentesSeleccionados.size, "agente", "agentes")} y{" "}
              {plural(medicosSeleccionados.size, "médico", "médicos")}; el resto se
              desactivará (los datos se conservan).
            </p>
            <p>Tu saldo de crédito comprado no se ve afectado por este cambio.</p>
          </div>

          {errorEnvio && <p className="mt-4 text-sm text-error">{errorEnvio}</p>}

          <div className="mt-8 flex gap-3">
            <Button variant="secondary" onClick={() => setPaso("seleccion")} disabled={enviando}>
              Volver
            </Button>
            <Button onClick={confirmarDowngrade} disabled={enviando}>
              {enviando ? "Confirmando…" : "Confirmar cambio"}
            </Button>
          </div>
        </Card>
      )}

      <Modal
        open={confirmarCancelacion}
        onClose={() => setConfirmarCancelacion(false)}
        title="Cancelar tu suscripción"
        description="Tu clínica dejará de tener acceso al finalizar el período actual. El saldo de crédito remanente no se devuelve."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmarCancelacion(false)} disabled={cancelando}>
              Volver
            </Button>
            <Button variant="danger" onClick={cancelarSuscripcion} disabled={cancelando}>
              {cancelando ? "Cancelando…" : "Sí, cancelar suscripción"}
            </Button>
          </>
        }
      >
        {errorCancelacion && <p className="text-sm text-error">{errorCancelacion}</p>}
      </Modal>

      <Modal
        open={estadoUpgrade === "confirmando" || estadoUpgrade === "procesando" || estadoUpgrade === "exito" || estadoUpgrade === "fallo"}
        onClose={estadoUpgrade === "procesando" ? () => {} : cerrarModalUpgrade}
        title={
          estadoUpgrade === "confirmando"
            ? `Confirmar upgrade a ${planUpgrade?.nombre ?? ""}`
            : estadoUpgrade === "procesando"
              ? "Procesando el cobro…"
              : estadoUpgrade === "exito"
                ? "¡Upgrade aplicado!"
                : "El upgrade no se pudo completar"
        }
        footer={
          estadoUpgrade === "confirmando" ? (
            <>
              <Button variant="secondary" onClick={cerrarModalUpgrade}>
                Cancelar
              </Button>
              <Button onClick={confirmarUpgrade}>Confirmar y pagar</Button>
            </>
          ) : estadoUpgrade === "exito" || estadoUpgrade === "fallo" ? (
            <Button onClick={cerrarModalUpgrade}>Cerrar</Button>
          ) : undefined
        }
      >
        {estadoUpgrade === "confirmando" && cotizacion && (
          <div className="space-y-2 text-sm text-text-muted">
            <p>
              Monto proporcional a cobrar hoy:{" "}
              <span className="font-semibold text-text-primary">USD {cotizacion.montoACobrarHoyUsd.toFixed(2)}</span> (por
              los días restantes del período actual)
            </p>
            <p>
              Crédito adicional que se acredita:{" "}
              <span className="font-semibold text-text-primary">USD {cotizacion.creditoAdicionalUsd.toFixed(2)}</span>
            </p>
            <p>
              Cupos nuevos disponibles de inmediato:{" "}
              <span className="font-semibold text-text-primary">
                {cotizacion.agentesIncluidos ?? "Todos los"} agentes, {cotizacion.medicosIncluidos} médicos
              </span>
            </p>
            <p>
              Próxima renovación completa:{" "}
              <span className="font-semibold text-text-primary">USD {cotizacion.precioProximaRenovacionUsd.toFixed(2)}</span>{" "}
              el{" "}
              {formatearFecha(cotizacion.fechaProximaRenovacion, zonaHoraria, {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        )}

        {estadoUpgrade === "procesando" && (
          <p className="text-sm text-text-muted">Esperando la confirmación del cobro — no cierres esta ventana.</p>
        )}

        {estadoUpgrade === "exito" && cotizacion && (
          <p className="text-sm text-text-muted">
            Tu plan ahora es <span className="font-semibold text-text-primary">{cotizacion.planDestinoNombre}</span>. Los
            cupos y el crédito adicional ya están disponibles.
          </p>
        )}

        {estadoUpgrade === "fallo" && (
          <div className="space-y-2 text-sm">
            <p className="text-error font-semibold">
              {errorUpgrade ?? (motivoFalla ? MOTIVO_LABEL_UPGRADE[motivoFalla] : "No se pudo procesar el cobro.")}
            </p>
            <p className="text-text-muted">Tu plan sigue siendo el mismo. Revise su medio de pago e inténtelo de nuevo.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
