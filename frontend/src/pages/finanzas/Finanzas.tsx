import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  ChartBarras,
  Input,
  KpiCard,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Table,
  Tabs,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { apiFetchBlob } from "../../lib/api";
import { guardarComoArchivo } from "../../lib/descargas";
import {
  CierreDelDia,
  CuentaBanco,
  CuentaPorPagar,
  Deudor,
  finanzasApi,
  Gasto,
  Recurrente,
  ResumenGastos,
  ResumenPorPagar,
} from "../../lib/finanzasApi";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { getStoredToken } from "../../hooks/useAuth";

// ---------------------------------------------------------------------
// FINANZAS — prompt 10a.
//
// Una pantalla con cinco pestañas en la URL, porque son cinco preguntas
// del mismo trabajo: ¿qué debo?, ¿en qué gasté?, ¿qué me deben?, ¿cuadró
// el día?, ¿qué le mando al contador?
//
// NINGUNA DE ESTAS CIFRAS SE ESCRIBE ACÁ: todas salen de los
// comprobantes, las compras, los cobros y los movimientos de caja que ya
// existen. Finanzas consolida, no recaptura, y eso es lo que hace que
// los números cuadren con la caja.
// ---------------------------------------------------------------------

const PESTANAS = [
  { clave: "por-pagar", etiqueta: "Cuentas por pagar" },
  { clave: "gastos", etiqueta: "Gastos" },
  { clave: "por-cobrar", etiqueta: "Cuentas por cobrar" },
  { clave: "cierre", etiqueta: "Cierre del día" },
  { clave: "exportacion", etiqueta: "Para el contador" },
];

const NOMBRE_TRAMO: Record<string, string> = {
  al_dia: "Al día",
  "1_30": "1 a 30 días",
  "31_60": "31 a 60 días",
  mas_60: "Más de 60 días",
};

const MEDIOS_DE_PAGO = [
  { value: "transferencia", label: "Transferencia" },
  { value: "sinpe", label: "SINPE" },
  { value: "cheque", label: "Cheque" },
  { value: "efectivo", label: "Efectivo (de la caja abierta)" },
  { value: "tarjeta", label: "Tarjeta de la clínica" },
];

function colones(n: number | string): string {
  const v = typeof n === "string" ? Number(n) : n;
  return `₡${v.toLocaleString("es-CR", { maximumFractionDigits: 2 })}`;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Finanzas() {
  const { puede } = useAuth();
  const puedeRegistrar = puede("finanzas.registrar");

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Finanzas"
        subtitulo="Lo que la clínica debe, lo que gasta, lo que le deben y el cierre del día."
        icono="caja"
        modulo="caja"
      />
      {!puedeRegistrar && (
        <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
          Estás viendo finanzas en modo lectura. Registrar pagos y gastos lo hace quien tenga el
          permiso «Registrar gastos y pagos a proveedores».
        </p>
      )}

      <Tabs pestanas={PESTANAS}>
        {(activa) => (
          <>
            {activa === "por-pagar" && <PanelPorPagar puedeRegistrar={puedeRegistrar} />}
            {activa === "gastos" && <PanelGastos puedeRegistrar={puedeRegistrar} />}
            {activa === "por-cobrar" && <PanelPorCobrar puedeRegistrar={puedeRegistrar} />}
            {activa === "cierre" && <PanelCierre puedeRegistrar={puedeRegistrar} />}
            {activa === "exportacion" && <PanelExportacion />}
          </>
        )}
      </Tabs>
    </div>
  );
}

// =====================================================================
// CUENTAS POR PAGAR
// =====================================================================
function PanelPorPagar({ puedeRegistrar }: { puedeRegistrar: boolean }) {
  const toast = useToast();
  const { zonaHoraria } = useAuth();
  const [cargando, setCargando] = useState(true);
  const [resumen, setResumen] = useState<ResumenPorPagar | null>(null);
  const [cuentas, setCuentas] = useState<CuentaPorPagar[]>([]);
  const [estado, setEstado] = useState("");
  const [bancos, setBancos] = useState<CuentaBanco[]>([]);
  const [recargar, setRecargar] = useState(0);
  // El pago que se está armando: a quién y qué cuentas.
  const [pagando, setPagando] = useState<{ proveedorId: string; nombre: string } | null>(null);
  const [elegidas, setElegidas] = useState<Record<string, string>>({});
  const [medio, setMedio] = useState("transferencia");
  const [bancoId, setBancoId] = useState("");
  const [referencia, setReferencia] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [r, b] = await Promise.all([
          finanzasApi.porPagar({ estado: estado || undefined }),
          finanzasApi.cuentasBanco(),
        ]);
        if (!vivo) return;
        setResumen(r.resumen);
        setCuentas(r.cuentas);
        setBancos(b.cuentas);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [estado, recargar]);

  function abrirPago(c: CuentaPorPagar) {
    setPagando({ proveedorId: c.proveedor_id, nombre: c.proveedor_nombre });
    setElegidas({ [c.id]: c.saldo });
    setMedio("transferencia");
    setReferencia("");
  }

  async function pagar() {
    if (!pagando) return;
    const aplicaciones = Object.entries(elegidas)
      .map(([cuentaId, monto]) => ({ cuentaId, monto: Number(monto) }))
      .filter((a) => a.monto > 0);
    if (aplicaciones.length === 0) return;
    setTrabajando(true);
    try {
      const r = await finanzasApi.pagar({
        proveedorId: pagando.proveedorId,
        fecha: hoyISO(),
        medio,
        cuentaBancoId: bancoId || null,
        referencia: referencia || null,
        aplicaciones,
      });
      toast.exito(
        r.movimientoEfectivoId
          ? `Pago de ${colones(r.total)} registrado. El efectivo salió de la caja y el arqueo lo descuenta.`
          : `Pago de ${colones(r.total)} registrado.`
      );
      setPagando(null);
      setRecargar((n) => n + 1);
    } catch (err) {
      // El 409 del backend trae el mensaje de la regla de dinero tal
      // como lo escribió la base: «el pago excede el saldo…».
      toast.error(err instanceof Error ? err.message : "No se pudo registrar el pago.");
    } finally {
      setTrabajando(false);
    }
  }

  if (cargando) return <LoadingState forma="tabla" />;

  const delProveedor = pagando
    ? cuentas.filter((c) => c.proveedor_id === pagando.proveedorId && Number(c.saldo) > 0)
    : [];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <KpiCard titulo="Total por pagar" valor={colones(resumen?.total ?? 0)} />
        <KpiCard
          titulo="Vencido"
          valor={colones(resumen?.vencido ?? 0)}
          detalle={(resumen?.vencido ?? 0) > 0 ? "hay facturas pasadas de fecha" : "nada vencido"}
        />
        <KpiCard titulo="Vence en 7 días" valor={colones(resumen?.vence7 ?? 0)} />
        <KpiCard titulo="Vence en 30 días" valor={colones(resumen?.vence30 ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-black/5 bg-surface p-4">
          <h3 className="mb-3 text-sm font-bold text-primary">Antigüedad</h3>
          <ChartBarras
            datos={(resumen?.antiguedad ?? []).map((t) => ({
              etiqueta: NOMBRE_TRAMO[t.tramo] ?? t.tramo,
              valor: t.monto,
            }))}
          />
        </section>
        <section className="rounded-xl border border-black/5 bg-surface p-4">
          <h3 className="mb-3 text-sm font-bold text-primary">Calendario de pagos</h3>
          {(resumen?.calendario ?? []).length === 0 ? (
            <p className="text-sm text-text-muted">No hay nada por vencer.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(resumen?.calendario ?? []).slice(0, 10).map((s) => (
                <li key={s.semana} className="flex justify-between">
                  <span className="text-text-muted">
                    {formatearFechaCorta(s.semana, zonaHoraria)}
                  </span>
                  <span className="font-medium text-text">{colones(s.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex items-end gap-3">
        <Select
          label="Estado"
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          options={[
            { value: "", label: "Todas" },
            { value: "pendiente", label: "Pendientes" },
            { value: "parcial", label: "Parciales" },
            { value: "vencida", label: "Vencidas" },
            { value: "pagada", label: "Pagadas" },
          ]}
        />
      </div>

      <Table<CuentaPorPagar>
        columns={[
          { key: "proveedor", header: "Proveedor", render: (c) => c.proveedor_nombre },
          {
            key: "documento",
            header: "Documento",
            render: (c) => (
              <div>
                <div>{c.documento ?? "—"}</div>
                {c.sin_comprobante && (
                  <Badge variant="warning">sin comprobante electrónico</Badge>
                )}
              </div>
            ),
          },
          {
            key: "vencimiento",
            header: "Vence",
            render: (c) => (
              <div>
                <div>{formatearFechaCorta(c.vencimiento, zonaHoraria)}</div>
                <div className="text-xs text-text-muted">
                  {c.dias_para_vencer < 0
                    ? `vencida hace ${-c.dias_para_vencer} día${c.dias_para_vencer === -1 ? "" : "s"}`
                    : `en ${c.dias_para_vencer} día${c.dias_para_vencer === 1 ? "" : "s"}`}
                </div>
              </div>
            ),
          },
          {
            key: "monto",
            header: "Monto",
            render: (c) => (
              <div>
                <div>
                  {c.moneda} {Number(c.monto).toLocaleString("es-CR")}
                </div>
                {c.exigible !== c.monto && (
                  <div className="text-xs text-text-muted">
                    exigible {Number(c.exigible).toLocaleString("es-CR")}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: "saldo",
            header: "Saldo",
            render: (c) => `${c.moneda} ${Number(c.saldo).toLocaleString("es-CR")}`,
          },
          {
            key: "estado",
            header: "Estado",
            render: (c) => (
              <Badge
                variant={
                  c.estado === "pagada"
                    ? "success"
                    : c.estado === "vencida"
                      ? "error"
                      : c.estado === "parcial"
                        ? "warning"
                        : "neutral"
                }
              >
                {c.estado}
              </Badge>
            ),
          },
          {
            key: "acciones",
            header: "",
            render: (c) =>
              puedeRegistrar && Number(c.saldo) > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => abrirPago(c)}>
                  Pagar
                </Button>
              ) : null,
          },
        ]}
        data={cuentas}
        rowKey={(c) => c.id}
        emptyMessage="No hay cuentas por pagar. Nacen al aceptar un comprobante de proveedor o al recibir una compra."
      />

      <Modal
        open={pagando !== null}
        onClose={() => setPagando(null)}
        title={pagando ? `Pagar a ${pagando.nombre}` : ""}
        description="Un pago puede cubrir varias facturas del mismo proveedor. En efectivo sale de la caja abierta, y el arqueo lo descuenta."
        ancho="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPagando(null)}>
              Cancelar
            </Button>
            <Button onClick={pagar} disabled={trabajando}>
              Registrar el pago
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {delProveedor.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-black/5 p-2">
                <div className="flex-1 text-sm">
                  <div className="text-text">{c.documento ?? "sin número"}</div>
                  <div className="text-xs text-text-muted">
                    vence {formatearFechaCorta(c.vencimiento, zonaHoraria)} · saldo {c.moneda}{" "}
                    {Number(c.saldo).toLocaleString("es-CR")}
                  </div>
                </div>
                <Input
                  type="number"
                  className="w-32"
                  value={elegidas[c.id] ?? ""}
                  placeholder="0"
                  onChange={(e) => setElegidas((p) => ({ ...p, [c.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Medio"
              value={medio}
              onChange={(e) => setMedio(e.target.value)}
              options={MEDIOS_DE_PAGO}
            />
            {medio !== "efectivo" && (
              <Select
                label="Cuenta de la clínica"
                value={bancoId}
                onChange={(e) => setBancoId(e.target.value)}
                options={[
                  { value: "", label: "Sin especificar" },
                  ...bancos.map((b) => ({
                    value: b.id,
                    label: `${b.nombre}${b.terminacion ? ` ···${b.terminacion}` : ""}`,
                  })),
                ]}
              />
            )}
            <Input
              label="Referencia"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="N.º de transferencia, cheque…"
            />
          </div>

          {medio === "efectivo" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              El efectivo sale de la caja abierta. Si no hay ninguna, el pago no se puede registrar
              así: el arqueo tiene que poder descontarlo.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

// =====================================================================
// GASTOS
// =====================================================================
function PanelGastos({ puedeRegistrar }: { puedeRegistrar: boolean }) {
  const toast = useToast();
  const { zonaHoraria } = useAuth();
  const [cargando, setCargando] = useState(true);
  const [resumen, setResumen] = useState<ResumenGastos | null>(null);
  const [lista, setLista] = useState<Gasto[]>([]);
  const [categorias, setCategorias] = useState<Array<{ id: string; nombre: string }>>([]);
  const [recurrentes, setRecurrentes] = useState<Recurrente[]>([]);
  const [recargar, setRecargar] = useState(0);
  const [nuevo, setNuevo] = useState<{
    fecha: string;
    categoriaId: string;
    descripcion: string;
    monto: string;
    sinComprobante: boolean;
    generaCuentaPorPagar: boolean;
  } | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [g, c, r] = await Promise.all([
          finanzasApi.gastos({ mes: hoyISO() }),
          finanzasApi.categorias(),
          finanzasApi.recurrentes(),
        ]);
        if (!vivo) return;
        setResumen(g.resumen);
        setLista(g.gastos);
        setCategorias(c.categorias.map((x) => ({ id: x.id, nombre: x.nombre })));
        setRecurrentes(r.recurrentes);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recargar]);

  async function guardar() {
    if (!nuevo) return;
    setTrabajando(true);
    try {
      await finanzasApi.registrarGasto({
        fecha: nuevo.fecha,
        categoriaId: nuevo.categoriaId,
        descripcion: nuevo.descripcion,
        monto: Number(nuevo.monto),
        sinComprobante: nuevo.sinComprobante,
        generaCuentaPorPagar: nuevo.generaCuentaPorPagar,
      });
      toast.exito("Gasto registrado.");
      setNuevo(null);
      setRecargar((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo registrar.");
    } finally {
      setTrabajando(false);
    }
  }

  if (cargando) return <LoadingState forma="tarjetas" />;

  const variacion =
    (resumen?.totalMesAnterior ?? 0) > 0
      ? Math.round(((resumen!.total - resumen!.totalMesAnterior) / resumen!.totalMesAnterior) * 100)
      : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          titulo="Gastos del mes"
          valor={colones(resumen?.total ?? 0)}
          variacionPorcentaje={variacion}
          sentido="subir_es_malo"
          detalle="contra el mes anterior"
        />
        <KpiCard titulo="Mes anterior" valor={colones(resumen?.totalMesAnterior ?? 0)} />
        <KpiCard
          titulo="Sin soporte fiscal"
          valor={colones(resumen?.sinComprobante ?? 0)}
          detalle="lo que el contador no puede deducir"
        />
      </div>

      <section className="rounded-xl border border-black/5 bg-surface p-4">
        <h3 className="mb-3 text-sm font-bold text-primary">Por categoría</h3>
        <ChartBarras
          datos={(resumen?.porCategoria ?? []).map((c) => ({
            etiqueta: c.categoria,
            valor: c.monto,
          }))}
        />
      </section>

      {puedeRegistrar && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              setNuevo({
                fecha: hoyISO(),
                categoriaId: categorias[0]?.id ?? "",
                descripcion: "",
                monto: "",
                sinComprobante: true,
                generaCuentaPorPagar: false,
              })
            }
          >
            Registrar un gasto
          </Button>
          <Button
            variant="secondary"
            disabled={trabajando}
            onClick={async () => {
              setTrabajando(true);
              try {
                const r = await finanzasApi.generarPendientes(hoyISO());
                toast.exito(
                  r.generados === 0
                    ? "Los gastos recurrentes de este mes ya estaban generados."
                    : `${r.generados} gasto(s) recurrente(s) generado(s) como estimados.`
                );
                setRecargar((n) => n + 1);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "No se pudo generar.");
              } finally {
                setTrabajando(false);
              }
            }}
          >
            Generar los recurrentes del mes ({recurrentes.filter((r) => r.activo).length})
          </Button>
        </div>
      )}

      <Table<Gasto>
        columns={[
          { key: "fecha", header: "Fecha", render: (g) => formatearFechaCorta(g.fecha, zonaHoraria) },
          { key: "categoria", header: "Categoría", render: (g) => g.categoria },
          {
            key: "descripcion",
            header: "Descripción",
            render: (g) => (
              <div>
                <div className="text-text">{g.descripcion}</div>
                <div className="flex gap-1">
                  {g.estado === "estimado" && <Badge variant="info">estimado</Badge>}
                  {g.sin_comprobante && <Badge variant="warning">sin comprobante</Badge>}
                  {g.estado === "anulado" && <Badge variant="neutral">anulado</Badge>}
                </div>
              </div>
            ),
          },
          { key: "proveedor", header: "Proveedor", render: (g) => g.proveedor ?? "—" },
          {
            key: "monto",
            header: "Monto",
            render: (g) => `${g.moneda} ${Number(g.monto).toLocaleString("es-CR")}`,
          },
          {
            key: "acciones",
            header: "",
            render: (g) =>
              !puedeRegistrar || g.estado === "anulado" ? null : g.estado === "estimado" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={trabajando}
                  onClick={async () => {
                    const monto = window.prompt(
                      "Monto real del comprobante (vacío = el estimado):",
                      g.monto
                    );
                    if (monto === null) return;
                    setTrabajando(true);
                    try {
                      const r = await finanzasApi.conciliarGasto(g.id, {
                        monto: monto ? Number(monto) : undefined,
                      });
                      toast.exito(
                        r.cambioElMonto
                          ? `Conciliado por ${colones(r.montoFinal)}: el estimado se ajustó.`
                          : "Conciliado."
                      );
                      setRecargar((n) => n + 1);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "No se pudo conciliar.");
                    } finally {
                      setTrabajando(false);
                    }
                  }}
                >
                  Conciliar
                </Button>
              ) : null,
          },
        ]}
        data={lista}
        rowKey={(g) => g.id}
        emptyMessage="No hay gastos este mes. Los comprobantes que no son de inventario se clasifican como gasto desde Facturación › Recibidos."
      />

      <Modal
        open={nuevo !== null}
        onClose={() => setNuevo(null)}
        title="Registrar un gasto"
        description="Para lo que no tiene comprobante electrónico: la planilla, un pago a una persona física. Lo que sí tiene comprobante se clasifica desde la bandeja de recibidos, sin volver a escribirlo."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNuevo(null)}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={trabajando}>
              Guardar
            </Button>
          </div>
        }
      >
        {nuevo && (
          <div className="space-y-3">
            <Input
              label="Fecha"
              type="date"
              value={nuevo.fecha}
              onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })}
            />
            <Select
              label="Categoría"
              value={nuevo.categoriaId}
              onChange={(e) => setNuevo({ ...nuevo, categoriaId: e.target.value })}
              options={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
            />
            <Input
              label="Descripción"
              value={nuevo.descripcion}
              onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })}
            />
            <Input
              label="Monto"
              type="number"
              value={nuevo.monto}
              onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nuevo.sinComprobante}
                onChange={(e) => setNuevo({ ...nuevo, sinComprobante: e.target.checked })}
              />
              No tiene comprobante electrónico
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

// =====================================================================
// CUENTAS POR COBRAR
// =====================================================================
function PanelPorCobrar({ puedeRegistrar }: { puedeRegistrar: boolean }) {
  const toast = useToast();
  const { zonaHoraria } = useAuth();
  const [cargando, setCargando] = useState(true);
  const [resumen, setResumen] = useState<{
    total: number;
    vencido: number;
    clientes: number;
    antiguedad: Array<{ tramo: string; monto: number }>;
  } | null>(null);
  const [lista, setLista] = useState<Deudor[]>([]);
  const [recordando, setRecordando] = useState<Deudor | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [bloqueo, setBloqueo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recargar, setRecargar] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await finanzasApi.porCobrar();
        if (!vivo) return;
        setResumen(r.resumen);
        setLista(r.deudores);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recargar]);

  async function abrir(d: Deudor) {
    setRecordando(d);
    setMensaje("");
    setBloqueo(null);
    try {
      const r = await finanzasApi.puedeRecordar(d.propietario_id);
      if (!r.puede) setBloqueo(r.motivo);
    } catch {
      /* si falla, el backend lo vuelve a decir al enviar */
    }
  }

  if (cargando) return <LoadingState forma="tabla" />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard titulo="Total por cobrar" valor={colones(resumen?.total ?? 0)} />
        <KpiCard
          titulo="Vencido"
          valor={colones(resumen?.vencido ?? 0)}
          detalle={(resumen?.vencido ?? 0) > 0 ? "pasado de fecha" : "nada vencido"}
        />
        <KpiCard titulo="Clientes con saldo" valor={String(resumen?.clientes ?? 0)} />
      </div>

      <section className="rounded-xl border border-black/5 bg-surface p-4">
        <h3 className="mb-3 text-sm font-bold text-primary">Antigüedad</h3>
        <ChartBarras
          datos={(resumen?.antiguedad ?? []).map((t) => ({
            etiqueta: NOMBRE_TRAMO[t.tramo] ?? t.tramo,
            valor: t.monto,
          }))}
        />
      </section>

      <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
        La lista es por <strong>deudor</strong>, que es el receptor de la factura y puede no ser el
        dueño del paciente: la empresa que paga por el perro de su empleado, el albergue que trae
        veinte gatos.
      </p>

      <Table<Deudor>
        columns={[
          {
            key: "nombre",
            header: "Deudor",
            render: (d) => (
              <div>
                <div className="font-medium text-text">{d.nombre}</div>
                <div className="text-xs text-text-muted">
                  {[d.email, d.telefono].filter(Boolean).join(" · ")}
                </div>
              </div>
            ),
          },
          { key: "facturas", header: "Facturas", render: (d) => d.facturas },
          { key: "saldo", header: "Saldo", render: (d) => colones(d.saldo) },
          {
            key: "vencido",
            header: "Vencido",
            render: (d) =>
              Number(d.vencido) > 0 ? (
                <span className="text-error">{colones(d.vencido)}</span>
              ) : (
                "—"
              ),
          },
          {
            key: "antiguedad",
            header: "Más antigua",
            render: (d) => (
              <div>
                <div>{d.mas_antigua ? formatearFechaCorta(d.mas_antigua, zonaHoraria) : "—"}</div>
                {d.dias_mas_vencida > 0 && (
                  <div className="text-xs text-text-muted">
                    {d.dias_mas_vencida} día{d.dias_mas_vencida === 1 ? "" : "s"} de vencida
                  </div>
                )}
              </div>
            ),
          },
          {
            key: "recordatorio",
            header: "Último aviso",
            render: (d) =>
              d.ultimo_recordatorio ? formatearFechaCorta(d.ultimo_recordatorio, zonaHoraria) : "—",
          },
          {
            key: "acciones",
            header: "",
            render: (d) =>
              puedeRegistrar ? (
                <Button variant="secondary" size="sm" onClick={() => abrir(d)}>
                  Recordar el saldo
                </Button>
              ) : null,
          },
        ]}
        data={lista}
        rowKey={(d) => d.propietario_id}
        emptyMessage="Nadie debe nada."
      />

      <Modal
        open={recordando !== null}
        onClose={() => setRecordando(null)}
        title={recordando ? `Recordarle el saldo a ${recordando.nombre}` : ""}
        description="Sale por el canal que el cliente prefiere y respeta sus consentimientos y la franja horaria de la clínica. Queda en su línea de tiempo."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRecordando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={trabajando || bloqueo !== null}
              onClick={async () => {
                if (!recordando) return;
                setTrabajando(true);
                try {
                  const r = await finanzasApi.recordar(recordando.propietario_id, mensaje);
                  if (r.enviado) {
                    toast.exito(`Recordatorio enviado por ${r.canal ?? "correo"}.`);
                  } else {
                    toast.aviso(r.motivo ?? "No se pudo enviar.");
                  }
                  setRecordando(null);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo enviar.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Enviar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {bloqueo && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {bloqueo}
            </p>
          )}
          <p className="text-sm text-text-muted">
            Debe {colones(recordando?.saldo ?? 0)} en {recordando?.facturas} factura
            {recordando?.facturas === 1 ? "" : "s"}.
          </p>
          <Input
            label="Algo que quieras agregar (opcional)"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="Pasá cuando puedas y lo arreglamos."
          />
        </div>
      </Modal>
    </div>
  );
}

// =====================================================================
// CIERRE DEL DÍA
// =====================================================================
function PanelCierre({ puedeRegistrar }: { puedeRegistrar: boolean }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(hoyISO());
  const [cargando, setCargando] = useState(true);
  const [datos, setDatos] = useState<CierreDelDia | null>(null);
  const [bancos, setBancos] = useState<CuentaBanco[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const [recargar, setRecargar] = useState(0);
  const [deposito, setDeposito] = useState<{ monto: string; cuentaBancoId: string; referencia: string } | null>(
    null
  );
  const [justificacion, setJustificacion] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    (async () => {
      try {
        const [c, b] = await Promise.all([finanzasApi.cierreDelDia(fecha), finanzasApi.cuentasBanco()]);
        if (!vivo) return;
        setDatos(c);
        setBancos(b.cuentas);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar el día.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [fecha, recargar]);

  if (cargando) return <LoadingState forma="tarjetas" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Día" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        {datos?.cerrado && (
          <Badge variant="success">
            cerrado{datos.cerrado.cerrado_por ? ` por ${datos.cerrado.cerrado_por}` : ""}
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <KpiCard titulo="Ventas del día" valor={colones(datos?.totalVentas ?? 0)} />
        <KpiCard titulo="Efectivo" valor={colones(datos?.efectivoDelDia ?? 0)} />
        <KpiCard titulo="Depositado" valor={colones(datos?.depositado ?? 0)} />
        <KpiCard
          titulo="Falta conciliar"
          valor={colones(datos?.diferencia ?? 0)}
          detalle={
            Math.abs(datos?.diferencia ?? 0) > 0.001
              ? "hay que marcarlo o justificarlo para cerrar"
              : "el día cuadra"
          }
        />
      </div>

      <section className="rounded-xl border border-black/5 bg-surface p-4">
        <h3 className="mb-3 text-sm font-bold text-primary">Por medio de pago</h3>
        <ul className="space-y-1 text-sm">
          {(datos?.porMedio ?? []).map((m) => (
            <li key={`${m.medio}-${m.moneda}`} className="flex justify-between">
              <span className="text-text-muted">
                {m.medio} ({m.cantidad})
              </span>
              <span className="font-medium text-text">
                {m.moneda} {m.monto.toLocaleString("es-CR")}
              </span>
            </li>
          ))}
          {(datos?.porMedio ?? []).length === 0 && (
            <li className="text-text-muted">No hubo cobros ese día.</li>
          )}
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border border-black/5 bg-surface p-4">
        <h3 className="text-sm font-bold text-primary">SINPE Móvil, uno por uno</h3>
        <p className="text-xs text-text-muted">
          Se marca contra lo que de verdad llegó a la cuenta. Un cobro que el cliente dijo que hizo
          y no hizo cuadra con la caja y no con el banco: por eso se marca el cobro y no el total.
        </p>
        {(datos?.sinpe ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No hubo cobros por SINPE.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {datos!.sinpe.map((s) => (
              <li key={s.cobro_medio_id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">
                  <span className="text-text">{colones(s.monto)}</span>{" "}
                  <span className="text-text-muted">
                    {s.cliente ?? "cliente de mostrador"}
                    {s.referencia ? ` · ${s.referencia}` : ""}
                  </span>
                </span>
                {s.conciliado ? (
                  <>
                    <Badge variant="success">conciliado</Badge>
                    {puedeRegistrar && !datos?.cerrado && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={trabajando}
                        onClick={async () => {
                          setTrabajando(true);
                          try {
                            await finanzasApi.desconciliarSinpe(s.cobro_medio_id);
                            setRecargar((n) => n + 1);
                          } finally {
                            setTrabajando(false);
                          }
                        }}
                      >
                        Desmarcar
                      </Button>
                    )}
                  </>
                ) : (
                  puedeRegistrar &&
                  !datos?.cerrado && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={trabajando}
                      onClick={async () => {
                        setTrabajando(true);
                        try {
                          await finanzasApi.conciliarSinpe(s.cobro_medio_id, bancos[0]?.id ?? null);
                          setRecargar((n) => n + 1);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "No se pudo marcar.");
                        } finally {
                          setTrabajando(false);
                        }
                      }}
                    >
                      Llegó al banco
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-black/5 bg-surface p-4">
        <h3 className="text-sm font-bold text-primary">Datáfono</h3>
        {(datos?.datafono ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No hubo cobros con tarjeta.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {datos!.datafono.map((d, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-text-muted">
                  {[d.banco, d.tipo_tarjeta, d.marca].filter(Boolean).join(" · ") || "sin detalle"}
                </span>
                <span className={Math.abs(d.diferencia) > 0.001 ? "text-error" : "text-text"}>
                  lote {colones(d.declarado)} · cobrado {colones(d.cobrado)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-black/5 bg-surface p-4">
        <h3 className="text-sm font-bold text-primary">Depósitos de efectivo</h3>
        {(datos?.depositos ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No hay depósitos registrados.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {datos!.depositos.map((d) => (
              <li key={d.id} className="flex justify-between">
                <span className="text-text-muted">
                  {d.cuenta_banco ?? "sin cuenta"}
                  {d.referencia ? ` · ${d.referencia}` : ""}
                </span>
                <span className="text-text">{colones(d.monto)}</span>
              </li>
            ))}
          </ul>
        )}
        {puedeRegistrar && !datos?.cerrado && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setDeposito({
                monto: String(Math.max(0, (datos?.efectivoDelDia ?? 0) - (datos?.depositado ?? 0))),
                cuentaBancoId: bancos[0]?.id ?? "",
                referencia: "",
              })
            }
          >
            Registrar un depósito
          </Button>
        )}
      </section>

      {puedeRegistrar && !datos?.cerrado && (
        <section className="space-y-2 rounded-xl border border-black/5 bg-surface p-4">
          <h3 className="text-sm font-bold text-primary">Cerrar el día</h3>
          {Math.abs(datos?.diferencia ?? 0) > 0.001 && (
            <>
              <p className="text-sm text-amber-800">
                Falta conciliar {colones(datos?.diferencia ?? 0)}. Para cerrar así hace falta una
                justificación y el permiso de cerrar con diferencia.
              </p>
              <Input
                label="Justificación"
                value={justificacion}
                onChange={(e) => setJustificacion(e.target.value)}
              />
            </>
          )}
          <Button
            disabled={trabajando}
            onClick={async () => {
              setTrabajando(true);
              try {
                const r = await finanzasApi.cerrarDia(fecha, justificacion || undefined);
                toast.exito(
                  Math.abs(r.diferencia) < 0.001
                    ? "Día cerrado: cuadró."
                    : `Día cerrado con una diferencia de ${colones(r.diferencia)}.`
                );
                setRecargar((n) => n + 1);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "No se pudo cerrar el día.");
              } finally {
                setTrabajando(false);
              }
            }}
          >
            Cerrar el día
          </Button>
        </section>
      )}

      <Modal
        open={deposito !== null}
        onClose={() => setDeposito(null)}
        title="Registrar un depósito"
        description="El efectivo del día que entró al banco."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeposito(null)}>
              Cancelar
            </Button>
            <Button
              disabled={trabajando}
              onClick={async () => {
                if (!deposito) return;
                setTrabajando(true);
                try {
                  await finanzasApi.registrarDeposito({
                    fecha,
                    monto: Number(deposito.monto),
                    cuentaBancoId: deposito.cuentaBancoId,
                    referencia: deposito.referencia || null,
                  });
                  toast.exito("Depósito registrado.");
                  setDeposito(null);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo registrar.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Guardar
            </Button>
          </div>
        }
      >
        {deposito && (
          <div className="space-y-3">
            <Input
              label="Monto"
              type="number"
              value={deposito.monto}
              onChange={(e) => setDeposito({ ...deposito, monto: e.target.value })}
            />
            <Select
              label="Cuenta"
              value={deposito.cuentaBancoId}
              onChange={(e) => setDeposito({ ...deposito, cuentaBancoId: e.target.value })}
              options={bancos.map((b) => ({
                value: b.id,
                label: `${b.nombre}${b.terminacion ? ` ···${b.terminacion}` : ""}`,
              }))}
            />
            <Input
              label="Referencia"
              value={deposito.referencia}
              onChange={(e) => setDeposito({ ...deposito, referencia: e.target.value })}
            />
            {bancos.length === 0 && (
              <p className="text-sm text-amber-800">
                No hay cuentas bancarias cargadas. Un depósito necesita saber a qué cuenta entró.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// =====================================================================
// EXPORTACIÓN PARA EL CONTADOR
// =====================================================================
function PanelExportacion() {
  const toast = useToast();
  const [cuadernos, setCuadernos] = useState<Array<{ clave: string; titulo: string }>>([]);
  const primerDiaDelMes = `${hoyISO().slice(0, 7)}-01`;
  const [desde, setDesde] = useState(primerDiaDelMes);
  const [hasta, setHasta] = useState(hoyISO());
  const [bajando, setBajando] = useState<string | null>(null);

  useEffect(() => {
    finanzasApi
      .cuadernos()
      .then((r) => setCuadernos(r.cuadernos))
      .catch(() => setCuadernos([]));
  }, []);

  async function bajar(cuaderno: string, formato: "xlsx" | "pdf") {
    setBajando(`${cuaderno}-${formato}`);
    try {
      // EL ARCHIVO SE ARMA EN EL BACKEND, con los mismos filtros y el
      // mismo alcance de tenant que la consulta. Un CSV armado en el
      // navegador exporta lo que la pantalla tenga cargado.
      const blob = await apiFetchBlob(finanzasApi.urlExportacion(cuaderno, formato, desde, hasta), {
        token: getStoredToken(),
      });
      guardarComoArchivo(blob, `${cuaderno}-${desde}-a-${hasta}.${formato}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo exportar.");
    } finally {
      setBajando(null);
    }
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
        Las columnas de cada archivo son fijas y están documentadas, para que el contador no tenga
        que armar su plantilla de nuevo cada mes.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Input label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Input label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </div>

      <div className="divide-y divide-black/5 rounded-xl border border-black/5 bg-surface">
        {cuadernos.map((c) => (
          <div key={c.clave} className="flex flex-wrap items-center gap-3 p-4">
            <span className="flex-1 text-sm text-text">{c.titulo}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={bajando !== null}
              onClick={() => bajar(c.clave, "xlsx")}
            >
              Excel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={bajando !== null}
              onClick={() => bajar(c.clave, "pdf")}
            >
              PDF
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
