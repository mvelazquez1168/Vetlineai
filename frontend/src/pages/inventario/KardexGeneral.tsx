import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Badge,
  Card,
  CardDescription,
  CardTitle,
  LoadingState,
  MenuExportar,
  Select,
  useToast,
} from "../../components/ui";
import { guardarComoArchivo } from "../../lib/descargas";
import {
  Bodega,
  CatalogosInventario,
  LineaKardex,
  ProductoListado,
  formatearCantidad,
  formatearMonto,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// EL KARDEX GENERAL: todos los movimientos, de todos los productos.
//
// El kardex por producto ya estaba en la ficha, y alcanzaba para "¿qué
// pasó con la amoxicilina?". No alcanzaba para las preguntas que se
// hacen al revisar el mes —"¿qué se dio de baja por vencimiento?",
// "¿qué movió esta persona?", "¿qué salió del quirófano ayer?"—, que
// obligaban a entrar producto por producto.
//
// LOS FILTROS VIVEN EN LA URL. Así un kardex filtrado se puede pegar en
// un mensaje y el otro ve lo mismo, y el botón de volver del navegador
// deshace el filtro en vez de salir de la pantalla.
//
// LA EXPORTACIÓN SALE DEL BACKEND con estos mismos filtros. Un archivo
// armado acá exportaría las 500 filas que la pantalla tiene cargadas y
// nadie lo notaría hasta contar las filas.
// ---------------------------------------------------------------------

const FILTROS_EN_URL = ["tipo", "producto", "bodega", "persona", "desde", "hasta"] as const;

export function KardexGeneral() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [catalogos, setCatalogos] = useState<CatalogosInventario | null>(null);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [productos, setProductos] = useState<ProductoListado[]>([]);
  const [personas, setPersonas] = useState<Array<{ id: string; nombre: string }>>([]);
  const [datos, setDatos] = useState<{
    movimientos: LineaKardex[];
    tope: number;
    topeAlcanzado: boolean;
  } | null>(null);
  const [cargando, setCargando] = useState(true);

  const filtros = useMemo(() => {
    const f: Record<string, string> = {};
    for (const k of FILTROS_EN_URL) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    return f;
  }, [params]);

  const cambiar = (clave: string, valor: string) => {
    const siguiente = new URLSearchParams(params);
    if (valor) siguiente.set(clave, valor);
    else siguiente.delete(clave);
    setParams(siguiente, { replace: true });
  };

  useEffect(() => {
    inventarioApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
    inventarioApi.bodegas().then((r) => setBodegas(r.bodegas)).catch(() => setBodegas([]));
    inventarioApi
      .productos({ porPagina: 100 })
      .then((r) => setProductos(r.productos))
      .catch(() => setProductos([]));
    inventarioApi
      .kardexPersonas()
      .then((r) => setPersonas(r.personas))
      .catch(() => setPersonas([]));
  }, []);

  useEffect(() => {
    setCargando(true);
    inventarioApi
      .kardexGeneral(filtros)
      .then(setDatos)
      .catch((err) => {
        toast.error((err as Error).message);
        setDatos(null);
      })
      .finally(() => setCargando(false));
  }, [filtros]);

  const exportar = async (formato: "excel" | "pdf") => {
    try {
      const { blob, filename } = await inventarioApi.exportarKardex(formato, filtros);
      guardarComoArchivo(blob, filename ?? `kardex.${formato === "excel" ? "xlsx" : "pdf"}`);
      toast.exito("Descargado con los filtros que están aplicados.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const movimientos = datos?.movimientos ?? [];

  return (
    <div>
      <Link to="/inventario" className="text-sm text-text-muted hover:text-primary">
        ← Catálogo
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">Kardex</h2>
          <p className="mt-1 text-sm text-text-muted">
            Todos los movimientos de inventario: entradas, salidas, traslados y ajustes aplicados.
          </p>
        </div>
        <MenuExportar onExportar={exportar} deshabilitado={movimientos.length === 0} />
      </div>

      <Card className="mt-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Select
            label="Tipo"
            value={filtros.tipo ?? ""}
            onChange={(e) => cambiar("tipo", e.target.value)}
            options={[
              { value: "", label: "Todos" },
              ...(catalogos?.tiposMovimiento ?? []).map((t) => ({
                value: t.codigo,
                label: t.nombre,
              })),
            ]}
          />
          <Select
            label="Producto"
            value={filtros.producto ?? ""}
            onChange={(e) => cambiar("producto", e.target.value)}
            options={[
              { value: "", label: "Todos" },
              ...productos.map((p) => ({ value: p.id, label: p.nombre })),
            ]}
          />
          <Select
            label="Bodega"
            value={filtros.bodega ?? ""}
            onChange={(e) => cambiar("bodega", e.target.value)}
            options={[
              { value: "", label: "Todas" },
              ...bodegas.map((b) => ({ value: b.id, label: b.nombre })),
            ]}
          />
          <Select
            label="Persona"
            value={filtros.persona ?? ""}
            onChange={(e) => cambiar("persona", e.target.value)}
            options={[
              { value: "", label: "Todas" },
              ...personas.map((p) => ({ value: p.id, label: p.nombre })),
            ]}
          />
          <div>
            <label className="text-sm font-semibold text-text-primary">Desde</label>
            <input
              type="date"
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
              value={filtros.desde ?? ""}
              onChange={(e) => cambiar("desde", e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-text-primary">Hasta</label>
            <input
              type="date"
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
              value={filtros.hasta ?? ""}
              onChange={(e) => cambiar("hasta", e.target.value)}
            />
          </div>
        </div>
        {Object.keys(filtros).length > 0 && (
          <button
            type="button"
            className="mt-3 text-xs text-text-muted underline hover:text-primary"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            Quitar todos los filtros
          </button>
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle>
          {cargando ? "Movimientos" : `${movimientos.length} movimiento(s)`}
        </CardTitle>
        <CardDescription>
          Ordenados del más reciente al más viejo. Un movimiento no se edita ni se borra: una
          corrección es otro movimiento.
        </CardDescription>

        {datos?.topeAlcanzado && (
          <p className="mt-3 rounded-lg bg-warning/10 p-3 text-sm text-text-primary">
            Se está mostrando el tope de {datos.tope} movimientos, así que{" "}
            <strong>faltan los más viejos</strong>. Acotá el período o exportá: la exportación llega
            hasta 20 000 filas y avisa si también se corta.
          </p>
        )}

        {cargando ? (
          <LoadingState forma="tabla" cantidad={8} />
        ) : movimientos.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">
            Ningún movimiento con esos filtros. Si acabás de registrar uno, revise el período.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                  <th className="py-2">Fecha</th>
                  <th className="py-2">Tipo</th>
                  <th className="py-2">Producto</th>
                  <th className="py-2 text-right">Cantidad</th>
                  <th className="py-2">Bodega</th>
                  <th className="py-2">Lote</th>
                  <th className="py-2 text-right">Costo unit.</th>
                  <th className="py-2">Motivo</th>
                  <th className="py-2">Quién</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} className="border-b border-black/5">
                    <td className="whitespace-nowrap py-2 text-xs">
                      {new Date(m.creado_en).toLocaleString("es-CR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2">
                      <Badge variant={m.direccion === "entrada" ? "success" : "warning"}>
                        {m.direccion === "entrada" ? "entra" : "sale"}
                      </Badge>
                      <span className="ml-2">{m.tipo_nombre}</span>
                    </td>
                    <td className="py-2">
                      <Link
                        to={`/inventario/productos/${m.producto_id}`}
                        className="text-primary hover:underline"
                      >
                        {m.producto}
                      </Link>
                      {m.paciente && (
                        <span className="block text-xs text-accent">{m.paciente}</span>
                      )}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {m.direccion === "entrada" ? "+" : "−"}
                      {formatearCantidad(m.cantidad_base)} {m.unidad_base}
                      {m.presentacion && m.cantidad_presentacion && (
                        <span className="block text-xs text-text-muted">
                          {formatearCantidad(m.cantidad_presentacion)} × {m.presentacion}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-xs">{m.bodega}</td>
                    <td className="py-2 text-xs">{m.lote ?? "—"}</td>
                    <td className="py-2 text-right text-xs">
                      {m.costo_unitario ? formatearMonto(m.costo_unitario) : "—"}
                    </td>
                    <td className="py-2 text-xs">
                      {m.motivo ?? "—"}
                      {m.motivo_detalle && (
                        <span className="block text-text-muted">{m.motivo_detalle}</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">{m.persona ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
