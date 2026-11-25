import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  EmptyState,
  Icono,
  LoadingState,
  Modal,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import { Recibido, facturacionCrApi, formatearMonto } from "../../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// Comprobantes recibidos de proveedores, y el mensaje receptor con el
// que se aceptan o se rechazan.
//
// La columna que importa es "Mensaje receptor": es lo que la clínica
// tiene que emitir dentro del plazo, y lo que define si el IVA de esa
// factura es acreditable. Un comprobante cargado sin mensaje no está
// terminado, y la pantalla lo dice.
// ---------------------------------------------------------------------

const CONDICIONES_IMPUESTO = [
  { value: "01", label: "01 — Genera crédito IVA" },
  { value: "02", label: "02 — Genera crédito parcial del IVA" },
  { value: "03", label: "03 — Bienes de capital" },
  { value: "04", label: "04 — Gasto corriente, no genera crédito" },
  { value: "05", label: "05 — Proporcionalidad" },
];

const MENSAJES = [
  { value: "1", label: "1 — Aceptado" },
  { value: "2", label: "2 — Aceptado parcialmente" },
  { value: "3", label: "3 — Rechazado" },
];

export function ComprobantesRecibidos() {
  const toast = useToast();
  const [recibidos, setRecibidos] = useState<Recibido[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modalMensaje, setModalMensaje] = useState<Recibido | null>(null);
  const [mensaje, setMensaje] = useState<"1" | "2" | "3">("1");
  const [condicionImpuesto, setCondicionImpuesto] = useState("01");
  const [detalle, setDetalle] = useState("");

  const recargar = () => {
    setCargando(true);
    facturacionCrApi
      .recibidos()
      .then((r) => setRecibidos(r.recibidos))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  };

  useEffect(recargar, []);

  const cargarArchivo = async (archivo: File) => {
    setOcupado(true);
    try {
      const xml = await archivo.text();
      const r = await facturacionCrApi.cargarRecibido(xml);
      if (r.yaEstaba) {
        toast.aviso(`Ese comprobante ya estaba cargado (${r.clave.slice(-10)}). Se revalidó.`);
      } else if (r.validacionOk) {
        toast.exito("Comprobante cargado y válido contra el esquema de Hacienda.");
      } else {
        // Se cargó IGUAL, y eso es a propósito: la clínica recibió ese
        // documento de su proveedor y tiene que poder verlo para
        // reclamarle o rechazarlo formalmente.
        toast.aviso("Comprobante cargado, pero NO valida contra el esquema. Mirá el detalle.");
      }
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const emitirMensaje = async () => {
    if (!modalMensaje) return;
    setOcupado(true);
    try {
      const r = await facturacionCrApi.mensajeReceptor(modalMensaje.id, {
        mensaje,
        condicionImpuesto,
        detalle: detalle.trim() || undefined,
      });
      if (r.estado === "enviado") {
        toast.exito(`Mensaje receptor ${r.consecutivo} enviado.`);
      } else {
        // Un mensaje receptor NO se encola: tiene plazo y la clínica
        // tiene que saber que quedó pendiente.
        toast.aviso(
          `Mensaje receptor ${r.consecutivo} firmado pero SIN enviar: Hacienda no respondió. Hay que reintentarlo.`
        );
      }
      setModalMensaje(null);
      setDetalle("");
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<Recibido>[] = [
    {
      key: "proveedor",
      header: "Proveedor",
      render: (r) => (
        <>
          <span className="font-medium">{r.emisorNombre ?? "(sin nombre en el XML)"}</span>
          {r.emisorIdentificacion && (
            <span className="block text-xs text-text-muted">{r.emisorIdentificacion}</span>
          )}
        </>
      ),
    },
    {
      key: "comprobante",
      header: "Comprobante",
      render: (r) => (
        <>
          <span>{r.consecutivo ?? "—"}</span>
          <span className="block text-xs text-text-muted">{r.tipoComprobanteNombre ?? "—"}</span>
        </>
      ),
    },
    {
      key: "fecha",
      header: "Fecha",
      render: (r) =>
        r.fechaEmision
          ? new Date(r.fechaEmision).toLocaleDateString("es-CR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : "—",
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      render: (r) =>
        r.totalComprobante ? formatearMonto(r.totalComprobante, r.moneda ?? "CRC") : "—",
    },
    {
      key: "validacion",
      header: "Esquema",
      render: (r) =>
        r.validacionOk ? (
          <Badge variant="success" dot>
            Válido
          </Badge>
        ) : (
          <>
            <Badge variant="error" dot>
              No valida
            </Badge>
            {r.validacionDetalle && (
              <span
                className="mt-1 block max-w-xs truncate text-xs text-text-muted"
                title={r.validacionDetalle}
              >
                {r.validacionDetalle}
              </span>
            )}
          </>
        ),
    },
    {
      key: "mensaje",
      header: "Mensaje receptor",
      render: (r) =>
        r.mensajeEnviadoEn ? (
          <>
            <Badge variant={r.mensajeTipo === "3" ? "error" : "success"} dot>
              {r.mensajeTipo === "1"
                ? "Aceptado"
                : r.mensajeTipo === "2"
                  ? "Aceptado parcial"
                  : "Rechazado"}
            </Badge>
            <span className="block text-xs text-text-muted">{r.mensajeConsecutivo}</span>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setModalMensaje(r)}>
            Responder
          </Button>
        ),
    },
  ];

  const pendientes = (recibidos ?? []).filter((r) => !r.mensajeEnviadoEn).length;

  return (
    <div>
      <Link to="/facturacion" className="text-sm text-text-muted hover:text-primary">
        ← Comprobantes
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">Comprobantes recibidos</h2>
          <p className="mt-1 text-sm text-text-muted">
            Las facturas que la clínica recibe de sus proveedores, y el mensaje con el que se aceptan
            o se rechazan.
          </p>
        </div>
        <label className="inline-flex">
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            disabled={ocupado}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void cargarArchivo(f);
              e.target.value = "";
            }}
          />
          <span className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            <Icono nombre="agregar" tamano={16} /> Cargar un XML
          </span>
        </label>
      </div>

      {pendientes > 0 && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium text-text">
            {pendientes} comprobante(s) sin mensaje receptor.
          </p>
          <p className="text-text-muted">
            El mensaje receptor tiene plazo y es lo que define si el IVA de esa factura es
            acreditable. No se envía solo.
          </p>
        </div>
      )}

      {cargando && <LoadingState forma="tabla" cantidad={4} className="mt-4" />}
      {error && <p className="mt-6 text-sm text-error">{error}</p>}

      {!cargando && !error && recibidos && recibidos.length === 0 && (
        <EmptyState
          className="mt-4"
          icono="recibidos"
          titulo="Todavía no hay comprobantes de proveedores"
          texto="Cargá el XML que te manda tu proveedor. El sistema lo valida contra el esquema de Hacienda y después se le responde con el mensaje receptor."
        />
      )}

      {!cargando && !error && recibidos && recibidos.length > 0 && (
        <div className="mt-4">
          <Table columns={columnas} data={recibidos} rowKey={(r) => r.id} />
        </div>
      )}

      <Modal
        open={modalMensaje !== null}
        onClose={() => setModalMensaje(null)}
        title="Mensaje receptor"
        description={
          modalMensaje
            ? `Respuesta al comprobante ${modalMensaje.consecutivo ?? modalMensaje.clave.slice(-10)} de ${modalMensaje.emisorNombre ?? "el proveedor"}.`
            : ""
        }
        ancho="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalMensaje(null)}>
              Cancelar
            </Button>
            <Button onClick={emitirMensaje} disabled={ocupado}>
              Emitir y enviar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Respuesta"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value as "1" | "2" | "3")}
            options={MENSAJES}
          />
          <Select
            label="Condición del impuesto"
            value={condicionImpuesto}
            onChange={(e) => setCondicionImpuesto(e.target.value)}
            options={CONDICIONES_IMPUESTO}
          />
          <p className="text-xs text-text-muted">
            La condición del impuesto es lo que define si el IVA de esta factura se puede usar como
            crédito. No es un trámite: afecta la declaración de la clínica.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">Detalle (opcional)</span>
            <textarea
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              maxLength={160}
              rows={3}
              className="rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm"
              placeholder="Mercancía recibida completa y en buen estado."
            />
            <span className="text-xs text-text-muted">Hasta 160 caracteres (lo que admite el esquema).</span>
          </label>
          <Card>
            <CardTitle>Esto no se puede deshacer</CardTitle>
            <CardDescription>
              Un mensaje receptor no se reemplaza: una vez enviado, queda. Si la respuesta es
              incorrecta hay que resolverlo con el proveedor.
            </CardDescription>
          </Card>
        </div>
      </Modal>
    </div>
  );
}
