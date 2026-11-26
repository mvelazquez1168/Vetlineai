import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { Aprobacion, formatearMonto, ventasApi } from "../../lib/ventasApi";
import { plural } from "../../lib/plural";

// ---------------------------------------------------------------------
// Aprobaciones pendientes.
//
// Las seis clases de solicitud en una sola lista: anular un cobro,
// anular un comprobante, devolver producto, pasarse del crédito, pasarse
// del descuento y cerrar con diferencia. Son el mismo gesto —alguien
// pide, otro resuelve— y una lista por clase sería seis pantallas que
// se comportan parecido pero no igual.
//
// **Quien pidió no puede aprobar.** Lo impone el backend, no esta
// pantalla; acá solo se dice, para que nadie se sorprenda con el error.
// ---------------------------------------------------------------------

const ETIQUETA: Record<string, string> = {
  anular_cobro: "Anular un cobro",
  anular_comprobante: "Anular un comprobante",
  devolucion: "Devolución de producto",
  exceso_credito: "Venta sobre el límite de crédito",
  descuento: "Descuento sobre el máximo",
  diferencia_arqueo: "Cerrar caja con diferencia",
};

const QUE_PASA_AL_APROBAR: Record<string, string> = {
  anular_cobro: "Se anula el cobro y sale la nota de crédito. El dinero lo devuelve el cajero.",
  anular_comprobante: "Sale la nota de crédito que anula el comprobante.",
  devolucion: "El producto vuelve a su lote y el cargo queda anulado.",
  exceso_credito: "Queda el permiso; la venta la vuelve a intentar quien la pidió.",
  descuento: "Queda el permiso; el descuento lo aplica quien lo pidió.",
  diferencia_arqueo: "Queda el permiso; el cierre lo vuelve a intentar el cajero.",
};

export function AprobacionesVentas() {
  const toast = useToast();
  const { esAdminClinica } = useAuth();
  const [aprobaciones, setAprobaciones] = useState<Aprobacion[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const recargar = () =>
    ventasApi.aprobaciones().then((r) => setAprobaciones(r.aprobaciones)).catch(() => setAprobaciones([]));

  useEffect(() => {
    recargar();
  }, []);

  const resolver = async (id: string, aprobar: boolean) => {
    setOcupado(true);
    try {
      const r = await ventasApi.resolverAprobacion(id, aprobar);
      toast.exito(
        aprobar
          ? `Aprobada.${r.detalle?.nota ? ` Nota de crédito ${r.detalle.nota}.` : ""}`
          : "Rechazada."
      );
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<Aprobacion>[] = [
    {
      key: "tipo",
      header: "Qué se pide",
      render: (a) => (
        <>
          <span className="font-medium">{ETIQUETA[a.tipo] ?? a.tipo}</span>
          <span className="block text-xs text-text-muted">{a.motivo}</span>
          {a.estado === "pendiente" && (
            <span className="mt-0.5 block text-xs text-accent">
              Al aprobar: {QUE_PASA_AL_APROBAR[a.tipo] ?? "se aplica."}
            </span>
          )}
        </>
      ),
    },
    {
      key: "monto",
      header: "Monto",
      className: "text-right",
      render: (a) => (a.monto ? formatearMonto(a.monto) : "—"),
    },
    {
      key: "quien",
      header: "Quién",
      render: (a) => (
        <>
          <span className="text-sm">Pidió: {a.solicitada_por_nombre ?? "—"}</span>
          <span className="block text-xs text-text-muted">
            {new Date(a.solicitada_en).toLocaleString("es-CR")}
          </span>
          {a.resuelta_por_nombre && (
            <span className="block text-xs text-text-muted">
              Resolvió: {a.resuelta_por_nombre}
            </span>
          )}
        </>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (a) => (
        <Badge
          variant={
            a.estado === "pendiente" ? "warning" : a.estado === "aprobada" ? "success" : "error"
          }
          dot
        >
          {a.estado}
        </Badge>
      ),
    },
    {
      key: "acciones",
      header: "",
      render: (a) =>
        a.estado !== "pendiente" ? null : esAdminClinica ? (
          <div className="flex gap-2">
            <Button disabled={ocupado} onClick={() => resolver(a.id, true)}>
              Aprobar
            </Button>
            <Button variant="secondary" disabled={ocupado} onClick={() => resolver(a.id, false)}>
              Rechazar
            </Button>
          </div>
        ) : (
          <span className="text-xs text-text-muted">Lo resuelve un administrador</span>
        ),
    },
  ];

  const pendientes = aprobaciones.filter((a) => a.estado === "pendiente").length;

  return (
    <div>
      <Link to="/ventas" className="text-sm text-text-muted hover:text-primary">
        ← Caja
      </Link>
      <h2 className="mt-2 text-xl font-bold text-primary">Aprobaciones</h2>
      <p className="mt-1 text-sm text-text-muted">
        {pendientes === 0 ? "Nada pendiente." : `${plural(pendientes, "solicitud", "solicitudes")} esperando.`}
      </p>

      <Card className="mt-6">
        <CardTitle>Solicitudes</CardTitle>
        <CardDescription>
          Quien pide no puede aprobar su propia solicitud: tiene que resolverla otra persona.
        </CardDescription>
        <div className="mt-3">
          <Table
            columns={columnas}
            data={aprobaciones}
            rowKey={(a) => a.id}
            emptyMessage="Todavía no hubo solicitudes."
          />
        </div>
      </Card>
    </div>
  );
}
