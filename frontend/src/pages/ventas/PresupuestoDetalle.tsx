import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  useToast,
} from "../../components/ui";
import { guardarComoArchivo } from "../../lib/descargas";
import { formatearMonto, PresupuestoDetalleDatos, ventasApi } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// EL DETALLE DE UN PRESUPUESTO — prompt 08b, A1.
//
// Lo que se hace desde acá, en el orden en que pasa en la clínica:
// bajar el PDF para entregarlo, marcar que se entregó, registrar lo que
// el cliente contestó, y convertirlo en cargos.
//
// LO QUE EL VENCIDO PREGUNTA. Si la vigencia pasó, el backend devuelve
// un 409 en vez de decidir, y acá se abre el modal con las dos
// opciones: respetar lo cotizado (que necesita autorización, porque es
// un descuento) o cobrar lo de hoy.
// ---------------------------------------------------------------------

export function PresupuestoDetalle() {
  const { id = "" } = useParams();
  const navegar = useNavigate();
  const { mostrar } = useToast();
  const [p, setP] = useState<PresupuestoDetalleDatos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [recargar, setRecargar] = useState(0);
  const [respondiendo, setRespondiendo] = useState(false);
  const [respuesta, setRespuesta] = useState({ acepta: true, como: "telefono", nota: "" });
  const [vencido, setVencido] = useState<{ venceEl: string | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    ventasApi
      .presupuesto(id)
      .then((r) => vivo && setP(r.presupuesto))
      .catch((err) =>
        mostrar("error", err instanceof Error ? err.message : "No pudimos cargar el presupuesto.")
      )
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [id, recargar, mostrar]);

  const bajarPdf = async () => {
    try {
      const r = await ventasApi.presupuestoPdf(id);
      guardarComoArchivo(r.blob, r.filename ?? `presupuesto-${p?.numero ?? ""}.pdf`);
    } catch (err) {
      mostrar("error", err instanceof Error ? err.message : "No pudimos generar el PDF.");
    }
  };

  const convertir = async (precioVencido?: "cotizado" | "actual") => {
    setOcupado(true);
    try {
      const r = await ventasApi.convertirPresupuesto(id, { precioVencido });
      setVencido(null);
      mostrar(
        "exito",
        `Convertido en ${r.cargos} cargo(s) en la cuenta ${r.cuentaNumero}. ${r.avisos.join(" ")}`
      );
      navegar(`/ventas/cobro?cuenta=${r.cuentaId}`);
    } catch (err) {
      // El 409 del vencido trae la fecha: se abre el modal con las dos
      // opciones en vez de mostrar un error sin salida.
      const e = err as { vencido?: boolean; venceEl?: string | null; message?: string };
      if (e?.vencido) {
        setVencido({ venceEl: e.venceEl ?? null });
      } else {
        mostrar("error", e?.message ?? "No pudimos convertirlo.");
      }
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" cantidad={3} etiqueta="Cargando" />;
  if (!p) return null;

  const sePuedeConvertir = p.estado !== "convertido" && p.estado !== "rechazado";

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={`Presupuesto N.º ${p.numero}`}
        subtitulo={[
          p.cliente_nombre,
          p.paciente_nombre ? `Paciente: ${p.paciente_nombre}` : null,
          p.vence_el ? `Vigente hasta el ${p.vence_el}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        icono="comprobante"
        modulo="ventas"
        secundarias={
          <>
            <Button variant="secondary" onClick={bajarPdf}>
              Bajar el PDF
            </Button>
            {p.estado === "borrador" && (
              <Button
                variant="secondary"
                disabled={ocupado}
                onClick={async () => {
                  setOcupado(true);
                  try {
                    await ventasApi.enviarPresupuesto(id);
                    mostrar("exito", "Marcado como entregado al cliente.");
                    setRecargar((n) => n + 1);
                  } catch (err) {
                    mostrar("error", err instanceof Error ? err.message : "No pudimos marcarlo.");
                  } finally {
                    setOcupado(false);
                  }
                }}
              >
                Marcar como entregado
              </Button>
            )}
            {p.estado !== "convertido" && (
              <Button variant="secondary" onClick={() => setRespondiendo(true)}>
                Registrar la respuesta del cliente
              </Button>
            )}
          </>
        }
        accion={
          sePuedeConvertir ? (
            <Button disabled={ocupado} onClick={() => convertir()}>
              Convertir en cargos
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={p.estado === "convertido" ? "success" : "info"}>{p.estado}</Badge>
        {p.vencido && <Badge variant="warning">Vencido el {p.vence_el}</Badge>}
        {p.respondido_como && (
          <span className="text-sm text-text-muted">
            Contestó por {p.respondido_como.replace("_", " ")}
            {p.respuesta_nota ? `: «${p.respuesta_nota}»` : ""}
          </span>
        )}
        {p.cuenta_numero && (
          <span className="text-sm text-text-muted">Cuenta {p.cuenta_numero}</span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-background text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-2 text-left">Concepto</th>
              <th className="px-4 py-2 text-right">Cant.</th>
              <th className="px-4 py-2 text-right">Precio</th>
              <th className="px-4 py-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {p.lineas.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">
                  <span className="text-text-primary">{l.descripcion}</span>
                  {l.nota && <p className="mt-0.5 text-xs italic text-text-muted">{l.nota}</p>}
                  {Number(l.descuento) > 0 && (
                    <p className="mt-0.5 text-xs text-text-muted">
                      Incluye un descuento de {formatearMonto(l.descuento)}
                      {l.descuento_naturaleza ? ` · ${l.descuento_naturaleza}` : ""}
                    </p>
                  )}
                </td>
                <td className="px-4 py-2 text-right">{Number(l.cantidad)}</td>
                <td className="px-4 py-2 text-right">{formatearMonto(l.precio_unitario)}</td>
                <td className="px-4 py-2 text-right">
                  {formatearMonto(
                    Number(l.cantidad) * Number(l.precio_unitario) - Number(l.descuento)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-background font-semibold">
            <tr>
              <td className="px-4 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-4 py-2 text-right">{formatearMonto(p.total)}</td>
            </tr>
            {p.anticipado > 0 && (
              <>
                <tr className="font-normal">
                  <td className="px-4 py-2" colSpan={3}>
                    Anticipo ya recibido
                  </td>
                  <td className="px-4 py-2 text-right">- {formatearMonto(p.anticipado)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2" colSpan={3}>
                    Queda por pagar
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatearMonto(p.total - p.anticipado)}
                  </td>
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>

      {p.observaciones && (
        <div className="rounded-xl bg-background p-4 text-sm text-text-primary">
          {p.observaciones}
        </div>
      )}

      {/* --------------------------------- La respuesta del cliente */}
      <Modal
        open={respondiendo}
        onClose={() => setRespondiendo(false)}
        title="Qué contestó el cliente"
        description="Lo registra quien recibió la respuesta. El cliente no aprueba en línea: eso todavía no existe."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRespondiendo(false)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                try {
                  await ventasApi.responderPresupuesto(id, respuesta);
                  mostrar("exito", "Respuesta registrada.");
                  setRespondiendo(false);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  mostrar("error", err instanceof Error ? err.message : "No pudimos registrarla.");
                } finally {
                  setOcupado(false);
                }
              }}
            >
              Registrar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Select
            label="Qué dijo"
            value={respuesta.acepta ? "si" : "no"}
            onChange={(e) => setRespuesta({ ...respuesta, acepta: e.target.value === "si" })}
            options={[
              { value: "si", label: "Lo acepta" },
              { value: "no", label: "Lo rechaza" },
            ]}
          />
          <Select
            label="Por dónde contestó"
            value={respuesta.como}
            onChange={(e) => setRespuesta({ ...respuesta, como: e.target.value })}
            options={[
              { value: "telefono", label: "Por teléfono" },
              { value: "whatsapp", label: "Por WhatsApp" },
              { value: "correo", label: "Por correo" },
              { value: "en_persona", label: "En persona" },
            ]}
          />
          <Input
            label="Nota (opcional)"
            value={respuesta.nota}
            placeholder="Programa para el jueves, pregunta si se puede en dos pagos…"
            onChange={(e) => setRespuesta({ ...respuesta, nota: e.target.value })}
          />
        </div>
      </Modal>

      {/* ------------------------------------- El precio del vencido */}
      <Modal
        open={vencido !== null}
        onClose={() => setVencido(null)}
        title="Este presupuesto está vencido"
        description={`Venció el ${vencido?.venceEl ?? ""}. Hay que decidir con qué precio se cobra.`}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setVencido(null)}>
              Cancelar
            </Button>
            <Button variant="secondary" disabled={ocupado} onClick={() => convertir("cotizado")}>
              Respetar el precio cotizado
            </Button>
            <Button disabled={ocupado} onClick={() => convertir("actual")}>
              Usar los precios de hoy
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-muted">
          Respetar un precio vencido es cobrar menos de lo que vale hoy, así que lo autoriza quien
          puede autorizar descuentos. Usar los precios de hoy vuelve a tasar cada línea contra el
          catálogo.
        </p>
      </Modal>
    </div>
  );
}
