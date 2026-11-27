import { useState } from "react";
import { Button } from "../ui/Button";
import { CapaModal } from "../ui/CapaModal";

interface ReabrirCasoModalProps<TCaso> {
  onClose: () => void;
  onReabierto: (caso: TCaso) => void;
  reabrir: (motivo: string) => Promise<{ caso: TCaso }>;
}

// prompt_code_cierre_caso.md, Paso 3 — "Con motivo, y registrando quién lo
// hizo y cuándo." El motivo es lo único que pide este formulario: quién y
// cuándo los completa el backend (reabierto_por/reabierto_en).
export function ReabrirCasoModal<TCaso>({ onClose, onReabierto, reabrir }: ReabrirCasoModalProps<TCaso>) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      const { caso } = await reabrir(motivo.trim());
      onReabierto(caso);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos reabrir el caso.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <CapaModal
      onClose={onClose}
      tipo="formulario"
      hayCambios={motivo.trim() !== ""}
      z="z-50"
      className="flex w-full max-w-md flex-col rounded-2xl bg-surface shadow-2xl"
    >
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <h2 className="text-lg font-bold text-primary">Reabrir caso</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-error" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="space-y-3 p-6">
          <p className="text-sm text-text-muted">
            El caso vuelve a admitir información y análisis. Lo capturado en el cierre anterior se conserva.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Motivo de la reapertura</label>
            <textarea
              rows={3}
              className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: el paciente recayó y vuelve a consulta…"
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-black/5 px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={!motivo.trim() || enviando}>
            {enviando ? "Reabriendo…" : "Reabrir caso"}
          </Button>
        </div>
    </CapaModal>
  );
}
