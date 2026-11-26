import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  FiltroBar,
  Icono,
  KpiCard,
  LoadingState,
  MenuAcciones,
  PageHeader,
  Pagination,
  Table,
  TableColumn,
  TiraIndicadores,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import {
  Bodega,
  CatalogosInventario,
  ProductoListado,
  ResumenInventario,
  formatearCantidad,
  inventarioApi,
} from "../../lib/inventarioApi";
import { formatearMonto } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// Catálogo de productos: la pantalla de aterrizaje del módulo.
//
// La pregunta que tiene que responder de un vistazo es "¿qué me falta?",
// así que los dos filtros que importan —bajo mínimo y por vencer— están
// a la vista y no escondidos en un panel.
//
// LA EXISTENCIA SE LEE EN PRESENTACIÓN NATURAL ("6 cajas y 4 tabletas")
// con la unidad base entre paréntesis. Antes mostraba solo la unidad
// base, con el argumento de que es la que se compara entre filas; el
// problema es que nadie cuenta el estante en tabletas, así que había
// que dividir de cabeza en cada fila. El texto lo arma el backend con
// la misma función que la ficha.
//
// EL MENÚ DE ACCIONES de cada fila lleva a lo que se hace con un
// producto —ajustar, registrar una merma, trasladar, ver su kardex— con
// el producto ya elegido. Antes había que ir a Movimientos y buscarlo
// otra vez en un selector de cien productos.
// ---------------------------------------------------------------------

export function CatalogoProductos() {
  const navegar = useNavigate();
  const { esAdminClinica } = useAuth();
  const [catalogos, setCatalogos] = useState<CatalogosInventario | null>(null);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [datos, setDatos] = useState<{ productos: ProductoListado[]; total: number } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);
  // El contador de ajustes esperando aprobación. Lo trae el mismo
  // endpoint que la lista, así que el badge y la pantalla de
  // aprobaciones no pueden decir números distintos.
  const [pendientes, setPendientes] = useState(0);
  const [resumen, setResumen] = useState<ResumenInventario | null>(null);

  useEffect(() => {
    inventarioApi.resumen().then(setResumen).catch(() => setResumen(null));
    inventarioApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
    inventarioApi.bodegas().then((r) => setBodegas(r.bodegas)).catch(() => setBodegas([]));
    inventarioApi
      .ajustes("pendiente")
      .then((r) => setPendientes(r.pendientes))
      .catch(() => setPendientes(0));
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
              {p.existencia_presentada ?? `${formatearCantidad(hay)} ${p.unidad_base}`}
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
      key: "acciones",
      header: "",
      render: (p) => (
        <MenuAcciones
          acciones={[
            {
              etiqueta: "Ajustar existencia",
              icono: "ajustes",
              ayuda: "Sube o baja el stock con su motivo",
              onClick: () => navegar(`/inventario/movimientos?accion=ajuste&producto=${p.id}`),
            },
            {
              etiqueta: "Registrar merma",
              icono: "aviso",
              ayuda: "Rotura, derrame, pérdida",
              onClick: () =>
                navegar(`/inventario/movimientos?accion=movimiento&tipo=merma&producto=${p.id}`),
            },
            {
              etiqueta: "Trasladar entre bodegas",
              icono: "producto",
              onClick: () => navegar(`/inventario/movimientos?accion=traslado&producto=${p.id}`),
            },
            {
              etiqueta: "Ver kardex",
              icono: "panel",
              ayuda: "Todos sus movimientos",
              onClick: () => navegar(`/inventario/kardex?producto=${p.id}`),
            },
          ]}
        />
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
      {/* UNA SOLA ACCION PRINCIPAL. Las ocho que la acompanaban eran
          secciones del modulo disfrazadas de boton y ahora son las
          pestanas de `SeccionesInventario`. */}
      <PageHeader
        titulo="Catálogo"
        subtitulo="Productos con su existencia. Todo el stock se guarda en unidad base."
        icono="inventario"
        modulo="inventario"
        accion={
          <Button onClick={() => navegar("/inventario/productos/nuevo")}>
            <Icono nombre="agregar" className="mr-1 h-4 w-4" />
            Nuevo producto
          </Button>
        }
        indicadores={
          resumen && (
            <TiraIndicadores>
              <KpiCard
                titulo="Valor del inventario"
                valor={formatearMonto(resumen.valor_costo)}
                icono="inventario"
                modulo="inventario"
                variacionPorcentaje={null}
                detalle="A costo, con la existencia de hoy"
              />
              <KpiCard
                titulo="Bajo el mínimo"
                valor={String(resumen.bajo_minimo)}
                icono="aviso"
                modulo="inventario"
                estado={resumen.bajo_minimo > 0 ? "aviso" : undefined}
                variacionPorcentaje={null}
                detalle="Productos que hay que pedir"
                alClic={() => navegar("/inventario/alertas")}
              />
              <KpiCard
                titulo="Vencen en 60 días"
                valor={String(resumen.por_vencer_60)}
                icono="hora"
                modulo="inventario"
                estado={resumen.por_vencer_60 > 0 ? "aviso" : undefined}
                variacionPorcentaje={null}
                detalle="Lotes con existencia"
                alClic={() => navegar("/inventario/alertas")}
              />
              <KpiCard
                titulo="Ajustes por aprobar"
                valor={String(pendientes)}
                icono="ajustes"
                modulo="inventario"
                estado={pendientes > 0 ? "aviso" : undefined}
                variacionPorcentaje={null}
                detalle="Esperan a un administrador"
                alClic={() => navegar("/inventario/movimientos?ver=aprobaciones")}
              />
            </TiraIndicadores>
          )
        }
      />

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
        <div className="mt-4 rounded-xl border border-error/40 bg-error/10 p-3 text-sm">{error}</div>
      )}

      {cargando ? (
        <LoadingState forma="tabla" cantidad={6} />
      ) : !datos || datos.productos.length === 0 ? (
        <EmptyState
          titulo="Todavía no hay productos"
          texto="Podés cargarlos de a uno o importar el inventario que ya tiene desde una planilla."
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
