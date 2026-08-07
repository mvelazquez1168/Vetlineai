import { Fragment } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { RechazoGeneracionAviso } from "./ConsumoBanner";
import { Mensaje, RechazoGeneracion } from "../../lib/workspaceApi";

interface MensajesListaProps {
  mensajes: Mensaje[];
  // Mapa mensajeId -> motivo estructurado del aviso a mostrar en vez de la
  // burbuja de la IA (límite de uso alcanzado, falla de la llamada real a
  // Claude, rechazo del motor de crédito, etc.) — solo aplica en el
  // workspace del médico, la vista de solo lectura del admin nunca la
  // necesita.
  avisosSinRespuesta?: Map<string, RechazoGeneracion>;
  onAbrirArchivo: (archivoId: string) => void;
}

// Mapeo explícito de cada elemento markdown a clases de Tailwind con la
// tipografía y paleta ya establecidas (colors.primary/accent/text-muted
// de tailwind.config.js) — no se usan los estilos por defecto de
// react-markdown (que además Tailwind's preflight desnuda: headings y
// listas pierden tamaño/margen/bullets salvo que se los des acá).
const COMPONENTES_MARKDOWN: Components = {
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-3 text-base font-bold text-primary first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-sm font-bold text-primary first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2.5 text-sm font-semibold text-primary first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="mb-2 list-outside list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-outside list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline hover:no-underline"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-xs">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-black/5 p-3 font-mono text-xs last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/40 pl-3 text-text-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-black/10" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-black/10 bg-black/5 px-2 py-1 text-left font-bold text-primary">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-black/10 px-2 py-1">{children}</td>,
};

// Extraído de CasoWorkspace.tsx para poder reusar exactamente las mismas
// burbujas de mensaje en la vista de solo lectura del admin de clínica.
export function MensajesLista({ mensajes, avisosSinRespuesta, onAbrirArchivo }: MensajesListaProps) {
  return (
    <>
      {mensajes.map((m) =>
        // Anotar vs consultar — un bloque de información registrada NO es
        // un turno de conversación, así que no se dibuja como burbuja
        // alineada a un lado: es una tarjeta de ancho completo, sin el
        // contraste burbuja-clara/burbuja-oscura del diálogo, para que la
        // distinción sea evidente de un vistazo (no hay que leer el
        // contenido para notar que es otra cosa).
        m.tipo === "informacion" ? (
          <div key={m.id} className="flex justify-center">
            <div className="w-full max-w-lg rounded-lg border border-dashed border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-text-primary">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-accent">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                Información registrada
              </p>
              {m.contenido}
              {m.archivos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.archivos.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onAbrirArchivo(a.id)}
                      title="Abrir archivo"
                      className="inline-flex max-w-[10rem] items-center gap-1.5 truncate rounded-lg border border-black/10 bg-background px-2.5 py-1 text-xs text-text-primary hover:underline"
                    >
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
                        {a.tipo}
                      </span>
                      <span className="truncate">{a.nombre_archivo}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
        <Fragment key={m.id}>
          <div className={m.remitente === "medico" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={[
                "max-w-lg rounded-2xl px-5 py-3 text-sm",
                m.remitente === "medico"
                  ? "bg-primary text-white"
                  : "border border-black/5 bg-surface text-text-primary",
              ].join(" ")}
            >
              {m.remitente === "ai" && (
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-accent">
                  Vetline Ai AI
                </p>
              )}

              {/* El médico no escribe en markdown — su mensaje se muestra
                  tal cual, como siempre. Solo la respuesta de la IA (que
                  sí llega en markdown real desde Claude) se renderiza. */}
              {m.remitente === "ai" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTES_MARKDOWN}>
                  {m.contenido}
                </ReactMarkdown>
              ) : (
                m.contenido
              )}

              {m.archivos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.archivos.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onAbrirArchivo(a.id)}
                      title="Abrir archivo"
                      className={[
                        "inline-flex max-w-[10rem] items-center gap-1.5 truncate rounded-lg border px-2.5 py-1 text-xs hover:underline",
                        m.remitente === "medico"
                          ? "border-white/20 bg-white/10 text-white"
                          : "border-black/10 bg-background text-text-primary",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          m.remitente === "medico" ? "bg-white/20" : "bg-accent/10 text-accent",
                        ].join(" ")}
                      >
                        {a.tipo}
                      </span>
                      <span className="truncate">{a.nombre_archivo}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {avisosSinRespuesta?.has(m.id) && (
            <div className="flex justify-start">
              <div className="max-w-lg">
                <RechazoGeneracionAviso
                  error={avisosSinRespuesta.get(m.id)!.error}
                  motivo={avisosSinRespuesta.get(m.id)!.motivo}
                />
              </div>
            </div>
          )}
        </Fragment>
        )
      )}
    </>
  );
}
