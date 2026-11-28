import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  EmptyState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import {
  inventarioApi,
  ProductoSinClasificar,
  TipoClinicoProducto,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// PRODUCTOS SIN CLASIFICAR — defecto del 2026-11-27, punto 3.
//
// `tipo_clinico` decide en qué acción de la atención aparece cada
// producto. La migración 115 lo llenó solo donde era evidente y dejó
// 1.782 productos en NULL. Clasificarlos de a uno son 891 fichas.
//
// LO QUE ENCONTRÉ EN EL CATÁLOGO REAL y explica el diseño de esta
// pantalla: de los 897 productos de la clínica de `demo.medico`, solo
// CINCO tienen categoría y cinco familia. Los filtros por categoría y
// por familia están —sirven para catálogos que las tengan— pero con lo
// que hay cargado hoy no filtran nada. Lo que sí funciona es buscar por
// nombre («choice» trae todos los alimentos de esa marca, se marcan de
// a cien y se clasifican como «otro» de una sola vez) y la sugerencia
// por palabras del nombre.
//
// LA SUGERENCIA NUNCA SE APLICA SOLA. Se muestra con su motivo y hay que
// confirmarla: una clasificación automática equivocada manda un alimento
// a la receta y nadie se entera hasta que un médico lo receta.
// ---------------------------------------------------------------------

export function SinClasificar({
  /** Para dibujarla dentro de una pestaña (Calidad de datos, punto 6). */
  sinEncabezado,
}: { sinEncabezado?: boolean } = {}) {
  const toast = useToast();
  const { puede } = useAuth();
  const puedeEditar = puede("catalogo.editar");

  const [productos, setProductos] = useState<ProductoSinClasificar[]>([]);
  const [total, setTotal] = useState(0);
  const [categorias, setCategorias] = useState<Array<{ categoria: string; cantidad: number }>>([]);
  const [tipos, setTipos] = useState<Array<{ valor: TipoClinicoProducto; etiqueta: string }>>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [tipoALote, setTipoALote] = useState<TipoClinicoProducto>("medicamento");

  const cargar = (q: string, cat: string) => {
    setCargando(true);
    inventarioApi
      .sinClasificar({ q: q || undefined, categoria: cat || undefined, limite: 300 })
      .then((r) => {
        setProductos(r.productos);
        setTotal(r.total);
        setCategorias(r.categorias);
        setTipos(r.tipos);
        setElegidos(new Set());
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    const t = window.setTimeout(() => cargar(busqueda.trim(), categoria), busqueda ? 350 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, categoria]);

  const alternar = (id: string) => {
    setElegidos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const todos = () => {
    setElegidos((s) =>
      s.size === productos.length ? new Set() : new Set(productos.map((p) => p.id))
    );
  };

  /** Marca los que la sugerencia manda a este tipo. Sigue siendo el usuario quien confirma. */
  const marcarSugeridos = (tipo: TipoClinicoProducto) => {
    const ids = productos.filter((p) => p.sugerencia?.tipo === tipo).map((p) => p.id);
    if (ids.length === 0) {
      toast.aviso(`Ninguno de los que se ven tiene a «${tipo}» como sugerencia.`);
      return;
    }
    setElegidos(new Set(ids));
    setTipoALote(tipo);
  };

  const clasificar = async () => {
    if (elegidos.size === 0) return;
    setGuardando(true);
    try {
      const r = await inventarioApi.clasificar([...elegidos], tipoALote);
      toast.exito(
        `${r.cambiados} producto${r.cambiados === 1 ? "" : "s"} clasificado${
          r.cambiados === 1 ? "" : "s"
        } como ${tipoALote}. Quedan ${r.quedan} sin clasificar.`
      );
      cargar(busqueda.trim(), categoria);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      {!sinEncabezado && (
        <PageHeader
          titulo="Productos sin clasificar"
          subtitulo="El tipo clínico decide en qué acción de la atención aparece cada producto."
          icono="producto"
          modulo="inventario"
          padre={{ a: "/inventario", etiqueta: "Inventario" }}
        />
      )}

      <Card>
        <CardTitle>Qué es esto y por qué importa</CardTitle>
        <CardDescription>
          Un producto con <strong>tipo clínico</strong> aparece en su acción: las vacunas en
          «Vacuna», los antiparasitarios en «Desparasitación», los medicamentos en la receta. Los
          que están acá se pueden usar igual —el buscador de la atención los muestra con la
          etiqueta «sin clasificar»—, pero clasificarlos hace que el médico los encuentre primero.
        </CardDescription>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Input
            label="Buscar"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre o código"
          />
          <Select
            label="Categoría"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            options={[
              { value: "", label: `Todas (${total})` },
              ...categorias.map((c) => ({
                value: c.categoria,
                label: `${c.categoria} (${c.cantidad})`,
              })),
            ]}
          />
          <div className="flex items-end">
            <p className="text-sm text-text-muted">
              {categorias.length === 0
                ? "Ninguno de estos productos tiene categoría cargada, así que el filtro por categoría no ayuda acá: usá la búsqueda por nombre."
                : `${categorias.length} categoría(s) entre los sin clasificar.`}
            </p>
          </div>
        </div>
      </Card>

      {cargando ? (
        <LoadingState forma="tabla" cantidad={8} />
      ) : productos.length === 0 ? (
        <EmptyState
          icono="producto"
          titulo={total === 0 ? "No queda ninguno sin clasificar" : "Nada con ese filtro"}
          texto={
            total === 0
              ? "Todo el catálogo tiene su tipo clínico. El médico encuentra cada producto en su acción."
              : "Probá con menos letras o sacá el filtro de categoría."
          }
        />
      ) : (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-text-muted">
              Se ven {productos.length} de {total}. Elegidos: <strong>{elegidos.size}</strong>.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={todos}
                className="text-sm font-semibold text-accent hover:underline"
              >
                {elegidos.size === productos.length ? "Ninguno" : "Todos los que se ven"}
              </button>
              {tipos.map((t) => (
                <button
                  key={t.valor}
                  type="button"
                  onClick={() => marcarSugeridos(t.valor)}
                  className="rounded-md border border-black/15 px-2 py-1 text-xs font-semibold text-text-muted hover:bg-black/5"
                  title={`Marca los que el sistema cree que son ${t.valor}. Hay que confirmarlo igual.`}
                >
                  Marcar sugeridos: {t.valor}
                </button>
              ))}
            </div>
          </div>

          {puedeEditar && (
            <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-primary-borde bg-primary-suave p-3">
              <div className="w-64">
                <Select
                  label="Clasificar los elegidos como"
                  value={tipoALote}
                  onChange={(e) => setTipoALote(e.target.value as TipoClinicoProducto)}
                  options={tipos.map((t) => ({ value: t.valor, label: t.etiqueta }))}
                />
              </div>
              <Button onClick={() => void clasificar()} disabled={guardando || elegidos.size === 0}>
                {guardando ? "Clasificando…" : `Clasificar ${elegidos.size}`}
              </Button>
              <p className="text-xs text-text-muted">
                Solo escribe los que no tienen tipo: no pisa lo que alguien ya clasificó a mano.
              </p>
            </div>
          )}

          <ul className="mt-3 divide-y divide-black/5">
            {productos.map((p) => (
              <li key={p.id} className="flex items-start gap-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={elegidos.has(p.id)}
                  onChange={() => alternar(p.id)}
                  aria-label={`Elegir ${p.nombre}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{p.nombre}</p>
                  <p className="text-xs text-text-muted">
                    {p.codigo ?? "sin código"}
                    {p.categoria ? ` · ${p.categoria}` : ""}
                    {p.familia ? ` · ${p.familia}` : ""}
                    {p.principioActivo ? ` · ${p.principioActivo}` : ""}
                  </p>
                </div>
                {p.sugerencia && (
                  <Badge variant="info" title={`Porque ${p.sugerencia.porque}.`}>
                    quizá {p.sugerencia.tipo}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
