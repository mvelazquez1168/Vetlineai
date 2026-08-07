import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ClinicaCombobox } from "../../components/ui/ClinicaCombobox";
import { FiltroBar } from "../../components/ui/FiltroBar";
import { Modal } from "../../components/ui/Modal";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { Table, TableColumn } from "../../components/ui/Table";
import { formatearFechaCorta } from "../../lib/formatFecha";
import {
  CancelacionFila,
  FacturaFila,
  NuevaClinicaFila,
  PagoFila,
  platformAdminApi,
  UsoIaClinica,
} from "../../lib/platformAdminApi";

const TABS = [
  { id: "uso-ia", label: "Uso de IA" },
  { id: "facturas", label: "Facturas" },
  { id: "pagos", label: "Pagos" },
  { id: "cancelaciones", label: "Cancelaciones" },
  { id: "nuevas-clinicas", label: "Nuevas Clínicas" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function fecha(valor: string) {
  return formatearFechaCorta(valor, undefined);
}

// ---------------------------------------------------------------------
// Paginador compartido — mismo patrón que ya usaba Auditoria.tsx.
// ---------------------------------------------------------------------
function Paginador({
  total,
  pagina,
  totalPaginas,
  porPagina,
  onCambiar,
}: {
  total: number;
  pagina: number;
  totalPaginas: number;
  porPagina: number;
  onCambiar: (pagina: number) => void;
}) {
  if (total === 0) return null;
  const desde = (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  return (
    <div className="mt-4 flex items-center justify-between">
      <p className="text-sm text-text-muted">
        Mostrando {desde}–{hasta} de {total}
      </p>
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => onCambiar(Math.max(1, pagina - 1))} disabled={pagina <= 1}>
          Anterior
        </Button>
        <span className="text-sm text-text-muted">
          Página {pagina} de {totalPaginas}
        </span>
        <Button
          variant="secondary"
          onClick={() => onCambiar(Math.min(totalPaginas, pagina + 1))}
          disabled={pagina >= totalPaginas}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Modal "Facturar manualmente" — disponible desde cualquier pestaña.
// ---------------------------------------------------------------------
function FacturarManualmenteModal({
  open,
  onClose,
  onEmitida,
}: {
  open: boolean;
  onClose: () => void;
  onEmitida: () => void;
}) {
  const [tenantId, setTenantId] = useState("");
  const [concepto, setConcepto] = useState("");
  const [montoUsd, setMontoUsd] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTenantId("");
      setConcepto("");
      setMontoUsd("");
      setError(null);
    }
  }, [open]);

  const emitir = async () => {
    const monto = Number(montoUsd);
    if (!tenantId || !concepto.trim() || !monto || monto <= 0) {
      setError("Completá clínica, concepto y un monto mayor a 0.");
      return;
    }
    setProcesando(true);
    setError(null);
    try {
      await platformAdminApi.facturarManualmente({ tenantId, concepto: concepto.trim(), montoUsd: monto });
      onEmitida();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "No pudimos emitir la factura.");
    } finally {
      setProcesando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Facturar manualmente"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={emitir} disabled={procesando}>
            {procesando ? "Emitiendo…" : "Emitir factura"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ClinicaCombobox label="Clínica" value={tenantId} onChange={(id) => setTenantId(id)} />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Concepto</label>
          <input
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder="Descripción del cobro"
            className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Monto (USD)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={montoUsd}
            onChange={(e) => setMontoUsd(e.target.value)}
            placeholder="$0.00"
            className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <p className="text-sm text-text-muted">
          Esta factura es de cobro único, no genera cargos recurrentes.
        </p>
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Uso de IA — sin cambios de comportamiento respecto a la versión previa,
// solo movida a su propio componente para convivir con las otras 4 pestañas.
// ---------------------------------------------------------------------
function UsoIaTab() {
  const [clinicas, setClinicas] = useState<UsoIaClinica[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    platformAdminApi
      .listarUsoIa()
      .then((data) => setClinicas(data.clinicas))
      .finally(() => setIsLoading(false));
  }, []);

  const columns: TableColumn<UsoIaClinica>[] = [
    {
      key: "clinica",
      header: "Clínica",
      render: (c) => (
        <div>
          <p className="font-semibold text-primary">{c.tenantNombre}</p>
          <p className="text-xs text-text-muted">{c.planNombre ?? "Sin plan"}</p>
        </div>
      ),
    },
    {
      key: "consumo",
      header: "Consumo del ciclo",
      render: (c) => (
        <div className="min-w-[160px]">
          <p className="text-sm font-semibold text-text-primary">
            ${c.montoUsado.toFixed(2)}
            {c.presupuestoUsdIncluido != null && ` / $${c.presupuestoUsdIncluido.toFixed(2)}`}
          </p>
          {c.porcentajePresupuesto != null && (
            <ProgressBar value={Math.min(c.porcentajePresupuesto, 100)} className="mt-1.5" />
          )}
        </div>
      ),
    },
    {
      key: "porcentaje",
      header: "% Presupuesto",
      render: (c) => (
        <span
          className={
            c.porcentajePresupuesto != null && c.porcentajePresupuesto >= 100
              ? "font-bold text-error"
              : c.porcentajePresupuesto != null && c.porcentajePresupuesto >= 80
                ? "font-bold text-warning"
                : "text-text-primary"
          }
        >
          {c.porcentajePresupuesto != null ? `${c.porcentajePresupuesto}%` : "—"}
        </span>
      ),
    },
    {
      key: "limite",
      header: "Límite propio",
      render: (c) =>
        c.limiteUsdConfigurado != null ? (
          `$${c.limiteUsdConfigurado.toFixed(2)}`
        ) : (
          <span className="text-text-muted">Sin límite</span>
        ),
    },
    {
      key: "comportamiento",
      header: "Comportamiento",
      render: (c) => (
        <Badge variant={c.limiteAccion === "bloquear" ? "warning" : "info"}>
          {c.limiteAccion === "bloquear" ? "Bloquear" : "Solo notificar"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mt-6">
      {isLoading ? (
        <p className="text-text-muted">Cargando…</p>
      ) : (
        <Table columns={columns} data={clinicas} rowKey={(c) => c.tenantId} emptyMessage="No hay clínicas para mostrar." />
      )}
    </div>
  );
}

const POR_PAGINA = 5;

// ---------------------------------------------------------------------
// Facturas
// ---------------------------------------------------------------------
function FacturasTab({ recargarSenal }: { recargarSenal: number }) {
  const [resumen, setResumen] = useState<{ ingresosEsteMes: number; facturasEmitidas30d: number; facturasPendientes: number } | null>(null);
  const [filas, setFilas] = useState<FacturaFila[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [q, setQ] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroOrigen, setFiltroOrigen] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    platformAdminApi.obtenerResumenFacturas().then(setResumen);
  }, [recargarSenal]);

  useEffect(() => {
    setIsLoading(true);
    platformAdminApi
      .listarFacturas({ desde, hasta, q, estado: filtroEstado || undefined, origen: filtroOrigen || undefined, pagina })
      .then((data) => {
        setFilas(data.facturas);
        setTotal(data.total);
        setTotalPaginas(data.totalPaginas);
      })
      .finally(() => setIsLoading(false));
  }, [desde, hasta, q, filtroEstado, filtroOrigen, pagina, recargarSenal]);

  const columns: TableColumn<FacturaFila>[] = [
    { key: "clinica", header: "Clínica", render: (f) => <span className="font-semibold text-primary">{f.clinica}</span> },
    { key: "concepto", header: "Concepto", render: (f) => f.concepto ?? "—" },
    { key: "monto", header: "Monto", render: (f) => `$${f.monto.toFixed(2)}` },
    { key: "fecha", header: "Fecha", render: (f) => fecha(f.fecha) },
    {
      key: "estado",
      header: "Estado",
      render: (f) => <Badge variant={f.estado === "pagada" ? "success" : "warning"}>{f.estado === "pagada" ? "Pagada" : "Pendiente"}</Badge>,
    },
    {
      key: "origen",
      header: "Origen",
      render: (f) => <Badge variant={f.origen === "manual" ? "info" : "neutral"}>{f.origen === "manual" ? "Manual" : "Automática"}</Badge>,
    },
  ];

  return (
    <div className="mt-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-primary">${(resumen?.ingresosEsteMes ?? 0).toLocaleString()}</p>
          <p className="mt-1 text-sm text-text-muted">Ingresos este mes</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-primary">{resumen?.facturasEmitidas30d ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">Facturas emitidas (30 días)</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-warning">{resumen?.facturasPendientes ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">Facturas pendientes</p>
        </div>
      </div>

      <FiltroBar
        desde={desde}
        hasta={hasta}
        onDesde={(v) => { setDesde(v); setPagina(1); }}
        onHasta={(v) => { setHasta(v); setPagina(1); }}
        busqueda={q}
        onBusqueda={(v) => { setQ(v); setPagina(1); }}
        placeholderBusqueda="Buscar clínica o concepto…"
        selects={[
          {
            value: filtroEstado,
            onChange: (v) => { setFiltroEstado(v); setPagina(1); },
            opciones: [
              { value: "", label: "Estado: Todos" },
              { value: "pagada", label: "Pagada" },
              { value: "pendiente", label: "Pendiente" },
            ],
          },
          {
            value: filtroOrigen,
            onChange: (v) => { setFiltroOrigen(v); setPagina(1); },
            opciones: [
              { value: "", label: "Origen: Todos" },
              { value: "manual", label: "Manual" },
              { value: "automatica", label: "Automática" },
            ],
          },
        ]}
      />

      <div className="mt-6">
        {isLoading ? <p className="text-text-muted">Cargando…</p> : <Table columns={columns} data={filas} rowKey={(f) => f.id} emptyMessage="No hay facturas para mostrar." />}
      </div>
      <Paginador total={total} pagina={pagina} totalPaginas={totalPaginas} porPagina={POR_PAGINA} onCambiar={setPagina} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------
function PagosTab() {
  const [resumen, setResumen] = useState<{ pagosExitosos30d: number; montoTotalCobrado30d: number; pagosFallidos30d: number } | null>(null);
  const [filas, setFilas] = useState<PagoFila[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [q, setQ] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    platformAdminApi.obtenerResumenPagos().then(setResumen);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    platformAdminApi
      .listarPagos({ desde, hasta, q, pagina })
      .then((data) => {
        setFilas(data.pagos);
        setTotal(data.total);
        setTotalPaginas(data.totalPaginas);
      })
      .finally(() => setIsLoading(false));
  }, [desde, hasta, q, pagina]);

  const columns: TableColumn<PagoFila>[] = [
    { key: "clinica", header: "Clínica", render: (p) => <span className="font-semibold text-primary">{p.clinica}</span> },
    { key: "monto", header: "Monto", render: (p) => `$${p.monto.toFixed(2)}` },
    { key: "fecha", header: "Fecha", render: (p) => fecha(p.fecha) },
    { key: "plan", header: "Plan", render: (p) => p.plan ?? "—" },
  ];

  return (
    <div className="mt-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-primary">{resumen?.pagosExitosos30d ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">Pagos exitosos (30 días)</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-primary">${(resumen?.montoTotalCobrado30d ?? 0).toLocaleString()}</p>
          <p className="mt-1 text-sm text-text-muted">Monto total cobrado (30 días)</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-error">{resumen?.pagosFallidos30d ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">Pagos fallidos (30 días)</p>
        </div>
      </div>

      <FiltroBar
        desde={desde}
        hasta={hasta}
        onDesde={(v) => { setDesde(v); setPagina(1); }}
        onHasta={(v) => { setHasta(v); setPagina(1); }}
        busqueda={q}
        onBusqueda={(v) => { setQ(v); setPagina(1); }}
        placeholderBusqueda="Buscar clínica…"
      />

      <div className="mt-6">
        {isLoading ? <p className="text-text-muted">Cargando…</p> : <Table columns={columns} data={filas} rowKey={(p) => p.id} emptyMessage="No hay pagos para mostrar." />}
      </div>
      <Paginador total={total} pagina={pagina} totalPaginas={totalPaginas} porPagina={POR_PAGINA} onCambiar={setPagina} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Cancelaciones
// ---------------------------------------------------------------------
function CancelacionesTab() {
  const [resumen, setResumen] = useState<{ cancelacionesPendientes: number; cancelacionesCompletadas30d: number; tasaCancelacionMes: number } | null>(null);
  const [filas, setFilas] = useState<CancelacionFila[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    platformAdminApi.obtenerResumenCancelaciones().then(setResumen);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    platformAdminApi
      .listarCancelaciones({ q, estado: filtroEstado || undefined, pagina })
      .then((data) => {
        setFilas(data.cancelaciones);
        setTotal(data.total);
        setTotalPaginas(data.totalPaginas);
      })
      .finally(() => setIsLoading(false));
  }, [q, filtroEstado, pagina]);

  const columns: TableColumn<CancelacionFila>[] = [
    { key: "clinica", header: "Clínica", render: (c) => <span className="font-semibold text-primary">{c.clinica}</span> },
    { key: "fechaSolicitud", header: "Fecha de solicitud", render: (c) => (c.fechaSolicitud ? fecha(c.fechaSolicitud) : "—") },
    { key: "fechaEfectiva", header: "Fecha efectiva", render: (c) => (c.fechaEfectiva ? fecha(c.fechaEfectiva) : "—") },
    {
      key: "estado",
      header: "Estado",
      render: (c) => <Badge variant={c.estado === "completada" ? "success" : "warning"}>{c.estado === "completada" ? "Completada" : "Pendiente"}</Badge>,
    },
  ];

  return (
    <div className="mt-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-primary">{resumen?.cancelacionesPendientes ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">Cancelaciones pendientes</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-primary">{resumen?.cancelacionesCompletadas30d ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">Cancelaciones completadas (30 días)</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-error">{resumen?.tasaCancelacionMes ?? 0}%</p>
          <p className="mt-1 text-sm text-text-muted">Tasa de cancelación del mes</p>
        </div>
      </div>

      <FiltroBar
        busqueda={q}
        onBusqueda={(v) => { setQ(v); setPagina(1); }}
        placeholderBusqueda="Buscar clínica…"
        selects={[
          {
            value: filtroEstado,
            onChange: (v) => { setFiltroEstado(v); setPagina(1); },
            opciones: [
              { value: "", label: "Estado: Todos" },
              { value: "pendiente", label: "Pendiente" },
              { value: "completada", label: "Completada" },
            ],
          },
        ]}
      />

      <div className="mt-6">
        {isLoading ? <p className="text-text-muted">Cargando…</p> : <Table columns={columns} data={filas} rowKey={(c) => c.id} emptyMessage="No hay cancelaciones para mostrar." />}
      </div>
      <Paginador total={total} pagina={pagina} totalPaginas={totalPaginas} porPagina={POR_PAGINA} onCambiar={setPagina} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Nuevas Clínicas
// ---------------------------------------------------------------------
const ESTADO_BADGE: Record<string, "success" | "warning" | "neutral"> = {
  trial: "warning",
  activa: "success",
  suspendida: "warning",
  cancelada: "neutral",
  trial_expirado: "neutral",
};

const ESTADO_LABEL: Record<string, string> = {
  trial: "Trial",
  activa: "Activa",
  suspendida: "Suspendida",
  cancelada: "Cancelada",
  trial_expirado: "Trial vencido",
};

function NuevasClinicasTab() {
  const [resumen, setResumen] = useState<{ clinicasNuevas30d: number; enPeriodoDePrueba: number; convertidasAPago30d: number } | null>(null);
  const [filas, setFilas] = useState<NuevaClinicaFila[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    platformAdminApi.obtenerResumenNuevasClinicas().then(setResumen);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    platformAdminApi
      .listarNuevasClinicas({ q, pagina })
      .then((data) => {
        setFilas(data.clinicas);
        setTotal(data.total);
        setTotalPaginas(data.totalPaginas);
      })
      .finally(() => setIsLoading(false));
  }, [q, pagina]);

  const columns: TableColumn<NuevaClinicaFila>[] = [
    { key: "nombre", header: "Nombre de clínica", render: (c) => <span className="font-semibold text-primary">{c.nombre}</span> },
    { key: "pais", header: "País", render: (c) => c.pais ?? "—" },
    { key: "fechaRegistro", header: "Fecha de registro", render: (c) => fecha(c.fechaRegistro) },
    {
      key: "estado",
      header: "Estado",
      render: (c) => <Badge variant={ESTADO_BADGE[c.estado] ?? "neutral"}>{ESTADO_LABEL[c.estado] ?? c.estado}</Badge>,
    },
    { key: "plan", header: "Plan actual", render: (c) => c.plan ?? "—" },
  ];

  return (
    <div className="mt-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-primary">{resumen?.clinicasNuevas30d ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">Clínicas nuevas (30 días)</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-primary">{resumen?.enPeriodoDePrueba ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">En período de prueba</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-surface p-6">
          <p className="text-3xl font-bold text-success">{resumen?.convertidasAPago30d ?? 0}</p>
          <p className="mt-1 text-sm text-text-muted">Convertidas a plan pago (30 días)</p>
        </div>
      </div>

      <FiltroBar busqueda={q} onBusqueda={(v) => { setQ(v); setPagina(1); }} placeholderBusqueda="Buscar clínica…" />

      <div className="mt-6">
        {isLoading ? <p className="text-text-muted">Cargando…</p> : <Table columns={columns} data={filas} rowKey={(c) => c.id} emptyMessage="No hay clínicas para mostrar." />}
      </div>
      <Paginador total={total} pagina={pagina} totalPaginas={totalPaginas} porPagina={POR_PAGINA} onCambiar={setPagina} />
    </div>
  );
}

export function Facturacion() {
  const [tabActiva, setTabActiva] = useState<TabId>("uso-ia");
  const [modalFacturar, setModalFacturar] = useState(false);
  const [recargarSenal, setRecargarSenal] = useState(0);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Facturación</h1>
          <p className="mt-1 text-text-muted">Facturación, pagos, y uso de recursos de IA de todas las clínicas.</p>
        </div>
        <Button onClick={() => setModalFacturar(true)}>+ Facturar manualmente</Button>
      </div>

      <div className="mt-6 flex gap-1 border-b border-black/10">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTabActiva(tab.id)}
            className={[
              "px-4 py-2.5 text-sm font-semibold transition-colors",
              tabActiva === tab.id
                ? "border-b-2 border-accent text-primary"
                : "text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabActiva === "uso-ia" && <UsoIaTab />}
      {tabActiva === "facturas" && <FacturasTab recargarSenal={recargarSenal} />}
      {tabActiva === "pagos" && <PagosTab />}
      {tabActiva === "cancelaciones" && <CancelacionesTab />}
      {tabActiva === "nuevas-clinicas" && <NuevasClinicasTab />}

      <FacturarManualmenteModal
        open={modalFacturar}
        onClose={() => setModalFacturar(false)}
        onEmitida={() => setRecargarSenal((v) => v + 1)}
      />
    </div>
  );
}
