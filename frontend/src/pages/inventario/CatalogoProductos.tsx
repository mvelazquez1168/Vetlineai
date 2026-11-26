import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  FiltroBar,
  Icono,
  LoadingState,
  Pagination,
  Table,
  TableColumn,
} from "../../components/ui";
import {
  Bodega,
  CatalogosInventario,
  ProductoListado,
  formatearCantidad,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// Catálogo de productos: la pantalla de aterrizaje del módulo.
//
// La pregunta que tiene que responder de un vistazo es "¿qué me falta?",
// así que los dos filtros que importan —bajo mínimo y por vencer— están
// a la vista y no escondidos en un panel.
//
// La existencia se muestra en UNIDAD BASE porque es la columna que se
// compara entre filas; la lectura en presentación ("3 cajas y 7
// tabletas") vive en la ficha, donde hay espacio para decirla bien.
// ---------------------------------------------------------------------

export function CatalogoProductos() {
  const navegar = useNavigate();
  const [catalogos, setCatalogos] = useState<CatalogosInventario | null>(null);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [datos, setDatos] = useState<{ productos: ProductoListado[]; total: number } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    inventarioApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
    inventarioApi.bodegas().then((r) => setBodegas(r.bodegas)).catch(() => setBodegas([]));
  }, []);

  useEffect(() => {
    setCargando(true);
    setError(null);
    inventarioApi
      .productos({ ...filtros, pagina, porPagina: 25 })
      .then(setDatos)
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, [filtros, pagina]);

  const columnas: TableColumn<ProductoListado>[] = [
    {
      key: "nombre",
      header: "Producto",
      render: (p) => (
        <Link to={`/inventario/productos/${p.id}`} className="block hover:underline">
          <span className="font-medium text-primary">{p.nombre}</span>
          <span className="block text-xs text-text-muted">
            {p.codigo}
            {p.categoria ? ` · ${p.categoria}` : ""}
          </span>
        </Link>
      ),
    },
    {
      key: "linea",
      header: "Línea",
      render: (p) => (
        <span className="text-sm">
          {catalogos?.lineasNegocio.find((l) => l.codigo === p.linea_negocio)?.nombre ??
            p.linea_negocio}
        </span>
      ),
    },
    {
      key: "existencia",
      header: "Existencia",
      className: "text-right",
      render: (p) => {
        const hay = Number(p.existencia);
        const minimo = Number(p.minimo);
        const reorden = Number(p.punto_reorden);
        // El color NO es la única forma de leerlo: al lado va la
        // etiqueta que dice qué pasa (guía rectora §4.1).
        const estado =
          hay < minimo ? "bajo" : reorden > 0 && hay <= reorden ? "reorden" : "ok";
        return (
          <div>
            <span
              className={
                estado === "bajo"
                  ? "font-semibold text-error"
                  : estado === "reorden"
                    ? "font-semibold text-warning"
                    : "font-medium"
              }
            >
              {formatearCantidad(hay)} {p.unidad_base}
            </span>
            {estado !== "ok" && (
              <span className="block text-xs text-text-muted">
                {estado === "bajo" ? `bajo el mínimo (${formatearCantidad(minimo)})` : "en punto de reorden"}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "vencimiento",
      header: "Vence",
      render: (p) =>
        p.proximo_vencimiento ? (
          <span className="text-sm">
            {new Date(p.proximo_vencimiento).toLocaleDateString("es-CR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </span>
        ) : (
          <span className="text-sm text-text-muted">—</span>
        ),
    },
    {
      key: "marcas",
      header: "",
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.requiere_receta && <Badge variant="info">Receta</Badge>}
          {p.es_controlado && <Badge variant="error">Controlado</Badge>}
          {p.requiere_refrigeracion && <Badge variant="info">Frío</Badge>}
          {p.medicamento_id && <Badge variant="neutral">Vinculado a Vetline Ai</Badge>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">Catálogo</h2>
          <p className="mt-1 text-sm text-text-muted">
            Productos con su existencia. Todo el stock se guarda en unidad base.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navegar("/inventario/alertas")}>
            <Icono nombre="aviso" className="mr-1 h-4 w-4" />
            Alertas
          </Button>
          <Button variant="secondary" onClick={() => navegar("/inventario/servicios")}>
            Servicios
          </Button>
          <Button variant="secondary" onClick={() => navegar("/inventario/precios")}>
            Precios
          </Button>
          <Button variant="secondary" onClick={() => navegar("/inventario/compras")}>
            Compras
          </Button>
          <Button onClick={() => navegar("/inventario/productos/nuevo")}>
            <Icono nombre="agregar" className="mr-1 h-4 w-4" />
            Nuevo producto
          </Button>
        </div>
      </div>

      <FiltroBar
        className="mt-4"
        busqueda={filtros.q ?? ""}
        onBusqueda={(v) => {
          setPagina(1);
          setFiltros((f) => ({ ...f, q: v }));
        }}
        placeholderBusqueda="Buscar por nombre o código…"
        selects={[
          {
            value: filtros.linea ?? "",
            onChange: (v) => {
              setPagina(1);
              setFiltros((f) => ({ ...f, linea: v }));
            },
            opciones: [
              { value: "", label: "Todas las líneas" },
              ...(catalogos?.lineasNegocio ?? []).map((l) => ({ value: l.codigo, label: l.nombre })),
            ],
          },
          {
            value: filtros.bodega ?? "",
            onChange: (v) => {
              setPagina(1);
              setFiltros((f) => ({ ...f, bodega: v }));
            },
            opciones: [
              { value: "", label: "Todas las bodegas" },
              ...bodegas.map((b) => ({ value: b.id, label: b.nombre })),
            ],
          },
          {
            value: filtros.bajoMinimo ?? "",
            onChange: (v) => {
              setPagina(1);
              setFiltros((f) => ({ ...f, bajoMinimo: v }));
            },
            opciones: [
              { value: "", label: "Mínimo: todos" },
              { value: "true", label: "Solo bajo el mínimo" },
            ],
          },
          {
            value: filtros.porVencer ?? "",
            onChange: (v) => {
              setPagina(1);
              setFiltros((f) => ({ ...f, porVencer: v }));
            },
            opciones: [
              { value: "", label: "Vencimiento: todos" },
              { value: "true", label: "Vencen en 90 días" },
            ],
          },
        ]}
      />

      {error && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">{error}</div>
      )}

      {cargando ? (
        <LoadingState forma="tabla" cantidad={6} />
      ) : !datos || datos.productos.length === 0 ? (
        <EmptyState
          titulo="Todavía no hay productos"
          texto="Podés cargarlos de a uno o importar el inventario que ya tenés desde una planilla."
          accion={
            <div className="flex gap-2">
              <Button onClick={() => navegar("/inventario/productos/nuevo")}>Nuevo producto</Button>
              <Button variant="secondary" onClick={() => navegar("/inventario/importar")}>
                Importar planilla
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="mt-4">
            <Table columns={columnas} data={datos.productos} rowKey={(p) => p.id} />
          </div>
          <Pagination
            pagina={pagina}
            total={datos.total}
            porPagina={25}
            onPagina={setPagina}
            sustantivo={{ singular: "producto", plural: "productos" }}
          />
        </>
      )}
    </div>
  );
}
