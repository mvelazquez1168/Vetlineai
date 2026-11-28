import { useEffect, useState } from "react";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";
import { useFormularioSucio } from "../../hooks/useFormularioSucio";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { ChecklistPais, DetallePais as DetallePaisData, platformAdminApi } from "../../lib/platformAdminApi";

// Prompt A (platform_admin_registro), Paso 6 — Detalle de País.

const CHECKLIST_ITEMS: { key: keyof ChecklistPais; titulo: string; detalle: string }[] = [
  { key: "pasarela", titulo: "Integración con pasarela local", detalle: "Requiere una pasarela de pago configurada." },
  { key: "impuestoVigente", titulo: "Configuración de impuesto de consumo", detalle: "Debe tener un impuesto vigente cargado." },
  { key: "proveedorFacturacion", titulo: "Sistema de comprobante electrónico", detalle: "Requiere un proveedor de facturación electrónica." },
  { key: "idioma", titulo: "Soporte multilingüe e interfaz", detalle: "El país debe tener un idioma por defecto." },
];

export function DetallePais() {
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const { codigo } = useParams<{ codigo: string }>();
  const navigate = useNavigate();
  const [detalle, setDetalle] = useState<DetallePaisData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [habilitando, setHabilitando] = useState(false);

  const [monedaLiquidacion, setMonedaLiquidacion] = useState("");
  const [pasarelaCodigo, setPasarelaCodigo] = useState("");
  const [proveedorFacturacion, setProveedorFacturacion] = useState("");
  const [guardandoConfig, setGuardandoConfig] = useState(false);

  const [modalImpuesto, setModalImpuesto] = useState(false);
  const [impuestoNombre, setImpuestoNombre] = useState("");
  const [impuestoTasa, setImpuestoTasa] = useState("");

  const [modalTipo, setModalTipo] = useState(false);
  const [tipoCodigo, setTipoCodigo] = useState("");
  const [tipoEtiqueta, setTipoEtiqueta] = useState("");
  const [tipoFisica, setTipoFisica] = useState(true);
  const [tipoJuridica, setTipoJuridica] = useState(false);

  // agentes_paises_v2, Paso 4 — inactivar país (transición inversa de
  // habilitado a no_disponible/lista_espera). Se agrega sobre la pantalla
  // editable existente, sin tocar el resto (decisión explícita).
  const [modalInactivar, setModalInactivar] = useState(false);
  const [estadoDestino, setEstadoDestino] = useState<"no_disponible" | "lista_espera">("no_disponible");
  const [motivoInactivar, setMotivoInactivar] = useState("");
  const [inactivando, setInactivando] = useState(false);

  const cargar = () => {
    if (!codigo) return;
    setIsLoading(true);
    platformAdminApi
      .obtenerDetallePais(codigo)
      .then((d) => {
        setDetalle(d);
        setMonedaLiquidacion(d.pais.monedaLiquidacion ?? "");
        setPasarelaCodigo(d.pais.pasarelaCodigo ?? "");
        setProveedorFacturacion(d.pais.proveedorFacturacion ?? "");
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, [codigo]);

  const guardarConfig = async () => {
    if (!codigo) return;
    setGuardandoConfig(true);
    try {
      await platformAdminApi.actualizarPais(codigo, {
        monedaLiquidacion: monedaLiquidacion || undefined,
        pasarelaCodigo: pasarelaCodigo || undefined,
        proveedorFacturacion: proveedorFacturacion || undefined,
      });
      cargar();
    } finally {
      setGuardandoConfig(false);
    }
  };

  const crearImpuesto = async () => {
    if (!codigo) return;
    const tasa = Number(impuestoTasa);
    if (!impuestoNombre.trim() || !Number.isFinite(tasa) || tasa < 0) return;
    await platformAdminApi.crearImpuestoPais(codigo, { nombre: impuestoNombre.trim(), tasa });
    setModalImpuesto(false);
    setImpuestoNombre("");
    setImpuestoTasa("");
    cargar();
  };

  const crearTipoIdentificacion = async () => {
    if (!codigo) return;
    if (!tipoCodigo.trim() || !tipoEtiqueta.trim() || (!tipoFisica && !tipoJuridica)) return;
    await platformAdminApi.crearTipoIdentificacion(codigo, {
      codigo: tipoCodigo.trim(),
      etiqueta: tipoEtiqueta.trim(),
      aplicaPersonaFisica: tipoFisica,
      aplicaPersonaJuridica: tipoJuridica,
    });
    setModalTipo(false);
    setTipoCodigo("");
    setTipoEtiqueta("");
    setTipoFisica(true);
    setTipoJuridica(false);
    cargar();
  };

  const alternarActivo = async (id: string, activo: boolean) => {
    await platformAdminApi.actualizarTipoIdentificacion(id, { activo: !activo });
    cargar();
  };

  const habilitarPais = async () => {
    if (!codigo) return;
    setHabilitando(true);
    setError(null);
    try {
      await platformAdminApi.cambiarEstadoPais(codigo, "habilitado");
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo habilitar el país.");
    } finally {
      setHabilitando(false);
    }
  };

  const confirmarInactivar = async () => {
    if (!codigo) return;
    setInactivando(true);
    setError(null);
    try {
      await platformAdminApi.cambiarEstadoPais(codigo, estadoDestino, motivoInactivar.trim() || undefined);
      setModalInactivar(false);
      setMotivoInactivar("");
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo inactivar el país.");
    } finally {
      setInactivando(false);
    }
  };

  if (isLoading || !detalle) return <p className="text-text-muted">Cargando…</p>;

  const checklistCompleto = Object.values(detalle.checklist).every(Boolean);

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>}>
      {dialogoSalida}
      <button onClick={() => navigate("/platform-admin/paises")} className="text-sm font-medium text-accent hover:underline">
        ← Volver
      </button>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-primary">Requisitos de {detalle.pais.nombre}</h1>
          <Badge variant={detalle.pais.estado === "habilitado" ? "success" : "warning"}>
            {detalle.pais.estado === "habilitado" ? "Habilitado" : detalle.pais.estado === "lista_espera" ? "En espera" : "No disponible"}
          </Badge>
        </div>
        {detalle.pais.estado !== "habilitado" && (
          <Button onClick={habilitarPais} disabled={!checklistCompleto || habilitando}>
            {habilitando ? "Habilitando…" : "Habilitar país"}
          </Button>
        )}
        {detalle.pais.estado === "habilitado" && (
          <Button variant="danger" onClick={() => setModalInactivar(true)}>
            Inactivar país
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
      {detalle.pais.estado !== "habilitado" && detalle.pais.motivoInactivacion && (
        <p className="mt-2 text-sm text-text-muted">Motivo de la inactivación: {detalle.pais.motivoInactivacion}</p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Clínicas registradas</p>
          <p className="mt-1 text-3xl font-bold text-primary">{detalle.clinicas.total}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">En prueba gratuita</p>
          <p className="mt-1 text-3xl font-bold text-primary">{detalle.clinicas.enPrueba} clínicas activas</p>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Checklist de habilitación</CardTitle>
          <div className="mt-4 space-y-4">
            {CHECKLIST_ITEMS.map((item) => (
              <div key={item.key} className="flex items-start gap-3">
                <span className={["mt-0.5 text-lg", detalle.checklist[item.key] ? "text-success" : "text-warning"].join(" ")}>
                  {detalle.checklist[item.key] ? "✓" : "○"}
                </span>
                <div>
                  <p className="font-semibold text-text-primary">{item.titulo}</p>
                  <p className="text-sm text-text-muted">
                    Estado: <span className="font-semibold">{detalle.checklist[item.key] ? "COMPLETADO" : "PENDIENTE"}</span> — {item.detalle}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 space-y-3 border-t border-black/5 pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Código de pasarela</label>
              <input
                value={pasarelaCodigo}
                onChange={(e) => setPasarelaCodigo(e.target.value)}
                placeholder="ej. tilopay"
                className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Proveedor de facturación electrónica</label>
              <input
                value={proveedorFacturacion}
                onChange={(e) => setProveedorFacturacion(e.target.value)}
                placeholder="ej. hacienda"
                className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Moneda de liquidación</label>
              <input
                value={monedaLiquidacion}
                onChange={(e) => setMonedaLiquidacion(e.target.value.toUpperCase())}
                placeholder="ej. CRC"
                maxLength={3}
                className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <Button variant="secondary" onClick={guardarConfig} disabled={guardandoConfig}>
              {guardandoConfig ? "Guardando…" : "Guardar configuración"}
            </Button>
          </div>

          <div className="mt-6 border-t border-black/5 pt-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-text-primary">Impuesto vigente</p>
              <Button variant="secondary" onClick={() => setModalImpuesto(true)}>
                Nuevo impuesto
              </Button>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {detalle.pais.impuesto
                ? `${detalle.pais.impuesto.nombre} — ${(detalle.pais.impuesto.tasa * 100).toFixed(2)}%`
                : "Sin impuesto vigente cargado."}
            </p>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Tipos de identificación</CardTitle>
            <Button variant="secondary" onClick={() => setModalTipo(true)}>
              Agregar
            </Button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-black/5">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-background/60">
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Identificación</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Tipo persona</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Estado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {detalle.tiposIdentificacion.map((t) => (
                  <tr key={t.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 font-semibold text-text-primary">{t.etiqueta}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {t.aplicaPersonaFisica && t.aplicaPersonaJuridica
                        ? "Física o Jurídica"
                        : t.aplicaPersonaFisica
                        ? "Física"
                        : "Jurídica"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={t.activo ? "success" : "neutral"}>{t.activo ? "Activo" : "Inactivo"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-sm text-accent hover:underline" onClick={() => alternarActivo(t.id, t.activo)}>
                        {t.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                ))}
                {detalle.tiposIdentificacion.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-text-muted">
                      Todavía no hay tipos de identificación cargados para este país.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Modal
        open={modalImpuesto}
        onClose={() => setModalImpuesto(false)}
        title="Nuevo impuesto vigente"
        description="Cierra el impuesto vigente actual (si hay) y crea uno nuevo — nunca se edita uno existente."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalImpuesto(false)}>
              Cancelar
            </Button>
            <Button onClick={crearImpuesto}>Crear impuesto</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Nombre</label>
            <input
              value={impuestoNombre}
              onChange={(e) => setImpuestoNombre(e.target.value)}
              placeholder="ej. IVA"
              className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Tasa (ej. 0.13 para 13%)</label>
            <input
              type="number"
              min={0}
              step="0.0001"
              value={impuestoTasa}
              onChange={(e) => setImpuestoTasa(e.target.value)}
              className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={modalTipo}
        onClose={() => setModalTipo(false)}
        title="Nuevo tipo de identificación"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalTipo(false)}>
              Cancelar
            </Button>
            <Button onClick={crearTipoIdentificacion}>Agregar</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Código</label>
            <input
              value={tipoCodigo}
              onChange={(e) => setTipoCodigo(e.target.value)}
              placeholder="ej. 01"
              className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Etiqueta</label>
            <input
              value={tipoEtiqueta}
              onChange={(e) => setTipoEtiqueta(e.target.value)}
              placeholder="ej. Cédula de identidad"
              className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tipoFisica} onChange={(e) => setTipoFisica(e.target.checked)} />
              Persona física
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tipoJuridica} onChange={(e) => setTipoJuridica(e.target.checked)} />
              Persona jurídica
            </label>
          </div>
        </div>
      </Modal>

      <Link to="/platform-admin/paises" className="mt-6 block text-sm text-text-muted hover:underline">
        Ver todos los países
      </Link>

      <Modal
        open={modalInactivar}
        onClose={() => setModalInactivar(false)}
        title={`Inactivar ${detalle.pais.nombre}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalInactivar(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmarInactivar} disabled={inactivando}>
              {inactivando ? "Inactivando…" : "Inactivar país"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            {detalle.clinicas.total} {detalle.clinicas.total === 1 ? "clínica" : "clínicas"} operan hoy en{" "}
            {detalle.pais.nombre}. Van a seguir operando y facturando con normalidad — esto solo bloquea altas
            nuevas.
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Nuevo estado</label>
            <select
              value={estadoDestino}
              onChange={(e) => setEstadoDestino(e.target.value as "no_disponible" | "lista_espera")}
              className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
            >
              <option value="no_disponible">No disponible</option>
              <option value="lista_espera">Lista de espera</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Motivo (opcional, para auditoría)</label>
            <textarea
              className="rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
              rows={3}
              value={motivoInactivar}
              onChange={(e) => setMotivoInactivar(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
