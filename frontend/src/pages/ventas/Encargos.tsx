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
import { Encargo, ventasApi } from "../../lib/ventasApi";
import { ProductoListado, inventarioApi } from "../../lib/inventarioApi";
import { ReceptorEncontrado, facturacionCrApi } from "../../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// ENCARGOS ESPECIALES: alimentos o medicamentos que se piden para un
// cliente concreto.
//
// El estado `recibido` **reserva el stock**: si no se reservara, el
// producto que se pidió para alguien se le vende al primero que entre y
// hay que volver a pedirlo.
//
// EL AVISO AL CLIENTE todavía no sale solo: el canal lo va a dar el
// CRM. Mientras tanto el encargo en estado `recibido` **queda visible
// en caja** como tarea pendiente, que es exactamente lo que el prompt
// pide para el intertanto. La pantalla lo dice en vez de simular que
// manda algo.
// ---------------------------------------------------------------------

const ESTADOS: Record<string, { etiqueta: string; variante: "neutral" | "info" | "warning" | "success" | "error" }> = {
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

export function Encargos() {
  const toast = useToast();
  const [encargos, setEncargos] = useState<Encargo[]>([]);
  const [productos, setProductos] = useState<ProductoListado[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const [creando, setCreando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [clientes, setClientes] = useState<ReceptorEncontrado[]>([]);
  const [cliente, setCliente] = useState<ReceptorEncontrado | null>(null);
  const [nuevo, setNuevo] = useState({ productoId: "", descripcion: "", cantidad: "1" });

  const recargar = () =>
    ventasApi.encargos().then((r) => setEncargos(r.encargos)).catch(() => setEncargos([]));

  useEffect(() => {
    recargar();
    inventarioApi
      .productos({ porPagina: 100 })
      .then((r) => setProductos(r.productos))
      .catch(() => setProductos([]));
  }, []);

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setClientes([]);
      return;
    }
    const t = setTimeout(() => {
      facturacionCrApi
        .buscarReceptores(busqueda)
        .then((r) => setClientes(r.receptores))
        .catch(() => setClientes([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const crear = async () => {
    if (!cliente) return;
    setOcupado(true);
    try {
      await ventasApi.crearEncargo({
        propietarioId: cliente.id,
        productoId: nuevo.productoId || undefined,
        descripcion:
          nuevo.descripcion.trim() ||
          productos.find((p) => p.id === nuevo.productoId)?.nombre ||
          "Encargo",
        cantidad: Number(nuevo.cantidad.replace(",", ".")) || 1,
      });
      toast.exito("Encargo registrado.");
      setCreando(false);
      setCliente(null);
      setNuevo({ productoId: "", descripcion: "", cantidad: "1" });
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const cambiar = async (id: string, estado: string) => {
    setOcupado(true);
    try {
      await ventasApi.estadoEncargo(id, estado);
      toast.exito(
        estado === "recibido"
          ? "Recibido y reservado: no se le vende a otro cliente."
          : estado === "avisado"
            ? "Marcado como avisado. El aviso automático llega con el CRM."
            : "Encargo actualizado."
      );
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
          </span>
        </>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (e) => (
        <Badge variant={ESTADOS[e.estado]?.variante ?? "neutral"} dot>
          {ESTADOS[e.estado]?.etiqueta ?? e.estado}
        </Badge>
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
              onClick={() => cambiar(e.id, s)}
            >
              {ESTADOS[s]?.etiqueta.split(" —")[0] ?? s}
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
              ? `${porAvisar} encargo(s) llegaron y hay que avisarle al cliente.`
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
          Al marcarlo recibido se reserva el stock. El aviso automático al cliente llega con el
          CRM; mientras tanto, los que están en «Recibido» son la lista de a quién hay que llamar.
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
          <Input
            label="Cantidad"
            value={nuevo.cantidad}
            onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
