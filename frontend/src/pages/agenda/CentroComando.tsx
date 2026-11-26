import { PageHeader } from "../../components/ui";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { Cita, CentroComando as CentroComandoData, agendaApi, citasApi, etiquetaEstadoCita } from "../../lib/agendaApi";
import { CitaDetallePanel } from "./CitaDetallePanel";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const METRICAS: { key: keyof CentroComandoData["conteos"]; label: string }[] = [
  { key: "total", label: "Total de hoy" },
  { key: "enSalaEspera", label: "En sala de espera" },
  { key: "enProgreso", label: "En progreso" },
  { key: "completadas", label: "Completadas" },
  { key: "noShowsCanceladas", label: "No-shows / Canceladas" },
];

// Barra de progreso factual: citas de hoy / capacidad configurada del
// médico. Sin ícono ni texto de IA — el prompt fue explícito en que esto
// NO debe leerse como una predicción, solo la cuenta real vs. el tope.
function colorCarga(porcentaje: number): string {
  if (porcentaje >= 100) return "bg-error";
  if (porcentaje >= 75) return "bg-warning";
  return "bg-accent";
}

export function CentroComando() {
  const [fecha, setFecha] = useState(hoyISO());
  const [datos, setDatos] = useState<CentroComandoData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [citaSeleccionada, setCitaSeleccionada] = useState<Cita | null>(null);

  const cargar = () => {
    setCargando(true);
    setError(null);
    agendaApi
      .centroComando(fecha)
      .then(setDatos)
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar el centro de comando."))
      .finally(() => setCargando(false));
  };

  useEffect(cargar, [fecha]); // eslint-disable-line react-hooks/exhaustive-deps

  const abrirCitaCompleta = async (citaParcial: { id: string }) => {
    try {
      const { citas } = await citasApi.listar({ desde: fecha, hasta: fecha });
      const completa = citas.find((c) => c.id === citaParcial.id);
      if (completa) setCitaSeleccionada(completa);
    } catch {
      // silencioso — el timeline sigue siendo usable sin el detalle
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Centro de comando diario"
        icono="panel"
        modulo="agenda"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {cargando && !datos && <p className="text-sm text-text-muted">Cargando…</p>}

      {datos && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {METRICAS.map((m) => (
              <Card key={m.key} className="p-4">
                <p className="text-xs font-semibold uppercase text-text-muted">{m.label}</p>
                <p className="mt-1 text-2xl font-bold text-primary">{datos.conteos[m.key]}</p>
              </Card>
            ))}
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase text-text-muted">Duración promedio</p>
              <p className="mt-1 text-2xl font-bold text-primary">
                {datos.duracionPromedioMinutos !== null ? `${datos.duracionPromedioMinutos}m` : "—"}
              </p>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <Card>
              <p className="text-sm font-bold text-primary">Flujo Clínico de Hoy</p>
              <div className="mt-4 flex flex-col gap-3">
                {datos.flujoClinico.length === 0 && (
                  <p className="text-sm text-text-muted">No hay citas programadas para esta fecha.</p>
                )}
                {datos.flujoClinico.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => abrirCitaCompleta(c)}
                    className="flex items-center gap-4 rounded-xl border border-black/5 p-3 text-left hover:bg-background/60"
                  >
                    <span className="w-14 shrink-0 text-sm font-bold text-primary">{c.hora_inicio.slice(0, 5)}</span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-text-primary">
                        {c.paciente_nombre} <span className="font-normal text-text-muted">({c.propietario_nombre})</span>
                      </span>
                      <span className="block text-xs text-text-muted">
                        {c.medico_nombre} · {c.motivo_consulta || "Sin motivo especificado"}
                      </span>
                    </span>
                    <Badge variant="info">{etiquetaEstadoCita(c.estado)}</Badge>
                  </button>
                ))}
              </div>
            </Card>

            <div className="flex flex-col gap-6">
              <Card>
                <p className="text-sm font-bold text-primary">Cola de Próximos</p>
                <div className="mt-3 flex flex-col gap-2">
                  {datos.colaProximos.length === 0 && <p className="text-xs text-text-muted">Sin próximas citas.</p>}
                  {datos.colaProximos.map((c) => (
                    <div key={c.id} className="rounded-lg bg-background px-3 py-2 text-sm">
                      <span className="font-semibold text-primary">{c.hora_inicio.slice(0, 5)}</span>{" "}
                      <span className="text-text-primary">{c.paciente_nombre}</span>
                      <p className="text-xs text-text-muted">{c.medico_nombre}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {datos.alertasNoShow.length > 0 && (
                <Card className="border-error/30 bg-error/5">
                  <p className="text-sm font-bold text-error">Alertas de No-show</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {datos.alertasNoShow.map((a) => (
                      <div key={a.id} className="text-sm text-text-primary">
                        {a.hora_inicio.slice(0, 5)} — {a.paciente_nombre} con {a.medico_nombre}
                        <p className="text-xs text-text-muted">Pasó su horario sin registrar check-in.</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>

          <Card>
            <p className="text-sm font-bold text-primary">Carga de Trabajo Médicos</p>
            <p className="mt-1 text-xs text-text-muted">Citas agendadas hoy sobre la capacidad diaria configurada.</p>
            <div className="mt-4 flex flex-col gap-4">
              {datos.cargaTrabajo.map((c) => (
                <div key={c.medicoId}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-text-primary">{c.medicoNombre}</span>
                    <span className="text-text-muted">
                      {c.citasHoy}/{c.capacidadMaxima} ({c.porcentaje}%)
                    </span>
                  </div>
                  <ProgressBar value={c.porcentaje} className="mt-1.5" colorClassName={colorCarga(c.porcentaje)} />
                </div>
              ))}
              {datos.cargaTrabajo.length === 0 && <p className="text-xs text-text-muted">Sin médicos activos configurados.</p>}
            </div>
          </Card>
        </>
      )}

      <CitaDetallePanel
        cita={citaSeleccionada}
        onClose={() => setCitaSeleccionada(null)}
        onEditar={() => {}}
        permitirEditar={false}
        onActualizada={(cita) => {
          setCitaSeleccionada(cita);
          cargar();
        }}
      />
    </div>
  );
}
