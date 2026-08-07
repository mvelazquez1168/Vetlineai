import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { useAuth } from "../../hooks/useAuth";
import { formatearFecha } from "../../lib/formatFecha";
import { adminApi, AvisoConsumo, ConsumoPeriodoItem, PlanConsumo as PlanConsumoData } from "../../lib/adminApi";

// Implementación de pantallas, prompt 2, paso 2 — Mi plan y consumo.
// Pantalla principal de la sección; alimentada por una sola llamada
// (GET /admin/plan-consumo) — el frontend no calcula cupos, umbrales de
// aviso ni compone el texto de los avisos, todo eso viene resuelto.

const TONO_AVISO: Record<AvisoConsumo["umbral"], string> = {
  saldo_bajo: "border-accent/30 bg-accent/5",
  trial_80: "border-accent/30 bg-accent/5",
  saldo_agotado: "border-warning/40 bg-warning/10",
  trial_agotado: "border-error/40 bg-error/10",
  colchon_agotado: "border-error/40 bg-error/10",
};

const CONCEPTO_LABEL: Record<string, string> = {
  clinico: "Consultas clínicas",
  regeneracion: "Regeneraciones",
  operativo: "Operativo",
  cortesia: "Cortesía",
};

export function PlanConsumo() {
  const { zonaHoraria } = useAuth();
  const [data, setData] = useState<PlanConsumoData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelando, setCancelando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    setError(null);
    adminApi
      .obtenerPlanConsumo()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar el plan."))
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const cancelarCambio = async () => {
    if (!data?.cambioPendiente) return;
    setCancelando(true);
    try {
      await adminApi.cancelarCambioPendiente(data.cambioPendiente.id);
      cargar();
    } finally {
      setCancelando(false);
    }
  };

  if (isLoading) return <p className="text-text-muted">Cargando…</p>;
  if (error || !data) return <p className="text-error">{error ?? "No se encontró el plan."}</p>;

  const { plan, cupos, credito, saldo, aviso, cambioPendiente, consumoPeriodo } = data;
  const pctPlan = saldo.totalUsd > 0 ? Math.min(Math.max((saldo.planUsd / saldo.totalUsd) * 100, 0), 100) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Plan y consumo</h1>

      {/* Tarjeta de plan */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Plan actual</p>
            <h2 className="mt-1 text-xl font-bold text-primary">{plan.nombre}</h2>
            <p className="mt-1 text-sm text-text-muted">
              USD {plan.precioUsd.toFixed(2)} / {plan.periodicidad === "anual" ? "año" : "mes"} · Renueva el{" "}
              {formatearFecha(plan.renovacion, zonaHoraria, { day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>
          <Link to="/admin/plan-consumo/cambiar-plan">
            <Button variant="secondary">Cambiar plan</Button>
          </Link>
        </div>
      </Card>

      {/* Aviso contextual */}
      {aviso && (
        <div className={["mt-6 rounded-2xl border p-4 text-sm font-medium", TONO_AVISO[aviso.umbral]].join(" ")}>
          {aviso.mensaje}
        </div>
      )}

      {/* Cambio de plan programado */}
      {cambioPendiente && (
        <Card className="mt-6">
          <CardTitle>
            {cambioPendiente.tipo === "downgrade" ? "Cambio de plan programado" : "Cancelación programada"}
          </CardTitle>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cambioPendiente.tipo === "downgrade" && (
              <>
                <p className="text-sm text-text-muted">
                  Plan nuevo: <span className="font-semibold text-text-primary">{cambioPendiente.plan_destino_nombre}</span>
                </p>
                <p className="text-sm text-text-muted">
                  Agentes: <span className="font-semibold text-text-primary">{cambioPendiente.agentes_destino ?? "∞"}</span> ·
                  Médicos: <span className="font-semibold text-text-primary">{cambioPendiente.medicos_destino}</span>
                </p>
                <p className="text-sm text-text-muted">
                  Crédito nuevo:{" "}
                  <span className="font-semibold text-text-primary">
                    USD {cambioPendiente.credito_destino ? Number(cambioPendiente.credito_destino).toFixed(2) : "—"}
                  </span>
                </p>
                <p className="text-sm text-text-muted">
                  Precio nuevo:{" "}
                  <span className="font-semibold text-text-primary">
                    USD {cambioPendiente.precio_destino ? Number(cambioPendiente.precio_destino).toFixed(2) : "—"}
                  </span>
                </p>
              </>
            )}
            <p className="text-sm text-text-muted sm:col-span-2">
              Fecha efectiva:{" "}
              <span className="font-semibold text-text-primary">
                {formatearFecha(cambioPendiente.efectivo_en, zonaHoraria, { day: "2-digit", month: "long", year: "numeric" })}
              </span>
            </p>
          </div>
          <Button variant="secondary" onClick={cancelarCambio} disabled={cancelando} className="mt-4">
            {cancelando ? "Cancelando…" : "Cancelar este cambio"}
          </Button>
        </Card>
      )}

      {/* 3 tarjetas de métrica */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Agentes</p>
          <p className="mt-2 text-2xl font-bold text-primary">
            {cupos.agentesEnUso} <span className="text-base font-normal text-text-muted">/ {cupos.agentesContratados ?? "∞"}</span>
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {cupos.agentesDisponibles != null ? `${Math.max(cupos.agentesDisponibles, 0)} disponibles` : "Ilimitados"}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Médicos</p>
          <p className="mt-2 text-2xl font-bold text-primary">
            {cupos.medicosActivos} <span className="text-base font-normal text-text-muted">/ {cupos.medicosContratados}</span>
          </p>
          <p className="mt-1 text-sm text-text-muted">{Math.max(cupos.medicosDisponibles, 0)} disponibles</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Crédito del período</p>
          <p className="mt-2 text-2xl font-bold text-primary">USD {credito.pactadoUsd.toFixed(2)}</p>
          <p className="mt-1 text-sm text-text-muted">Se otorga al iniciar cada período</p>
        </Card>
      </div>

      {(cupos.agentesExceso > 0 || cupos.medicosExceso > 0) && (
        <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-semibold text-warning">Tu clínica tiene más recursos en uso que los contratados.</p>
          <p className="mt-1 text-text-muted">
            {cupos.agentesExceso > 0 && `${cupos.agentesExceso} agente(s) de más. `}
            {cupos.medicosExceso > 0 && `${cupos.medicosExceso} médico(s) de más. `}
            El uso no se interrumpe — considerá cambiar a un plan superior.
          </p>
        </div>
      )}

      {/* Tarjeta de saldo — barra partida en dos segmentos */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Saldo de IA</CardTitle>
            <p className="mt-2 text-3xl font-bold text-primary">USD {saldo.totalUsd.toFixed(2)}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/admin/plan-consumo/autorecarga">
              <Button variant="secondary">Configurar autorecarga</Button>
            </Link>
            <Link to="/admin/plan-consumo/recargar">
              <Button>Recargar crédito</Button>
            </Link>
          </div>
        </div>
        <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-black/5">
          <div className="h-full bg-accent" style={{ width: `${pctPlan}%` }} />
          <div className="h-full bg-success" style={{ width: `${100 - pctPlan}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-2 text-text-muted">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
            Crédito del plan (expira a fin de mes): <span className="font-semibold text-text-primary">USD {saldo.planUsd.toFixed(2)}</span>
          </span>
          <span className="flex items-center gap-2 text-text-muted">
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
            Crédito comprado (no expira): <span className="font-semibold text-text-primary">USD {saldo.compradoUsd.toFixed(2)}</span>
          </span>
        </div>
      </Card>

      {/* Tabla de consumo del período */}
      <Card className="mt-6">
        <CardTitle>Consumo de este período</CardTitle>
        <div className="mt-3">
          <Table
            columns={[
              { key: "tipo", header: "Tipo", render: (row: ConsumoPeriodoItem) => CONCEPTO_LABEL[row.tipo] ?? row.tipo },
              { key: "cantidad", header: "Cantidad", render: (row: ConsumoPeriodoItem) => row.cantidad },
              { key: "monto", header: "Monto", render: (row: ConsumoPeriodoItem) => `USD ${row.montoUsd.toFixed(2)}` },
            ]}
            data={consumoPeriodo}
            rowKey={(row) => row.tipo}
            emptyMessage="Todavía no hay consumo registrado en este período."
          />
        </div>
      </Card>
    </div>
  );
}
