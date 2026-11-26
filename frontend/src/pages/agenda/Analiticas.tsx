import { PageHeader } from "../../components/ui";
import { useEffect, useState } from "react";
import { Card } from "../../components/ui/Card";
import { agendaApi, AnaliticasAgenda } from "../../lib/agendaApi";

const COLORES_DONA = [
  "text-blue-500",
  "text-purple-500",
  "text-teal-500",
  "text-rose-500",
  "text-amber-500",
  "text-emerald-500",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hace30Dias(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function VariacionTexto({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs text-text-muted">Sin datos del período anterior</span>;
  const positivo = valor >= 0;
  return (
    <span className={["text-xs font-semibold", positivo ? "text-success" : "text-error"].join(" ")}>
      {positivo ? "▲" : "▼"} {Math.abs(valor)}% vs. período anterior
    </span>
  );
}

// Dona simple en SVG (sin librería de gráficos) — cada segmento es un
// círculo con stroke-dasharray proporcional a su participación del total.
function GraficoDona({ datos }: { datos: { motivo: string; cantidad: number }[] }) {
  const total = datos.reduce((acc, d) => acc + d.cantidad, 0);
  if (total === 0) {
    return <p className="text-sm text-text-muted">No hubo cancelaciones en este período.</p>;
  }
  const radio = 60;
  const grosor = 22;
  const circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg width={160} height={160} viewBox="0 0 160 160" className="shrink-0">
        <g transform="translate(80,80) rotate(-90)">
          {datos.map((d, i) => {
            const proporcion = d.cantidad / total;
            const largo = proporcion * circunferencia;
            const offset = -acumulado * circunferencia;
            acumulado += proporcion;
            return (
              <circle
                key={d.motivo}
                r={radio}
                cx={0}
                cy={0}
                fill="none"
                stroke="currentColor"
                strokeWidth={grosor}
                strokeDasharray={`${largo} ${circunferencia - largo}`}
                strokeDashoffset={offset}
                className={COLORES_DONA[i % COLORES_DONA.length]}
              />
            );
          })}
        </g>
        <text x={80} y={80} textAnchor="middle" dominantBaseline="middle" className="fill-primary text-xl font-bold">
          {total}
        </text>
      </svg>
      <ul className="flex flex-1 flex-col gap-2 text-sm">
        {datos.map((d, i) => (
          <li key={d.motivo} className="flex items-center gap-2">
            <span className={["h-2.5 w-2.5 rounded-full bg-current", COLORES_DONA[i % COLORES_DONA.length]].join(" ")} />
            <span className="flex-1 text-text-primary">{d.motivo}</span>
            <span className="font-semibold text-text-muted">{d.cantidad}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Analiticas() {
  const [desde, setDesde] = useState(hace30Dias());
  const [hasta, setHasta] = useState(hoyISO());
  const [datos, setDatos] = useState<AnaliticasAgenda | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    setError(null);
    agendaApi
      .analiticas(desde, hasta)
      .then(setDatos)
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar las analíticas."))
      .finally(() => setCargando(false));
  }, [desde, hasta]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Analíticas y reportes"
        icono="reportes"
        modulo="agenda"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm" />
          <span className="text-sm text-text-muted">a</span>
          <input type="date" value={hasta} min={desde} max={hoyISO()} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {cargando && <p className="text-sm text-text-muted">Cargando…</p>}

      {datos && !cargando && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs font-semibold uppercase text-text-muted">Total de citas</p>
              <p className="mt-1 text-3xl font-bold text-primary">{datos.totalCitas}</p>
              <div className="mt-1">
                <VariacionTexto valor={datos.variacionPorcentaje} />
              </div>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase text-text-muted">Tasa de no-show</p>
              <p className="mt-1 text-3xl font-bold text-primary">{datos.tasaNoShowPorcentaje}%</p>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase text-text-muted">Duración promedio</p>
              <p className="mt-1 text-3xl font-bold text-primary">
                {datos.duracionPromedioMinutos !== null ? `${datos.duracionPromedioMinutos}m` : "—"}
              </p>
            </Card>
          </div>

          <Card>
            <p className="text-sm font-bold text-primary">Motivos de Cancelación</p>
            <div className="mt-4">
              <GraficoDona datos={datos.motivosCancelacion} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
