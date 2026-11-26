import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  CollapsibleSection,
  Icono,
  Input,
  LoadingState,
  Modal,
  Select,
  Table,
  TableColumn,
  useToast,
  PageHeader,
} from "../../components/ui";
import {
  Catalogos,
  DetalleComprobante,
  LineaDetalleApi,
  facturacionCrApi,
  formatearMonto,
  varianteEstado,
} from "../../lib/facturacionCrApi";
import { guardarComoArchivo } from "../../lib/descargas";

// ---------------------------------------------------------------------
// Detalle de un comprobante: sus datos, sus líneas, su historia de
// eventos, el XML firmado, la respuesta de Hacienda, y las acciones.
//
// La historia de eventos está arriba y no escondida al final: cuando
// alguien abre esta pantalla, en nueve de cada diez casos es porque algo
// no salió como esperaba, y los eventos son lo que explica POR QUÉ.
// ---------------------------------------------------------------------

const EVENTOS: Record<string, { etiqueta: string; icono: "check" | "aviso" | "info" | "hora" }> = {
  creado: { etiqueta: "Creado", icono: "info" },
  firmado: { etiqueta: "Firmado", icono: "check" },
  enviado: { etiqueta: "Enviado a Hacienda", icono: "check" },
  respuesta_recibida: { etiqueta: "Respuesta de Hacienda", icono: "check" },
  reintento: { etiqueta: "Reintento", icono: "hora" },
  contingencia: { etiqueta: "Contingencia: Hacienda no respondió", icono: "aviso" },
  anulado_por_nota: { etiqueta: "Anulado por una nota", icono: "info" },
  error: { etiqueta: "Error", icono: "aviso" },
};

export function ComprobanteDetalle() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [datos, setDatos] = useState<DetalleComprobante | null>(null);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modalNota, setModalNota] = useState<"credito" | "debito" | null>(null);
  const [codigoReferencia, setCodigoReferencia] = useState("01");
  const [razon, setRazon] = useState("");

  const recargar = () => {
    if (!id) return;
    setCargando(true);
    facturacionCrApi
      .detalle(id)
      .then(setDatos)
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  };

  useEffect(recargar, [id]);
  useEffect(() => {
    facturacionCrApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
  }, []);

  /**
   * Las descargas van por blob autenticado: un `<a href>` no manda el
   * header Authorization y daría 401. El nombre del archivo lo decide el
   * backend (es el de la Nota 3) y se respeta.
   */
  const descargar = async (tipo: "pdf" | "xml") => {
    if (!id) return;
    try {
      const { blob, filename } = await (tipo === "pdf"
        ? facturacionCrApi.descargarPdf(id)
        : facturacionCrApi.descargarXml(id));
      guardarComoArchivo(blob, filename ?? `comprobante.${tipo}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const reenviar = async (destino: "hacienda" | "correo") => {
    if (!id) return;
    setOcupado(true);
    try {
      const r = await facturacionCrApi.reenviar(id, destino);
      if (destino === "correo") {
        if (r.entrega?.enviado) toast.exito("El correo salió al receptor.");
        else toast.aviso(`No se envió: ${r.entrega?.motivo ?? "sin motivo"}`);
      } else {
        toast.exito(`Estado tras reintentar: ${r.estado}`);
      }
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const emitirNota = async () => {
    if (!id || !modalNota) return;
    setOcupado(true);
    try {
      const r = await facturacionCrApi.nota(id, modalNota, { codigoReferencia, razon });
      toast.exito(`Nota ${r.consecutivo} emitida (${r.estado}).`);
      setModalNota(null);
      setRazon("");
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (cargando && !datos) return <LoadingState forma="tarjetas" cantidad={3} />;
  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!datos) return null;

  const c = datos.comprobante;
  const yaSalio = ["enviado", "aceptado", "aceptado_parcial", "rechazado"].includes(c.estado);

  const columnasLinea: TableColumn<LineaDetalleApi>[] = [
    { key: "n", header: "#", render: (l) => String(l.numero_linea) },
    {
      key: "detalle",
      header: "Detalle",
      render: (l) => (
        <>
          <span>{l.detalle}</span>
          {l.codigo_cabys && (
            <span className="block text-xs text-text-muted">CABYS {l.codigo_cabys}</span>
          )}
        </>
      ),
    },
    {
      key: "cantidad",
      header: "Cantidad",
      className: "text-right",
      render: (l) => `${Number(l.cantidad).toLocaleString("es-CR")} ${l.unidad_medida}`,
    },
    {
      key: "precio",
      header: "Precio",
      className: "text-right",
      render: (l) => formatearMonto(l.precio_unitario, c.moneda),
    },
    {
      key: "impuesto",
      header: "Impuesto",
      className: "text-right",
      render: (l) => (
        <>
          <span>{formatearMonto(l.impuesto_neto, c.moneda)}</span>
          <span className="block text-xs text-text-muted">
            {l.impuestos
              .map((i) => (i.tarifa ? `${Number(i.tarifa)}%` : `cód. ${i.codigoImpuesto}`))
              .join(", ")}
          </span>
        </>
      ),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      render: (l) => formatearMonto(l.monto_total_linea, c.moneda),
    },
  ];

  const totales: Array<[string, string]> = [
    ["Gravado", c.total_gravado],
    ["Exento", c.total_exento],
    ["Descuentos", c.total_descuentos],
    ["Venta neta", c.total_venta_neta],
    ["Impuesto", c.total_impuesto],
    ["Otros cargos", c.total_otros_cargos],
  ];

  return (
    <div>
      <PageHeader
        variante="compacta"
        titulo={c.consecutivo ?? "Comprobante sin consecutivo"}
        icono="comprobante"
        modulo="facturacion"
        padre={{ a: "/facturacion", etiqueta: "Comprobantes" }}
        contexto={<span className="break-all font-mono text-xs">{c.clave}</span>}
      />
      <div className="mb-4 flex flex-wrap items-start justify-end gap-3">
        <Badge variant={varianteEstado(c.estado)} dot>
          {c.estadoLegible}
        </Badge>
      </div>

      {c.respuesta_detalle && (
        <div className="mt-3 rounded-xl border border-black/5 bg-surface p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Lo que respondió Hacienda
          </p>
          {/* Se muestra TAL CUAL. Reescribirlo en palabras propias haría
              imposible buscar el texto exacto en la documentación de
              Hacienda, que es lo primero que alguien va a hacer. */}
          <p className="mt-1 text-sm text-text">{c.respuesta_detalle}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => descargar("pdf")}>
          <Icono nombre="pdf" tamano={16} /> PDF
        </Button>
        <Button variant="secondary" onClick={() => descargar("xml")} disabled={!c.xmlFirmado}>
          <Icono nombre="descargar" tamano={16} /> XML
        </Button>
        <Button variant="ghost" onClick={() => reenviar("correo")} disabled={ocupado}>
          Reenviar el correo
        </Button>
        {c.estado !== "aceptado" && c.estado !== "rechazado" && (
          <Button variant="ghost" onClick={() => reenviar("hacienda")} disabled={ocupado}>
            Reintentar en Hacienda
          </Button>
        )}
        {yaSalio && c.estado !== "rechazado" && (
          <>
            <Button variant="ghost" onClick={() => setModalNota("credito")}>
              Nota de crédito
            </Button>
            <Button variant="ghost" onClick={() => setModalNota("debito")}>
              Nota de débito
            </Button>
          </>
        )}
      </div>

      {/* La historia primero: es lo que explica el estado. */}
      <Card className="mt-6">
        <CardTitle>Qué le pasó a este comprobante</CardTitle>
        <ol className="mt-3 space-y-3">
          {datos.eventos.map((e, i) => {
            const meta = EVENTOS[e.tipo_evento] ?? { etiqueta: e.tipo_evento, icono: "info" as const };
            return (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-0.5 text-text-muted">
                  <Icono nombre={meta.icono} tamano={16} />
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-text">{meta.etiqueta}</p>
                  <p className="text-xs text-text-muted">
                    {new Date(e.creado_en).toLocaleString("es-CR")}
                  </p>
                  {e.detalle && (
                    <p className="mt-1 break-words text-xs text-text-muted">
                      {Object.entries(e.detalle)
                        .filter(([, v]) => v !== null && v !== undefined)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Receptor</CardTitle>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-text-muted">Nombre</dt>
              <dd>{c.receptor_nombre ?? "Consumidor final"}</dd>
            </div>
            {c.receptor_numero_identificacion && (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-text-muted">Identificación</dt>
                <dd>{c.receptor_numero_identificacion}</dd>
              </div>
            )}
            {c.receptor_correo && (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-text-muted">Correo</dt>
                <dd>{c.receptor_correo}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-text-muted">Emisión</dt>
              <dd>{new Date(c.fecha_emision).toLocaleString("es-CR")}</dd>
            </div>
            {datos.mediosPago.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-text-muted">Medio de pago</dt>
                <dd>
                  {datos.mediosPago
                    .map(
                      (m) =>
                        catalogos?.mediosPago.find((x) => x.codigo === m.codigo_medio_pago)?.nombre ??
                        m.codigo_medio_pago
                    )
                    .join(", ")}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <CardTitle>Totales</CardTitle>
          <dl className="mt-3 space-y-1 text-sm">
            {totales
              // Las líneas en cero no se muestran: una factura sin
              // descuentos no tiene por qué decir "Descuentos 0,00".
              .filter(([, v]) => Number(v) !== 0)
              .map(([etiqueta, valor]) => (
                <div key={etiqueta} className="flex justify-between gap-2">
                  <dt className="text-text-muted">{etiqueta}</dt>
                  <dd>{formatearMonto(valor, c.moneda)}</dd>
                </div>
              ))}
            <div className="mt-2 flex justify-between gap-2 border-t border-black/5 pt-2 text-base font-bold text-primary">
              <dt>Total</dt>
              <dd>{formatearMonto(c.total_comprobante, c.moneda)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Detalle</CardTitle>
        <div className="mt-3">
          <Table columns={columnasLinea} data={datos.lineas} rowKey={(l) => String(l.numero_linea)} />
        </div>
      </Card>

      {datos.referencias.length > 0 && (
        <Card className="mt-4">
          <CardTitle>A qué comprobante se refiere</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {datos.referencias.map((r, i) => (
              <li key={i}>
                <span className="break-all font-mono text-xs">{r.numero}</span>
                {r.razon && <span className="block text-text-muted">{r.razon}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {datos.notas.length > 0 && (
        <Card className="mt-4">
          <CardTitle>Notas que corrigen este comprobante</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {datos.notas.map((n) => (
              <li key={n.id}>
                <Link to={`/facturacion/comprobantes/${n.id}`} className="text-primary hover:underline">
                  {n.consecutivo}
                </Link>
                <span className="ml-2 text-text-muted">
                  {formatearMonto(n.total_comprobante, c.moneda)} · {n.estado}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* El XML va colapsado: es el documento con validez legal y tiene
          que estar accesible, pero son 6-10 KB que nadie lee de arriba
          abajo. */}
      <div className="mt-4 space-y-3">
        {c.xmlFirmado && (
          <CollapsibleSection titulo="XML firmado (el documento con validez legal)">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 text-xs">
              {c.xmlFirmado}
            </pre>
          </CollapsibleSection>
        )}
        {c.respuestaXml && (
          <CollapsibleSection titulo="Respuesta de Hacienda (XML)">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 text-xs">
              {c.respuestaXml}
            </pre>
          </CollapsibleSection>
        )}
      </div>

      <Modal
        open={modalNota !== null}
        onClose={() => setModalNota(null)}
        title={modalNota === "credito" ? "Nota de crédito" : "Nota de débito"}
        description={
          modalNota === "credito"
            ? "Baja el monto del comprobante original: una anulación, una devolución o un descuento posterior."
            : "Sube el monto del comprobante original: un cargo que faltaba."
        }
        ancho="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalNota(null)}>
              Cancelar
            </Button>
            <Button onClick={emitirNota} disabled={ocupado || razon.trim().length < 3}>
              Emitir la nota
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Qué efecto tiene"
            value={codigoReferencia}
            onChange={(e) => setCodigoReferencia(e.target.value)}
            options={(catalogos?.codigosReferencia ?? []).map((r) => ({
              value: r.codigo,
              label: `${r.codigo} — ${r.nombre}`,
            }))}
          />
          {/* Esto NO tiene un default silencioso a propósito: "anula el
              documento" y "corrige el monto" tienen efectos contables
              distintos en la declaración del receptor. */}
          <p className="text-xs text-text-muted">
            El código define el efecto contable para el receptor, no solo el texto: elegir mal cambia
            su declaración de IVA.
          </p>
          <Input
            label="Razón"
            value={razon}
            onChange={(e) => setRazon(e.target.value)}
            placeholder="Anulación por error en el monto facturado"
            maxLength={180}
          />
          <p className="text-xs text-text-muted">
            La nota copia las líneas del comprobante original. El original no se modifica: queda como
            está y la nota lo corrige.
          </p>
        </div>
      </Modal>
    </div>
  );
}
