import { plural } from "../../lib/plural";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Select,
  useToast,
} from "../../components/ui";
import {
  Bodega,
  DetalleProducto,
  ProductoListado,
  formatearCantidad,
  formatearMonto,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// VENTA DE MOSTRADOR MÍNIMA.
//
// Es provisoria y lo dice en la pantalla: existe solo para que la
// salida de inventario por venta quede registrada mientras no existe la
// caja. NO cobra y NO factura; el prompt 08 la reemplaza por la caja
// real, usando ESTE MISMO punto único de movimientos.
//
// Por eso no tiene medio de pago, ni vuelto, ni cliente: todo eso es de
// la caja. Ponerlo acá sería construir media caja que después habría
// que desarmar.
// ---------------------------------------------------------------------

interface LineaVenta {
  productoId: string;
  presentacionId: string;
  cantidad: string;
}

export function VentaMostrador() {
  const toast = useToast();
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [bodegaId, setBodegaId] = useState("");
  const [productos, setProductos] = useState<ProductoListado[]>([]);
  const [detalles, setDetalles] = useState<Record<string, DetalleProducto>>({});
  const [lineas, setLineas] = useState<LineaVenta[]>([
    { productoId: "", presentacionId: "", cantidad: "1" },
  ]);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    inventarioApi
      .bodegas()
      .then((r) => {
        setBodegas(r.bodegas);
        const def = r.bodegas.find((b) => b.es_default) ?? r.bodegas[0];
        if (def) setBodegaId(def.id);
      })
      .catch(() => setBodegas([]));
    inventarioApi
      .productos({ porPagina: 100 })
      .then((r) => setProductos(r.productos))
      .catch(() => setProductos([]));
  }, []);

  /** Las presentaciones se piden al elegir el producto, no todas de una. */
  const cargarDetalle = async (productoId: string) => {
    if (!productoId || detalles[productoId]) return;
    try {
      const d = await inventarioApi.producto(productoId);
      setDetalles((m) => ({ ...m, [productoId]: d }));
    } catch {
      /* si falla, la línea queda sin presentaciones y el botón no se habilita */
    }
  };

  const actualizar = (i: number, cambios: Partial<LineaVenta>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambios } : l)));

  const totalEstimado = lineas.reduce((suma, l) => {
    const d = detalles[l.productoId];
    const pres = d?.presentaciones.find((p) => p.id === l.presentacionId);
    const precio = pres?.precio_venta ? Number(pres.precio_venta) : 0;
    const cant = Number(l.cantidad.replace(",", ".")) || 0;
    return suma + precio * cant;
  }, 0);

  const completas = lineas.filter(
    (l) => l.productoId && l.presentacionId && Number(l.cantidad.replace(",", ".")) > 0
  );

  const registrar = async () => {
    setOcupado(true);
    try {
      for (const l of completas) {
        await inventarioApi.movimiento({
          tipo: "venta",
          productoId: l.productoId,
          bodegaId,
          presentacionId: l.presentacionId,
          cantidadPresentacion: l.cantidad.replace(",", "."),
        });
      }
      toast.exito(
        `${plural(completas.length, "salida registrada", "salidas registradas")}. Esto descontó inventario; no cobró ni facturó.`
      );
      setLineas([{ productoId: "", presentacionId: "", cantidad: "1" }]);
      const r = await inventarioApi.productos({ porPagina: 100 });
      setProductos(r.productos);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div>
      <Link to="/inventario" className="text-sm text-text-muted hover:text-primary">
        ← Catálogo
      </Link>
      <h2 className="mt-2 text-xl font-bold text-primary">Venta de mostrador</h2>

      <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
        <p className="font-medium text-text-primary">Esta pantalla es provisoria.</p>
        <p className="text-text-muted">
          Registra la SALIDA de inventario por venta mientras no existe la caja. No cobra, no da
          vuelto y no emite comprobante. La caja real la reemplaza, usando el mismo punto único de
          movimientos.
        </p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <CardTitle>Qué sale</CardTitle>
            <Button
              variant="secondary"
              onClick={() =>
                setLineas((ls) => [...ls, { productoId: "", presentacionId: "", cantidad: "1" }])
              }
            >
              <Icono nombre="agregar" className="mr-1 h-4 w-4" />
              Agregar línea
            </Button>
          </div>
          <CardDescription>
            Elegí la presentación: vender una caja descuenta sus unidades base, no una caja.
          </CardDescription>

          <div className="mt-3 space-y-3">
            <Select
              label="Bodega"
              value={bodegaId}
              onChange={(e) => setBodegaId(e.target.value)}
              options={bodegas.map((b) => ({ value: b.id, label: b.nombre }))}
            />

            {lineas.map((l, i) => {
              const d = detalles[l.productoId];
              const presentaciones = (d?.presentaciones ?? []).filter(
                (p) => p.activo && p.para_venta
              );
              const pres = presentaciones.find((p) => p.id === l.presentacionId);
              const cant = Number(l.cantidad.replace(",", ".")) || 0;
              const producto = productos.find((p) => p.id === l.productoId);
              return (
                <div key={i} className="grid gap-2 rounded-xl border border-black/5 p-3 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <Select
                      label="Producto"
                      value={l.productoId}
                      onChange={(e) => {
                        actualizar(i, { productoId: e.target.value, presentacionId: "" });
                        cargarDetalle(e.target.value);
                      }}
                      options={[
                        { value: "", label: "Elegí un producto" },
                        ...productos.map((p) => ({
                          value: p.id,
                          label: `${p.nombre} — hay ${formatearCantidad(p.existencia)} ${p.unidad_base}`,
                        })),
                      ]}
                    />
                  </div>
                  <Select
                    label="Presentación"
                    value={l.presentacionId}
                    onChange={(e) => actualizar(i, { presentacionId: e.target.value })}
                    options={[
                      { value: "", label: presentaciones.length ? "Elegí" : "—" },
                      ...presentaciones.map((p) => ({
                        value: p.id,
                        label: `${p.nombre} (×${formatearCantidad(p.factor)})`,
                      })),
                    ]}
                  />
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="text-sm font-semibold text-text-primary">Cantidad</label>
                      <input
                        className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                        value={l.cantidad}
                        onChange={(e) => actualizar(i, { cantidad: e.target.value })}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Quitar la línea ${i + 1}`}
                      className="mb-2 rounded p-1 text-text-muted hover:bg-black/5 hover:text-error"
                      onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Icono nombre="borrar" className="h-4 w-4" />
                    </button>
                  </div>
                  {pres && producto && (
                    <p className="text-xs text-text-muted sm:col-span-4">
                      Descuenta {formatearCantidad(cant * Number(pres.factor))} {producto.unidad_base}
                      {pres.precio_venta
                        ? ` · ${formatearMonto(Number(pres.precio_venta) * cant)}`
                        : " · sin precio cargado"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardTitle>Resumen</CardTitle>
          <CardDescription>
            El total es informativo: esta pantalla no cobra.
          </CardDescription>
          <p className="mt-4 text-2xl font-bold">{formatearMonto(totalEstimado)}</p>
          <p className="text-xs text-text-muted">{plural(completas.length, "línea lista", "líneas listas")}</p>
          <Button
            className="mt-4 w-full"
            disabled={ocupado || completas.length === 0 || !bodegaId}
            onClick={registrar}
          >
            {ocupado ? "Registrando…" : "Registrar la salida"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
