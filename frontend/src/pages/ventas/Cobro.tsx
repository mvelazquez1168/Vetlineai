import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  LoadingState,
  Select,
  useToast,
} from "../../components/ui";
import {
  Cargo,
  TotalesCuenta,
  formatearMonto,
  ventasApi,
} from "../../lib/ventasApi";
import { ListaPrecio, ProductoListado, inventarioApi } from "../../lib/inventarioApi";
import { ReceptorEncontrado, facturacionCrApi } from "../../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// LA PANTALLA DE COBRO. Es la más usada de la clínica, así que está
// hecha para ir rápido:
//
//   * **El buscador de producto tiene el foco al entrar** y vuelve a
//     tenerlo después de cada línea. Un lector de código de barras
//     funciona como un teclado que escribe y aprieta Enter, así que con
//     el foco puesto el lector funciona solo, sin configurar nada.
//   * **El total y el vuelto van en grande.** El vuelto mal leído es
//     plata perdida en el mostrador, y es el número que se lee a un
//     metro de distancia.
//   * **Atajos:** F2 busca producto, F4 cobra, Esc cierra el panel de
//     cobro. Están escritos en pantalla, no escondidos.
//
// El total NO se calcula acá: viene del backend con cada cargo. Las
// reglas de IVA son las del Anexo y tienen que estar en un solo lugar.
// ---------------------------------------------------------------------

interface MedioElegido {
  medio: string;
  moneda: string;
  monto: string;
  referencia: string;
}

const MEDIOS = [
  { value: "01", label: "Efectivo" },
  { value: "02", label: "Tarjeta" },
  { value: "06", label: "SINPE Móvil" },
  { value: "04", label: "Transferencia" },
  { value: "anticipo", label: "Saldo a favor del cliente" },
  { value: "credito", label: "A crédito" },
];

export function Cobro() {
  const { id: cuentaIdParam } = useParams();
  const [parametros] = useSearchParams();
  const sesionId = parametros.get("sesion") ?? "";
  const navegar = useNavigate();
  const toast = useToast();

  const [cuentaId, setCuentaId] = useState(cuentaIdParam ?? "");
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [totales, setTotales] = useState<TotalesCuenta | null>(null);
  const [numero, setNumero] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const [productos, setProductos] = useState<ProductoListado[]>([]);
  const [presentaciones, setPresentaciones] = useState<
    Array<{ id: string; nombre: string; factor: string; precio: string | null; producto: string; existencia: number; unidad: string }>
  >([]);
  const [busqueda, setBusqueda] = useState("");
  const [cantidad, setCantidad] = useState("1");
  // LA LISTA DE PRECIO que rige esta venta (nocturno, convenio…). Se
  // precarga con la de la clínica y se puede cambiar antes de agregar
  // líneas: cambiarla DESPUÉS no retasa lo ya cargado, porque un cargo
  // ya emitido a un precio es un hecho, no una preferencia.
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const [listaId, setListaId] = useState<string>("");
  const [presentacionId, setPresentacionId] = useState("");

  const [cliente, setCliente] = useState<ReceptorEncontrado | null>(null);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clientes, setClientes] = useState<ReceptorEncontrado[]>([]);

  const [panelCobro, setPanelCobro] = useState(false);
  const [medios, setMedios] = useState<MedioElegido[]>([
    { medio: "01", moneda: "CRC", monto: "", referencia: "" },
  ]);
  const [tipoComprobante, setTipoComprobante] = useState<"01" | "04">("04");
  const [condicionVenta, setCondicionVenta] = useState("01");
  const [tipoCambio, setTipoCambio] = useState<number | null>(null);

  const refBusqueda = useRef<HTMLInputElement>(null);

  // --- Carga inicial --------------------------------------------------
  useEffect(() => {
    // Las listas vigentes y la que la clínica dejó preseleccionada.
    Promise.all([inventarioApi.listasPrecio(), ventasApi.parametros()])
      .then(([l, p]) => {
        setListas(l.listas.filter((x) => x.vigenteHoy));
        const preferida = p.parametros.lista_precio_id ?? "";
        if (preferida && l.listas.some((x) => x.id === preferida && x.vigenteHoy)) {
          setListaId(preferida);
        }
      })
      .catch(() => setListas([]));
  }, []);

  useEffect(() => {
    ventasApi.tipoCambio().then((r) => setTipoCambio(r.valor)).catch(() => setTipoCambio(null));
    inventarioApi
      .productos({ porPagina: 100 })
      .then(async (r) => {
        setProductos(r.productos);
        // Las presentaciones vendibles de todos los productos, aplanadas:
        // el cajero busca "amoxicilina caja", no un producto y después
        // una presentación.
        const todas: typeof presentaciones = [];
        for (const p of r.productos) {
          try {
            const d = await inventarioApi.producto(p.id);
            for (const pr of d.presentaciones.filter((x) => x.activo && x.para_venta)) {
              todas.push({
                id: pr.id,
                nombre: pr.nombre,
                factor: pr.factor,
                precio: pr.precio_venta,
                producto: p.nombre,
                existencia: Number(p.existencia),
                unidad: p.unidad_base,
              });
            }
          } catch {
            /* un producto que no carga no bloquea la caja */
          }
        }
        setPresentaciones(todas);
      })
      .catch(() => setProductos([]));
  }, []);

  const recargarCuenta = useCallback(
    async (id: string) => {
      const d = await ventasApi.cuenta(id);
      setCargos(d.cargos.filter((c) => !c.anulado_en));
      setTotales(d.totales);
      setNumero(d.cuenta.numero);
    },
    []
  );

  useEffect(() => {
    const preparar = async () => {
      setCargando(true);
      try {
        let id = cuentaId;
        if (!id) {
          const nueva = await ventasApi.abrirCuenta({ sesionId: sesionId || undefined });
          id = nueva.id;
          setCuentaId(id);
        }
        await recargarCuenta(id);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setCargando(false);
        refBusqueda.current?.focus();
      }
    };
    preparar();
  }, []);

  // --- Búsqueda de cliente -------------------------------------------
  useEffect(() => {
    if (buscaCliente.trim().length < 2) {
      setClientes([]);
      return;
    }
    const t = setTimeout(() => {
      facturacionCrApi
        .buscarReceptores(buscaCliente)
        .then((r) => setClientes(r.receptores))
        .catch(() => setClientes([]));
    }, 300);
    return () => clearTimeout(t);
  }, [buscaCliente]);

  // --- Atajos ---------------------------------------------------------
  useEffect(() => {
    const atajo = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        refBusqueda.current?.focus();
        refBusqueda.current?.select();
      }
      if (e.key === "F4") {
        e.preventDefault();
        if (totales && totales.saldo > 0) setPanelCobro(true);
      }
      if (e.key === "Escape") setPanelCobro(false);
    };
    window.addEventListener("keydown", atajo);
    return () => window.removeEventListener("keydown", atajo);
  }, [totales]);

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return presentaciones
      .filter(
        (p) =>
          p.producto.toLowerCase().includes(q) ||
          p.nombre.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [busqueda, presentaciones]);

  const agregar = async (presId: string) => {
    if (!cuentaId) return;
    const pres = presentaciones.find((p) => p.id === presId);
    const cant = Number(cantidad.replace(",", ".")) || 1;
    if (pres && cant * Number(pres.factor) > pres.existencia) {
      toast.aviso(
        `Hay ${pres.existencia} ${pres.unidad} y esto descontaría ${cant * Number(pres.factor)}. Se registra igual si el producto lo permite.`
      );
    }
    setOcupado(true);
    try {
      const r = await ventasApi.agregarCargo(cuentaId, {
        origen: "mostrador",
        presentacionId: presId,
        cantidad: cant,
        // `null` explícito = a precio base. Sin esto el backend usaría
        // la preseleccionada de la clínica y el cajero no podría
        // volver al base para una línea.
        listaPrecioId: listaId || null,
      });
      setTotales(r.totales);
      await recargarCuenta(cuentaId);
      setBusqueda("");
      setCantidad("1");
      setPresentacionId("");
      refBusqueda.current?.focus();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const recibidoCrc = medios.reduce((a, m) => {
    const n = Number(m.monto.replace(",", ".")) || 0;
    const tc = m.moneda === "USD" ? tipoCambio ?? 0 : 1;
    return a + n * tc;
  }, 0);
  const vuelto = totales ? Math.max(0, Math.round((recibidoCrc - totales.saldo) * 100) / 100) : 0;

  const cobrar = async () => {
    if (!cuentaId || !totales) return;
    setOcupado(true);
    try {
      const r = await ventasApi.cobrar(cuentaId, {
        sesionId,
        tipoComprobante,
        condicionVenta,
        plazoCreditoDias: condicionVenta === "10" ? 30 : undefined,
        receptor:
          tipoComprobante === "01" && cliente
            ? {
                nombre: cliente.nombre,
                identificacion: cliente.numero_identificacion
                  ? {
                      tipo: cliente.tipo_identificacion_codigo ?? "01",
                      numero: cliente.numero_identificacion,
                    }
                  : undefined,
                correo: cliente.email ?? undefined,
              }
            : undefined,
        medios: medios
          .filter((m) => Number(m.monto.replace(",", ".")) > 0)
          .map((m) => ({
            medio: m.medio,
            moneda: m.moneda,
            monto: Number(m.monto.replace(",", ".")),
            referencia: m.referencia.trim() || undefined,
          })),
      });
      toast.exito(
        `Cobrado ${formatearMonto(r.total)}${r.vueltoCrc > 0 ? ` · vuelto ${formatearMonto(r.vueltoCrc)}` : ""}` +
          (r.consecutivo ? ` · comprobante ${r.consecutivo}` : "")
      );
      navegar(`/ventas/tiquete/${r.cobroId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" cantidad={2} />;

  return (
    <div>
      <Link to={sesionId ? `/ventas/caja/${sesionId}` : "/ventas"} className="text-sm text-text-muted hover:text-primary">
        ← Caja
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">
            Cobro {numero !== null && <span className="text-text-muted">· cuenta #{numero}</span>}
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            F2 buscar producto · F4 cobrar · Esc cerrar
          </p>
        </div>
        {!sesionId && (
          <Badge variant="warning" dot>
            Sin sesión de caja: abrí una para poder cobrar
          </Badge>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* -------------------------------------------- Líneas */}
        <Card className="lg:col-span-2">
          <CardTitle>Qué se lleva</CardTitle>
          <CardDescription>
            Escribí el nombre o pasá el lector de código de barras: con el foco acá, el lector
            escribe solo.
          </CardDescription>

          <div className="mt-3 grid gap-2 sm:grid-cols-6">
            <div className="sm:col-span-4">
              <Input
                ref={refBusqueda}
                label="Producto"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && coincidencias.length > 0) {
                    e.preventDefault();
                    agregar(presentacionId || coincidencias[0].id);
                  }
                }}
                placeholder="amoxicilina, caja, 7501234…"
              />
            </div>
            <Input
              label="Cantidad"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={ocupado || coincidencias.length === 0}
                onClick={() => agregar(presentacionId || coincidencias[0].id)}
              >
                Agregar
              </Button>
            </div>
          </div>

          {listas.length > 0 && (
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <div className="w-64">
                <Select
                  label="Lista de precio de esta venta"
                  value={listaId}
                  onChange={(e) => setListaId(e.target.value)}
                  options={[
                    { value: "", label: "Precio base del catálogo" },
                    ...listas.map((l) => ({ value: l.id, label: l.nombre })),
                  ]}
                />
              </div>
              <p className="pb-2 text-xs text-text-muted">
                Rige las líneas que se agreguen de acá en adelante. Las ya cargadas no se retasan:
                el precio con el que entró una línea es un hecho.
              </p>
            </div>
          )}

          {coincidencias.length > 0 && (
            <ul className="mt-2 max-h-48 overflow-auto rounded-lg border border-black/10">
              {coincidencias.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => agregar(p.id)}
                    className={[
                      "block w-full px-3 py-2 text-left text-sm hover:bg-black/5",
                      presentacionId === p.id ? "bg-black/5" : "",
                    ].join(" ")}
                  >
                    <span className="font-medium">
                      {p.producto} — {p.nombre}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {p.precio ? formatearMonto(p.precio) : "sin precio"} · hay {p.existencia}{" "}
                      {p.unidad}
                      {p.existencia <= 0 && " · SIN EXISTENCIA"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                  <th className="py-2">Detalle</th>
                  <th className="py-2 text-right">Cant.</th>
                  <th className="py-2 text-right">Precio</th>
                  <th className="py-2 text-right">Desc.</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {cargos.map((c) => (
                  <tr key={c.id} className="border-b border-black/5">
                    <td className="py-2">
                      {c.descripcion}
                      {c.paciente && (
                        <span className="block text-xs text-accent">{c.paciente}</span>
                      )}
                    </td>
                    <td className="py-2 text-right">{Number(c.cantidad)}</td>
                    <td className="py-2 text-right">
                      {formatearMonto(c.precio_unitario)}
                      {c.lista_precio_nombre && (
                        <span className="block text-xs text-text-muted">
                          {c.lista_precio_nombre}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {Number(c.descuento) > 0 ? `−${formatearMonto(c.descuento)}` : "—"}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {formatearMonto(
                        Number(c.cantidad) * Number(c.precio_unitario) - Number(c.descuento)
                      )}
                    </td>
                  </tr>
                ))}
                {cargos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-text-muted">
                      Todavía no hay nada en la cuenta.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* -------------------------------------------- Total */}
        <Card>
          <CardTitle>Total</CardTitle>
          {totales && (
            <>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">Neto</dt>
                  <dd>{formatearMonto(totales.neto)}</dd>
                </div>
                {totales.descuentos > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">Descuentos</dt>
                    <dd>−{formatearMonto(totales.descuentos)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-text-muted">Impuesto</dt>
                  <dd>{formatearMonto(totales.impuesto)}</dd>
                </div>
              </dl>
              {/* El total, en grande: es el número que se lee a un metro. */}
              <p className="mt-3 border-t border-black/5 pt-3 text-3xl font-bold text-primary">
                {formatearMonto(totales.saldo)}
              </p>
              {totales.cobrado > 0 && (
                <p className="text-xs text-text-muted">
                  Ya cobrado: {formatearMonto(totales.cobrado)}
                </p>
              )}
            </>
          )}

          <Button
            className="mt-4 w-full"
            disabled={!sesionId || !totales || totales.saldo <= 0}
            onClick={() => setPanelCobro(true)}
          >
            Cobrar (F4)
          </Button>

          {/* ---------------------------------------- Panel de cobro */}
          {panelCobro && totales && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <CardTitle>Cómo paga</CardTitle>

              <div className="mt-3 space-y-2">
                <Select
                  label="Comprobante"
                  value={tipoComprobante}
                  onChange={(e) => setTipoComprobante(e.target.value as "01" | "04")}
                  options={[
                    { value: "04", label: "Tiquete electrónico" },
                    { value: "01", label: "Factura (exige cliente identificado)" },
                  ]}
                />
                {tipoComprobante === "01" && (
                  <div className="relative">
                    <Input
                      label="Cliente"
                      value={cliente?.nombre ?? buscaCliente}
                      onChange={(e) => {
                        setCliente(null);
                        setBuscaCliente(e.target.value);
                      }}
                      placeholder="Buscar por nombre, cédula o teléfono"
                    />
                    {!cliente && clientes.length > 0 && (
                      <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-auto rounded-lg border border-black/10 bg-surface shadow-lg">
                        {clientes.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
                              onClick={() => {
                                setCliente(c);
                                setClientes([]);
                              }}
                            >
                              {c.nombre}
                              <span className="block text-xs text-text-muted">
                                {c.numero_identificacion ?? "sin identificación"}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <Select
                  label="Condición de venta"
                  value={condicionVenta}
                  onChange={(e) => setCondicionVenta(e.target.value)}
                  options={[
                    { value: "01", label: "Contado" },
                    { value: "10", label: "Crédito hasta 90 días (art. 27 LIVA)" },
                  ]}
                />

                {medios.map((m, i) => (
                  <div key={i} className="rounded-lg border border-black/5 p-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select
                        label="Medio"
                        value={m.medio}
                        onChange={(e) =>
                          setMedios((ms) =>
                            ms.map((x, j) => (j === i ? { ...x, medio: e.target.value } : x))
                          )
                        }
                        options={MEDIOS}
                      />
                      <Select
                        label="Moneda"
                        value={m.moneda}
                        onChange={(e) =>
                          setMedios((ms) =>
                            ms.map((x, j) => (j === i ? { ...x, moneda: e.target.value } : x))
                          )
                        }
                        options={[
                          { value: "CRC", label: "Colones" },
                          {
                            value: "USD",
                            label: tipoCambio ? `Dólares (₡${tipoCambio})` : "Dólares (sin tipo de cambio)",
                          },
                        ]}
                      />
                      <Input
                        label="Monto"
                        value={m.monto}
                        onChange={(e) =>
                          setMedios((ms) =>
                            ms.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x))
                          )
                        }
                      />
                      {(m.medio === "02" || m.medio === "06") && (
                        <Input
                          label={m.medio === "02" ? "Autorización del datáfono" : "Referencia SINPE"}
                          value={m.referencia}
                          onChange={(e) =>
                            setMedios((ms) =>
                              ms.map((x, j) => (j === i ? { ...x, referencia: e.target.value } : x))
                            )
                          }
                        />
                      )}
                    </div>
                    {medios.length > 1 && (
                      <button
                        type="button"
                        className="mt-1 text-xs text-text-muted underline"
                        onClick={() => setMedios((ms) => ms.filter((_, j) => j !== i))}
                      >
                        quitar
                      </button>
                    )}
                  </div>
                ))}

                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() =>
                    setMedios((ms) => [...ms, { medio: "02", moneda: "CRC", monto: "", referencia: "" }])
                  }
                >
                  <Icono nombre="agregar" className="mr-1 h-4 w-4" />
                  Otro medio (pago mixto)
                </Button>

                <div className="rounded-lg bg-background p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Recibido</span>
                    <span>{formatearMonto(recibidoCrc)}</span>
                  </div>
                  {/* El vuelto, en grande: mal leído es plata perdida. */}
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-sm font-semibold">Vuelto</span>
                    <span className="text-2xl font-bold text-success">
                      {formatearMonto(vuelto)}
                    </span>
                  </div>
                </div>

                <Button className="w-full" disabled={ocupado || recibidoCrc <= 0} onClick={cobrar}>
                  {ocupado ? "Cobrando…" : "Confirmar el cobro"}
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => setPanelCobro(false)}>
                  Cancelar (Esc)
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
