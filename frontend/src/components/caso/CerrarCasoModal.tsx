import { useState } from "react";
import { Button } from "../ui/Button";
import { CapaModal } from "../ui/CapaModal";
import { Select } from "../ui/Select";
import { CerrarCasoInput, Desenlace } from "../../lib/workspaceApi";

interface CerrarCasoModalProps<TCaso> {
  pacienteNombre: string;
  pacienteEstado: "activo" | "fallecido";
  onClose: () => void;
  onCerrado: (caso: TCaso, pacienteMarcadoFallecido: boolean) => void;
  cerrar: (data: CerrarCasoInput) => Promise<{ caso: TCaso; pacienteMarcadoFallecido: boolean }>;
}

const DESENLACE_OPTIONS: { value: Desenlace; label: string }[] = [
  { value: "resuelto", label: "Resuelto" },
  { value: "derivado", label: "Derivado" },
  { value: "en_control", label: "En control" },
  { value: "fallecido", label: "Fallecido" },
];

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// prompt_code_cierre_caso.md, Paso 2 — un solo componente, usado tanto por
// el médico (CasoWorkspace.tsx) como por el administrador de clínica
// (CasoDetalleAdmin.tsx): la única diferencia entre ambos es qué función
// de API se pasa en `cerrar` (workspaceApi.cerrarCaso vs.
// adminApi.cerrarCaso), por eso es genérico en el tipo de caso devuelto.
//
// "UN CASO CERRADO ES DE SOLO LECTURA hasta que se reabra" — este modal
// solo captura los 4 campos que pide el prompt: diagnóstico final,
// tratamiento activo (+detalle), desenlace, y — si el desenlace es
// fallecido — el vínculo con el paciente, siempre OFRECIDO (checkbox) y
// CONFIRMADO acá mismo, nunca automático.
export function CerrarCasoModal<TCaso>({
  pacienteNombre,
  pacienteEstado,
  onClose,
  onCerrado,
  cerrar,
}: CerrarCasoModalProps<TCaso>) {
  const [diagnosticoFinal, setDiagnosticoFinal] = useState("");
  const [tratamientoActivo, setTratamientoActivo] = useState(false);
  const [tratamientoActivoDetalle, setTratamientoActivoDetalle] = useState("");
  const [desenlace, setDesenlace] = useState<Desenlace>("resuelto");
  const [marcarFallecido, setMarcarFallecido] = useState(false);
  const [fechaFallecimiento, setFechaFallecimiento] = useState(hoyIso());
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ofrecerFallecido = desenlace === "fallecido" && pacienteEstado === "activo";

  const puedeEnviar =
    diagnosticoFinal.trim().length > 0 &&
    (!tratamientoActivo || tratamientoActivoDetalle.trim().length > 0) &&
    (!ofrecerFallecido || !marcarFallecido || fechaFallecimiento.length > 0);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      const { caso, pacienteMarcadoFallecido } = await cerrar({
        diagnosticoFinal: diagnosticoFinal.trim(),
        tratamientoActivo,
        tratamientoActivoDetalle: tratamientoActivo ? tratamientoActivoDetalle.trim() : undefined,
        desenlace,
        marcarPacienteFallecido: ofrecerFallecido ? marcarFallecido : undefined,
        fechaFallecimiento: ofrecerFallecido && marcarFallecido ? fechaFallecimiento : undefined,
      });
      onCerrado(caso, pacienteMarcadoFallecido);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cerrar el caso.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <CapaModal
      onClose={onClose}
      tipo="formulario"
      // Hay algo que perder cuando se escribió el diagnóstico, se
      // marcó el tratamiento activo o se cambió el desenlace: lo demás
      // son valores por omisión.
      hayCambios={
        diagnosticoFinal.trim() !== "" ||
        tratamientoActivo ||
        tratamientoActivoDetalle.trim() !== "" ||
        desenlace !== "resuelto" ||
        marcarFallecido
      }
      z="z-50"
      className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-surface shadow-2xl"
    >
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <h2 className="text-lg font-bold text-primary">Cerrar caso</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-error" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <p className="text-sm text-text-muted">
            Un caso cerrado queda de solo lectura hasta que se reabra: no se le podrá agregar información nueva ni
            pedirle análisis al agente.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Diagnóstico final</label>
            <textarea
              rows={3}
              className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={diagnosticoFinal}
              onChange={(e) => setDiagnosticoFinal(e.target.value)}
              placeholder="Diagnóstico con el que se cierra el caso…"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <input
                type="checkbox"
                checked={tratamientoActivo}
                onChange={(e) => setTratamientoActivo(e.target.checked)}
              />
              Queda tratamiento activo
            </label>
            {tratamientoActivo && (
              <textarea
                rows={2}
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={tratamientoActivoDetalle}
                onChange={(e) => setTratamientoActivoDetalle(e.target.value)}
                placeholder="Cuál — el propietario sigue con esto en casa…"
              />
            )}
          </div>

          <Select
            label="Desenlace"
            options={DESENLACE_OPTIONS}
            value={desenlace}
            onChange={(e) => setDesenlace(e.target.value as Desenlace)}
          />

          {ofrecerFallecido && (
            <div className="rounded-lg border border-error/30 bg-error/5 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <input
                  type="checkbox"
                  checked={marcarFallecido}
                  onChange={(e) => setMarcarFallecido(e.target.checked)}
                />
                Marcar a {pacienteNombre} como fallecido
              </label>
              {marcarFallecido && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-text-primary">Fecha de fallecimiento</label>
                  <input
                    type="date"
                    className="rounded-lg border border-black/10 bg-background px-4 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    value={fechaFallecimiento}
                    max={hoyIso()}
                    onChange={(e) => setFechaFallecimiento(e.target.value)}
                  />
                </div>
              )}
              <p className="mt-2 text-xs text-text-muted">
                Deja de recibir avisos preventivos (vacunas, desparasitación, etc.). Esta acción no se puede
                deshacer desde acá.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-error">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-black/5 px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={!puedeEnviar || enviando}>
            {enviando ? "Cerrando…" : "Cerrar caso"}
          </Button>
        </div>
    </CapaModal>
  );
}
