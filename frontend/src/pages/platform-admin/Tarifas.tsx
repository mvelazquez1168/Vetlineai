import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { formatearFecha } from "../../lib/formatFecha";
import { AlertaTarifa, TarifaModelo, TipoToken, platformAdminApi } from "../../lib/platformAdminApi";

// Prompt A (platform_admin_registro), Paso 6 — pantalla de Tarifas.
// Una tarifa nunca se edita: el modal siempre crea una fila nueva y cierra
// la anterior (POST /platform-admin/tarifas), nunca hay un PUT/PATCH de
// precio. El backend ya invalida el caché de 60s del motor de crédito al
// guardar, así que el precio nuevo aplica de inmediato, no en el próximo minuto.

const TIPO_TOKEN_LABEL: Record<TipoToken, string> = {
  entrada: "Entrada (Prompt)",
  salida: "Salida (Completion)",
  cache_escritura: "Escritura Caché",
  cache_lectura: "Lectura Caché",
};

const ORDEN_TIPO_TOKEN: TipoToken[] = ["entrada", "salida", "cache_escritura", "cache_lectura"];

export function Tarifas() {
  const [modelos, setModelos] = useState<TarifaModelo[]>([]);
  const [alertas, setAlertas] = useState<AlertaTarifa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [historialAbierto, setHistorialAbierto] = useState<string | null>(null);

  const [modalTarifa, setModalTarifa] = useState<{ modelo: string; tipoToken: TipoToken; precioActual: number } | null>(
    null
  );
  const [nuevoPrecio, setNuevoPrecio] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    Promise.all([platformAdminApi.listarTarifas(), platformAdminApi.listarAlertasTarifas()])
      .then(([tarifasResp, alertasResp]) => {
        setModelos(tarifasResp.modelos);
        setAlertas(alertasResp.alertas);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const abrirModal = (modelo: string, tipoToken: TipoToken, precioActual: number) => {
    setModalTarifa({ modelo, tipoToken, precioActual });
    setNuevoPrecio(precioActual.toString());
    setError(null);
  };

  const confirmarNuevaTarifa = async () => {
    if (!modalTarifa) return;
    const precio = Number(nuevoPrecio);
    if (!Number.isFinite(precio) || precio < 0) {
      setError("El precio no puede ser negativo.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await platformAdminApi.crearTarifa({
        modelo: modalTarifa.modelo,
        tipoToken: modalTarifa.tipoToken,
        precioUsdPorMillon: precio,
      });
      setModalTarifa(null);
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la nueva tarifa.");
    } finally {
      setGuardando(false);
    }
  };

  const alternarFacturable = async (modelo: string, facturableActual: boolean) => {
    await platformAdminApi.cambiarFacturableModelo(modelo, !facturableActual);
    cargar();
  };

  if (isLoading) return <p className="text-text-muted">Cargando…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Configuración de Tarifas</h1>
      <p className="mt-1 text-text-muted">
        Lista global de costos por millón de tokens para cobro automatizado en clínicas veterinarias.
      </p>

      {alertas.length > 0 && (
        <div className="mt-6 space-y-2">
          {alertas.map((a) => (
            <div key={`${a.modelo}-${a.motivo}`} className="rounded-xl border border-error/40 bg-error/10 p-4 text-sm font-semibold text-error">
              {a.motivo === "tarifa_en_cero"
                ? `${a.modelo} tiene tarifa $0.00 siendo facturable — el consumo no se cobra y ningún aviso se dispara.`
                : `${a.modelo} no tiene las 4 tarifas vigentes cargadas — el consumo se registra con costo cero y no facturable.`}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-6">
        {modelos.map((modelo) => {
          const vigentes = modelo.tarifas
            .filter((t) => t.vigente)
            .sort((a, b) => ORDEN_TIPO_TOKEN.indexOf(a.tipoToken) - ORDEN_TIPO_TOKEN.indexOf(b.tipoToken));
          const historicas = modelo.tarifas.filter((t) => !t.vigente);

          return (
            <Card key={modelo.modelo}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle>{modelo.modelo}</CardTitle>
                  <Badge variant={modelo.facturable ? "success" : "warning"}>
                    {modelo.facturable ? "Facturable" : "No facturable"}
                  </Badge>
                </div>
                <Button variant="secondary" onClick={() => alternarFacturable(modelo.modelo, modelo.facturable)}>
                  {modelo.facturable ? "Marcar no facturable" : "Marcar facturable"}
                </Button>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-black/5">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/5 bg-background/60">
                      <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Tipo de token</th>
                      <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Tarifa (USD / millón tokens)</th>
                      <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Vigente desde</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {vigentes.map((t) => (
                      <tr key={t.id} className="border-b border-black/5 last:border-0">
                        <td className="px-4 py-3">{TIPO_TOKEN_LABEL[t.tipoToken]}</td>
                        <td className="px-4 py-3 font-semibold">USD {t.precioUsdPorMillon.toFixed(3)}</td>
                        <td className="px-4 py-3 text-text-muted">
                          {formatearFecha(t.vigenteDesde, undefined, { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="secondary" onClick={() => abrirModal(modelo.modelo, t.tipoToken, t.precioUsdPorMillon)}>
                            Cambiar precio
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {historicas.length > 0 && (
                <div className="mt-3">
                  <button
                    className="text-sm font-medium text-accent hover:underline"
                    onClick={() => setHistorialAbierto(historialAbierto === modelo.modelo ? null : modelo.modelo)}
                  >
                    {historialAbierto === modelo.modelo ? "Ocultar historial" : `Ver historial (${historicas.length})`}
                  </button>
                  {historialAbierto === modelo.modelo && (
                    <ul className="mt-2 space-y-1 text-sm text-text-muted">
                      {historicas.map((t) => (
                        <li key={t.id}>
                          {TIPO_TOKEN_LABEL[t.tipoToken]}: USD {t.precioUsdPorMillon.toFixed(3)} (
                          {formatearFecha(t.vigenteDesde, undefined, { day: "2-digit", month: "short", year: "numeric" })} —{" "}
                          {formatearFecha(t.vigenteHasta!, undefined, { day: "2-digit", month: "short", year: "numeric" })})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Modal
        open={modalTarifa !== null}
        onClose={() => setModalTarifa(null)}
        title={modalTarifa ? `Nueva tarifa — ${modalTarifa.modelo} · ${TIPO_TOKEN_LABEL[modalTarifa.tipoToken]}` : ""}
        description="Al crear una nueva tarifa, se cerrará automáticamente la vigente actual y comenzará la vigencia de la nueva regla."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalTarifa(null)} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={confirmarNuevaTarifa} disabled={guardando}>
              {guardando ? "Guardando…" : "Crear nueva tarifa"}
            </Button>
          </>
        }
      >
        <div className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
          El consumo ya registrado conserva la tarifa anterior.
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Nuevo precio (USD por cada millón de tokens)</label>
          <input
            type="number"
            min={0}
            step="0.001"
            value={nuevoPrecio}
            onChange={(e) => setNuevoPrecio(e.target.value)}
            className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
      </Modal>
    </div>
  );
}
