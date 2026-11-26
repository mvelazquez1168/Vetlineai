import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  LoadingState,
  Modal,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import {
  Caja,
  CobroListado,
  CuentaListada,
  ETIQUETA_MEDIO,
  LineaEsperada,
  MovimientoEfectivo,
  QUE_DECLARAR,
  Sesion,
  formatearMonto,
  ventasApi,
} from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// LA CAJA DEL DÍA: la sesión abierta, sus cuentas, sus cobros y su
// cierre con arqueo.
//
// EL ARQUEO está hecho para que sirva: **el esperado NO se precarga en
// el campo del declarado**. Si lo hiciera, el cajero confirmaría el
// número del sistema sin contar y el arqueo dejaría de detectar nada.
// La diferencia aparece recién cuando el cajero escribe lo que contó.
//
// El esperado se muestra igual —no es un examen sorpresa— pero en otra
// columna.
// ---------------------------------------------------------------------

export function CajaDelDia() {
  const { id: sesionIdParam } = useParams();
  const navegar = useNavigate();
  const toast = useToast();

  const [cajas, setCajas] = useState<Caja[]>([]);
  const [sesionId, setSesionId] = useState(sesionIdParam ?? "");
  const [datos, setDatos] = useState<{
    sesion: Sesion;
    esperado: LineaEsperada[];
    cobros: CobroListado[];
    movimientos: MovimientoEfectivo[];
    cuentasAbiertas: CuentaListada[];
  } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const [abriendo, setAbriendo] = useState(false);
  const [cajaId, setCajaId] = useState("");
  const [fondoCrc, setFondoCrc] = useState("0");
  const [fondoUsd, setFondoUsd] = useState("0");

  const [cerrando, setCerrando] = useState(false);
  const [declarado, setDeclarado] = useState<Record<string, string>>({});
  const [justificacion, setJustificacion] = useState<Record<string, string>>({});

  const [movimiento, setMovimiento] = useState(false);
  const [mov, setMov] = useState({
    tipo: "retiro_caja_fuerte",
    moneda: "CRC",
    monto: "",
    categoriaGasto: "",
    motivo: "",
  });

  const recargar = async (id: string) => {
    const d = await ventasApi.sesion(id);
    setDatos(d);
    setDeclarado({});
    setJustificacion({});
  };

  useEffect(() => {
    ventasApi
      .cajas()
      .then((r) => {
        setCajas(r.cajas);
        if (!sesionId) {
          const abierta = r.cajas.find((c) => c.sesion_abierta);
          if (abierta?.sesion_abierta) {
            setSesionId(abierta.sesion_abierta);
            navegar(`/ventas/caja/${abierta.sesion_abierta}`, { replace: true });
          } else if (r.cajas[0]) {
            setCajaId(r.cajas[0].id);
          }
        }
      })
      .catch(() => setCajas([]))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    if (!sesionId) return;
    setCargando(true);
    recargar(sesionId)
      .catch((err) => toast.error(err.message))
      .finally(() => setCargando(false));
  }, [sesionId]);

  const abrir = async () => {
    setOcupado(true);
    try {
      const r = await ventasApi.abrirSesion({
        cajaId,
        fondoCrc: Number(fondoCrc.replace(",", ".")) || 0,
        fondoUsd: Number(fondoUsd.replace(",", ".")) || 0,
      });
      toast.exito("Caja abierta.");
      setAbriendo(false);
      setSesionId(r.id);
      navegar(`/ventas/caja/${r.id}`, { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const clave = (l: LineaEsperada) => `${l.medio}|${l.moneda}`;

  const cerrar = async () => {
    if (!datos) return;
    setOcupado(true);
    try {
      const r = await ventasApi.cerrarSesion(sesionId, {
        lineas: datos.esperado.map((l) => ({
          medio: l.medio,
          moneda: l.moneda,
          declarado: Number((declarado[clave(l)] ?? "").replace(",", ".")) || 0,
          justificacion: justificacion[clave(l)]?.trim() || undefined,
        })),
      });
      if (!r.cerrada) {
        toast.aviso(
          `La diferencia es de ${formatearMonto(r.diferenciaTotalCrc)} y el umbral es ${formatearMonto(r.umbral)}: ` +
            `la caja NO se cerró. Quedó una solicitud para que la apruebe un administrador.`
        );
      } else {
        toast.exito("Caja cerrada. El arqueo queda inmutable.");
        setCerrando(false);
      }
      await recargar(sesionId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const registrarMovimiento = async () => {
    setOcupado(true);
    try {
      await ventasApi.movimientoEfectivo(sesionId, {
        tipo: mov.tipo,
        moneda: mov.moneda,
        monto: Number(mov.monto.replace(",", ".")),
        categoriaGasto: mov.categoriaGasto.trim() || undefined,
        motivo: mov.motivo,
      });
      toast.exito("Movimiento registrado. El arqueo ya lo considera.");
      setMovimiento(false);
      setMov({ ...mov, monto: "", motivo: "", categoriaGasto: "" });
      await recargar(sesionId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" cantidad={3} />;

  // ------------------------------------------------ Sin sesión abierta
  if (!sesionId || !datos) {
    return (
      <div>
        <h2 className="text-xl font-bold text-primary">Caja</h2>
        <Card className="mt-6">
          <CardTitle>No hay ninguna caja abierta</CardTitle>
          <CardDescription>
            Para cobrar hace falta una sesión abierta, con su fondo inicial. El fondo entra al
            arqueo del cierre.
          </CardDescription>
          <Button className="mt-4" onClick={() => setAbriendo(true)} disabled={cajas.length === 0}>
            Abrir caja
          </Button>
          {cajas.length === 0 && (
            <p className="mt-2 text-sm text-text-muted">
              Todavía no hay ninguna caja configurada. La crea un administrador.
            </p>
          )}
        </Card>

        <Modal
          open={abriendo}
          onClose={() => setAbriendo(false)}
          title="Abrir caja"
          description="El fondo inicial en cada moneda. Es el punto de partida del arqueo."
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAbriendo(false)}>
                Cancelar
              </Button>
              <Button disabled={ocupado || !cajaId} onClick={abrir}>
                Abrir
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Select
              label="Caja"
              value={cajaId}
              onChange={(e) => setCajaId(e.target.value)}
              options={cajas.map((c) => ({ value: c.id, label: `${c.nombre} — ${c.bodega}` }))}
            />
            <Input
              label="Fondo en colones"
              value={fondoCrc}
              onChange={(e) => setFondoCrc(e.target.value)}
            />
            <Input
              label="Fondo en dólares"
              value={fondoUsd}
              onChange={(e) => setFondoUsd(e.target.value)}
            />
          </div>
        </Modal>
      </div>
    );
  }

  const abiertaAun = datos.sesion.estado === "abierta";

  const columnasCobros: TableColumn<CobroListado>[] = [
    {
      key: "hora",
      header: "Hora",
      render: (c) => new Date(c.creado_en).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" }),
    },
    {
      key: "cuenta",
      header: "Cuenta",
      render: (c) => (
        <>
          <span className="font-medium">#{c.cuenta_numero ?? "—"}</span>
          {c.cliente_nombre && <span className="block text-xs text-text-muted">{c.cliente_nombre}</span>}
        </>
      ),
    },
    { key: "cajero", header: "Cobró", render: (c) => c.cajero ?? "—" },
    {
      key: "comprobante",
      header: "Comprobante",
      render: (c) => <span className="text-sm">{c.consecutivo ?? "—"}</span>,
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      render: (c) => (
        <span className={c.estado === "anulado" ? "line-through text-text-muted" : "font-medium"}>
          {formatearMonto(c.total)}
        </span>
      ),
    },
    {
      key: "acciones",
      header: "",
      render: (c) => (
        <Link to={`/ventas/tiquete/${c.id}`} className="text-sm text-accent hover:underline">
          Tiquete
        </Link>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">{datos.sesion.caja}</h2>
          <p className="mt-1 text-sm text-text-muted">
            Abierta por {datos.sesion.abierta_por_nombre ?? "—"} el{" "}
            {new Date(datos.sesion.abierta_en).toLocaleString("es-CR")} · fondo{" "}
            {formatearMonto(datos.sesion.fondo_crc)} y {formatearMonto(datos.sesion.fondo_usd, "USD")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={abiertaAun ? "success" : "neutral"} dot>
            {abiertaAun ? "Abierta" : "Cerrada"}
          </Badge>
          {abiertaAun && (
            <>
              <Button variant="secondary" onClick={() => setMovimiento(true)}>
                Movimiento de efectivo
              </Button>
              <Button variant="secondary" onClick={() => setCerrando(true)}>
                Cerrar con arqueo
              </Button>
              <Button onClick={() => navegar(`/ventas/cobro?sesion=${sesionId}`)}>
                <Icono nombre="agregar" className="mr-1 h-4 w-4" />
                Cobrar
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>Lo que debería haber</CardTitle>
          <CardDescription>Calculado por el sistema. Se compara con lo contado al cerrar.</CardDescription>
          <ul className="mt-3 space-y-1 text-sm">
            {datos.esperado.map((l) => (
              <li key={clave(l)} className="flex justify-between border-b border-black/5 pb-1">
                <span className="text-text-muted">
                  {ETIQUETA_MEDIO[l.medio] ?? l.medio} {l.moneda !== "CRC" && l.moneda}
                </span>
                <span className="font-medium">{formatearMonto(l.esperado, l.moneda)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>Cuentas abiertas</CardTitle>
          <CardDescription>
            Una cuenta puede quedar abierta varios días acumulando cargos.
          </CardDescription>
          <ul className="mt-3 space-y-1 text-sm">
            {datos.cuentasAbiertas.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/ventas/cobro/${c.id}?sesion=${sesionId}`}
                  className="flex justify-between border-b border-black/5 pb-1 hover:underline"
                >
                  <span>
                    #{c.numero} {c.cliente_nombre ?? "sin cliente"}
                  </span>
                  <span className="text-text-muted">{c.cargos} cargo(s)</span>
                </Link>
              </li>
            ))}
            {datos.cuentasAbiertas.length === 0 && (
              <li className="text-text-muted">Ninguna cuenta abierta.</li>
            )}
          </ul>
        </Card>

        <Card>
          <CardTitle>Movimientos de efectivo</CardTitle>
          <CardDescription>Lo que entra y sale sin ser una venta.</CardDescription>
          <ul className="mt-3 space-y-1 text-sm">
            {datos.movimientos.map((m) => (
              <li key={m.id} className="border-b border-black/5 pb-1">
                <div className="flex justify-between">
                  <span>
                    {m.tipo === "ingreso_cambio" ? "+" : "−"}
                    {formatearMonto(m.monto, m.moneda)}
                  </span>
                  <span className="text-xs text-text-muted">{m.persona ?? "—"}</span>
                </div>
                <span className="block text-xs text-text-muted">{m.motivo}</span>
              </li>
            ))}
            {datos.movimientos.length === 0 && (
              <li className="text-text-muted">Ninguno todavía.</li>
            )}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Cobros de la sesión</CardTitle>
        <div className="mt-3">
          <Table
            columns={columnasCobros}
            data={datos.cobros}
            rowKey={(c) => c.id}
            emptyMessage="Todavía no se cobró nada."
          />
        </div>
      </Card>

      {/* ------------------------------------------------ Arqueo */}
      <Modal
        open={cerrando}
        onClose={() => setCerrando(false)}
        title="Cerrar con arqueo"
        description="Escribí lo CONTADO en cada medio. El esperado está al lado para comparar, no para copiar."
        ancho="xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCerrando(false)}>
              Cancelar
            </Button>
            <Button disabled={ocupado} onClick={cerrar}>
              Cerrar la caja
            </Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                <th className="py-2">Medio</th>
                <th className="py-2 text-right">Esperado</th>
                <th className="py-2 text-right">Declarado</th>
                <th className="py-2 text-right">Diferencia</th>
                <th className="py-2">Justificación</th>
              </tr>
            </thead>
            <tbody>
              {datos.esperado.map((l) => {
                const k = clave(l);
                const valor = declarado[k] ?? "";
                const dif =
                  valor === "" ? null : Number(valor.replace(",", ".")) - l.esperado;
                return (
                  <tr key={k} className="border-b border-black/5">
                    <td className="py-2">
                      <span className="font-medium">
                        {ETIQUETA_MEDIO[l.medio] ?? l.medio}
                        {l.moneda !== "CRC" ? ` (${l.moneda})` : ""}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {QUE_DECLARAR[l.medio] ?? "El total confirmado"}
                      </span>
                    </td>
                    <td className="py-2 text-right">{formatearMonto(l.esperado, l.moneda)}</td>
                    <td className="py-2 text-right">
                      <input
                        className="w-32 rounded-lg border border-black/10 bg-surface px-2 py-1 text-right"
                        value={valor}
                        placeholder="0"
                        onChange={(e) => setDeclarado((d) => ({ ...d, [k]: e.target.value }))}
                      />
                    </td>
                    <td className="py-2 text-right">
                      {dif === null ? (
                        <span className="text-text-muted">—</span>
                      ) : dif === 0 ? (
                        <span className="text-success">cuadra</span>
                      ) : (
                        <span className="font-semibold text-error">
                          {dif > 0 ? "+" : ""}
                          {formatearMonto(dif, l.moneda)}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      {dif !== null && dif !== 0 && (
                        <input
                          className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1"
                          value={justificacion[k] ?? ""}
                          placeholder="Por qué no cuadra"
                          onChange={(e) =>
                            setJustificacion((j) => ({ ...j, [k]: e.target.value }))
                          }
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Cada diferencia lleva su justificación. Si la diferencia total supera el umbral de la
          clínica, la caja no cierra hasta que un administrador lo apruebe.
        </p>
      </Modal>

      {/* ------------------------------------- Movimiento de efectivo */}
      <Modal
        open={movimiento}
        onClose={() => setMovimiento(false)}
        title="Movimiento de efectivo"
        description="Lo que entra o sale de la caja sin ser una venta. El arqueo lo considera."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMovimiento(false)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado || !Number(mov.monto.replace(",", ".")) || !mov.motivo.trim()}
              onClick={registrarMovimiento}
            >
              Registrar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Select
            label="Tipo"
            value={mov.tipo}
            onChange={(e) => setMov({ ...mov, tipo: e.target.value })}
            options={[
              { value: "retiro_caja_fuerte", label: "Retiro a caja fuerte (sale)" },
              { value: "ingreso_cambio", label: "Ingreso de cambio (entra)" },
              { value: "gasto_caja_chica", label: "Gasto de caja chica (sale)" },
            ]}
          />
          <Select
            label="Moneda"
            value={mov.moneda}
            onChange={(e) => setMov({ ...mov, moneda: e.target.value })}
            options={[
              { value: "CRC", label: "Colones" },
              { value: "USD", label: "Dólares" },
            ]}
          />
          <Input label="Monto" value={mov.monto} onChange={(e) => setMov({ ...mov, monto: e.target.value })} />
          {mov.tipo === "gasto_caja_chica" && (
            <Input
              label="Categoría del gasto"
              value={mov.categoriaGasto}
              onChange={(e) => setMov({ ...mov, categoriaGasto: e.target.value })}
              placeholder="Limpieza, papelería, mensajería…"
            />
          )}
          <Input
            label="Motivo"
            value={mov.motivo}
            onChange={(e) => setMov({ ...mov, motivo: e.target.value })}
            placeholder="Retiro del mediodía a la caja fuerte"
          />
        </div>
      </Modal>
    </div>
  );
}
