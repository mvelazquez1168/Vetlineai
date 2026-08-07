import { Badge, BadgeVariant } from "../ui/Badge";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import {
  DashboardGcis,
  DashboardGcisActiveProblem,
  DashboardGcisAlerta,
  DashboardGcisDifferential,
  DashboardGcisReasoningEntry,
  DashboardGcisReferralRecommendation,
} from "../../lib/workspaceApi";
import { formatearFecha } from "../../lib/formatFecha";

const CLINICAL_STATE_LABEL: Record<string, string> = {
  remision: "Remisión",
  estable: "Estable",
  mejorando: "Mejorando",
  respuesta_parcial: "Respuesta parcial",
  empeorando: "Empeorando",
  critico: "Crítico",
  informacion_insuficiente: "Información insuficiente",
};

const CLINICAL_STATE_BADGE: Record<string, BadgeVariant> = {
  remision: "success",
  estable: "info",
  mejorando: "success",
  respuesta_parcial: "warning",
  empeorando: "error",
  critico: "error",
  informacion_insuficiente: "neutral",
};

const CONFIANZA_BADGE: Record<string, BadgeVariant> = {
  alto: "success",
  moderado: "warning",
  bajo: "error",
  alta: "success",
  moderada: "warning",
  baja: "error",
};

const PROBLEMA_SEVERIDAD_BADGE: Record<DashboardGcisActiveProblem["severidad"], BadgeVariant> = {
  critico: "error",
  relevante: "warning",
  seguimiento: "neutral",
};

const PROBLEMA_SEVERIDAD_LABEL: Record<DashboardGcisActiveProblem["severidad"], string> = {
  critico: "Crítico",
  relevante: "Relevante",
  seguimiento: "Seguimiento",
};

const PROBLEMA_SEVERIDAD_ORDEN: Record<DashboardGcisActiveProblem["severidad"], number> = {
  critico: 0,
  relevante: 1,
  seguimiento: 2,
};

const ALERTA_NIVEL_BADGE: Record<DashboardGcisAlerta["nivel"], BadgeVariant> = {
  alta: "error",
  media: "warning",
};

const REFERRAL_CLASIFICACION_LABEL: Record<DashboardGcisReferralRecommendation["clasificacion"], string> = {
  manejable_atencion_primaria: "Manejable en atención primaria",
  derivacion_no_urgente: "Derivación no urgente",
  derivacion_urgente: "Derivación urgente",
  informacion_insuficiente: "Información insuficiente",
};

const REFERRAL_CLASIFICACION_BADGE: Record<DashboardGcisReferralRecommendation["clasificacion"], BadgeVariant> = {
  manejable_atencion_primaria: "success",
  derivacion_no_urgente: "warning",
  derivacion_urgente: "error",
  informacion_insuficiente: "neutral",
};

const REFERRAL_URGENCIA_LABEL: Record<string, string> = { urgente: "Urgente", no_urgente: "No urgente" };

interface DashboardGcisPanelProps {
  dashboard: DashboardGcis;
  // Usado por exportarDashboardHtml.tsx al renderizar a HTML estático: ahí
  // no hay interactividad posible, así que las Zonas 3/4 se fuerzan
  // expandidas para que su contenido quede en el documento exportado (en
  // pantalla normal se deja el comportamiento colapsable de siempre).
  modoExport?: boolean;
  zonaHoraria?: string | null;
  // Dato determinístico del caso (casos.numero_expediente), no algo que
  // el modelo genere — se pasa como prop propia en vez de vivir dentro
  // del JSON de dashboard, que es contenido de la IA.
  numeroExpediente?: number;
}

// Consume el JSON real de POST /casos/:id/dashboard/actualizar para
// agentes GCIS (tool use forzado contra generar_dashboard_gcis — ver
// dashboard_schema.json). Regla transversal de todo este componente: un
// campo null no se renderiza — nunca como sección vacía, nunca como
// título sin contenido debajo.
export function DashboardGcisPanel({
  dashboard,
  modoExport = false,
  zonaHoraria,
  numeroExpediente,
}: DashboardGcisPanelProps) {
  const {
    executive_summary: executiveSummary,
    clinical_state: clinicalState,
    clinical_confidence: clinicalConfidence,
    active_problems: activeProblems,
    alertas,
    trends,
    differential_diagnosis: differentialDiagnosis,
    knowledge_match: knowledgeMatch,
    clinical_reasoning_journal: reasoningJournal,
    referral_recommendation: referralRecommendation,
  } = dashboard;

  const problemasOrdenados = activeProblems
    ? [...activeProblems].sort(
        (a, b) => PROBLEMA_SEVERIDAD_ORDEN[a.severidad] - PROBLEMA_SEVERIDAD_ORDEN[b.severidad]
      )
    : null;

  // Zona 3 completa se oculta si los 7 campos de trends son null.
  const hayTendencias =
    trends !== null &&
    (trends.weight_trend ||
      trends.bcs_trend ||
      trends.cbc_trend ||
      trends.clinical_chemistry_trend ||
      trends.imaging_comparison ||
      trends.clinical_timeline ||
      trends.treatment_timeline);

  // Zona 4 completa se oculta si los 3 campos son null.
  const hayRazonamiento = differentialDiagnosis || knowledgeMatch || reasoningJournal;

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">
        Dashboard clínico (GCIS)
      </h3>

      {/* Mismo indicador tanto para datos recién generados (después de
          "Actualizar Dashboard") como para datos cargados desde el cache
          al abrir el caso — en los dos casos la fecha sale de
          dashboard.meta.generado_en, así que es el mismo elemento. En el
          export a HTML estático se omite: ese documento ya tiene su
          propio header con "Generado el / Exportado el". */}
      {!modoExport && dashboard.meta.estado_generacion === "generado" && (
        <div className="rounded-xl bg-accent/5 px-4 py-2 text-xs text-text-muted">
          Generado el {formatearFecha(dashboard.meta.generado_en, zonaHoraria, {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          — hacé clic en "Actualizar Dashboard" si hay información nueva relevante.
        </div>
      )}

      {/* ================= Zona 1 — Header ================= */}
      {executiveSummary && (
        <div className="rounded-2xl border border-black/5 bg-surface p-5">
          <h4 className="text-sm font-bold text-primary">Resumen del caso</h4>
          <p className="mt-2 text-sm leading-relaxed text-text-primary">{executiveSummary.resumen}</p>

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-muted">
            {numeroExpediente != null && (
              <div>
                <dt className="inline font-semibold text-text-primary">Expediente N.º: </dt>
                <dd className="inline">{numeroExpediente}</dd>
              </div>
            )}
            <div>
              <dt className="inline font-semibold text-text-primary">Paciente: </dt>
              <dd className="inline">{executiveSummary.paciente.nombre}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-text-primary">Especie/raza: </dt>
              <dd className="inline">
                {executiveSummary.paciente.especie} · {executiveSummary.paciente.raza}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold text-text-primary">Edad: </dt>
              <dd className="inline">{executiveSummary.paciente.edad}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-text-primary">Sexo: </dt>
              <dd className="inline">{executiveSummary.paciente.sexo}</dd>
            </div>
            {executiveSummary.paciente.peso_actual_kg != null && (
              <div>
                <dt className="inline font-semibold text-text-primary">Peso actual: </dt>
                <dd className="inline">{executiveSummary.paciente.peso_actual_kg} kg</dd>
              </div>
            )}
          </dl>

          {executiveSummary.contexto_racial && (
            <p className="mt-3 rounded-lg bg-accent/5 p-3 text-xs text-text-primary">
              <span className="font-semibold text-accent">Contexto racial: </span>
              {executiveSummary.contexto_racial}
            </p>
          )}
        </div>
      )}

      {clinicalState && (
        <div className="rounded-2xl border border-black/5 bg-surface p-5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted">Estado clínico</h4>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xl" aria-hidden="true">
              {clinicalState.emoji}
            </span>
            <Badge variant={CLINICAL_STATE_BADGE[clinicalState.estado] ?? "neutral"}>
              {CLINICAL_STATE_LABEL[clinicalState.estado] ?? clinicalState.estado}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">{clinicalState.justificacion}</p>
        </div>
      )}

      {clinicalConfidence && (
        <div className="rounded-2xl border border-black/5 bg-surface p-5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Confianza diagnóstica
          </h4>
          <Badge variant={CONFIANZA_BADGE[clinicalConfidence.nivel] ?? "neutral"} className="mt-2">
            {clinicalConfidence.nivel}
          </Badge>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">{clinicalConfidence.justificacion}</p>
        </div>
      )}

      {/* ================= Zona 2 — Problemas y alertas ================= */}
      {problemasOrdenados && (
        <div className="rounded-2xl border border-black/5 bg-surface p-5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Problemas activos
          </h4>
          <ul className="mt-3 space-y-3">
            {problemasOrdenados.map((p, i) => (
              <li key={i} className="border-b border-black/5 pb-3 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-text-primary">{p.problema}</p>
                  <Badge variant={PROBLEMA_SEVERIDAD_BADGE[p.severidad]} className="shrink-0">
                    {PROBLEMA_SEVERIDAD_LABEL[p.severidad]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-text-muted">{p.fuente}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {alertas && (
        <div className="rounded-2xl border border-error/30 bg-error/5 p-5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-error">Alertas</h4>
          <ul className="mt-3 space-y-3">
            {alertas.map((a, i) => (
              <li key={i} className="border-b border-error/10 pb-3 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary">{a.tipo}</p>
                  <Badge variant={ALERTA_NIVEL_BADGE[a.nivel]} className="shrink-0">
                    {a.nivel}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{a.descripcion}</p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-text-muted/70">
                  {a.componente_origen}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {referralRecommendation && (
        <div className="rounded-2xl border border-black/5 bg-surface p-5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Recomendación de Derivación
          </h4>
          <Badge
            variant={REFERRAL_CLASIFICACION_BADGE[referralRecommendation.clasificacion] ?? "neutral"}
            className="mt-2"
          >
            {REFERRAL_CLASIFICACION_LABEL[referralRecommendation.clasificacion] ?? referralRecommendation.clasificacion}
          </Badge>
          {referralRecommendation.especialidad_destino && (
            <p className="mt-2 text-xs text-text-muted">
              <span className="font-semibold text-text-primary">Especialidad destino: </span>
              {referralRecommendation.especialidad_destino}
            </p>
          )}
          {referralRecommendation.pregunta_clinica && (
            <p className="mt-1 text-xs text-text-muted">
              <span className="font-semibold text-text-primary">Pregunta clínica: </span>
              {referralRecommendation.pregunta_clinica}
            </p>
          )}
          {referralRecommendation.urgencia && (
            <p className="mt-1 text-xs text-text-muted">
              <span className="font-semibold text-text-primary">Urgencia: </span>
              {REFERRAL_URGENCIA_LABEL[referralRecommendation.urgencia] ?? referralRecommendation.urgencia}
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-text-muted">{referralRecommendation.justificacion}</p>
        </div>
      )}

      {/* ================= Zona 3 — Evolución y evidencia ================= */}
      {hayTendencias && trends && (
        <CollapsibleSection titulo="Evolución y evidencia" defaultAbierto forzarAbierto={modoExport}>
          {trends.weight_trend && (
            <TablaSerie
              titulo="Peso"
              filas={trends.weight_trend.map((p) => [p.fecha, `${p.peso_kg} kg`])}
            />
          )}
          {trends.bcs_trend && (
            <TablaSerie titulo="BCS" filas={trends.bcs_trend.map((p) => [p.fecha, `${p.bcs}/9`])} />
          )}
          {trends.cbc_trend && (
            <TablaSerie
              titulo="Hemograma"
              filas={trends.cbc_trend.map((p) => [
                p.fecha,
                `${p.parametro}: ${p.valor} ${p.unidad} (ref. ${p.rango_ref})`,
              ])}
            />
          )}
          {trends.clinical_chemistry_trend && (
            <TablaSerie
              titulo="Bioquímica"
              filas={trends.clinical_chemistry_trend.map((p) => [
                p.fecha,
                `${p.parametro}: ${p.valor} ${p.unidad} (ref. ${p.rango_ref})`,
              ])}
            />
          )}
          {trends.imaging_comparison && (
            <TablaSerie
              titulo="Comparación de imágenes"
              filas={trends.imaging_comparison.map((p) => [p.fecha, p.hallazgo])}
            />
          )}
          {trends.clinical_timeline && (
            <LineaDeTiempo titulo="Línea de tiempo clínica" eventos={trends.clinical_timeline} />
          )}
          {trends.treatment_timeline && (
            <LineaDeTiempo
              titulo="Línea de tiempo de tratamiento"
              eventos={trends.treatment_timeline.map((t) => ({ fecha: t.fecha, evento: t.cambio }))}
            />
          )}
        </CollapsibleSection>
      )}

      {/* ================= Zona 4 — Razonamiento y conocimiento ================= */}
      {hayRazonamiento && (
        <CollapsibleSection
          titulo="Razonamiento y conocimiento"
          defaultAbierto={false}
          forzarAbierto={modoExport}
        >
          {differentialDiagnosis && <DiagnosticosDiferenciales items={differentialDiagnosis} />}
          {knowledgeMatch && (
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wide text-text-muted">
                Coincidencias en la Base de Conocimiento
              </h5>
              <ul className="mt-2 space-y-2">
                {knowledgeMatch.map((k, i) => (
                  <li key={i} className="rounded-lg bg-accent/5 p-3 text-xs">
                    <p className="font-semibold text-text-primary">{k.referencia}</p>
                    <p className="mt-1 text-text-muted">{k.relevancia}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reasoningJournal && <BitacoraRazonamiento entradas={reasoningJournal} />}
        </CollapsibleSection>
      )}
    </div>
  );
}

function TablaSerie({ titulo, filas }: { titulo: string; filas: [string, string][] }) {
  return (
    <div>
      <h5 className="text-xs font-bold uppercase tracking-wide text-text-muted">{titulo}</h5>
      <ul className="mt-2 space-y-1">
        {filas.map(([fecha, valor], i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-text-muted">{fecha}</span>
            <span className="text-right font-medium text-text-primary">{valor}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineaDeTiempo({
  titulo,
  eventos,
}: {
  titulo: string;
  eventos: { fecha: string; evento: string }[];
}) {
  return (
    <div>
      <h5 className="text-xs font-bold uppercase tracking-wide text-text-muted">{titulo}</h5>
      <ol className="mt-2 space-y-3 border-l-2 border-accent/30 pl-4">
        {eventos.map((e, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            <p className="text-xs font-semibold text-text-primary">{e.fecha}</p>
            <p className="text-xs text-text-muted">{e.evento}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DiagnosticosDiferenciales({ items }: { items: DashboardGcisDifferential[] }) {
  return (
    <div>
      <h5 className="text-xs font-bold uppercase tracking-wide text-text-muted">
        Diagnósticos diferenciales
      </h5>
      <ul className="mt-2 space-y-4">
        {items.map((d, i) => (
          <li key={i} className="rounded-lg border border-black/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-text-primary">{d.diagnostico}</p>
              <Badge variant={CONFIANZA_BADGE[d.confianza] ?? "neutral"} className="shrink-0">
                {d.confianza}
              </Badge>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-success">
                  Evidencia a favor
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-muted">
                  {d.evidencia_a_favor.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-error">
                  Evidencia en contra
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-muted">
                  {d.evidencia_en_contra.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>

            {d.informacion_faltante.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                  Información faltante
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-muted">
                  {d.informacion_faltante.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Hipótesis "descartada" nunca se elimina de la vista — se distingue con
// texto tachado y atenuado, siempre visible junto a las activas.
function BitacoraRazonamiento({ entradas }: { entradas: DashboardGcisReasoningEntry[] }) {
  return (
    <div>
      <h5 className="text-xs font-bold uppercase tracking-wide text-text-muted">
        Bitácora de razonamiento clínico
      </h5>
      <ul className="mt-2 space-y-3">
        {entradas.map((e, i) => {
          const descartada = e.estado === "descartada";
          return (
            <li key={i} className={["text-xs", descartada ? "opacity-50" : ""].join(" ")}>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-text-muted">{e.fecha}</span>
                <Badge variant={descartada ? "neutral" : "info"}>
                  {descartada ? "Descartada" : "Activa"}
                </Badge>
              </div>
              <p className={["mt-1 font-medium text-text-primary", descartada ? "line-through" : ""].join(" ")}>
                {e.hipotesis}
              </p>
              <p className="mt-0.5 text-text-muted">{e.motivo}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
