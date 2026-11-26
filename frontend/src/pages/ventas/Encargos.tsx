import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  Modal,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import { Caja, CuentaListada, Encargo, formatearMonto, ventasApi } from "../../lib/ventasApi";
import { ProductoListado, inventarioApi } from "../../lib/inventarioApi";
import { ReceptorEncontrado, facturacionCrApi } from "../../lib/facturacionCrApi";
import { plural } from "../../lib/plural";

// ---------------------------------------------------------------------
// ENCARGOS ESPECIALES: alimentos o medicamentos que se piden para un
// cliente concreto. El ciclo entero, no solo el estado:
//
//   * **anticipo** al registrarlo: entra a la caja antes de que el
//     producto exista, y queda ligado a este encargo;
//   * **pedido al proveedor** = una orden de compra del inventario, con
//     su consecutivo y su recepción. Opcional: quien pide por WhatsApp
//     cambia el estado y no carga orden;
//   * **recibido** reserva el stock. La reserva la respeta
//     `registrarMovimiento`, así que el producto apartado NO se le
//     vende a otro: el intento falla nombrando al cliente;
//   * **entregado** descarga el lote reservado, deja el cargo en una
//     cuenta y aplica el anticipo.
//
// EL AVISO AL CLIENTE no sale solo: el canal lo da el CRM. Mientras
// tanto los que están en «Recibido» son la lista de a quién llamar, y
// «Avisado» registra que se llamó. La pantalla lo dice en vez de
// simular que manda algo.
// ---------------------------------------------------------------------

const ESTADOS: Record<
  string,
  { etiqueta: string; variante: "neutral" | "info" | "warning" | "success" | "error" }
> = {
  pendiente: { etiqueta: "Pendiente de pedir", variante: "warning" },
  pedido: { etiqueta: "Pedido al proveedor", variante: "info" },
  recibido: { etiqueta: "Recibido — avisar al cliente", variante: "warning" },
  avisado: { etiqueta: "Avisado", variante: "info" },
  entregado: { etiqueta: "Entregado", variante: "success" },
  cancelado: { etiqueta: "Cancelado", variante: "error" },
};

const SIGUIENTE: Record<string, string[]> = {
  pendiente: ["pedido", "cancelado"],
  pedido: ["recibido", "cancelado"],
  recibido: ["avisado", "entregado", "cancelado"],
  avisado: ["entregado", "cancelado"],
};

const ACCION: Record<string, string> = {
  pedido: "Pedir",
  recibido: "Llegó",
  avisado: "Avisé al cliente",
  entregado: "Entregar",
  cancelado: "Cancelar",
};

export function Encargos() {
  const toast = useToast();
  const [encargos, setEncargos] = useState<Encargo[]>([]);
  const [productos, setProductos] = useState<ProductoListado[]>([]);
  const [cuentas, setCuentas] = useState<CuentaListada[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [proveedores, setProveedores] = useState<Array<Record<string, string>>>([]);
  const [ocupado, setOcupado] = useState(false);

  const [creando, setCreando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [clientes, setClientes] = useState<ReceptorEncontrado[]>([]);
  const [cliente, setCliente] = useState<ReceptorEncontrado | null>(null);
  const [nuevo, setNuevo] = useState({
    productoId: "",
    descripcion: "",
    cantidad: "1",
    anticipo: "",
  });

  // El paso que necesita datos extra abre su propio panel. `cual` es el
  // encargo y `paso` lo que se está haciendo con él.
  const [paso, setPaso] = useState<{ encargo: Encargo; estado: string } | null>(null);
  const [datosPaso, setDatosPaso] = useState({
    proveedorId: "",
    presentacionId: "",
    costoUnitario: "",
    cuentaId: "",
    precioUnitario: "",
    motivo: "",
  });
  const [presentaciones, setPresentaciones] = useState<
    Array<{ id: string; nombre: string; precio_venta: string | null }>
  >([]);

  const sesionAbierta = cajas.find((c) => c.sesion_abierta)?.sesion_abierta ?? "";

  const recargar = () =>
    ventasApi
      .encargos()
      .then((r) => setEncargos(r.encargos))
      .catch(() => setEncargos([]));

  useEffect(() => {
    recargar();
    inventarioApi
      .productos({ porPagina: 100 })
      .then((r) => setProductos(r.productos))
      .catch(() => setProductos([]));
    inventarioApi
      .proveedores()
      .then((r) => setProveedores(r.proveedores))
      .catch(() => setProveedores([]));
    ventasApi
      .cuentas("abierta")
      .then((r) => setCuentas(r.cuentas))
      .catch(() => setCuentas([]));
    ventasApi
      .cajas()
      .then((r) => setCajas(r.cajas))
      .catch(() => setCajas([]));
  }, []);

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setClientes([]);
      return;
    }
    const t = setTimeout(() => {
      facturacionCrApi
        .buscarClientes(busqueda)
        .then((r) => setClientes(r.clientes))
        .catch(() => setClientes([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  /** Las presentaciones del producto del encargo, para pedir y entregar. */
  const cargarPresentaciones = async (productoId: string | null) => {
    if (!productoId) {
      setPresentaciones([]);
      return;
    }
    try {
      const d = await inventarioApi.producto(productoId);
      setPresentaciones(d.presentaciones);
    } catch {
      setPresentaciones([]);
    }
  };

  const crear = async () => {
    if (!cliente) return;
    const anticipo = Number(nuevo.anticipo.replace(",", ".")) || 0;
    if (anticipo > 0 && !sesionAbierta) {
      toast.error(
        "Un anticipo entra a una caja y no hay ninguna sesión abierta. Abrí la caja primero o registrá el encargo sin anticipo."
      );
      return;
    }
    setOcupado(true);
    try {
      const r = await ventasApi.crearEncargo({
        propietarioId: cliente.id,
        productoId: nuevo.productoId || undefined,
        descripcion:
          nuevo.descripcion.trim() ||
          productos.find((p) => p.id === nuevo.productoId)?.nombre ||
          "Encargo",
        cantidad: Number(nuevo.cantidad.replace(",", ".")) || 1,
        anticipo: anticipo > 0 ? anticipo : undefined,
        sesionId: anticipo > 0 ? sesionAbierta : undefined,
      });
      toast.exito(
        r.anticipoId
          ? `Encargo registrado con un anticipo de ${formatearMonto(anticipo)}, que queda como saldo a favor del cliente.`
          : "Encargo registrado."
      );
      setCreando(false);
      setCliente(null);
      setNuevo({ productoId: "", descripcion: "", cantidad: "1", anticipo: "" });
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  /** Los pasos que no necesitan datos se hacen de una. */
  const avanzar = async (e: Encargo, estado: string) => {
    if (estado === "pedido" || estado === "entregado" || estado === "cancelado") {
      setDatosPaso({
        proveedorId: "",
        presentacionId: "",
        costoUnitario: "",
        cuentaId: "",
        precioUnitario: "",
        motivo: "",
      });
      await cargarPresentaciones(e.producto_id);
      setPaso({ encargo: e, estado });
      return;
    }
    setOcupado(true);
    try {
      const r = await ventasApi.estadoEncargo(e.id, estado);
      toast.exito(
        estado === "recibido"
          ? `Llegó y queda reservado: ${plural(Number(r.reservado ?? 0), "unidad apartada", "unidades apartadas")}, no se le venden a otro cliente.`
          : "Marcado como avisado. El aviso automático llega con el CRM."
      );
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const confirmarPaso = async () => {
    if (!paso) return;
    setOcupado(true);
    try {
      const cuerpo: Record<string, unknown> =
        paso.estado === "pedido"
          ? {
              proveedorId: datosPaso.proveedorId || undefined,
              presentacionId: datosPaso.presentacionId || undefined,
              bodegaId: cajas.find((c) => c.sesion_abierta)?.bodega_id,
              costoUnitario: Number(datosPaso.costoUnitario.replace(",", ".")) || undefined,
            }
          : paso.estado === "entregado"
            ? {
                cuentaId: datosPaso.cuentaId,
                presentacionId: datosPaso.presentacionId || undefined,
                precioUnitario: Number(datosPaso.precioUnitario.replace(",", ".")) || undefined,
              }
            : { motivo: datosPaso.motivo };

      const r = await ventasApi.estadoEncargo(paso.encargo.id, paso.estado, cuerpo);

      if (paso.estado === "pedido") {
        toast.exito(
          r.numeroOrden
            ? `Pedido con la orden de compra #${r.numeroOrden}. Al recibirla, el stock entra por Compras.`
            : "Marcado como pedido, sin orden de compra en el sistema."
        );
      } else if (paso.estado === "entregado") {
        toast.exito(
          `Entregado. Quedó el cargo en la cuenta` +
            (r.anticipoDisponible
              ? `. Al cobrarla, aplicá ${formatearMonto(r.anticipoDisponible)} con el medio «anticipo»: el saldo a favor se descuenta ahí, no acá.`
              : ". El cliente no tenía anticipo pendiente.")
        );
      } else {
        toast.exito(
          `Encargo cancelado. El anticipo NO se borra: le quedan ${formatearMonto(r.saldoAFavorDelCliente ?? 0)} a favor.`
        );
      }
      setPaso(null);
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<Encargo>[] = [
    {
      key: "encargo",
      header: "Encargo",
      render: (e) => (
        <>
          <span className="font-medium">{e.descripcion}</span>
          <span className="block text-xs text-text-muted">
            {Number(e.cantidad)} · {e.cliente}
            {e.orden_numero ? ` · orden #${e.orden_numero}` : ""}
          </span>
        </>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (e) => (
        <>
          <Badge variant={ESTADOS[e.estado]?.variante ?? "neutral"} dot>
            {ESTADOS[e.estado]?.etiqueta ?? e.estado}
          </Badge>
          {Number(e.cantidad_reservada) > 0 && (
            <span className="mt-1 block text-xs text-text-muted">
              {plural(Number(e.cantidad_reservada), "reservada", "reservadas")}
            </span>
          )}
        </>
      ),
    },
    {
      key: "anticipo",
      header: "Anticipo",
      render: (e) =>
        Number(e.anticipo) > 0 ? (
          <>
            {formatearMonto(e.anticipo)}
            <span className="block text-xs text-text-muted">
              {Number(e.anticipo_disponible) > 0
                ? `${formatearMonto(e.anticipo_disponible)} sin aplicar`
                : "ya aplicado"}
            </span>
          </>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      key: "fecha",
      header: "Pedido el",
      render: (e) => new Date(e.creado_en).toLocaleDateString("es-CR"),
    },
    {
      key: "acciones",
      header: "",
      render: (e) => (
        <div className="flex flex-wrap gap-2">
          {(SIGUIENTE[e.estado] ?? []).map((s) => (
            <Button
              key={s}
              variant={s === "cancelado" ? "secondary" : "primary"}
              disabled={ocupado}
              onClick={() => avanzar(e, s)}
            >
              {ACCION[s] ?? s}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  const porAvisar = encargos.filter((e) => e.estado === "recibido").length;

  return (
    <div>
      <Link to="/ventas" className="text-sm text-text-muted hover:text-primary">
        ← Caja
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">Encargos</h2>
          <p className="mt-1 text-sm text-text-muted">
            {porAvisar > 0
              ? `${plural(porAvisar, "encargo llegó", "encargos llegaron")} y hay que avisarle al cliente.`
              : "Nada pendiente de avisar."}
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>
          <Icono nombre="agregar" className="mr-1 h-4 w-4" />
          Nuevo encargo
        </Button>
      </div>

      <Card className="mt-6">
        <CardDescription>
          Al marcarlo recibido se reserva el stock, y el reservado no se le puede vender a otro: el
          intento falla nombrando al cliente que lo espera. El aviso automático llega con el CRM;
          mientras tanto, los que están en «Recibido» son la lista de a quién hay que llamar.
        </CardDescription>
        <div className="mt-3">
          <Table
            columns={columnas}
            data={encargos}
            rowKey={(e) => e.id}
            emptyMessage="Todavía no hay encargos."
          />
        </div>
      </Card>

      {/* ------------------------------------------- Nuevo encargo */}
      <Modal
        open={creando}
        onClose={() => setCreando(false)}
        title="Nuevo encargo"
        ancho="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreando(false)}>
              Cancelar
            </Button>
            <Button disabled={ocupado || !cliente} onClick={crear}>
              Registrar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="relative">
            <Input
              label="Cliente"
              value={cliente?.nombre ?? busqueda}
              onChange={(e) => {
                setCliente(null);
                setBusqueda(e.target.value);
              }}
              placeholder="Buscar por nombre, identificación o teléfono"
            />
            {clientes.length > 0 && (
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
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Select
            label="Producto del catálogo (opcional)"
            value={nuevo.productoId}
            onChange={(e) => setNuevo({ ...nuevo, productoId: e.target.value })}
            options={[
              { value: "", label: "No está en el catálogo" },
              ...productos.map((p) => ({ value: p.id, label: p.nombre })),
            ]}
          />
          <Input
            label="Descripción"
            value={nuevo.descripcion}
            onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })}
            placeholder="Alimento renal 7,5 kg"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Cantidad"
              value={nuevo.cantidad}
              onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value })}
            />
            <Input
              label="Anticipo (opcional)"
              value={nuevo.anticipo}
              onChange={(e) => setNuevo({ ...nuevo, anticipo: e.target.value })}
              placeholder="0"
            />
          </div>
          <p className="text-xs text-text-muted">
            El anticipo entra a la caja y queda como <strong>saldo a favor</strong> del cliente,
            ligado a este encargo: no emite comprobante al recibirse y se aplica al entregarlo.
            {sesionAbierta ? "" : " Hace falta una sesión de caja abierta para recibirlo."}
          </p>
        </div>
      </Modal>

      {/* -------------------------------- Pedir / entregar / cancelar */}
      <Modal
        open={paso !== null}
        onClose={() => setPaso(null)}
        title={
          paso?.estado === "pedido"
            ? "Pedir al proveedor"
            : paso?.estado === "entregado"
              ? "Entregar el encargo"
              : "Cancelar el encargo"
        }
        ancho="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPaso(null)}>
              Volver
            </Button>
            <Button
              disabled={ocupado || (paso?.estado === "entregado" && !datosPaso.cuentaId)}
              onClick={confirmarPaso}
            >
              {paso ? (ACCION[paso.estado] ?? "Confirmar") : "Confirmar"}
            </Button>
          </div>
        }
      >
        {paso?.estado === "pedido" && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              Si decís proveedor y presentación, se crea la <strong>orden de compra</strong> del
              inventario y queda ligada al encargo, así el pedido no se carga dos veces. Si pedís
              por fuera del sistema, dejalo vacío y solo se cambia el estado.
            </p>
            <Select
              label="Proveedor"
              value={datosPaso.proveedorId}
              onChange={(e) => setDatosPaso({ ...datosPaso, proveedorId: e.target.value })}
              options={[
                { value: "", label: "Sin orden en el sistema" },
                ...proveedores.map((p) => ({ value: p.id, label: p.nombre ?? p.id })),
              ]}
            />
            {datosPaso.proveedorId && (
              <>
                <Select
                  label="Presentación de compra"
                  value={datosPaso.presentacionId}
                  onChange={(e) => setDatosPaso({ ...datosPaso, presentacionId: e.target.value })}
                  options={[
                    { value: "", label: "Elegí la presentación" },
                    ...presentaciones.map((p) => ({ value: p.id, label: p.nombre })),
                  ]}
                />
                <Input
                  label="Costo unitario (opcional)"
                  value={datosPaso.costoUnitario}
                  onChange={(e) => setDatosPaso({ ...datosPaso, costoUnitario: e.target.value })}
                />
                {!paso.encargo.producto_id && (
                  <p className="text-sm text-error">
                    Este encargo no apunta a un producto del catálogo, así que no se puede armar la
                    orden. Se pide por fuera.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {paso?.estado === "entregado" && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              Entregar <strong>descarga el lote reservado</strong>, deja el cargo en una cuenta y
              aplica el anticipo. Después se cobra desde la pantalla de cobro, como cualquier venta.
            </p>
            <Select
              label="Cuenta donde queda el cargo"
              value={datosPaso.cuentaId}
              onChange={(e) => setDatosPaso({ ...datosPaso, cuentaId: e.target.value })}
              options={[
                { value: "", label: "Elegí la cuenta" },
                ...cuentas.map((c) => ({
                  value: c.id,
                  label: `#${c.numero} ${c.cliente_nombre ?? "sin cliente"}`,
                })),
              ]}
            />
            {presentaciones.length > 0 && (
              <Select
                label="Presentación que se entrega"
                value={datosPaso.presentacionId}
                onChange={(e) => setDatosPaso({ ...datosPaso, presentacionId: e.target.value })}
                options={[
                  { value: "", label: "En unidad base" },
                  ...presentaciones.map((p) => ({ value: p.id, label: p.nombre })),
                ]}
              />
            )}
            <Input
              label="Precio unitario (vacío = el del catálogo)"
              value={datosPaso.precioUnitario}
              onChange={(e) => setDatosPaso({ ...datosPaso, precioUnitario: e.target.value })}
            />
            {Number(paso.encargo.anticipo_disponible) > 0 && (
              <p className="rounded-lg bg-background p-3 text-sm">
                El cliente tiene {formatearMonto(paso.encargo.anticipo_disponible)} de anticipo sin
                aplicar: se descuentan de este cargo.
              </p>
            )}
          </div>
        )}

        {paso?.estado === "cancelado" && (
          <div className="space-y-3">
            <Input
              label="Motivo"
              value={datosPaso.motivo}
              onChange={(e) => setDatosPaso({ ...datosPaso, motivo: e.target.value })}
              placeholder="El proveedor lo discontinuó"
            />
            <p className="text-sm text-text-muted">
              Se libera la reserva. El anticipo <strong>no se borra</strong>: queda como saldo a
              favor del cliente, porque eso es lo que es. Devolverlo en efectivo es una devolución
              y pasa por su aprobación.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
