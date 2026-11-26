import { plural } from "../../lib/plural";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Input,
  Modal,
  Select,
  Table,
  TableColumn,
  useToast,
  PageHeader,
} from "../../components/ui";
import {
  Bodega,
  LineaOrdenDetalle,
  LineaSugerida,
  OrdenListada,
  formatearCantidad,
  formatearMonto,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// Compras: la orden sugerida, las órdenes con sus estados y la
// recepción.
//
// La sugerida muestra SU EXPLICACIÓN línea por línea. Es la diferencia
// entre una pantalla que propone números y una que se puede aprobar:
// nadie firma una orden de compra porque un sistema dijo "pedí 3".
//
// La recepción se captura en la PRESENTACIÓN DE COMPRA (cajas) y el
// backend la convierte; lo que se compara contra lo pedido es la unidad
// base, que es donde las dos cantidades son comparables.
// ---------------------------------------------------------------------

const ESTADOS: Record<string, { etiqueta: string; variante: "success" | "warning" | "info" | "neutral" | "error" }> = {
  sugerida: { etiqueta: "Sugerida", variante: "neutral" },
  aprobada: { etiqueta: "Aprobada", variante: "info" },
  enviada: { etiqueta: "Enviada al proveedor", variante: "info" },
  recibida_parcial: { etiqueta: "Recibida parcial", variante: "warning" },
  recibida: { etiqueta: "Recibida", variante: "success" },
  cancelada: { etiqueta: "Cancelada", variante: "error" },
};

export function Compras() {
  const toast = useToast();
  const [proveedores, setProveedores] = useState<Array<Record<string, string>>>([]);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenListada[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [sugerida, setSugerida] = useState<LineaSugerida[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [ordenAbierta, setOrdenAbierta] = useState<{
    orden: OrdenListada;
    lineas: LineaOrdenDetalle[];
  } | null>(null);
  const [recepcion, setRecepcion] = useState<Record<string, { cantidad: string; lote: string; vencimiento: string; costo: string }>>({});
  const [factura, setFactura] = useState("");

  const recargar = () =>
    inventarioApi.ordenes().then((r) => setOrdenes(r.ordenes)).catch(() => setOrdenes([]));

  useEffect(() => {
    inventarioApi.proveedores().then((r) => setProveedores(r.proveedores)).catch(() => setProveedores([]));
    inventarioApi
      .bodegas()
      .then((r) => {
        setBodegas(r.bodegas);
        const def = r.bodegas.find((b) => b.es_default) ?? r.bodegas[0];
        if (def) setBodegaId(def.id);
      })
      .catch(() => setBodegas([]));
    recargar();
  }, []);

  const pedirSugerida = async () => {
    setOcupado(true);
    try {
      const r = await inventarioApi.ordenSugerida(proveedorId);
      setSugerida(r.lineas);
      if (r.lineas.length === 0) {
        toast.aviso("Con el consumo y la existencia de hoy, a ese proveedor no hay que pedirle nada.");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const crearDesdeSugerida = async () => {
    if (!sugerida || sugerida.length === 0) return;
    setOcupado(true);
    try {
      const r = await inventarioApi.crearOrden({
        proveedorId,
        bodegaId,
        estado: "sugerida",
        lineas: sugerida.map((l) => ({
          productoId: l.productoId,
          presentacionId: l.presentacionId,
          cantidadPedida: l.cantidadPedida,
          costoUnitario: l.costoUnitario,
          explicacion: l.explicacion,
        })),
      });
      toast.exito(`Orden ${r.numero} creada.`);
      setSugerida(null);
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const abrirOrden = async (id: string) => {
    try {
      const d = await inventarioApi.orden(id);
      setOrdenAbierta(d);
      setFactura(d.orden.factura_proveedor ?? "");
      const inicial: typeof recepcion = {};
      for (const l of d.lineas) {
        const faltanBase = Number(l.cantidad_pedida) * Number(l.factor) - Number(l.cantidad_recibida_base);
        inicial[l.id] = {
          cantidad: faltanBase > 0 ? String(faltanBase / Number(l.factor)) : "0",
          lote: "",
          vencimiento: "",
          costo: String(Number(l.costo_unitario) || ""),
        };
      }
      setRecepcion(inicial);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const cambiarEstado = async (id: string, estado: string) => {
    setOcupado(true);
    try {
      await inventarioApi.cambiarEstadoOrden(id, estado);
      toast.exito(
        estado === "enviada"
          ? "Orden marcada como enviada. En desarrollo no sale ningún correo real."
          : "Orden actualizada."
      );
      await recargar();
      if (ordenAbierta?.orden.id === id) await abrirOrden(id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const recibir = async () => {
    if (!ordenAbierta) return;
    const lineas = Object.entries(recepcion)
      .filter(([, v]) => Number(v.cantidad.replace(",", ".")) > 0 && v.lote.trim())
      .map(([lineaId, v]) => ({
        lineaId,
        cantidadRecibida: v.cantidad.replace(",", "."),
        lote: { numero: v.lote.trim(), vencimiento: v.vencimiento || null },
        costoUnitario: v.costo ? v.costo.replace(",", ".") : undefined,
      }));
    if (lineas.length === 0) {
      toast.aviso("Para recibir hace falta al menos una línea con cantidad y número de lote.");
      return;
    }
    setOcupado(true);
    try {
      const r = await inventarioApi.recibirOrden(ordenAbierta.orden.id, {
        lineas,
        facturaProveedor: factura.trim() || undefined,
      });
      const faltan = r.diferencias.filter((d) => Number(d.faltanBase) > 0);
      toast.exito(
        r.estado === "recibida"
          ? "Orden recibida completa."
          : `Recepción parcial. Falta recibir ${plural(faltan.length, "línea", "líneas")}.`
      );
      await recargar();
      await abrirOrden(ordenAbierta.orden.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<OrdenListada>[] = [
    {
      key: "numero",
      header: "Orden",
      render: (o) => (
        <button type="button" className="text-left hover:underline" onClick={() => abrirOrden(o.id)}>
          <span className="font-medium text-primary">#{o.numero}</span>
          <span className="block text-xs text-text-muted">{plural(o.lineas, "línea", "líneas")}</span>
        </button>
      ),
    },
    { key: "proveedor", header: "Proveedor", render: (o) => o.proveedor },
    { key: "bodega", header: "Entra a", render: (o) => o.bodega },
    {
      key: "estado",
      header: "Estado",
      render: (o) => (
        <Badge variant={ESTADOS[o.estado]?.variante ?? "neutral"} dot>
          {ESTADOS[o.estado]?.etiqueta ?? o.estado}
        </Badge>
      ),
    },
    {
      key: "factura",
      header: "Factura del proveedor",
      render: (o) => <span className="text-sm">{o.factura_proveedor ?? "—"}</span>,
    },
    {
      key: "acciones",
      header: "",
      render: (o) => (
        <div className="flex flex-wrap gap-2">
          {o.estado === "sugerida" && (
            <Button variant="secondary" disabled={ocupado} onClick={() => cambiarEstado(o.id, "aprobada")}>
              Aprobar
            </Button>
          )}
          {o.estado === "aprobada" && (
            <Button variant="secondary" disabled={ocupado} onClick={() => cambiarEstado(o.id, "enviada")}>
              Enviar
            </Button>
          )}
          {["aprobada", "enviada", "recibida_parcial"].includes(o.estado) && (
            <Button disabled={ocupado} onClick={() => abrirOrden(o.id)}>
              Recibir
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        titulo="Compras"
        icono="caja"
        modulo="inventario"
      />

      <Card className="mt-6">
        <CardTitle>Orden sugerida</CardTitle>
        <CardDescription>
          Calculada con el consumo real de los últimos 90 días, el tiempo de entrega del proveedor,
          los días de seguridad y el punto de reorden. Cada línea dice de dónde salió su cantidad.
        </CardDescription>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Select
            label="Proveedor"
            value={proveedorId}
            onChange={(e) => {
              setProveedorId(e.target.value);
              setSugerida(null);
            }}
            options={[
              { value: "", label: "Elegí un proveedor" },
              ...proveedores.map((p) => ({ value: p.id, label: p.nombre })),
            ]}
          />
          <Select
            label="Entra a la bodega"
            value={bodegaId}
            onChange={(e) => setBodegaId(e.target.value)}
            options={bodegas.map((b) => ({ value: b.id, label: b.nombre }))}
          />
          <div className="flex items-end">
            <Button className="w-full" disabled={ocupado || !proveedorId} onClick={pedirSugerida}>
              Calcular
            </Button>
          </div>
        </div>

        {sugerida && sugerida.length > 0 && (
          <div className="mt-4">
            <ul className="space-y-2">
              {sugerida.map((l) => (
                <li key={l.presentacionId} className="rounded-xl border border-black/5 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{l.productoNombre}</span>
                    <span className="font-semibold">
                      {l.cantidadPedida} × {l.presentacionNombre}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{l.explicacion}</p>
                </li>
              ))}
            </ul>
            <Button className="mt-3" disabled={ocupado || !bodegaId} onClick={crearDesdeSugerida}>
              Crear la orden con estas líneas
            </Button>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle>Órdenes</CardTitle>
        <div className="mt-3">
          <Table
            columns={columnas}
            data={ordenes}
            rowKey={(o) => o.id}
            emptyMessage="Todavía no hay órdenes de compra."
          />
        </div>
      </Card>

      {/* ------------------------------------------------ Recepción */}
      <Modal
        open={!!ordenAbierta}
        onClose={() => setOrdenAbierta(null)}
        title={ordenAbierta ? `Recibir la orden #${ordenAbierta.orden.numero}` : ""}
        description="Se captura en la presentación de compra. Lo que se compara contra lo pedido es la unidad base."
        ancho="xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOrdenAbierta(null)}>
              Cerrar
            </Button>
            <Button disabled={ocupado} onClick={recibir}>
              Registrar la recepción
            </Button>
          </div>
        }
      >
        {ordenAbierta && (
          <div className="space-y-3">
            <Input
              label="Número de la factura del proveedor"
              value={factura}
              onChange={(e) => setFactura(e.target.value)}
              placeholder="FAC-00123"
            />
            {ordenAbierta.lineas.map((l) => {
              const pedidoBase = Number(l.cantidad_pedida) * Number(l.factor);
              const recibidoBase = Number(l.cantidad_recibida_base);
              const faltan = pedidoBase - recibidoBase;
              const v = recepcion[l.id] ?? { cantidad: "", lote: "", vencimiento: "", costo: "" };
              return (
                <div key={l.id} className="rounded-xl border border-black/5 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{l.producto}</span>
                    <span className="text-sm text-text-muted">
                      pedido {formatearCantidad(l.cantidad_pedida)} × {l.presentacion} ={" "}
                      {formatearCantidad(pedidoBase)} {l.unidad_base}
                      {recibidoBase > 0 &&
                        ` · recibido ${formatearCantidad(recibidoBase)} · ${
                          faltan > 0 ? `faltan ${formatearCantidad(faltan)}` : "completo"
                        }`}
                    </span>
                  </div>
                  {l.explicacion && (
                    <p className="mt-1 text-xs text-text-muted">{l.explicacion}</p>
                  )}
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <Input
                      label={`Cantidad (${l.presentacion})`}
                      value={v.cantidad}
                      onChange={(e) =>
                        setRecepcion((r) => ({ ...r, [l.id]: { ...v, cantidad: e.target.value } }))
                      }
                    />
                    <Input
                      label="Lote"
                      value={v.lote}
                      onChange={(e) =>
                        setRecepcion((r) => ({ ...r, [l.id]: { ...v, lote: e.target.value } }))
                      }
                      placeholder="L-2026-11"
                    />
                    <div>
                      <label className="text-sm font-semibold text-text-primary">Vencimiento</label>
                      <input
                        type="date"
                        className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                        value={v.vencimiento}
                        onChange={(e) =>
                          setRecepcion((r) => ({ ...r, [l.id]: { ...v, vencimiento: e.target.value } }))
                        }
                      />
                    </div>
                    <Input
                      label={`Costo por ${l.unidad_base}`}
                      value={v.costo}
                      onChange={(e) =>
                        setRecepcion((r) => ({ ...r, [l.id]: { ...v, costo: e.target.value } }))
                      }
                    />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    Si el proveedor bonificó unidades, poné acá el costo REAL por unidad base
                    (lo pagado entre lo recibido): es lo que hace que el margen salga bien.
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
