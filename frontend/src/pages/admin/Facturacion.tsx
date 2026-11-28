import { PageHeader } from "../../components/ui";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";
import { useFormularioSucio } from "../../hooks/useFormularioSucio";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { useAuth } from "../../hooks/useAuth";
import { adminApi, Cobro, DatosFiscales, TipoIdentificacion } from "../../lib/adminApi";
import { ApiError } from "../../lib/apiError";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { Pais, paisesApi } from "../../lib/paisesApi";
import { MetodoPago, pagosApi } from "../../lib/pagosApi";

// Implementación de pantallas, prompt 2, paso 5 — Facturación en modo
// lectura. Reemplaza la pantalla anterior (basada en Stripe: cupos,
// consumo de IA, límite propio y cambio de plan), que quedó obsoleta con
// el motor de crédito nuevo — esas 3 primeras cosas ahora viven en "Plan
// y consumo"/"Cambiar plan". El límite de uso configurable
// (limite_usd_configurado / limite_accion) no tiene lugar en el nuevo
// diseño, tal como lo especifica el prompt; el backend que lo aplica
// (debeBloquearseMensaje en usoIa.ts) queda intacto pero sin UI para
// configurarlo — se reporta como decisión de alcance, no como bug.

const ESTADO_COBRO_BADGE: Record<Cobro["estado"], { variant: BadgeVariant; label: string }> = {
  exitoso: { variant: "success", label: "Pagado" },
  pendiente: { variant: "warning", label: "Pendiente" },
  fallido: { variant: "error", label: "Fallido" },
};

export function Facturacion({
  /**
   * Para dibujarla DENTRO de una pestaña (punto 6 del 2026-11-27).
   *
   * El encabezado lo pone el contenedor; repetirlo acá daría dos
   * títulos. Suelta, en su URL vieja, sigue trayendo el suyo.
   */
  sinEncabezado,
}: { sinEncabezado?: boolean } = {}) {
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const { zonaHoraria } = useAuth();
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [isLoadingCobros, setIsLoadingCobros] = useState(true);

  const [datosFiscales, setDatosFiscales] = useState<DatosFiscales | null>(null);
  const [tipos, setTipos] = useState<TipoIdentificacion[]>([]);
  const [isLoadingFiscal, setIsLoadingFiscal] = useState(true);

  const [nombreFiscal, setNombreFiscal] = useState("");
  // País y tipo de persona quedan fijos desde el registro (Prompt B) — se
  // muestran de solo lectura, no se editan desde este panel.
  const [tipoPersona, setTipoPersona] = useState<"fisica" | "juridica">("fisica");
  const [paisCodigo, setPaisCodigo] = useState<string | null>(null);
  const [paises, setPaises] = useState<Pais[]>([]);
  const [tipoIdentificacionId, setTipoIdentificacionId] = useState<string>("");
  const [numeroIdentificacion, setNumeroIdentificacion] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const [metodoPago, setMetodoPago] = useState<MetodoPago | null>(null);

  useEffect(() => {
    adminApi
      .listarCobros()
      .then((r) => setCobros(r.cobros))
      .finally(() => setIsLoadingCobros(false));

    paisesApi.listar().then((r) => setPaises(r.paises));

    pagosApi.obtenerMetodoPago().then((r) => setMetodoPago(r.metodo));

    adminApi
      .obtenerDatosFiscales()
      .then((r) => {
        const d = r.datosFiscales;
        setDatosFiscales(d);
        if (d) {
          setNombreFiscal(d.nombre_fiscal ?? "");
          setTipoPersona(d.tipo_persona ?? "fisica");
          setPaisCodigo(d.pais_codigo);
          setTipoIdentificacionId(d.tipo_identificacion_id ?? "");
          setNumeroIdentificacion(d.numero_identificacion ?? "");
        }
      })
      .finally(() => setIsLoadingFiscal(false));
  }, []);

  useEffect(() => {
    if (!paisCodigo) {
      setTipos([]);
      return;
    }
    adminApi.listarTiposIdentificacion(paisCodigo, tipoPersona).then((r) => setTipos(r.tipos));
  }, [paisCodigo, tipoPersona]);

  const nombrePais = paises.find((p) => p.codigo_iso === paisCodigo)?.nombre ?? paisCodigo ?? "—";

  const guardarDatosFiscales = async () => {
    setGuardando(true);
    setGuardado(false);
    setErrorGuardar(null);
    try {
      const r = await adminApi.actualizarDatosFiscales({
        nombreFiscal: nombreFiscal.trim() || undefined,
        tipoIdentificacionId: tipoIdentificacionId || undefined,
        numeroIdentificacion: numeroIdentificacion.trim() || undefined,
      });
      setDatosFiscales(r.datosFiscales);
      setGuardado(true);
    } catch (err) {
      setErrorGuardar(err instanceof ApiError ? err.message : "No pudimos guardar los datos fiscales.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>}>
      {dialogoSalida}
      {!sinEncabezado && (
        <PageHeader
          titulo="Facturación"
          subtitulo="Historial de cobros y datos de facturación de tu clínica."
          icono="comprobante"
          modulo="admin"
        />
      )}

      <Card className="mt-6">
        <CardTitle>Historial de cobros</CardTitle>
        {isLoadingCobros ? (
          <p className="mt-4 text-sm text-text-muted">Cargando…</p>
        ) : (
          <div className="mt-4">
            <Table
              columns={[
                { key: "fecha", header: "Fecha", render: (c: Cobro) => formatearFechaCorta(c.fecha, zonaHoraria) },
                { key: "concepto", header: "Concepto", render: (c: Cobro) => c.concepto },
                {
                  key: "monto",
                  header: "Monto",
                  render: (c: Cobro) => `${c.moneda} ${c.montoUsd.toFixed(2)}`,
                },
                {
                  key: "estado",
                  header: "Estado",
                  render: (c: Cobro) => {
                    const info = ESTADO_COBRO_BADGE[c.estado];
                    return (
                      <Badge variant={info.variant} dot>
                        {info.label}
                      </Badge>
                    );
                  },
                },
                {
                  key: "comprobante",
                  header: "Comprobante",
                  render: (c: Cobro) =>
                    c.comprobante ? (
                      <span className="text-text-muted">
                        {c.comprobante.numero} ({c.comprobante.estado})
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    ),
                },
              ]}
              data={cobros}
              rowKey={(c) => c.id}
              emptyMessage="Todavía no hay cobros registrados para esta clínica."
            />
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Medio de pago</CardTitle>
            <p className="mt-1 text-sm text-text-muted">
              {metodoPago
                ? `${metodoPago.marca} •••• ${metodoPago.ultimos4} — vence ${String(metodoPago.vencimientoMes).padStart(2, "0")}/${metodoPago.vencimientoAnio}`
                : "No tiene un medio de pago registrado."}
            </p>
          </div>
          <Link to="/admin/facturacion/medio-de-pago">
            <Button variant="secondary">{metodoPago ? "Cambiar" : "Agregar"}</Button>
          </Link>
        </div>
      </Card>

      <Card className="mt-6">
        <CardTitle>Datos de facturación</CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          Se usan para emitir el comprobante fiscal de tus cobros.
        </p>

        {isLoadingFiscal ? (
          <p className="mt-4 text-sm text-text-muted">Cargando…</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-sm font-semibold text-text-primary">Nombre fiscal / razón social</label>
              <input
                value={nombreFiscal}
                onChange={(e) => setNombreFiscal(e.target.value)}
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Tipo de persona</label>
              <p className="rounded-lg border border-black/10 bg-background/60 px-4 py-2.5 text-sm text-text-muted">
                {tipoPersona === "juridica" ? "Persona jurídica" : "Persona física"}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">País</label>
              <p className="rounded-lg border border-black/10 bg-background/60 px-4 py-2.5 text-sm text-text-muted">
                {nombrePais}
              </p>
            </div>

            <p className="text-xs text-text-muted sm:col-span-2">
              El país y el tipo de persona se fijan en el registro. Para cambiarlos, contacte a soporte.
            </p>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Tipo de identificación</label>
              <select
                value={tipoIdentificacionId}
                onChange={(e) => setTipoIdentificacionId(e.target.value)}
                disabled={!paisCodigo || tipos.length === 0}
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
              >
                <option value="">Seleccioná…</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Número de identificación</label>
              <input
                value={numeroIdentificacion}
                onChange={(e) => setNumeroIdentificacion(e.target.value)}
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>
        )}

        {errorGuardar && <p className="mt-4 text-sm text-error">{errorGuardar}</p>}

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={guardarDatosFiscales} disabled={guardando || isLoadingFiscal}>
            {guardando ? "Guardando…" : "Guardar datos fiscales"}
          </Button>
          {guardado && !guardando && <span className="text-sm font-semibold text-success">Guardado.</span>}
        </div>
      </Card>
    </div>
  );
}
