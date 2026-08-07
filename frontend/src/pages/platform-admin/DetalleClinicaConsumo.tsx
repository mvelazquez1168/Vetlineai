import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { formatearFecha } from "../../lib/formatFecha";
import { DetalleClinicaConsumo as DetalleData, EventoCicloVida, platformAdminApi } from "../../lib/platformAdminApi";

// Prompt A (platform_admin_registro), Paso 6 — Detalle de clínica (consumo).
// El ajuste manual de saldo es la operación más sensible del panel: motivo
// obligatorio, y el backend la registra en movimientos_credito con el
// usuario que la hizo — no hay forma de aplicarla sin dejar rastro.
//
// Ajustes del recorrido de prueba, Bloque 2 — esta vista ahora se llega
// desde DOS listados (Consumo por clínica y Clínicas), no solo el
// primero. "Volver" usa navigate(-1) en vez de una ruta fija: un destino
// hardcodeado solo podía ser correcto para uno de los dos orígenes.
//
// Vetline_Ai_Suspension_Bloqueo.md — 4 acciones manuales de ciclo de
// vida. Suspender y bloquear son cosas DISTINTAS (spec, sección 1): la
// primera es un problema comercial y reversible, la segunda es
// excepcional (abuso/fraude) — por eso tienen tratamiento visual
// distinto (naranja vs. rojo) y nunca aparecen como la misma acción.

const ESTADO_LABEL: Record<string, string> = {
  prueba: "Prueba",
  activa: "Activa",
  morosa: "Morosa",
  suspendida: "Suspendida",
  ventana_purga: "En ventana de cierre",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
  finalizada: "Finalizada",
};

const ESTADO_VARIANT: Record<string, BadgeVariant> = {
  prueba: "info",
  activa: "success",
  morosa: "warning",
  suspendida: "warning",
  ventana_purga: "error",
  bloqueada: "error",
  cancelada: "neutral",
  finalizada: "neutral",
};

const TIPO_EVENTO_LABEL: Record<string, string> = {
  suspension_manual: "Suspendida manualmente",
  reactivacion: "Reactivada",
  bloqueo: "Bloqueada",
  desbloqueo: "Desbloqueada",
  entrada_ventana_cierre: "Entró en ventana de cierre",
  cancelacion_ventana_cierre: "Ventana de cierre cancelada",
  cierre_efectivo: "Cierre efectivo",
};

type AccionCicloVida = "suspender" | "reactivar" | "bloquear" | "desbloquear" | null;

export function DetalleClinicaConsumo() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const navigate = useNavigate();
  const [detalle, setDetalle] = useState<DetalleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [modalAjuste, setModalAjuste] = useState(false);
  const [montoAjuste, setMontoAjuste] = useState("");
  const [motivoAjuste, setMotivoAjuste] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [errorAjuste, setErrorAjuste] = useState<string | null>(null);

  const [accionAbierta, setAccionAbierta] = useState<AccionCicloVida>(null);
  const [motivoAccion, setMotivoAccion] = useState("");
  const [aplicandoAccion, setAplicandoAccion] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cargar = () => {
    if (!tenantId) return;
    setIsLoading(true);
    platformAdminApi.obtenerDetalleClinicaConsumo(tenantId).then(setDetalle).finally(() => setIsLoading(false));
  };

  useEffect(cargar, [tenantId]);

  const aplicarAjuste = async () => {
    if (!tenantId) return;
    const monto = Number(montoAjuste);
    if (!Number.isFinite(monto) || monto === 0) {
      setErrorAjuste("El monto debe ser un número distinto de cero.");
      return;
    }
    if (!motivoAjuste.trim()) {
      setErrorAjuste("El motivo del ajuste es obligatorio.");
      return;
    }
    setAplicando(true);
    setErrorAjuste(null);
    try {
      await platformAdminApi.ajustarSaldoClinica(tenantId, { montoUsd: monto, motivo: motivoAjuste.trim() });
      setModalAjuste(false);
      setMontoAjuste("");
      setMotivoAjuste("");
      cargar();
    } catch (err) {
      setErrorAjuste(err instanceof Error ? err.message : "No pudimos aplicar el ajuste.");
    } finally {
      setAplicando(false);
    }
  };

  const cerrarModalAccion = () => {
    setAccionAbierta(null);
    setMotivoAccion("");
    setErrorAccion(null);
  };

  const aplicarAccion = async () => {
    if (!tenantId || !accionAbierta) return;
    if (!motivoAccion.trim()) {
      setErrorAccion("El motivo es obligatorio.");
      return;
    }
    setAplicandoAccion(true);
    setErrorAccion(null);
    try {
      const fn = {
        suspender: platformAdminApi.suspenderClinica,
        reactivar: platformAdminApi.reactivarClinica,
        bloquear: platformAdminApi.bloquearClinica,
        desbloquear: platformAdminApi.desbloquearClinica,
      }[accionAbierta];
      await fn(tenantId, motivoAccion.trim());
      cerrarModalAccion();
      cargar();
    } catch (err) {
      setErrorAccion(err instanceof Error ? err.message : "No pudimos aplicar la acción.");
    } finally {
      setAplicandoAccion(false);
    }
  };

  if (isLoading || !detalle) return <p className="text-text-muted">Cargando…</p>;

  const puedeSuspender = ["activa", "morosa"].includes(detalle.estado);
  const puedeReactivar = detalle.estado === "suspendida";
  const puedeBloquear = !["bloqueada", "cancelada", "finalizada"].includes(detalle.estado);
  const puedeDesbloquear = detalle.estado === "bloqueada";

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm font-medium text-accent hover:underline">
        ← Volver
      </button>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-primary">{detalle.nombre}</h1>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase text-primary">{detalle.plan}</span>
          <Badge variant={ESTADO_VARIANT[detalle.estado] ?? "neutral"}>{ESTADO_LABEL[detalle.estado] ?? detalle.estado}</Badge>
        </div>
        <Button onClick={() => setModalAjuste(true)}>Ajustar saldo manualmente</Button>
      </div>

      <Card className="mt-6">
        <CardTitle>Acciones de Control</CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          Estas herramientas permiten cambiar de forma inmediata el acceso y facturación de la clínica en la
          plataforma.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {puedeSuspender && (
            <button
              onClick={() => setAccionAbierta("suspender")}
              className="rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Suspender clínica
            </button>
          )}
          {puedeReactivar && (
            <button
              onClick={() => setAccionAbierta("reactivar")}
              className="rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Reactivar clínica
            </button>
          )}
          {puedeBloquear && (
            <button
              onClick={() => setAccionAbierta("bloquear")}
              className="rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Bloquear clínica
            </button>
          )}
          {puedeDesbloquear && (
            <button
              onClick={() => setAccionAbierta("desbloquear")}
              className="rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5"
            >
              Desbloquear clínica
            </button>
          )}
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Estado del crédito corriente</CardTitle>
          <p className="mt-2 text-3xl font-bold text-primary">USD {detalle.saldoUsd.toFixed(2)}</p>
          <p className="mt-1 text-sm text-success">Saldo disponible</p>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Desglose de consumo del período</CardTitle>
            <p className="font-bold text-primary">
              Total: USD {detalle.desgloseConsumo.reduce((acc, d) => acc + d.montoUsd, 0).toFixed(2)}
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {detalle.desgloseConsumo.map((d) => (
              <div key={d.tipo} className="flex items-center justify-between border-b border-black/5 pb-2 last:border-0">
                <div>
                  <p className="font-semibold text-text-primary">{d.etiqueta}</p>
                  <p className="text-sm text-text-muted">{d.cantidad} registro(s)</p>
                </div>
                <p className="font-semibold text-text-primary">USD {d.montoUsd.toFixed(2)}</p>
              </div>
            ))}
            {detalle.desgloseConsumo.length === 0 && (
              <p className="text-sm text-text-muted">Todavía no hay consumo registrado en este período.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle>Historial de movimientos de crédito</CardTitle>
        <div className="mt-4 overflow-x-auto rounded-xl border border-black/5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-background/60">
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Fecha y hora</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Concepto</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Operador</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Monto</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-primary">Saldo resultante</th>
              </tr>
            </thead>
            <tbody>
              {detalle.movimientos.map((m) => (
                <tr key={m.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3 text-text-muted">
                    {formatearFecha(m.creadoEn, undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-text-primary">{m.descripcion ?? m.tipo}</td>
                  <td className="px-4 py-3 text-text-muted">{m.operador}</td>
                  <td className={["px-4 py-3 font-semibold", m.montoUsd >= 0 ? "text-success" : "text-error"].join(" ")}>
                    {m.montoUsd >= 0 ? "+" : ""}
                    USD {m.montoUsd.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-text-primary">USD {(m.saldoPlanPost + m.saldoCompradoPost).toFixed(2)}</td>
                </tr>
              ))}
              {detalle.movimientos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
                    Sin movimientos registrados todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardTitle>Historial de Acciones y Auditoría</CardTitle>
        <div className="mt-4 space-y-4">
          {detalle.historialCicloVida.map((e: EventoCicloVida) => (
            <div key={e.id} className="border-b border-black/5 pb-4 last:border-0">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-primary">{TIPO_EVENTO_LABEL[e.tipoEvento] ?? e.tipoEvento}</p>
                <p className="text-xs text-text-muted">
                  {formatearFecha(e.ejecutadoEn, undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <p className="text-sm text-text-muted">
                Ejecutado por: <span className="font-semibold text-text-primary">{e.ejecutadoPorNombre}</span>
                {e.motivo && (
                  <>
                    {" "}
                    · Motivo: {e.motivo}
                  </>
                )}
              </p>
            </div>
          ))}
          {detalle.historialCicloVida.length === 0 && (
            <p className="text-sm text-text-muted">Sin acciones registradas todavía.</p>
          )}
        </div>
      </Card>

      <Modal
        open={modalAjuste}
        onClose={() => setModalAjuste(false)}
        title="Ajuste manual de saldo"
        description={detalle.nombre}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalAjuste(false)} disabled={aplicando}>
              Cancelar
            </Button>
            <Button onClick={aplicarAjuste} disabled={aplicando}>
              {aplicando ? "Aplicando…" : "Aplicar ajuste"}
            </Button>
          </>
        }
      >
        <div className="rounded-lg bg-background p-3 text-sm">
          Saldo actual de la clínica: <span className="font-bold">USD {detalle.saldoUsd.toFixed(2)}</span>
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Monto del ajuste (USD)</label>
          <input
            type="number"
            step="0.01"
            value={montoAjuste}
            onChange={(e) => setMontoAjuste(e.target.value)}
            placeholder="0.00 (negativo para restar)"
            className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Motivo del ajuste (obligatorio)</label>
          <textarea
            value={motivoAjuste}
            onChange={(e) => setMotivoAjuste(e.target.value)}
            placeholder="Ej. Compensación por falla de API el día 14/08…"
            rows={3}
            className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div className="mt-4 rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Este ajuste queda registrado en el historial de movimientos, firmado por tu usuario.
        </div>
        {errorAjuste && <p className="mt-3 text-sm text-error">{errorAjuste}</p>}
      </Modal>

      <Modal
        open={accionAbierta === "suspender"}
        onClose={cerrarModalAccion}
        title={`Suspender clínica — ${detalle.nombre}`}
        footer={
          <>
            <Button variant="secondary" onClick={cerrarModalAccion} disabled={aplicandoAccion}>
              Cancelar
            </Button>
            <button
              onClick={aplicarAccion}
              disabled={aplicandoAccion}
              className="rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {aplicandoAccion ? "Aplicando…" : "Suspender clínica"}
            </button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          La suspensión suspende temporalmente los consumos y el crédito de IA asignado, pero mantiene intactos
          los expedientes y accesos básicos de lectura.
        </p>
        <div className="mt-4 rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Una suspensión manual no se levanta automáticamente con un cobro exitoso. Deberás reactivarla
          explícitamente desde este panel de control.
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Motivo de la suspensión</label>
          <textarea
            value={motivoAccion}
            onChange={(e) => setMotivoAccion(e.target.value)}
            placeholder="Ej. Incumplimiento de pago recurrente tras 3 intentos fallidos."
            rows={3}
            className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        {errorAccion && <p className="mt-3 text-sm text-error">{errorAccion}</p>}
      </Modal>

      <Modal
        open={accionAbierta === "reactivar"}
        onClose={cerrarModalAccion}
        title={`Reactivar clínica — ${detalle.nombre}`}
        footer={
          <>
            <Button variant="secondary" onClick={cerrarModalAccion} disabled={aplicandoAccion}>
              Cancelar
            </Button>
            <button
              onClick={aplicarAccion}
              disabled={aplicandoAccion}
              className="rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {aplicandoAccion ? "Aplicando…" : "Reactivar clínica"}
            </button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          La reactivación restablecerá de manera inmediata todos los permisos de consumo de IA y habilitará de
          nuevo a los médicos asociados.
        </p>
        <div className="mt-4 rounded-lg bg-success/10 p-3 text-sm text-success">
          La clínica volverá a contar con acceso total inmediato. Se le reasignará su cuota correspondiente al
          plan {detalle.plan}.
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Motivo de la reactivación</label>
          <textarea
            value={motivoAccion}
            onChange={(e) => setMotivoAccion(e.target.value)}
            placeholder="Ej. Pago regularizado de manera telefónica de forma manual."
            rows={3}
            className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        {errorAccion && <p className="mt-3 text-sm text-error">{errorAccion}</p>}
      </Modal>

      <Modal
        open={accionAbierta === "bloquear"}
        onClose={cerrarModalAccion}
        title={`Bloquear clínica — ${detalle.nombre}`}
        footer={
          <>
            <Button variant="secondary" onClick={cerrarModalAccion} disabled={aplicandoAccion}>
              Cancelar
            </Button>
            <button
              onClick={aplicarAccion}
              disabled={aplicandoAccion}
              className="rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {aplicandoAccion ? "Aplicando…" : "Bloquear clínica"}
            </button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          El bloqueo es una medida restrictiva crítica. Impide por completo el acceso a cualquier usuario de la
          clínica sin borrar datos históricos de la base.
        </p>
        <div className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error">
          <span className="font-bold">{detalle.usuariosActivos} usuario(s) quedarán sin acceso</span> de forma
          inmediata.
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Motivo del bloqueo de seguridad</label>
          <textarea
            value={motivoAccion}
            onChange={(e) => setMotivoAccion(e.target.value)}
            placeholder="Ej. Solicitud explícita de baja por cierre de la clínica."
            rows={3}
            className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        {errorAccion && <p className="mt-3 text-sm text-error">{errorAccion}</p>}
      </Modal>

      <Modal
        open={accionAbierta === "desbloquear"}
        onClose={cerrarModalAccion}
        title={`Desbloquear clínica — ${detalle.nombre}`}
        footer={
          <>
            <Button variant="secondary" onClick={cerrarModalAccion} disabled={aplicandoAccion}>
              Cancelar
            </Button>
            <Button onClick={aplicarAccion} disabled={aplicandoAccion}>
              {aplicandoAccion ? "Aplicando…" : "Desbloquear clínica"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          La clínica volverá al estado en que se encontraba antes del bloqueo. Esto no implica que vuelva a estado
          activa si estaba suspendida o morosa.
        </p>
        <div className="mt-4 rounded-lg bg-info/10 p-3 text-sm text-info">
          Se habilitará nuevamente la pantalla de login para sus médicos y personal administrativo.
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Motivo del desbloqueo</label>
          <textarea
            value={motivoAccion}
            onChange={(e) => setMotivoAccion(e.target.value)}
            placeholder="Ej. Contrato renovado y verificado por soporte."
            rows={3}
            className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        {errorAccion && <p className="mt-3 text-sm text-error">{errorAccion}</p>}
      </Modal>
    </div>
  );
}
