import { useAuth } from "../../hooks/useAuth";
import { fechaHoyEnZona, formatearFechaCorta } from "../../lib/formatFecha";
import { Icono } from "./Icono";

// ---------------------------------------------------------------------
// SelectorPeriodo — el rango de fechas de los dashboards.
//
// LA PARTE QUE IMPORTA: las fechas se resuelven en la ZONA HORARIA DEL
// TENANT, no en la del navegador. Una clínica en Costa Rica (UTC-6) que
// abre el dashboard a las 19:00 locales tiene que ver "hoy" como el día
// que está viviendo, no el siguiente. Es el mismo bug que ya apareció en
// el reporte de atenciones, y el único punto que lo resuelve bien es
// `lib/formatFecha.ts` — de ahí sale `fechaHoyEnZona`, y de `useAuth`
// sale la zona.
//
// Las fechas se devuelven como "YYYY-MM-DD" (día calendario), no como
// Date ni como ISO con hora: es lo que los endpoints esperan, y evita
// que cada pantalla vuelva a convertir y se corra un día.
//
// `compararConAnterior` no cambia el rango: devuelve además el rango
// equivalente inmediatamente anterior, de la misma duración. Lo calcula
// acá para que las cuatro pantallas de dashboard no lo hagan cada una.
// ---------------------------------------------------------------------

export type PresetPeriodo = "hoy" | "7dias" | "mes" | "trimestre" | "anio" | "personalizado";

export interface Periodo {
  preset: PresetPeriodo;
  /** Día calendario inclusive, "YYYY-MM-DD". */
  desde: string;
  hasta: string;
  compararConAnterior: boolean;
  /** Presente solo si `compararConAnterior`. Mismo largo, inmediatamente antes. */
  anterior?: { desde: string; hasta: string };
}

const ETIQUETAS: Record<PresetPeriodo, string> = {
  hoy: "Hoy",
  "7dias": "7 días",
  mes: "Mes",
  trimestre: "Trimestre",
  anio: "Año",
  personalizado: "Personalizado",
};

/** Suma días a un "YYYY-MM-DD" sin pasar por la zona local del navegador. */
function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  // Date.UTC + getUTC*: aritmética de calendario pura. Un `new Date(iso)`
  // interpretado en la zona local es justamente de dónde salen los
  // corrimientos de un día.
  const t = Date.UTC(a, m - 1, d) + dias * 86400000;
  const f = new Date(t);
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}-${String(
    f.getUTCDate()
  ).padStart(2, "0")}`;
}

function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

/** Rango de un preset, anclado a "hoy" en la zona horaria del tenant. */
export function rangoDePreset(preset: PresetPeriodo, hoy: string): { desde: string; hasta: string } {
  switch (preset) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "7dias":
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "mes":
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "trimestre":
      return { desde: sumarDias(hoy, -89), hasta: hoy };
    case "anio":
      return { desde: sumarDias(hoy, -364), hasta: hoy };
    case "personalizado":
      return { desde: hoy, hasta: hoy };
  }
}

/**
 * El período inmediatamente anterior, del MISMO largo. Para 1–31 de
 * marzo devuelve 29 de enero – 28 de febrero (31 días antes), no "el mes
 * anterior": comparar 31 días contra 28 haría que febrero parezca
 * siempre peor.
 */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const largo = diasEntre(desde, hasta) + 1;
  return { desde: sumarDias(desde, -largo), hasta: sumarDias(desde, -1) };
}

export function construirPeriodo(
  preset: PresetPeriodo,
  hoy: string,
  comparar: boolean,
  personalizado?: { desde: string; hasta: string }
): Periodo {
  const rango = preset === "personalizado" && personalizado ? personalizado : rangoDePreset(preset, hoy);
  return {
    preset,
    ...rango,
    compararConAnterior: comparar,
    ...(comparar ? { anterior: periodoAnterior(rango.desde, rango.hasta) } : {}),
  };
}

export interface SelectorPeriodoProps {
  valor: Periodo;
  onCambio: (periodo: Periodo) => void;
  className?: string;
}

export function SelectorPeriodo({ valor, onCambio, className = "" }: SelectorPeriodoProps) {
  const { zonaHoraria } = useAuth();
  const hoy = fechaHoyEnZona(zonaHoraria);

  const elegirPreset = (preset: PresetPeriodo) =>
    onCambio(
      construirPeriodo(preset, hoy, valor.compararConAnterior, {
        desde: valor.desde,
        hasta: valor.hasta,
      })
    );

  const cambiarRango = (campo: "desde" | "hasta", iso: string) =>
    onCambio(
      construirPeriodo("personalizado", hoy, valor.compararConAnterior, {
        desde: campo === "desde" ? iso : valor.desde,
        hasta: campo === "hasta" ? iso : valor.hasta,
      })
    );

  return (
    <div className={["flex flex-wrap items-center gap-3", className].join(" ")}>
      <div className="flex flex-wrap gap-1 rounded-lg bg-background p-1">
        {(Object.keys(ETIQUETAS) as PresetPeriodo[]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => elegirPreset(preset)}
            aria-pressed={valor.preset === preset}
            className={[
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              valor.preset === preset
                ? "bg-surface text-primary shadow-sm"
                : "text-text-muted hover:text-primary",
            ].join(" ")}
          >
            {ETIQUETAS[preset]}
          </button>
        ))}
      </div>

      {valor.preset === "personalizado" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={valor.desde}
            max={valor.hasta}
            onChange={(e) => cambiarRango("desde", e.target.value)}
            aria-label="Desde"
            className="rounded-lg border border-black/10 bg-background px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <span className="text-text-muted">—</span>
          <input
            type="date"
            value={valor.hasta}
            min={valor.desde}
            max={hoy}
            onChange={(e) => cambiarRango("hasta", e.target.value)}
            aria-label="Hasta"
            className="rounded-lg border border-black/10 bg-background px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input
          type="checkbox"
          checked={valor.compararConAnterior}
          onChange={(e) =>
            onCambio(
              construirPeriodo(valor.preset, hoy, e.target.checked, {
                desde: valor.desde,
                hasta: valor.hasta,
              })
            )
          }
          className="h-4 w-4 rounded border-black/20 text-accent focus:ring-accent/30"
        />
        Comparar con el período anterior
      </label>

      <span className="flex items-center gap-1.5 text-xs text-text-muted">
        <Icono nombre="cita" tamano={14} />
        {formatearFechaCorta(valor.desde, zonaHoraria)} — {formatearFechaCorta(valor.hasta, zonaHoraria)}
        {valor.anterior && (
          <>
            {" · vs. "}
            {formatearFechaCorta(valor.anterior.desde, zonaHoraria)} —{" "}
            {formatearFechaCorta(valor.anterior.hasta, zonaHoraria)}
          </>
        )}
      </span>
    </div>
  );
}

/** Período inicial razonable para una pantalla que recién abre. */
export function periodoPorDefecto(zonaHoraria: string | null | undefined): Periodo {
  return construirPeriodo("mes", fechaHoyEnZona(zonaHoraria), false);
}
