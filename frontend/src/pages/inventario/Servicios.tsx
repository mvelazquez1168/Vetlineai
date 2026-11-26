import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
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
import {
  CatalogosInventario,
  DetalleProducto,
  ProductoListado,
  Servicio,
  formatearCantidad,
  formatearMonto,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// Servicios y su RECETA DE INSUMOS.
//
// La receta es qué consume el servicio cada vez que se realiza: una
// castración gasta anestésico en ml, suturas en unidades y algodón en
// gramos. La atención la va a usar para descargar los insumos sola
// (prompt 07); acá se define y se ve su costo.
//
// El COSTO DE INSUMOS lo calcula el backend con el costo real de los
// lotes, no con un precio de lista. Es lo que permite ver que un
// servicio se está vendiendo por debajo de lo que cuesta hacerlo.
// ---------------------------------------------------------------------

export function Servicios() {
  const toast = useToast();
  const [catalogos, setCatalogos] = useState<CatalogosInventario | null>(null);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [productos, setProductos] = useState<ProductoListado[]>([]);
  const [detalles, setDetalles] = useState<Record<string, DetalleProducto>>({});
  const [ocupado, setOcupado] = useState(false);

  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({
    codigo: "",
    nombre: "",
    lineaNegocio: "consulta",
    especialidad: "",
    codigoCabys: "",
    codigoTarifaIva: "04",
    precio: "",
    duracionMin: "",
  });

  const [abierto, setAbierto] = useState<{
    servicio: Servicio;
    insumos: Array<Record<string, string>>;
  } | null>(null);
  const [insumoProducto, setInsumoProducto] = useState("");
  const [insumoPresentacion, setInsumoPresentacion] = useState("");
  const [insumoCantidad, setInsumoCantidad] = useState("1");

  const recargar = () =>
    inventarioApi.servicios().then((r) => setServicios(r.servicios)).catch(() => setServicios([]));

  useEffect(() => {
    inventarioApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
    inventarioApi
      .productos({ porPagina: 100 })
      .then((r) => setProductos(r.productos))
      .catch(() => setProductos([]));
    recargar();
  }, []);

  const cargarDetalle = async (productoId: string) => {
    if (!productoId || detalles[productoId]) return;
    try {
      const d = await inventarioApi.producto(productoId);
      setDetalles((m) => ({ ...m, [productoId]: d }));
    } catch {
      /* sin presentaciones, el botón no se habilita */
    }
  };

  const crear = async () => {
    setOcupado(true);
    try {
      await inventarioApi.crearServicio({
        codigo: nuevo.codigo.trim(),
        nombre: nuevo.nombre.trim(),
        lineaNegocio: nuevo.lineaNegocio,
        especialidad: nuevo.especialidad || null,
        codigoCabys: nuevo.codigoCabys.trim() || null,
        codigoTarifaIva: nuevo.codigoTarifaIva || null,
        precio: Number(nuevo.precio.replace(",", ".")) || 0,
        duracionMin: nuevo.duracionMin ? Number(nuevo.duracionMin) : null,
      });
      toast.exito("Servicio creado.");
      setCreando(false);
      setNuevo({ ...nuevo, codigo: "", nombre: "", precio: "", duracionMin: "" });
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const abrir = async (id: string) => {
    try {
      setAbierto(await inventarioApi.servicio(id));
      setInsumoProducto("");
      setInsumoPresentacion("");
      setInsumoCantidad("1");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const agregarInsumo = async () => {
    if (!abierto) return;
    setOcupado(true);
    try {
      await inventarioApi.agregarInsumo(abierto.servicio.id, {
        presentacionId: insumoPresentacion,
        cantidad: Number(insumoCantidad.replace(",", ".")),
      });
      await abrir(abierto.servicio.id);
      await recargar();
      toast.exito("Insumo agregado a la receta.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<Servicio>[] = [
    {
      key: "nombre",
      header: "Servicio",
      render: (s) => (
        <button type="button" className="text-left hover:underline" onClick={() => abrir(s.id)}>
          <span className="font-medium text-primary">{s.nombre}</span>
          <span className="block text-xs text-text-muted">{s.codigo}</span>
        </button>
      ),
    },
    {
      key: "linea",
      header: "Línea / especialidad",
      render: (s) => (
        <span className="text-sm">
          {catalogos?.lineasNegocio.find((l) => l.codigo === s.linea_negocio)?.nombre ??
            s.linea_negocio}
          {s.especialidad && (
            <span className="block text-xs text-text-muted">
              {catalogos?.especialidades.find((e) => e.codigo === s.especialidad)?.nombre}
            </span>
          )}
        </span>
      ),
    },
    { key: "precio", header: "Precio", className: "text-right", render: (s) => formatearMonto(s.precio) },
    {
      key: "costo",
      header: "Costo de insumos",
      className: "text-right",
      render: (s) => {
        const costo = Number(s.costo_insumos);
        const precio = Number(s.precio);
        const pierde = precio > 0 && costo > precio;
        return (
          <span className={pierde ? "font-semibold text-error" : ""}>
            {formatearMonto(costo)}
            {pierde && <span className="block text-xs">cuesta más de lo que se cobra</span>}
          </span>
        );
      },
    },
    {
      key: "duracion",
      header: "Duración",
      render: (s) => <span className="text-sm">{s.duracion_min ? `${s.duracion_min} min` : "—"}</span>,
    },
  ];

  const presentaciones = (detalles[insumoProducto]?.presentaciones ?? []).filter(
    (p) => p.activo && (p.para_consumo || p.para_venta)
  );

  return (
    <div>
      <Link to="/inventario" className="text-sm text-text-muted hover:text-primary">
        ← Catálogo
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">Servicios</h2>
          <p className="mt-1 text-sm text-text-muted">
            Con su receta de insumos: qué consume cada vez que se realiza.
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>
          <Icono nombre="agregar" className="mr-1 h-4 w-4" />
          Nuevo servicio
        </Button>
      </div>

      <Card className="mt-6">
        <Table
          columns={columnas}
          data={servicios}
          rowKey={(s) => s.id}
          emptyMessage="Todavía no hay servicios."
        />
      </Card>

      {/* ------------------------------------------- Nuevo servicio */}
      <Modal
        open={creando}
        onClose={() => setCreando(false)}
        title="Nuevo servicio"
        ancho="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreando(false)}>
              Cancelar
            </Button>
            <Button disabled={ocupado || !nuevo.codigo.trim() || !nuevo.nombre.trim()} onClick={crear}>
              Crear
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Código"
            value={nuevo.codigo}
            onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}
            placeholder="SRV-001"
          />
          <Input
            label="Nombre"
            value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            placeholder="Castración de gata"
          />
          <Select
            label="Línea de negocio"
            value={nuevo.lineaNegocio}
            onChange={(e) => setNuevo({ ...nuevo, lineaNegocio: e.target.value })}
            options={(catalogos?.lineasNegocio ?? []).map((l) => ({ value: l.codigo, label: l.nombre }))}
          />
          <Select
            label="Especialidad"
            value={nuevo.especialidad}
            onChange={(e) => setNuevo({ ...nuevo, especialidad: e.target.value })}
            options={[
              { value: "", label: "Sin especialidad" },
              ...(catalogos?.especialidades ?? []).map((e) => ({ value: e.codigo, label: e.nombre })),
            ]}
          />
          <Input
            label="Código CABYS"
            value={nuevo.codigoCabys}
            onChange={(e) => setNuevo({ ...nuevo, codigoCabys: e.target.value })}
            maxLength={13}
            placeholder="8351000000000"
          />
          <Select
            label="Tarifa de impuesto"
            value={nuevo.codigoTarifaIva}
            onChange={(e) => setNuevo({ ...nuevo, codigoTarifaIva: e.target.value })}
            options={(catalogos?.tarifasIva ?? []).map((t) => ({ value: t.codigo, label: t.nombre }))}
          />
          <Input
            label="Precio"
            value={nuevo.precio}
            onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })}
            placeholder="45000"
          />
          <Input
            label="Duración estándar (min)"
            value={nuevo.duracionMin}
            onChange={(e) => setNuevo({ ...nuevo, duracionMin: e.target.value })}
            placeholder="60"
          />
        </div>
      </Modal>

      {/* ------------------------------------------- Receta de insumos */}
      <Modal
        open={!!abierto}
        onClose={() => setAbierto(null)}
        title={abierto ? `Receta de insumos — ${abierto.servicio.nombre}` : ""}
        description="Lo que el servicio consume cada vez que se realiza. La atención lo va a descargar sola."
        ancho="lg"
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setAbierto(null)}>
              Cerrar
            </Button>
          </div>
        }
      >
        {abierto && (
          <>
            <ul className="space-y-2">
              {abierto.insumos.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{i.producto}</span>
                    <span className="block text-xs text-text-muted">
                      {formatearCantidad(i.cantidad)} × {i.presentacion} ={" "}
                      {formatearCantidad(Number(i.cantidad) * Number(i.factor))} {i.unidad_base}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-xs text-text-muted underline hover:text-error"
                    onClick={async () => {
                      await inventarioApi.quitarInsumo(abierto.servicio.id, i.id);
                      await abrir(abierto.servicio.id);
                      await recargar();
                    }}
                  >
                    quitar
                  </button>
                </li>
              ))}
              {abierto.insumos.length === 0 && (
                <li className="text-sm text-text-muted">
                  Sin insumos. Un servicio sin receta no descarga nada al realizarse.
                </li>
              )}
            </ul>

            <div className="mt-4 grid gap-2 border-t border-black/5 pt-4 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Select
                  label="Producto"
                  value={insumoProducto}
                  onChange={(e) => {
                    setInsumoProducto(e.target.value);
                    setInsumoPresentacion("");
                    cargarDetalle(e.target.value);
                  }}
                  options={[
                    { value: "", label: "Elegí un producto" },
                    ...productos.map((p) => ({ value: p.id, label: p.nombre })),
                  ]}
                />
              </div>
              <Select
                label="Presentación"
                value={insumoPresentacion}
                onChange={(e) => setInsumoPresentacion(e.target.value)}
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
                    value={insumoCantidad}
                    onChange={(e) => setInsumoCantidad(e.target.value)}
                  />
                </div>
              </div>
              <div className="sm:col-span-4">
                <Button
                  disabled={ocupado || !insumoPresentacion || !Number(insumoCantidad.replace(",", "."))}
                  onClick={agregarInsumo}
                >
                  Agregar a la receta
                </Button>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
