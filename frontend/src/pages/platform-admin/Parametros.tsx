import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { formatearFecha } from "../../lib/formatFecha";
import { ConsumoPruebas, ParametroPlataforma, platformAdminApi } from "../../lib/platformAdminApi";

// Prompt A (platform_admin_registro), Paso 6 — pantalla de Parámetros.

const GRUPOS: { prefijo: string; titulo: string }[] = [
  { prefijo: "trial.", titulo: "Prueba gratuita y consumo global" },
  { prefijo: "saldo.", titulo: "Límites de saldo de clientes" },
  { prefijo: "recarga.", titulo: "Configuración de recargas" },
  { prefijo: "purga.", titulo: "Políticas de purga e historial" },
  { prefijo: "agentes.", titulo: "Políticas de configuración de agentes IA" },
];

export function Parametros() {
  const [parametros, setParametros] = useState<ParametroPlataforma[]>([]);
  const [consumoPruebas, setConsumoPruebas] = useState<ConsumoPruebas | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const cargar = () => {
    setIsLoading(true);
    Promise.all([platformAdminApi.listarParametros(), platformAdminApi.obtenerConsumoPruebas()])
      .then(([paramsResp, consumoResp]) => {
        setParametros(paramsResp.parametros);
        setValores(Object.fromEntries(paramsResp.parametros.map((p) => [p.clave, p.valor])));
        setConsumoPruebas(consumoResp);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const guardar = async (clave: string) => {
    setGuardando(clave);
    setErrores((prev) => ({ ...prev, [clave]: "" }));
    try {
      await platformAdminApi.actualizarParametro(clave, valores[clave]);
      cargar();
    } catch (err) {
      setErrores((prev) => ({
        ...prev,
        [clave]: err instanceof Error ? err.message : "No pudimos guardar el parámetro.",
      }));
    } finally {
      setGuardando(null);
    }
  };

  if (isLoading || !consumoPruebas) return <p className="text-text-muted">Cargando…</p>;

  const ultimaModificacion = parametros
    .filter((p) => p.actualizadoPorNombre)
    .sort((a, b) => new Date(b.actualizadoEn).getTime() - new Date(a.actualizadoEn).getTime())[0];

  const pctSandbox = consumoPruebas.topeUsd > 0 ? Math.min((consumoPruebas.consumoUsd / consumoPruebas.topeUsd) * 100, 100) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Parámetros Globales</h1>
      <p className="mt-1 text-text-muted">
        Configuración general de límites, purgas, saldos de gracia y políticas de control del sistema Vetline Ai.
      </p>

      <div className="mt-6 space-y-6">
        {GRUPOS.map((grupo) => {
          const filas = parametros.filter((p) => p.clave.startsWith(grupo.prefijo));
          if (filas.length === 0) return null;

          return (
            <Card key={grupo.prefijo}>
              <CardTitle>{grupo.titulo.toUpperCase()}</CardTitle>
              <div className="mt-4 space-y-4">
                {filas.map((p) => (
                  <div key={p.clave} className="flex flex-wrap items-center justify-between gap-4 border-b border-black/5 pb-4 last:border-0 last:pb-0">
                    <div>
                      <p className="font-semibold text-text-primary">{p.clave}</p>
                      <p className="text-sm text-text-muted">{p.descripcion}</p>
                      {errores[p.clave] && <p className="mt-1 text-sm text-error">{errores[p.clave]}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={valores[p.clave] ?? ""}
                        onChange={(e) => setValores((prev) => ({ ...prev, [p.clave]: e.target.value }))}
                        className="w-32 rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                      />
                      <Button
                        variant="secondary"
                        onClick={() => guardar(p.clave)}
                        disabled={guardando === p.clave || valores[p.clave] === p.valor}
                      >
                        {guardando === p.clave ? "Guardando…" : "Guardar"}
                      </Button>
                    </div>
                  </div>
                ))}

                {grupo.prefijo === "trial." && (
                  <div className="pt-2">
                    <p className="font-semibold text-text-primary">Tope Global Mensual del Sandbox</p>
                    <p className="text-sm text-text-muted">
                      Presupuesto acumulado mensual para consumo preventivo de pruebas gratuitas de toda la red.
                    </p>
                    <p className="mt-2 text-sm font-semibold text-text-primary">
                      USD {consumoPruebas.consumoUsd.toFixed(2)} / {consumoPruebas.topeUsd.toFixed(2)}
                    </p>
                    <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-black/5">
                      <div
                        className={["h-full", pctSandbox >= 100 ? "bg-error" : "bg-accent"].join(" ")}
                        style={{ width: `${pctSandbox}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {ultimaModificacion && (
        <div className="mt-6 rounded-xl border border-black/5 bg-surface p-4 text-sm text-text-muted">
          Última modificación realizada por: <span className="font-semibold text-text-primary">{ultimaModificacion.actualizadoPorNombre}</span> el{" "}
          {formatearFecha(ultimaModificacion.actualizadoEn, undefined, { day: "2-digit", month: "long", year: "numeric" })}
        </div>
      )}
    </div>
  );
}
