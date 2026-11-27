import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Icono, Input } from "./ui";
import { apiFetch } from "../lib/api";
import { getStoredToken } from "../hooks/useAuth";

// ---------------------------------------------------------------------
// EL PANEL DE AYUDA — prompt 16a.
//
// Disponible en toda la app, con un atajo y desde la paleta de comandos.
// Responde cómo se usa el sistema con el manual de la clínica.
//
// ES CONTEXTUAL: manda la pantalla donde está la persona, así «¿cómo
// anulo esto?» en la caja se entiende sin repetir de qué se habla.
//
// NO ES UN CHAT DE IA GENÉRICO y la pantalla lo dice: responde sobre
// Vetline Clinic y nada más. Prometer menos de lo que hace es lo que
// hace que la primera respuesta no decepcione.
// ---------------------------------------------------------------------

interface Fuente {
  titulo: string;
  seccion: string | null;
  archivo: string;
}

interface Respuesta {
  respondio: boolean;
  motivo?: string;
  texto: string;
  fuentes: Fuente[];
  ruta: string | null;
  permisoFaltante?: string;
}

interface Turno {
  pregunta: string;
  respuesta?: Respuesta;
  error?: string;
}

export function PanelAyuda({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const ubicacion = useLocation();
  const navigate = useNavigate();
  const [pregunta, setPregunta] = useState("");
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pensando, setPensando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (abierto) campo.current?.focus();
  }, [abierto]);

  async function preguntar() {
    const texto = pregunta.trim();
    if (texto.length < 3 || pensando) return;
    setPregunta("");
    setTurnos((t) => [...t, { pregunta: texto }]);
    setPensando(true);
    try {
      const r = await apiFetch<Respuesta>("/ayuda/preguntar", {
        method: "POST",
        token: getStoredToken(),
        body: JSON.stringify({ pregunta: texto, rutaActual: ubicacion.pathname }),
      });
      setTurnos((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, respuesta: r } : x)));
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : "No se pudo responder.";
      setTurnos((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: mensaje } : x)));
    } finally {
      setPensando(false);
    }
  }

  if (!abierto) return null;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-black/10 bg-surface shadow-xl"
      role="complementary"
      aria-label="Ayuda del sistema"
    >
      <header className="flex items-center justify-between border-b border-black/5 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-primary">Ayuda</h2>
          <p className="text-xs text-text-muted">Cómo se usa Vetline Clinic.</p>
        </div>
        <button
          onClick={onCerrar}
          aria-label="Cerrar la ayuda"
          className="rounded-lg px-2 py-1 text-text-muted hover:bg-black/5"
        >
          <Icono nombre="cerrar" tamano={16} />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {turnos.length === 0 && (
          <div className="space-y-3 text-sm text-text-muted">
            <p>Preguntá cómo se hace algo. Por ejemplo:</p>
            <ul className="space-y-1">
              {[
                "¿Cómo registro una vacuna?",
                "¿Cómo cierro la caja?",
                "¿Cómo invito a una recepcionista?",
                "¿Dónde veo lo que le debo a los proveedores?",
              ].map((e) => (
                <li key={e}>
                  <button
                    className="text-left text-accent hover:underline"
                    onClick={() => setPregunta(e)}
                  >
                    {e}
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs">
              Responde sobre este sistema. No da consejo clínico ni de dosis.
            </p>
          </div>
        )}

        {turnos.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="rounded-lg bg-background px-3 py-2 text-sm font-medium text-text">
              {t.pregunta}
            </p>
            {t.error && <p className="text-sm text-error">{t.error}</p>}
            {t.respuesta && (
              <div className="space-y-2">
                <div className="whitespace-pre-wrap text-sm text-text">{t.respuesta.texto}</div>

                {t.respuesta.ruta && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      navigate(t.respuesta!.ruta!);
                      onCerrar();
                    }}
                  >
                    Ir a esa pantalla
                  </Button>
                )}

                {t.respuesta.fuentes.length > 0 && (
                  <p className="text-xs text-text-muted">
                    Del manual:{" "}
                    {t.respuesta.fuentes
                      .map((f) => `${f.titulo}${f.seccion ? ` — ${f.seccion}` : ""}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            )}
            {!t.respuesta && !t.error && (
              <p className="text-sm text-text-muted">Buscando en el manual…</p>
            )}
          </div>
        ))}
      </div>

      <footer className="border-t border-black/5 p-3">
        <div className="flex gap-2">
          <Input
            ref={campo}
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") preguntar();
            }}
            placeholder="¿Cómo…?"
          />
          <Button onClick={preguntar} disabled={pensando || pregunta.trim().length < 3}>
            Preguntar
          </Button>
        </div>
      </footer>
    </aside>
  );
}
