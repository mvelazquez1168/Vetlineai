import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { useAuth } from "../../hooks/useAuth";
import { formatearFecha } from "../../lib/formatFecha";
import { ApiError } from "../../lib/apiError";
import { adminApi, PlanConsumo } from "../../lib/adminApi";
import {
  MetodoPago,
  PaqueteRecarga,
  RecargaEjecutada,
  RecargaHistorial,
  pagosApi,
} from "../../lib/pagosApi";

// Pantallas de pago, Paso 2 — Recargar crédito. El crédito se acredita
// solo cuando el cobro (simulado) se confirma, nunca al solicitarlo — la
// pantalla refleja esa espera con un estado "en proceso" explícito. El
// tope mensual de recargas nunca bloquea el acto manual, solo avisa.

const MOTIVO_LABEL: Record<string, string> = {
  fondos_insuficientes: "La tarjeta no tiene fondos suficientes.",
  tarjeta_rechazada: "La tarjeta fue rechazada por el banco emisor.",
  error_desconocido: "Ocurrió un error inesperado al procesar el cobro.",
};

const ESTADO_HISTORIAL_BADGE: Record<RecargaHistorial["estado"], { variant: "success" | "warning" | "error"; label: string }> = {
  acreditada: { variant: "success", label: "Acreditada" },
  pendiente: { variant: "warning", label: "En proceso" },
  fallida: { variant: "error", label: "Fallida" },
};

type EstadoRecarga = "idle" | "confirmando" | "procesando" | "exito" | "fallo";

export function RecargarCredito() {
  const { zonaHoraria } = useAuth();
  const [plan, setPlan] = useState<PlanConsumo | null>(null);
  const [paquetes, setPaquetes] = useState<PaqueteRecarga[]>([]);
  const [metodo, setMetodo] = useState<MetodoPago | null>(null);
  const [historial, setHistorial] = useState<RecargaHistorial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paqueteElegido, setPaqueteElegido] = useState<PaqueteRecarga | null>(null);
  const [estado, setEstado] = useState<EstadoRecarga>("idle");
  const [resultado, setResultado] = useState<RecargaEjecutada | null>(null);

  const cargar = () => {
    setIsLoading(true);
    Promise.all([
      adminApi.obtenerPlanConsumo(),
      pagosApi.listarPaquetesRecarga(),
      pagosApi.obtenerMetodoPago(),
      pagosApi.listarRecargas(),
    ])
      .then(([planResp, paquetesResp, metodoResp, historialResp]) => {
        setPlan(planResp);
        setPaquetes(paquetesResp.paquetes);
        setMetodo(metodoResp.metodo);
        setHistorial(historialResp.recargas);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar la información de recarga."))
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const elegirPaquete = (paquete: PaqueteRecarga) => {
    setPaqueteElegido(paquete);
    setEstado("confirmando");
    setResultado(null);
  };

  const confirmarRecarga = async () => {
    if (!paqueteElegido) return;
    setEstado("procesando");
    try {
      const { recarga } = await pagosApi.ejecutarRecarga(paqueteElegido.id);
      setResultado(recarga);
      setEstado(recarga.estado === "acreditada" ? "exito" : "fallo");
      if (recarga.estado === "acreditada") {
        cargar();
      }
    } catch (err) {
      setResultado({
        id: "",
        estado: "fallida",
        montoPagadoUsd: paqueteElegido.montoPagadoUsd,
        creditoAcreditadoUsd: 0,
        motivoFalla: "error_desconocido",
        mensajeError: err instanceof ApiError ? err.message : "No pudimos procesar la recarga.",
        superaTopeMensual: false,
      });
      setEstado("fallo");
    }
  };

  const cerrarModal = () => {
    setEstado("idle");
    setPaqueteElegido(null);
    setResultado(null);
  };

  if (isLoading) return <p className="text-text-muted">Cargando…</p>;
  if (error || !plan) return <p className="text-error">{error ?? "No pudimos cargar la información."}</p>;

  return (
    <div>
      <Link to="/admin/plan-consumo" className="text-sm font-medium text-accent hover:underline">
        ← Volver a Plan y consumo
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-primary">Recargar crédito</h1>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Saldo actual</p>
          <p className="text-xl font-bold text-primary">USD {plan.saldo.totalUsd.toFixed(2)}</p>
        </div>
      </div>

      {!metodo && (
        <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-semibold text-warning">No tiene un medio de pago registrado.</p>
          <p className="mt-1 text-text-muted">
            Necesitás agregar uno antes de recargar —{" "}
            <Link to="/admin/facturacion/medio-de-pago" className="font-semibold text-accent hover:underline">
              agregar medio de pago
            </Link>
            .
          </p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {paquetes.map((paquete, idx) => {
          const destacado = idx === 1 && paquetes.length === 3;
          const bono = paquete.creditoAcreditadoUsd - paquete.montoPagadoUsd;
          return (
            <Card key={paquete.id} highlighted={destacado}>
              {destacado && (
                <Badge variant="info" className="mb-2">
                  Recomendado
                </Badge>
              )}
              <CardTitle>{paquete.nombre}</CardTitle>
              <p className="mt-2 text-2xl font-bold text-primary">USD {paquete.montoPagadoUsd.toFixed(2)}</p>
              <p className="mt-1 text-sm text-text-muted">
                Acredita USD {paquete.creditoAcreditadoUsd.toFixed(2)} de crédito
              </p>
              {bono > 0 && (
                <p className="mt-1 text-sm font-semibold text-success">+ USD {bono.toFixed(2)} de crédito extra</p>
              )}
              <Button className="mt-4 w-full" disabled={!metodo} onClick={() => elegirPaquete(paquete)}>
                Elegir este paquete
              </Button>
            </Card>
          );
        })}
        {paquetes.length === 0 && <p className="text-text-muted">No hay paquetes de recarga disponibles.</p>}
      </div>

      <Card className="mt-6">
        <CardTitle>Historial de recargas</CardTitle>
        {historial.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">Todavía no hiciste ninguna recarga.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {historial.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-black/5 py-2 text-sm last:border-0">
                <div>
                  <p className="font-medium text-text-primary">
                    {r.paqueteNombre ?? "Paquete"} · USD {r.montoPagadoUsd.toFixed(2)}
                  </p>
                  <p className="text-text-muted">
                    {formatearFecha(r.creadaEn, zonaHoraria, { day: "2-digit", month: "short", year: "numeric" })} ·{" "}
                    {r.origen === "manual" ? "Manual" : "Automática"}
                  </p>
                </div>
                <Badge variant={ESTADO_HISTORIAL_BADGE[r.estado].variant} dot>
                  {ESTADO_HISTORIAL_BADGE[r.estado].label}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={estado !== "idle"}
        onClose={estado === "confirmando" || estado === "exito" || estado === "fallo" ? cerrarModal : () => {}}
        title={
          estado === "confirmando"
            ? "Confirmar recarga"
            : estado === "procesando"
              ? "Procesando tu recarga…"
              : estado === "exito"
                ? "¡Recarga exitosa!"
                : "La recarga no se pudo completar"
        }
        footer={
          estado === "confirmando" ? (
            <>
              <Button variant="secondary" onClick={cerrarModal}>
                Cancelar
              </Button>
              <Button onClick={confirmarRecarga}>Confirmar y pagar</Button>
            </>
          ) : estado === "exito" || estado === "fallo" ? (
            <Button onClick={cerrarModal}>Cerrar</Button>
          ) : undefined
        }
      >
        {estado === "confirmando" && paqueteElegido && (
          <div className="space-y-2 text-sm text-text-muted">
            <p>
              Monto a pagar: <span className="font-semibold text-text-primary">USD {paqueteElegido.montoPagadoUsd.toFixed(2)}</span>
            </p>
            <p>
              Crédito a acreditar:{" "}
              <span className="font-semibold text-text-primary">USD {paqueteElegido.creditoAcreditadoUsd.toFixed(2)}</span>
            </p>
            <p>
              Medio de pago:{" "}
              <span className="font-semibold text-text-primary">
                {metodo ? `${metodo.marca} •••• ${metodo.ultimos4}` : "—"}
              </span>
            </p>
            <p className="text-xs text-text-muted">El crédito se acredita recién cuando el cobro se confirma.</p>
          </div>
        )}

        {estado === "procesando" && (
          <p className="text-sm text-text-muted">Esperando la confirmación del cobro — no cierres esta ventana.</p>
        )}

        {estado === "exito" && resultado && (
          <div className="space-y-2 text-sm text-text-muted">
            <p>
              Se acreditaron <span className="font-semibold text-success">USD {resultado.creditoAcreditadoUsd.toFixed(2)}</span> a
              tu saldo.
            </p>
            {resultado.superaTopeMensual && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-warning">
                Esta recarga superó el tope mensual configurado para la autorecarga. La recarga manual siempre procede
                igual — solo te avisamos.
              </p>
            )}
          </div>
        )}

        {estado === "fallo" && resultado && (
          <div className="space-y-2 text-sm">
            <p className="text-error font-semibold">
              {resultado.mensajeError ?? (resultado.motivoFalla ? MOTIVO_LABEL[resultado.motivoFalla] : "No se pudo procesar el cobro.")}
            </p>
            <p className="text-text-muted">Tu saldo no cambió. Revise su medio de pago e inténtelo de nuevo.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
