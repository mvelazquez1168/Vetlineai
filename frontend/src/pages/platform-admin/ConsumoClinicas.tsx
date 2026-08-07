import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { FiltroBar } from "../../components/ui/FiltroBar";
import { formatearFecha } from "../../lib/formatFecha";
import { ClinicaConsumo, ResumenClinicas, platformAdminApi } from "../../lib/platformAdminApi";

// Prompt A (platform_admin_registro), Paso 6 — Consumo por Clínica.

const ESTADO_LABEL: Record<string, string> = {
  prueba: "Prueba",
  activa: "Activa",
  morosa: "Morosa",
  suspendida: "Suspendida",
  ventana_purga: "Ventana de purga",
  cancelada: "Cancelada",
  finalizada: "Finalizada",
};

const ESTADO_BADGE: Record<string, BadgeVariant> = {
  prueba: "info",
  activa: "success",
  morosa: "error",
  suspendida: "error",
  ventana_purga: "warning",
  cancelada: "neutral",
  finalizada: "neutral",
};

export function ConsumoClinicas() {
  const [clinicas, setClinicas] = useState<ClinicaConsumo[]>([]);
  const [resumen, setResumen] = useState<ResumenClinicas | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroPlan, setFiltroPlan] = useState("");

  const cargar = () => {
    setIsLoading(true);
    Promise.all([
      platformAdminApi.listarClinicasConsumo({
        q: busqueda || undefined,
        estado: filtroEstado || undefined,
        planId: filtroPlan || undefined,
      }),
      platformAdminApi.obtenerResumenClinicas(),
    ])
      .then(([clinicasResp, resumenResp]) => {
        setClinicas(clinicasResp.clinicas);
        setResumen(resumenResp);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, [busqueda, filtroEstado, filtroPlan]);

  const planesDisponibles = useMemo(() => {
    const mapa = new Map<string, string>();
    clinicas.forEach((c) => mapa.set(c.plan.id, c.plan.nombre));
    return Array.from(mapa.entries());
  }, [clinicas]);

  if (isLoading && !resumen) return <p className="text-text-muted">Cargando…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Consumo por Clínica</h1>
      <p className="mt-1 text-text-muted">Control de consumo en tiempo real de clínicas activas y sus estados de facturación mensual.</p>

      {resumen && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-black/5 bg-surface p-4">
            <p className="text-xs font-bold uppercase text-text-muted">Clínicas activas</p>
            <p className="mt-1 text-2xl font-bold text-primary">{resumen.clinicasActivas}</p>
            <p className="text-sm text-text-muted">Bajo contrato activo</p>
          </div>
          <div className="rounded-xl border border-black/5 bg-surface p-4">
            <p className="text-xs font-bold uppercase text-text-muted">Clínicas en prueba</p>
            <p className="mt-1 text-2xl font-bold text-primary">{resumen.clinicasPrueba}</p>
            <p className="text-sm text-text-muted">Período de prueba limitado</p>
          </div>
          <div className="rounded-xl border border-black/5 bg-surface p-4">
            <p className="text-xs font-bold uppercase text-text-muted">Consumo agregado del mes</p>
            <p className="mt-1 text-2xl font-bold text-primary">USD {resumen.consumoAgregadoMesUsd.toFixed(2)}</p>
            <p className="text-sm text-text-muted">Cargos acumulados por API</p>
          </div>
          <div className="rounded-xl border border-black/5 bg-surface p-4">
            <p className="text-xs font-bold uppercase text-text-muted">Ingresos recurrentes</p>
            <p className="mt-1 text-2xl font-bold text-primary">USD {resumen.ingresosRecurrentesUsd.toFixed(2)}</p>
            <p className="text-sm text-text-muted">Suscripciones del mes en curso</p>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-black/5 bg-surface p-4">
        <div className="flex items-start justify-between">
          <p className="font-semibold text-text-primary">Listado general de clientes</p>
          <div className="w-full max-w-2xl">
            <FiltroBar
              className=""
              busqueda={busqueda}
              onBusqueda={setBusqueda}
              placeholderBusqueda="Buscar clínica…"
              selects={[
                {
                  value: filtroPlan,
                  onChange: setFiltroPlan,
                  opciones: [
                    { value: "", label: "Plan: Todos" },
                    ...planesDisponibles.map(([id, nombre]) => ({ value: id, label: nombre })),
                  ],
                },
                {
                  value: filtroEstado,
                  onChange: setFiltroEstado,
                  opciones: [
                    { value: "", label: "Estado: Todos" },
                    ...Object.entries(ESTADO_LABEL).map(([value, label]) => ({ value, label })),
                  ],
                },
              ]}
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-black/5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-background/60">
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Nombre de clínica</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Plan contratado</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Estado suscripción</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Saldo actual</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Consumo del período</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Próximo cobro</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clinicas.map((c) => (
                <tr key={c.tenantId} className="border-b border-black/5 last:border-0 hover:bg-background/40">
                  <td className="px-4 py-4 font-semibold text-text-primary">{c.nombre}</td>
                  <td className="px-4 py-4">
                    <Badge variant="neutral">{c.plan.codigo?.toUpperCase() ?? c.plan.nombre}</Badge>
                  </td>
                  <td className="px-4 py-4">
                    <Badge variant={ESTADO_BADGE[c.estado] ?? "neutral"}>{ESTADO_LABEL[c.estado] ?? c.estado}</Badge>
                  </td>
                  <td className="px-4 py-4">USD {c.saldoUsd.toFixed(2)}</td>
                  <td className="px-4 py-4 text-accent">USD {c.consumoPeriodoUsd.toFixed(2)}</td>
                  <td className="px-4 py-4 text-text-muted">
                    {c.proximoCobro
                      ? formatearFecha(c.proximoCobro, undefined, { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Link to={`/platform-admin/clinicas/${c.tenantId}`}>
                      <Button variant="secondary">Ver detalle</Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {clinicas.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                    No hay clínicas para estos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
