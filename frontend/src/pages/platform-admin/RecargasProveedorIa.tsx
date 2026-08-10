import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { formatearFecha } from "../../lib/formatFecha";
import { platformAdminApi, RecargaProveedorIa } from "../../lib/platformAdminApi";

// prompt_code_panel_consumo_plataforma, Paso 1 — recargas de la cuenta de
// Anthropic. Entrada manual a propósito: Anthropic no expone el saldo por
// API (ver docs/inventario-stack-configuracion.md), así que esto es lo
// único de lo que se puede partir para derivar el saldo (Paso 3, todavía
// no construido — ver el panel de Dashboard).
const hoyISO = () => new Date().toISOString().slice(0, 10);

export function RecargasProveedorIa() {
  const [recargas, setRecargas] = useState<RecargaProveedorIa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fecha, setFecha] = useState(hoyISO());
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    platformAdminApi
      .listarRecargasProveedorIa()
      .then((r) => setRecargas(r.recargas))
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const montoNum = Number(monto);
  const montoValido = monto !== "" && Number.isFinite(montoNum) && montoNum > 0;

  const registrar = async () => {
    if (!montoValido || !fecha) return;
    setGuardando(true);
    setError(null);
    try {
      await platformAdminApi.registrarRecargaProveedorIa({ fecha, montoUsd: montoNum, nota: nota.trim() || undefined });
      setMonto("");
      setNota("");
      setFecha(hoyISO());
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos registrar la recarga.");
    } finally {
      setGuardando(false);
    }
  };

  const totalRecargado = recargas.reduce((acc, r) => acc + r.montoUsd, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Recargas del proveedor de IA</h1>
      <p className="mt-1 text-text-muted">
        Anthropic no expone el saldo de la cuenta por API — este registro manual es el único punto de partida para
        derivar el saldo disponible (Dashboard → posición de la plataforma).
      </p>

      <Card className="mt-6">
        <CardTitle>Registrar nueva recarga</CardTitle>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            max={hoyISO()}
          />
          <Input
            label="Monto (USD)"
            type="number"
            min={0}
            step="0.01"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            error={monto && !montoValido ? "El monto debe ser mayor que cero." : undefined}
          />
          <Input label="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <div className="mt-4 flex justify-end">
          <Button onClick={registrar} disabled={!montoValido || !fecha || guardando}>
            {guardando ? "Guardando…" : "Registrar recarga"}
          </Button>
        </div>
      </Card>

      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <CardTitle>Historial</CardTitle>
          <p className="text-sm font-semibold text-text-primary">Total recargado: USD {totalRecargado.toFixed(2)}</p>
        </div>
        {isLoading ? (
          <p className="mt-4 text-text-muted">Cargando…</p>
        ) : recargas.length === 0 ? (
          <p className="mt-4 text-text-muted">Todavía no se registró ninguna recarga.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-black/5">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-background/60">
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Fecha</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Monto</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Nota</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Cargado por</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Registrado</th>
                </tr>
              </thead>
              <tbody>
                {recargas.map((r) => (
                  <tr key={r.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      {formatearFecha(r.fecha, undefined, { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3 font-semibold">USD {r.montoUsd.toFixed(2)}</td>
                    <td className="px-4 py-3 text-text-muted">{r.nota ?? "—"}</td>
                    <td className="px-4 py-3 text-text-muted">{r.cargadoPorNombre ?? "—"}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {formatearFecha(r.creadoEn, undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
