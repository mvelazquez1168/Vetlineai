import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { ApiError } from "../../lib/apiError";
import { ConfigRecarga, MetodoPago, PaqueteRecarga, pagosApi } from "../../lib/pagosApi";

// Pantallas de pago, Paso 3 — Configurar autorecarga. El tope es un
// monto en dólares, no una cantidad de recargas; al alcanzarlo se
// detiene la recarga automática pero la manual sigue disponible (eso se
// ejecuta en el job de autorecarga, fuera de alcance de este prompt —
// acá solo se guarda la configuración con la validación correcta).

export function ConfigurarAutorecarga() {
  const [config, setConfig] = useState<ConfigRecarga | null>(null);
  const [paquetes, setPaquetes] = useState<PaqueteRecarga[]>([]);
  const [metodo, setMetodo] = useState<MetodoPago | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [autorecargaActiva, setAutorecargaActiva] = useState(false);
  const [umbralUsd, setUmbralUsd] = useState("5");
  const [paqueteId, setPaqueteId] = useState("");
  const [topeMensual, setTopeMensual] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([pagosApi.obtenerConfigRecarga(), pagosApi.listarPaquetesRecarga(), pagosApi.obtenerMetodoPago()])
      .then(([configResp, paquetesResp, metodoResp]) => {
        setConfig(configResp.config);
        setAutorecargaActiva(configResp.config.autorecargaActiva);
        setUmbralUsd(String(configResp.config.umbralUsd));
        setPaqueteId(configResp.config.paqueteId ?? paquetesResp.paquetes[0]?.id ?? "");
        setTopeMensual(configResp.config.topeMensualRecargasUsd != null ? String(configResp.config.topeMensualRecargasUsd) : "");
        setPaquetes(paquetesResp.paquetes);
        setMetodo(metodoResp.metodo);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar la configuración."))
      .finally(() => setIsLoading(false));
  }, []);

  const paqueteElegido = paquetes.find((p) => p.id === paqueteId) ?? null;
  const umbralInvalido =
    autorecargaActiva && paqueteElegido != null && Number(umbralUsd) >= paqueteElegido.montoPagadoUsd;

  const guardar = async () => {
    if (umbralInvalido) return;
    setGuardando(true);
    setGuardado(false);
    setErrorGuardar(null);
    try {
      const nuevaConfig: ConfigRecarga = {
        autorecargaActiva,
        umbralUsd: Number(umbralUsd),
        paqueteId: autorecargaActiva ? paqueteId || null : null,
        topeMensualRecargasUsd: topeMensual.trim() ? Number(topeMensual) : null,
      };
      const { config: guardada } = await pagosApi.actualizarConfigRecarga(nuevaConfig);
      setConfig(guardada);
      setGuardado(true);
    } catch (err) {
      setErrorGuardar(err instanceof ApiError ? err.message : "No pudimos guardar la configuración.");
    } finally {
      setGuardando(false);
    }
  };

  if (isLoading) return <p className="text-text-muted">Cargando…</p>;
  if (error || !config) return <p className="text-error">{error ?? "No pudimos cargar la configuración."}</p>;

  return (
    <div>
      <Link to="/admin/plan-consumo" className="text-sm font-medium text-accent hover:underline">
        ← Volver a Plan y consumo
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-primary">Configurar autorecarga</h1>
      <p className="mt-1 text-text-muted">Recargá tu saldo automáticamente cuando caiga por debajo de un umbral.</p>

      {!metodo && (
        <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-semibold text-warning">No tenés un medio de pago registrado.</p>
          <p className="mt-1 text-text-muted">
            La autorecarga usa el medio de pago registrado —{" "}
            <Link to="/admin/facturacion/medio-de-pago" className="font-semibold text-accent hover:underline">
              agregá uno
            </Link>{" "}
            para poder activarla.
          </p>
        </div>
      )}

      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Autorecarga automática</CardTitle>
            <p className="mt-1 text-sm text-text-muted">
              Usa el medio de pago registrado. Un fallo no se reintenta automáticamente — se te avisa y vos decidís.
            </p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={autorecargaActiva}
              disabled={!metodo}
              onChange={(e) => setAutorecargaActiva(e.target.checked)}
            />
            <div className="h-6 w-11 rounded-full bg-black/10 peer-checked:bg-accent peer-disabled:opacity-50" />
            <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
          </label>
        </div>

        {autorecargaActiva && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Umbral que dispara la recarga (USD)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={umbralUsd}
                onChange={(e) => setUmbralUsd(e.target.value)}
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Paquete a recargar</label>
              <select
                value={paqueteId}
                onChange={(e) => setPaqueteId(e.target.value)}
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {paquetes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} — USD {p.montoPagadoUsd.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-sm font-semibold text-text-primary">Tope mensual de recargas (USD, opcional)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={topeMensual}
                onChange={(e) => setTopeMensual(e.target.value)}
                placeholder="Sin tope"
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <p className="text-xs text-text-muted">
                Es un monto, no una cantidad de recargas. Al alcanzarlo se detiene la recarga automática hasta el
                próximo período — la recarga manual sigue disponible.
              </p>
            </div>

            {umbralInvalido && (
              <p className="text-sm text-error sm:col-span-2">
                El umbral no puede ser mayor ni igual al monto del paquete elegido — produciría una recarga que no
                alcanza a superar el umbral y dispararía otra de inmediato.
              </p>
            )}
          </div>
        )}

        {errorGuardar && <p className="mt-4 text-sm text-error">{errorGuardar}</p>}

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={guardar} disabled={guardando || umbralInvalido}>
            {guardando ? "Guardando…" : "Guardar configuración"}
          </Button>
          {guardado && !guardando && <span className="text-sm font-semibold text-success">Guardado.</span>}
        </div>
      </Card>
    </div>
  );
}
