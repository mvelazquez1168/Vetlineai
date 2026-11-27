import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  BadgeVariant,
  Button,
  EmptyState,
  LoadingState,
  PageHeader,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import { formatearMonto, PresupuestoListado, ventasApi } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// LA LISTA DE PRESUPUESTOS — prompt 08b, A1.
//
// Es la versión esencial que pide el prompt: la lista con sus filtros y
// el detalle. Sin indicadores de tasa de aprobación y sin edición
// simultánea en pestañas.
//
// EL FILTRO QUE IMPORTA ES «POR VENCER», y por eso es un botón y no una
// opción escondida en el desplegable: es la lista con la que la
// recepción llama a los clientes antes de que se caiga la cotización.
// ---------------------------------------------------------------------

const ESTADO_BADGE: Record<string, BadgeVariant> = {
  borrador: "neutral",
  enviado: "info",
  aceptado: "success",
  rechazado: "error",
  vencido: "warning",
  convertido: "success",
};

const ETIQUETA: Record<string, string> = {
  borrador: "Borrador",
  enviado: "Entregado al cliente",
  aceptado: "Aceptado",
  rechazado: "Rechazado",
  vencido: "Vencido",
  convertido: "Convertido en cargos",
};

export function Presupuestos() {
  const navegar = useNavigate();
  const { mostrar } = useToast();
  const [filas, setFilas] = useState<PresupuestoListado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState("");
  const [porVencer, setPorVencer] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    ventasApi
      .presupuestos({ estado: estado || undefined, porVencer })
      .then((r) => vivo && setFilas(r.presupuestos))
      .catch((err) =>
        mostrar("error", err instanceof Error ? err.message : "No pudimos cargar los presupuestos.")
      )
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [estado, porVencer, mostrar]);

  const columnas: TableColumn<PresupuestoListado>[] = [
    {
      key: "numero",
      header: "N.º",
      render: (p) => (
        <button
          type="button"
          className="font-mono text-sm font-semibold text-primary hover:underline"
          onClick={() => navegar(`/ventas/presupuestos/${p.id}`)}
        >
          {p.numero}
        </button>
      ),
    },
    { key: "cliente", header: "Cliente", render: (p) => p.cliente_nombre ?? "—" },
    { key: "paciente", header: "Paciente", render: (p) => p.paciente_nombre ?? "—" },
    { key: "total", header: "Total", render: (p) => formatearMonto(p.total) },
    {
      key: "vence",
      header: "Vence",
      render: (p) => (
        <span className={p.vencido ? "font-semibold text-warning" : ""}>{p.vence_el ?? "—"}</span>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (p) => (
        <Badge variant={ESTADO_BADGE[p.estado] ?? "neutral"}>
          {/* VENCIDO GANA SOBRE EL ESTADO GUARDADO: el job corre a las
              6:10 y la pantalla no puede decir «entregado» de algo que
              ya no se puede convertir. */}
          {p.vencido && p.estado !== "vencido" ? "Vencido" : (ETIQUETA[p.estado] ?? p.estado)}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        titulo="Presupuestos"
        subtitulo="Cotizaciones entregadas a los clientes. No son comprobantes electrónicos y no afectan el inventario hasta convertirse."
        icono="comprobante"
        modulo="ventas"
        accion={
          <Button onClick={() => navegar("/ventas/presupuestos/nuevo")}>+ Nuevo presupuesto</Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Select
          label="Estado"
          className="w-56"
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            setPorVencer(false);
          }}
          options={[
            { value: "", label: "Todos" },
            ...Object.entries(ETIQUETA).map(([v, l]) => ({ value: v, label: l })),
          ]}
        />
        <Button
          variant={porVencer ? "primary" : "secondary"}
          onClick={() => {
            setPorVencer((v) => !v);
            setEstado("");
          }}
        >
          {porVencer ? "Viendo los que vencen pronto" : "Los que vencen en 5 días"}
        </Button>
      </div>

      <div className="mt-6">
        {cargando ? (
          <LoadingState forma="tabla" cantidad={6} etiqueta="Cargando presupuestos" />
        ) : filas.length === 0 ? (
          <EmptyState
            icono="comprobante"
            titulo={porVencer ? "Ninguno vence en los próximos días" : "Todavía no hay presupuestos"}
            texto={
              porVencer
                ? "Nada que apurar."
                : "Un presupuesto se arma desde acá, desde la ficha del cliente o desde la consulta, cuando el médico cotiza una cirugía o un tratamiento."
            }
          />
        ) : (
          <Table columns={columnas} data={filas} rowKey={(p) => p.id} />
        )}
      </div>
    </div>
  );
}
