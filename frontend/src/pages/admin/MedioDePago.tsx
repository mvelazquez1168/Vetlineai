import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { ApiError } from "../../lib/apiError";
import { MetodoPago, pagosApi } from "../../lib/pagosApi";

// Pantallas de pago, Paso 4 — Medio de pago. Sin diseño aprobado,
// resuelto con los componentes existentes. Al reemplazar, el método
// anterior no se elimina — deja de ser el predeterminado (lo hace el
// backend); esta pantalla solo muestra el vigente.

const MESES = Array.from({ length: 12 }, (_, i) => i + 1);
const ANIO_ACTUAL = new Date().getFullYear();
const ANIOS = Array.from({ length: 12 }, (_, i) => ANIO_ACTUAL + i);

export function MedioDePago() {
  const [metodo, setMetodo] = useState<MetodoPago | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [numero, setNumero] = useState("");
  const [nombreTitular, setNombreTitular] = useState("");
  const [vencimientoMes, setVencimientoMes] = useState(MESES[0]);
  const [vencimientoAnio, setVencimientoAnio] = useState(ANIOS[0]);
  const [cvv, setCvv] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    pagosApi
      .obtenerMetodoPago()
      .then((r) => setMetodo(r.metodo))
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar el medio de pago."))
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const abrirModal = () => {
    setNumero("");
    setNombreTitular("");
    setVencimientoMes(MESES[0]);
    setVencimientoAnio(ANIOS[0]);
    setCvv("");
    setErrorGuardar(null);
    setModalAbierto(true);
  };

  const guardar = async () => {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const { metodo: nuevo } = await pagosApi.registrarMetodoPago({
        numero,
        nombreTitular,
        vencimientoMes,
        vencimientoAnio,
        cvv,
      });
      setMetodo(nuevo);
      setModalAbierto(false);
    } catch (err) {
      setErrorGuardar(err instanceof ApiError ? err.message : "No pudimos registrar la tarjeta.");
    } finally {
      setGuardando(false);
    }
  };

  if (isLoading) return <p className="text-text-muted">Cargando…</p>;
  if (error) return <p className="text-error">{error}</p>;

  return (
    <div>
      <Link to="/admin/plan-consumo" className="text-sm font-medium text-accent hover:underline">
        ← Volver a Plan y consumo
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-primary">Medio de pago</h1>
      <p className="mt-1 text-text-muted">La tarjeta registrada se usa para recargas, autorecarga y cambios de plan.</p>

      <Card className="mt-6">
        {metodo ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {metodo.marca} •••• {metodo.ultimos4}
                </CardTitle>
                <p className="mt-1 text-sm text-text-muted">
                  Vence {String(metodo.vencimientoMes).padStart(2, "0")}/{metodo.vencimientoAnio}
                </p>
              </div>
              {metodo.estadoVencimiento === "vencido" && <Badge variant="error">Vencida</Badge>}
              {metodo.estadoVencimiento === "por_vencer" && <Badge variant="warning">Por vencer</Badge>}
            </div>

            {metodo.estadoVencimiento === "vencido" && (
              <div className="mt-4 rounded-xl border border-error/40 bg-error/10 p-4 text-sm text-error">
                Esta tarjeta ya venció. Tu próximo cobro va a fallar hasta que reemplaces el medio de pago.
              </div>
            )}
            {metodo.estadoVencimiento === "por_vencer" && (
              <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
                Esta tarjeta está por vencer. Reemplazala antes de tu próximo cobro para evitar interrupciones.
              </div>
            )}

            <Button variant="secondary" className="mt-4" onClick={abrirModal}>
              Reemplazar tarjeta
            </Button>
          </>
        ) : (
          <>
            <CardTitle>No tiene un medio de pago registrado</CardTitle>
            <p className="mt-1 text-sm text-text-muted">
              Agregue una tarjeta para poder recargar crédito, activar la autorecarga o cambiar de plan.
            </p>
            <Button className="mt-4" onClick={abrirModal}>
              Agregar medio de pago
            </Button>
          </>
        )}
      </Card>

      <Modal
        open={modalAbierto}
        onClose={() => !guardando && setModalAbierto(false)}
        title={metodo ? "Reemplazar tarjeta" : "Agregar tarjeta"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalAbierto(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={guardando || !numero || !nombreTitular || !cvv}>
              {guardando ? "Guardando…" : "Guardar tarjeta"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Nombre en la tarjeta</label>
            <input
              value={nombreTitular}
              onChange={(e) => setNombreTitular(e.target.value)}
              className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Número de tarjeta</label>
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="0000 0000 0000 0000"
              className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Mes</label>
              <select
                value={vencimientoMes}
                onChange={(e) => setVencimientoMes(Number(e.target.value))}
                className="rounded-lg border border-black/10 bg-background px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {MESES.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Año</label>
              <select
                value={vencimientoAnio}
                onChange={(e) => setVencimientoAnio(Number(e.target.value))}
                className="rounded-lg border border-black/10 bg-background px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {ANIOS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">CVV</label>
              <input
                value={cvv}
                onChange={(e) => setCvv(e.target.value)}
                placeholder="123"
                className="rounded-lg border border-black/10 bg-background px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>
          {errorGuardar && <p className="text-sm text-error">{errorGuardar}</p>}
        </div>
      </Modal>
    </div>
  );
}
