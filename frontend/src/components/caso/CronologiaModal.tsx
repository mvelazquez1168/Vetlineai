import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { formatearFecha } from "../../lib/formatFecha";
import { EventoCronologia, workspaceApi } from "../../lib/workspaceApi";

interface CronologiaModalProps {
  casoId: string;
  zonaHoraria: string | null | undefined;
  onClose: () => void;
}

const ICONO_POR_TIPO: Record<EventoCronologia["tipo"], string> = {
  apertura: "🗂️",
  consulta_seguimiento: "📝",
  estudio_adjuntado: "📎",
  informe_generado: "📄",
  receta_emitida: "💊",
  cuidado_preventivo: "💉",
  atencion: "🩺",
};

function tituloDeEvento(evento: EventoCronologia): string {
  switch (evento.tipo) {
    case "apertura":
      return "Apertura del caso";
    case "consulta_seguimiento":
      return "Consulta de seguimiento";
    case "estudio_adjuntado":
      return "Estudio adjuntado";
    case "informe_generado":
      return "Informe generado";
    case "receta_emitida":
      return "Receta emitida";
    case "cuidado_preventivo":
      return evento.cuidadoTipo === "vacunacion" ? "Vacunación" : "Desparasitación";
    case "atencion":
      return "Atención registrada";
  }
}

// prompt_code_cronologia_seguimiento, Paso 3 — vista de solo lectura, sin
// resúmenes de IA: cada fila es un evento real de la base, en el orden en
// que el backend ya los devuelve (ordenados por fecha). NO incluye
// respuestas del agente — eso ya lo filtra el backend, acá ni siquiera
// llegan.
export function CronologiaModal({ casoId, zonaHoraria, onClose }: CronologiaModalProps) {
  const [eventos, setEventos] = useState<EventoCronologia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    workspaceApi
      .obtenerCronologia(casoId)
      .then((data) => setEventos(data.eventos))
      .catch((err) => {
        console.error("Error al obtener la cronología del caso:", err);
        setError(err instanceof Error ? err.message : "No pudimos obtener la cronología del caso.");
      });
  }, [casoId]);

  const alternarExpandido = (clave: string) => {
    setExpandidos((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(clave)) {
        nuevo.delete(clave);
      } else {
        nuevo.add(clave);
      }
      return nuevo;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <h2 className="text-lg font-bold text-primary">Cronología del caso</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-error" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && <p className="text-sm text-error">{error}</p>}

          {!error && eventos === null && <p className="text-sm text-text-muted">Cargando…</p>}

          {!error && eventos !== null && eventos.length === 0 && (
            <p className="text-sm text-text-muted">Este caso todavía no tiene eventos registrados.</p>
          )}

          {!error && eventos !== null && eventos.length > 0 && (
            <ol className="space-y-3">
              {eventos.map((evento, i) => {
                const clave = `${evento.tipo}-${i}`;
                const expandido = expandidos.has(clave);
                return (
                  <li key={clave} className="flex gap-3 rounded-xl border border-black/5 px-4 py-3">
                    <span className="text-xl leading-none" aria-hidden="true">
                      {ICONO_POR_TIPO[evento.tipo]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="font-semibold text-text-primary">{tituloDeEvento(evento)}</p>
                        <span className="whitespace-nowrap text-xs text-text-muted">
                          {formatearFecha(evento.fecha, zonaHoraria, {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </div>

                      {evento.tipo === "apertura" && (
                        <p className="mt-1 text-sm text-text-muted">{evento.motivo}</p>
                      )}

                      {evento.tipo === "consulta_seguimiento" && (
                        <>
                          {evento.medicoNombre && (
                            <p className="mt-1 text-xs text-text-muted">{evento.medicoNombre}</p>
                          )}
                          <p
                            className={`mt-1 whitespace-pre-wrap text-sm text-text-primary ${
                              expandido ? "" : "line-clamp-2"
                            }`}
                          >
                            {evento.contenido}
                          </p>
                          {evento.contenido.length > 140 && (
                            <button
                              type="button"
                              onClick={() => alternarExpandido(clave)}
                              className="mt-1 text-xs font-semibold text-accent hover:underline"
                            >
                              {expandido ? "Ver menos" : "Ver completo"}
                            </button>
                          )}
                        </>
                      )}

                      {evento.tipo === "estudio_adjuntado" && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-sm text-text-primary">{evento.nombreArchivo}</span>
                          {evento.tipoArchivo && <Badge variant="neutral">{evento.tipoArchivo}</Badge>}
                        </div>
                      )}

                      {evento.tipo === "informe_generado" && (
                        <p className="mt-1 text-sm text-text-muted">
                          {evento.nombreArchivo} · {evento.medicoNombre}
                        </p>
                      )}

                      {evento.tipo === "receta_emitida" && (
                        <p className="mt-1 text-sm text-text-muted">{evento.medicoNombre}</p>
                      )}

                      {evento.tipo === "cuidado_preventivo" && (
                        <p className="mt-1 text-sm text-text-muted">
                          {evento.cuidadoTipo === "vacunacion"
                            ? evento.vacuna ?? "Vacuna sin especificar"
                            : `Desparasitación ${evento.subtipoDesparasitacion ?? ""}${
                                evento.productoDesparasitacion ? ` · ${evento.productoDesparasitacion}` : ""
                              }`}{" "}
                          · {evento.registradoPorNombre}
                        </p>
                      )}

                      {evento.tipo === "atencion" && (
                        <>
                          <p className="mt-1 text-xs text-text-muted">
                            {evento.medicoNombre}
                            {evento.peso && ` · Peso: ${evento.peso} kg`}
                            {evento.temperatura && ` · Temp: ${evento.temperatura} °C`}
                          </p>
                          {evento.notaMedica && (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{evento.notaMedica}</p>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
