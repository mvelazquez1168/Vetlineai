import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Input,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import {
  Ajuste,
  Bodega,
  CatalogosInventario,
  ProductoListado,
  formatearCantidad,
  formatearMonto,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// Movimientos manuales: merma, consumo interno, traslado y ajustes.
//
// Son los movimientos que NO vienen de una venta ni de una compra:
// alguien rompió algo, el quirófano usó gasas, hay que pasar stock de
// una bodega a otra, o el conteo no cuadra.
//
// Los cuatro pasan por el mismo punto único que todo lo demás. La
// pantalla no calcula nada: elige el tipo, el producto, la cantidad y
// el motivo, y el backend hace el resto —incluido el FEFO, que es por
// qué no hay un selector de lote obligatorio.
//
// LOS AJUSTES PENDIENTES viven abajo, en la misma pantalla y no
// escondidos en otra: quien registra un ajuste grande tiene que ver en
// el acto que quedó esperando, y quien aprueba los encuentra donde ya
// está trabajando.
// ---------------------------------------------------------------------

const TIPOS_MANUALES = ["merma", "consumo_interno", "vencimiento", "devolucion_proveedor"] as const;

export function MovimientosInventario() {
  const toast = useToast();
  const { esAdminClinica } = useAuth();
  const [catalogos, setCatalogos] = useState<CatalogosInventario | null>(null);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [productos, setProductos] = useState<ProductoListado[]>([]);
  const [ajustes, setAjustes] = useState<Ajuste[]>([]);
  const [ocupado, setOcupado] = useState(false);

  // Movimiento simple
  const [tipo, setTipo] = useState<string>("merma");
  const [productoId, setProductoId] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("rotura");
  const [motivoDetalle, setMotivoDetalle] = useState("");

  // Traslado
  const [tProducto, setTProducto] = useState("");
  const [tOrigen, setTOrigen] = useState("");
  const [tDestino, setTDestino] = useState("");
  const [tCantidad, setTCantidad] = useState("");

  // Ajuste
  const [aTipo, setATipo] = useState<"positivo" | "negativo">("negativo");
  const [aProducto, setAProducto] = useState("");
  const [aBodega, setABodega] = useState("");
  const [aCantidad, setACantidad] = useState("");
  const [aMotivo, setAMotivo] = useState("diferencia_conteo");
  const [aDetalle, setADetalle] = useState("");

  const recargarAjustes = () =>
    inventarioApi.ajustes().then((r) => setAjustes(r.ajustes)).catch(() => setAjustes([]));

  useEffect(() => {
    inventarioApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
    inventarioApi
      .bodegas()
      .then((r) => {
        setBodegas(r.bodegas);
        const def = r.bodegas.find((b) => b.es_default) ?? r.bodegas[0];
        if (def) {
          setBodegaId(def.id);
          setABodega(def.id);
          setTOrigen(def.id);
        }
      })
      .catch(() => setBodegas([]));
    inventarioApi
      .productos({ porPagina: 100 })
      .then((r) => setProductos(r.productos))
      .catch(() => setProductos([]));
    recargarAjustes();
  }, []);

  const opcionesProducto = productos.map((p) => ({
    value: p.id,
    label: `${p.nombre} (${formatearCantidad(p.existencia)} ${p.unidad_base})`,
  }));
  const motivoElegido = catalogos?.motivos.find((m) => m.codigo === motivo);
  const aMotivoElegido = catalogos?.motivos.find((m) => m.codigo === aMotivo);

  const registrar = async () => {
    setOcupado(true);
    try {
      await inventarioApi.movimiento({
        tipo,
        productoId,
        bodegaId,
        cantidadBase: cantidad.replace(",", "."),
        motivo,
        motivoDetalle: motivoDetalle.trim() || undefined,
      });
      toast.exito("Movimiento registrado.");
      setCantidad("");
      setMotivoDetalle("");
      const r = await inventarioApi.productos({ porPagina: 100 });
      setProductos(r.productos);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const trasladar = async () => {
    setOcupado(true);
    try {
      await inventarioApi.traslado({
        productoId: tProducto,
        bodegaOrigenId: tOrigen,
        bodegaDestinoId: tDestino,
        cantidadBase: tCantidad.replace(",", "."),
      });
      toast.exito("Traslado registrado: salió de una bodega y entró a la otra, ligados entre sí.");
      setTCantidad("");
      const r = await inventarioApi.productos({ porPagina: 100 });
      setProductos(r.productos);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const pedirAjuste = async () => {
    setOcupado(true);
    try {
      const r = await inventarioApi.solicitarAjuste({
        tipo: aTipo,
        motivo: aMotivo,
        motivoDetalle: aDetalle.trim() || undefined,
        lineas: [
          { productoId: aProducto, bodegaId: aBodega, cantidadBase: aCantidad.replace(",", ".") },
        ],
      });
      if (r.requiereAprobacion) {
        toast.aviso(
          `El ajuste vale ${formatearMonto(r.valor)} y el umbral es ${formatearMonto(r.umbral)}: queda esperando aprobación de un administrador. Todavía no movió stock.`
        );
      } else {
        toast.exito("Ajuste aplicado.");
      }
      setACantidad("");
      setADetalle("");
      await recargarAjustes();
      const p = await inventarioApi.productos({ porPagina: 100 });
      setProductos(p.productos);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const resolver = async (id: string, accion: "aprobar" | "rechazar") => {
    setOcupado(true);
    try {
      if (accion === "aprobar") await inventarioApi.aprobarAjuste(id);
      else await inventarioApi.rechazarAjuste(id);
      toast.exito(accion === "aprobar" ? "Ajuste aprobado y aplicado." : "Ajuste rechazado.");
      await recargarAjustes();
      const p = await inventarioApi.productos({ porPagina: 100 });
      setProductos(p.productos);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnasAjustes: TableColumn<Ajuste>[] = [
    {
      key: "tipo",
      header: "Ajuste",
      render: (a) => (
        <>
          <span className="font-medium">
            {a.tipo === "positivo" ? "Positivo" : "Negativo"} · {a.motivo_nombre}
          </span>
          {a.motivo_detalle && (
            <span className="block text-xs text-text-muted">{a.motivo_detalle}</span>
          )}
          <span className="block text-xs text-text-muted">{a.lineas} línea(s)</span>
        </>
      ),
    },
    { key: "valor", header: "Valor", className: "text-right", render: (a) => formatearMonto(a.valor) },
    {
      key: "estado",
      header: "Estado",
      render: (a) => (
        <Badge
          variant={
            a.estado === "aplicado"
              ? "success"
              : a.estado === "pendiente"
                ? "warning"
                : a.estado === "rechazado"
                  ? "error"
                  : "neutral"
          }
          dot
        >
          {a.estado === "pendiente" ? "Esperando aprobación" : a.estado}
        </Badge>
      ),
    },
    {
      key: "quien",
      header: "Quién",
      render: (a) => (
        <>
          <span className="text-sm">Pidió: {a.solicitado_por_nombre ?? "—"}</span>
          {a.aprobado_por_nombre && (
            <span className="block text-xs text-text-muted">Resolvió: {a.aprobado_por_nombre}</span>
          )}
        </>
      ),
    },
    {
      key: "acciones",
      header: "",
      render: (a) =>
        a.estado === "pendiente" && esAdminClinica ? (
          <div className="flex gap-2">
            <Button disabled={ocupado} onClick={() => resolver(a.id, "aprobar")}>
              Aprobar
            </Button>
            <Button variant="secondary" disabled={ocupado} onClick={() => resolver(a.id, "rechazar")}>
              Rechazar
            </Button>
          </div>
        ) : a.estado === "pendiente" ? (
          <span className="text-xs text-text-muted">Lo aprueba un administrador</span>
        ) : null,
    },
  ];

  const opcionesBodega = bodegas.map((b) => ({ value: b.id, label: b.nombre }));

  return (
    <div>
      <Link to="/inventario" className="text-sm text-text-muted hover:text-primary">
        ← Catálogo
      </Link>
      <h2 className="mt-2 text-xl font-bold text-primary">Movimientos</h2>
      <p className="mt-1 text-sm text-text-muted">
        Merma, consumo interno, traslados y ajustes. Lo que no viene de una venta ni de una compra.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------- Movimiento simple */}
        <Card>
          <CardTitle>Salida manual</CardTitle>
          <CardDescription>
            El lote lo elige el sistema por vencimiento (FEFO). Si no alcanza uno, reparte.
          </CardDescription>
          <div className="mt-3 space-y-3">
            <Select
              label="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              options={(catalogos?.tiposMovimiento ?? [])
                .filter((t) => (TIPOS_MANUALES as readonly string[]).includes(t.codigo))
                .map((t) => ({ value: t.codigo, label: t.nombre }))}
            />
            <Select
              label="Producto"
              value={productoId}
              onChange={(e) => setProductoId(e.target.value)}
              options={[{ value: "", label: "Elegí un producto" }, ...opcionesProducto]}
            />
            <Select
              label="Bodega"
              value={bodegaId}
              onChange={(e) => setBodegaId(e.target.value)}
              options={opcionesBodega}
            />
            <Input
              label="Cantidad (unidad base)"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              placeholder="5"
            />
            <Select
              label="Motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              options={(catalogos?.motivos ?? []).map((m) => ({ value: m.codigo, label: m.nombre }))}
            />
            {motivoElegido?.exige_detalle && (
              <Input
                label="Decí cuál"
                value={motivoDetalle}
                onChange={(e) => setMotivoDetalle(e.target.value)}
              />
            )}
            <Button
              className="w-full"
              disabled={
                ocupado ||
                !productoId ||
                !bodegaId ||
                !Number(cantidad.replace(",", ".")) ||
                (motivoElegido?.exige_detalle && !motivoDetalle.trim())
              }
              onClick={registrar}
            >
              Registrar
            </Button>
          </div>
        </Card>

        {/* ------------------------------------- Traslado */}
        <Card>
          <CardTitle>Traslado entre bodegas</CardTitle>
          <CardDescription>
            Sale de una y entra a la otra. Los dos movimientos quedan ligados, así que el kardex
            muestra un traslado y no una merma seguida de una aparición.
          </CardDescription>
          <div className="mt-3 space-y-3">
            <Select
              label="Producto"
              value={tProducto}
              onChange={(e) => setTProducto(e.target.value)}
              options={[{ value: "", label: "Elegí un producto" }, ...opcionesProducto]}
            />
            <Select
              label="Desde"
              value={tOrigen}
              onChange={(e) => setTOrigen(e.target.value)}
              options={opcionesBodega}
            />
            <Select
              label="Hacia"
              value={tDestino}
              onChange={(e) => setTDestino(e.target.value)}
              options={[{ value: "", label: "Elegí la bodega destino" }, ...opcionesBodega]}
            />
            <Input
              label="Cantidad (unidad base)"
              value={tCantidad}
              onChange={(e) => setTCantidad(e.target.value)}
              placeholder="10"
            />
            <Button
              className="w-full"
              disabled={
                ocupado ||
                !tProducto ||
                !tOrigen ||
                !tDestino ||
                tOrigen === tDestino ||
                !Number(tCantidad.replace(",", "."))
              }
              onClick={trasladar}
            >
              Trasladar
            </Button>
            {tOrigen === tDestino && tDestino !== "" && (
              <p className="text-xs text-text-muted">El origen y el destino no pueden ser la misma bodega.</p>
            )}
          </div>
        </Card>

        {/* ------------------------------------- Ajuste */}
        <Card>
          <CardTitle>Ajuste</CardTitle>
          <CardDescription>
            Sobre el umbral configurado necesita que lo apruebe un administrador, y hasta entonces
            no mueve stock.
          </CardDescription>
          <div className="mt-3 space-y-3">
            <Select
              label="Dirección"
              value={aTipo}
              onChange={(e) => setATipo(e.target.value as "positivo" | "negativo")}
              options={[
                { value: "negativo", label: "Negativo (hay menos de lo que dice)" },
                { value: "positivo", label: "Positivo (hay más de lo que dice)" },
              ]}
            />
            <Select
              label="Producto"
              value={aProducto}
              onChange={(e) => setAProducto(e.target.value)}
              options={[{ value: "", label: "Elegí un producto" }, ...opcionesProducto]}
            />
            <Select
              label="Bodega"
              value={aBodega}
              onChange={(e) => setABodega(e.target.value)}
              options={opcionesBodega}
            />
            <Input
              label="Cantidad (unidad base)"
              value={aCantidad}
              onChange={(e) => setACantidad(e.target.value)}
              placeholder="3"
            />
            <Select
              label="Motivo"
              value={aMotivo}
              onChange={(e) => setAMotivo(e.target.value)}
              options={(catalogos?.motivos ?? []).map((m) => ({ value: m.codigo, label: m.nombre }))}
            />
            {aMotivoElegido?.exige_detalle && (
              <Input label="Decí cuál" value={aDetalle} onChange={(e) => setADetalle(e.target.value)} />
            )}
            <Button
              className="w-full"
              disabled={
                ocupado ||
                !aProducto ||
                !aBodega ||
                !Number(aCantidad.replace(",", ".")) ||
                (aMotivoElegido?.exige_detalle && !aDetalle.trim())
              }
              onClick={pedirAjuste}
            >
              Pedir ajuste
            </Button>
          </div>
        </Card>
      </div>

      {/* ------------------------------------- Ajustes */}
      <Card className="mt-4">
        <CardTitle>Ajustes</CardTitle>
        <CardDescription>
          Los pendientes esperan a un administrador. Queda registrado quién lo pidió y quién lo
          resolvió.
        </CardDescription>
        <div className="mt-3">
          <Table
            columns={columnasAjustes}
            data={ajustes}
            rowKey={(a) => a.id}
            emptyMessage="Sin ajustes todavía."
          />
        </div>
      </Card>
    </div>
  );
}
