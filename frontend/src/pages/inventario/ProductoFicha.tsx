import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  LoadingState,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import {
  ConsumoPorOrigen,
  DetalleProducto,
  MovimientoKardex,
  formatearCantidad,
  formatearMonto,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// Ficha del producto.
//
// Cuatro bloques, en el orden en que se preguntan: cuánto hay y dónde,
// en qué lotes y cuándo vencen, qué le pasó (kardex) y en qué se usó
// (consumo por origen).
//
// EL DRILL-DOWN del consumo es la sección 4.5 de la guía rectora: los
// movimientos ligados a paciente se abren y muestran a los pacientes;
// los que NO tienen paciente son su propio grupo con su origen ("Venta
// de mostrador", "Merma"), y se dice explícitamente que no tener
// paciente es normal. Esconderlos o repartirlos entre los demás daría
// un consumo que no cuadra con la existencia.
// ---------------------------------------------------------------------

function haceUnAnio(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
const HOY = new Date().toISOString().slice(0, 10);

export function ProductoFicha() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [datos, setDatos] = useState<DetalleProducto | null>(null);
  const [kardex, setKardex] = useState<MovimientoKardex[]>([]);
  const [consumo, setConsumo] = useState<ConsumoPorOrigen[]>([]);
  const [desde, setDesde] = useState(haceUnAnio());
  const [hasta, setHasta] = useState(HOY);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    inventarioApi
      .producto(id)
      .then(setDatos)
      .catch((err) => toast.error(err.message))
      .finally(() => setCargando(false));
    inventarioApi.kardex(id).then((r) => setKardex(r.movimientos)).catch(() => setKardex([]));
  }, [id]);

  useEffect(() => {
    inventarioApi
      .consumo(id, desde, hasta)
      .then((r) => setConsumo(r.origenes))
      .catch(() => setConsumo([]));
  }, [id, desde, hasta]);

  if (cargando) return <LoadingState forma="tarjetas" cantidad={3} />;
  if (!datos) return <p className="text-sm text-text-muted">No se pudo cargar el producto.</p>;

  const p = datos.producto as Record<string, string | number | boolean | null>;

  const columnasKardex: TableColumn<MovimientoKardex>[] = [
    {
      key: "fecha",
      header: "Fecha",
      render: (m) => (
        <span className="text-sm">
          {new Date(m.creado_en).toLocaleString("es-CR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
    },
    {
      key: "tipo",
      header: "Movimiento",
      render: (m) => (
        <>
          <span className="font-medium">{m.tipo_nombre}</span>
          {m.motivo && <span className="block text-xs text-text-muted">{m.motivo}</span>}
          {m.motivo_detalle && (
            <span className="block text-xs text-text-muted">{m.motivo_detalle}</span>
          )}
        </>
      ),
    },
    {
      key: "cantidad",
      header: "Cantidad",
      className: "text-right",
      render: (m) => (
        <span className={m.direccion === "entrada" ? "text-success" : "text-error"}>
          {m.direccion === "entrada" ? "+" : "−"}
          {formatearCantidad(m.cantidad_base)} {String(p.unidad_base)}
          {m.presentacion && m.cantidad_presentacion && (
            <span className="block text-xs text-text-muted">
              {formatearCantidad(m.cantidad_presentacion)} × {m.presentacion}
            </span>
          )}
        </span>
      ),
    },
    { key: "bodega", header: "Bodega", render: (m) => <span className="text-sm">{m.bodega}</span> },
    { key: "lote", header: "Lote", render: (m) => <span className="text-sm">{m.lote ?? "—"}</span> },
    {
      key: "quien",
      header: "Quién / paciente",
      render: (m) => (
        <>
          <span className="text-sm">{m.persona ?? "—"}</span>
          {m.paciente && <span className="block text-xs text-accent">{m.paciente}</span>}
        </>
      ),
    },
  ];

  return (
    <div>
      <Link to="/inventario" className="text-sm text-text-muted hover:text-primary">
        ← Catálogo
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">{String(p.nombre)}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {String(p.codigo)} · se mide en {String(p.unidad_base)}
            {p.principio_activo ? ` · ${String(p.principio_activo)}` : ""}
            {p.concentracion ? ` ${String(p.concentracion)}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {p.requiere_receta && <Badge variant="info">Requiere receta</Badge>}
            {p.es_controlado && <Badge variant="error">Controlado</Badge>}
            {p.requiere_refrigeracion && <Badge variant="info">Refrigeración</Badge>}
            {p.vida_util_apertura_dias && (
              <Badge variant="warning">
                Dura {String(p.vida_util_apertura_dias)} días tras abrirse
              </Badge>
            )}
            {p.permite_stock_negativo && <Badge variant="neutral">Admite stock negativo</Badge>}
          </div>
        </div>
        <Link to={`/inventario/productos/${id}/editar`}>
          <Button variant="secondary">
            <Icono nombre="editar" className="mr-1 h-4 w-4" />
            Editar
          </Button>
        </Link>
      </div>

      {/* ------------------------------------------ Existencia */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Existencia por bodega</CardTitle>
          <CardDescription>
            En la presentación natural y en unidad base, que es como se guarda.
          </CardDescription>
          <ul className="mt-3 space-y-2">
            {datos.existencias.map((e) => (
              <li
                key={e.bodegaId}
                className="flex items-baseline justify-between border-b border-black/5 pb-2 last:border-0"
              >
                <span className="text-sm">{e.bodegaNombre}</span>
                <span className={e.cantidad < 0 ? "font-semibold text-error" : "font-medium"}>
                  {e.presentacion.texto}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-muted">
            Mínimo {formatearCantidad(String(p.minimo))} · punto de reorden{" "}
            {formatearCantidad(String(p.punto_reorden))} {String(p.unidad_base)}
          </p>
        </Card>

        {/* ------------------------------------------ Presentaciones */}
        <Card>
          <CardTitle>Presentaciones</CardTitle>
          <CardDescription>
            Cada una con su equivalencia a la unidad base. Es lo que convierte al vender.
          </CardDescription>
          <ul className="mt-3 space-y-2">
            {datos.presentaciones
              .filter((pr) => pr.activo)
              .map((pr) => (
                <li key={pr.id} className="border-b border-black/5 pb-2 last:border-0">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{pr.nombre}</span>
                    <span className="text-sm">
                      {pr.precio_venta ? formatearMonto(pr.precio_venta) : "sin precio"}
                    </span>
                  </div>
                  <span className="block text-xs text-text-muted">
                    1 {pr.nombre} = {formatearCantidad(pr.factor)} {String(p.unidad_base)} ·{" "}
                    {pr.codigo_interno} ·{" "}
                    {[pr.para_compra && "compra", pr.para_venta && "venta", pr.para_consumo && "consumo"]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </li>
              ))}
            {datos.presentaciones.length === 0 && (
              <li className="text-sm text-text-muted">
                Sin presentaciones: sin al menos una no se puede vender ni comprar.
              </li>
            )}
          </ul>
        </Card>
      </div>

      {/* ------------------------------------------ Lotes */}
      <Card className="mt-4">
        <CardTitle>Lotes</CardTitle>
        <CardDescription>
          El vencimiento efectivo es el menor entre el del lote y el de la apertura. Es el que usa
          FEFO y el que disparan las alertas.
        </CardDescription>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                <th className="py-2">Lote</th>
                <th className="py-2">Bodega</th>
                <th className="py-2 text-right">Cantidad</th>
                <th className="py-2 text-right">Costo unitario</th>
                <th className="py-2">Vence</th>
                <th className="py-2">Abierto</th>
              </tr>
            </thead>
            <tbody>
              {datos.lotes.map((l) => {
                const vencido =
                  l.vencimiento_efectivo && new Date(l.vencimiento_efectivo) < new Date();
                return (
                  <tr key={l.id} className="border-b border-black/5">
                    <td className="py-2 font-medium">{l.numero}</td>
                    <td className="py-2">{l.bodega}</td>
                    <td className="py-2 text-right">
                      {formatearCantidad(l.cantidad)} {String(p.unidad_base)}
                    </td>
                    <td className="py-2 text-right">{formatearMonto(l.costo_unitario)}</td>
                    <td className="py-2">
                      {l.vencimiento_efectivo ? (
                        <span className={vencido ? "font-semibold text-error" : ""}>
                          {new Date(l.vencimiento_efectivo).toLocaleDateString("es-CR")}
                          {vencido && " · vencido"}
                        </span>
                      ) : (
                        <span className="text-text-muted">sin vencimiento</span>
                      )}
                    </td>
                    <td className="py-2">
                      {l.fecha_apertura ? (
                        <Badge variant="warning">
                          desde {new Date(l.fecha_apertura).toLocaleDateString("es-CR")}
                        </Badge>
                      ) : (
                        <span className="text-text-muted">cerrado</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {datos.lotes.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-text-muted">
                    Sin lotes todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ------------------------------------------ Consumo por origen */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Consumo del período, por origen</CardTitle>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-lg border border-black/10 bg-surface px-2 py-1"
            />
            <span className="text-text-muted">a</span>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-lg border border-black/10 bg-surface px-2 py-1"
            />
          </div>
        </div>
        <CardDescription>
          Los que salieron a un paciente se abren y lo muestran. Los que no tienen paciente —venta
          de mostrador, merma, consumo interno— son su propio grupo: que no tengan paciente es
          normal, no un dato faltante.
        </CardDescription>

        {consumo.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">Sin salidas en ese período.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {consumo.map((c) => (
              <li key={c.tipo} className="rounded-xl border border-black/5 p-3">
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between text-left"
                  onClick={() => setAbierto(abierto === c.tipo ? null : c.tipo)}
                  disabled={c.pacientes.length === 0}
                >
                  <span className="font-medium">
                    {c.tipoNombre}
                    <span className="ml-2 text-xs text-text-muted">
                      {c.movimientos} movimiento(s)
                      {c.pacientes.length === 0 ? " · sin paciente" : ` · ${c.pacientes.length} paciente(s)`}
                    </span>
                  </span>
                  <span className="font-semibold">
                    {formatearCantidad(c.cantidad)} {String(p.unidad_base)}
                  </span>
                </button>
                {abierto === c.tipo && c.pacientes.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-black/5 pt-2">
                    {c.pacientes.map((pac) => (
                      <li key={`${pac.pacienteId}-${pac.atencionId}`} className="flex justify-between text-sm">
                        <Link
                          to={`/admin/pacientes/${pac.pacienteId}`}
                          className="text-accent hover:underline"
                        >
                          {pac.nombre}
                        </Link>
                        <span>
                          {formatearCantidad(pac.cantidad)} {String(p.unidad_base)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------ Kardex */}
      <Card className="mt-4">
        <CardTitle>Kardex</CardTitle>
        <CardDescription>
          Solo se agrega. Un error se corrige con un movimiento inverso, nunca editando.
        </CardDescription>
        <div className="mt-3">
          <Table
            columns={columnasKardex}
            data={kardex}
            rowKey={(m) => m.id}
            emptyMessage="Sin movimientos todavía."
          />
        </div>
      </Card>
    </div>
  );
}
