import { useEffect, useState } from "react";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";
import { useFormularioSucio } from "../../hooks/useFormularioSucio";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  EmptyState,
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
import { Recibido, facturacionCrApi, formatearMonto } from "../../lib/facturacionCrApi";
import { inventarioApi } from "../../lib/inventarioApi";
import { CategoriaGasto, finanzasApi } from "../../lib/finanzasApi";
import { useAuth } from "../../hooks/useAuth";
import { guardarComoArchivo } from "../../lib/descargas";
import { plural } from "../../lib/plural";

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
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const toast = useToast();
  // CLASIFICAR UN COMPROBANTE COMO GASTO es una acción de finanzas, con
  // su permiso: la bandeja la mira quien factura, y registrar el gasto
  // lo hace quien lleva las cuentas. Si no lo tiene, el botón no está.
  const { puede } = useAuth();
  const puedeFinanzas = puede("finanzas.registrar");
  const [recibidos, setRecibidos] = useState<Recibido[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modalMensaje, setModalMensaje] = useState<Recibido | null>(null);
  const [mensaje, setMensaje] = useState<"1" | "2" | "3">("1");
  const [condicionImpuesto, setCondicionImpuesto] = useState("01");
  const [detalle, setDetalle] = useState("");
  // El registro en inventario (prompt 09b, B2).
  const [modalCompra, setModalCompra] = useState<Recibido | null>(null);
  const [lineas, setLineas] = useState<
    Array<{
      numeroLinea: number;
      descripcion: string;
      cantidad: number;
      precioUnitario: number;
      codigoProveedor: string | null;
      productoId: string | null;
      presentacionId: string | null;
      productoNombre: string | null;
      lote: string;
      vencimiento: string;
    }>
  >([]);
  const [proveedorDelXml, setProveedorDelXml] = useState<{
    id: string | null;
    nombre: string | null;
  }>({ id: null, nombre: null });
  const [bodegas, setBodegas] = useState<Array<{ id: string; nombre: string }>>([]);
  const [bodegaId, setBodegaId] = useState("");

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

  const abrirCompra = async (r: Recibido) => {
    setModalCompra(r);
    setLineas([]);
    try {
      const [datos, b] = await Promise.all([
        facturacionCrApi.lineasDelRecibido(r.id),
        inventarioApi.bodegas(),
      ]);
      setProveedorDelXml({ id: datos.proveedorId, nombre: datos.proveedorNombre });
      setBodegas(b.bodegas.map((x) => ({ id: x.id, nombre: x.nombre })));
      setBodegaId(b.bodegas[0]?.id ?? "");
      setLineas(
        datos.lineas.map((l) => ({
          ...l,
          // El lote nace vacío a propósito: es el dato que viene en la
          // caja física y no en el XML, y ponerle un valor por omisión
          // haría que alguien lo deje.
          lote: "",
          vencimiento: "",
        }))
      );
    } catch (err) {
      toast.mostrar(
        "error",
        err instanceof Error ? err.message : "No pudimos leer las líneas del comprobante."
      );
      setModalCompra(null);
    }
  };

  // --- Clasificar un comprobante como gasto (prompt 10a) -------------
  const [modalGasto, setModalGasto] = useState<Recibido | null>(null);
  const [categoriasGasto, setCategoriasGasto] = useState<CategoriaGasto[]>([]);
  const [categoriaElegida, setCategoriaElegida] = useState("");
  const [sugerida, setSugerida] = useState<string | null>(null);
  const [generaCuenta, setGeneraCuenta] = useState(true);
  const [proveedorGasto, setProveedorGasto] = useState<string | null>(null);

  const abrirGasto = async (r: Recibido) => {
    setModalGasto(r);
    setGeneraCuenta(true);
    try {
      // La sugerencia sale del ÚLTIMO gasto de ese proveedor: es lo que
      // hace que el segundo recibo de la luz no haya que clasificarlo.
      //
      // El proveedor del XML lo resuelve el mismo endpoint que usa la
      // compra: así la sugerencia funciona igual en los dos caminos y no
      // hay dos formas de identificar al emisor.
      const datos = await facturacionCrApi.lineasDelRecibido(r.id);
      setProveedorGasto(datos.proveedorId);
      const c = await finanzasApi.categorias(datos.proveedorId ?? undefined);
      setCategoriasGasto(c.categorias);
      setCategoriaElegida(c.sugerida?.categoria_id ?? c.categorias[0]?.id ?? "");
      setSugerida(c.sugerida?.nombre ?? null);
    } catch {
      setCategoriasGasto([]);
    }
  };

  const registrarGasto = async () => {
    if (!modalGasto || !categoriaElegida) return;
    setOcupado(true);
    try {
      const r = await finanzasApi.gastoDesdeComprobante({
        recibidoId: modalGasto.id,
        categoriaId: categoriaElegida,
        proveedorId: proveedorGasto,
        generaCuentaPorPagar: generaCuenta,
      });
      toast.mostrar(
        "exito",
        r.yaExistia
          ? "Ese comprobante ya estaba registrado como gasto."
          : r.cuentaPagarId
            ? "Gasto registrado, con su cuenta por pagar."
            : "Gasto registrado."
      );
      setModalGasto(null);
      recargar();
    } catch (err) {
      toast.mostrar("error", err instanceof Error ? err.message : "No se pudo registrar el gasto.");
    } finally {
      setOcupado(false);
    }
  };

  const registrarCompra = async () => {
    if (!modalCompra || !proveedorDelXml.id || !bodegaId) return;
    const vinculos = lineas
      .filter((l) => l.productoId && l.presentacionId)
      .map((l) => ({
        numeroLinea: l.numeroLinea,
        productoId: l.productoId,
        presentacionId: l.presentacionId,
        cantidad: l.cantidad,
        costoUnitario: l.precioUnitario,
        lote: l.lote.trim() ? { numero: l.lote.trim(), vencimiento: l.vencimiento || null } : undefined,
      }));
    if (vinculos.length === 0) {
      toast.mostrar("aviso", "Hay que vincular al menos una línea a un producto del catálogo.");
      return;
    }
    setOcupado(true);
    try {
      const r = await facturacionCrApi.registrarCompraDelRecibido(modalCompra.id, {
        proveedorId: proveedorDelXml.id,
        bodegaId,
        vinculos,
      });
      toast.mostrar(
        "exito",
        `Entraron ${r.movimientos} movimiento(s) de stock. ${r.equivalenciasGuardadas} equivalencia(s) guardada(s) para la próxima compra.`
      );
      setModalCompra(null);
      recargar();
    } catch (err) {
      toast.mostrar("error", err instanceof Error ? err.message : "No pudimos registrar la compra.");
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<Recibido>[] = [
    {
      key: "avisos",
      header: "Avisos",
      // LOS TRES AVISOS QUE DECIDEN SI SE PUEDE RESPONDER (prompt 09b,
      // B2). Van en la primera columna porque son lo que hace que
      // alguien no apriete «aceptar» sobre un comprobante que no es de
      // la clínica.
      render: (r) => (
        <div className="flex flex-col gap-1">
          {r.receptorEsLaClinica === false && (
            <Badge variant="error">No es de esta clínica</Badge>
          )}
          {r.firmaValida === false && (
            <span title={r.firmaDetalle ?? undefined}>
              <Badge variant="error">Firma inválida</Badge>
            </span>
          )}
          {r.firmaValida === null && (
            <span title={r.firmaDetalle ?? undefined}>
              <Badge variant="neutral">Firma sin comprobar</Badge>
            </span>
          )}
          {r.plazoVencido && <Badge variant="error">Plazo vencido</Badge>}
          {!r.plazoVencido && r.plazoPorVencer && (
            <Badge variant="warning">Vence el {r.responderHasta}</Badge>
          )}
          {r.registradoEnInventario && <Badge variant="success">En inventario</Badge>}
        </div>
      ),
    },
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
        ) : r.receptorEsLaClinica === false ? (
          // NO SE OFRECE RESPONDER LO QUE NO ES NUESTRO. El backend lo
          // rechaza igual; el botón deshabilitado con el motivo evita
          // que alguien lo intente y lea un error que no esperaba.
          <span className="text-xs text-text-muted">
            No se puede responder: el receptor es otra identificación.
          </span>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setModalMensaje(r)}>
            Responder
          </Button>
        ),
    },
    {
      key: "inventario",
      header: "Inventario",
      render: (r) =>
        r.registradoEnInventario ? (
          <span className="text-xs text-text-muted">
            Registrado el {r.registradoEnInventario.slice(0, 10)}
          </span>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => abrirCompra(r)}>
            Registrar la compra
          </Button>
        ),
    },
    {
      // LO QUE NO ES INVENTARIO ES UN GASTO (prompt 10a, §3): la luz, el
      // internet, el mantenimiento, la publicidad. Se clasifica desde
      // acá y **no se retipea nada**: el monto, la fecha y el número
      // salen del comprobante que ya está en esta tabla.
      key: "gasto",
      header: "Gasto",
      render: (r) =>
        r.registradoEnInventario ? (
          // Una compra ya es un activo: contarla también como gasto
          // duplicaría la salida de plata. El backend lo rechaza igual.
          <span className="text-xs text-text-muted">Entró al inventario</span>
        ) : !puedeFinanzas ? null : (
          <Button variant="secondary" size="sm" onClick={() => abrirGasto(r)}>
            Registrar como gasto
          </Button>
        ),
    },
  ];

  const pendientes = (recibidos ?? []).filter((r) => !r.mensajeEnviadoEn).length;

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>}>
      {dialogoSalida}

      <PageHeader
        padre={{ a: "/facturacion", etiqueta: "Comprobantes" }}
        titulo="Comprobantes recibidos"
        subtitulo="Las facturas que la clínica recibe de sus proveedores, y el mensaje con el que se aceptan o se rechazan."
        icono="recibidos"
        modulo="facturacion"
        secundarias={
          /* LA DESCARGA DEL MES PARA EL CONTADOR (prompt 09b, B2). El
             endpoint estaba y no tenía de dónde llamarse, y una función
             a la que no se llega no existe. */
          <Button
            variant="secondary"
            onClick={async () => {
              const hoy = new Date();
              const desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
              const hasta = hoy.toISOString().slice(0, 10);
              try {
                const r = await facturacionCrApi.descargaMasiva(desde, hasta);
                guardarComoArchivo(r.blob, r.filename ?? `comprobantes-${desde}-a-${hasta}.zip`);
              } catch (err) {
                toast.mostrar(
                  "error",
                  err instanceof Error ? err.message : "No pudimos armar la descarga."
                );
              }
            }}
          >
            Descargar el mes (XML)
          </Button>
        }
      />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
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
            {plural(pendientes, "comprobante", "comprobantes")} sin mensaje receptor.
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
          texto="Cargue el XML que le manda su proveedor. El sistema lo valida contra el esquema de Hacienda y después se le responde con el mensaje receptor."
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

      {/* ------------------------------ Clasificar como gasto (10a) */}
      <Modal
        open={modalGasto !== null}
        onClose={() => setModalGasto(null)}
        title="Registrar como gasto"
        description="Para lo que no entra al inventario: la luz, el internet, el mantenimiento. El monto y la fecha salen del comprobante: no hay nada que volver a escribir."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalGasto(null)}>
              Cancelar
            </Button>
            <Button disabled={ocupado || !categoriaElegida} onClick={registrarGasto}>
              Registrar el gasto
            </Button>
          </>
        }
      >
        {modalGasto && (
          <div className="space-y-3 text-sm">
            <p className="text-text-muted">
              {modalGasto.emisorNombre} · {modalGasto.consecutivo} ·{" "}
              {modalGasto.moneda} {Number(modalGasto.totalComprobante ?? 0).toLocaleString("es-CR")}
            </p>
            <Select
              label="Categoría"
              value={categoriaElegida}
              onChange={(e) => setCategoriaElegida(e.target.value)}
              options={categoriasGasto.map((c) => ({ value: c.id, label: c.nombre }))}
            />
            {sugerida && (
              <p className="text-xs text-text-muted">
                Sugerida por el último gasto de este proveedor: {sugerida}.
              </p>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={generaCuenta}
                onChange={(e) => setGeneraCuenta(e.target.checked)}
              />
              Todavía no está pagado: generar su cuenta por pagar
            </label>
          </div>
        )}
      </Modal>

      {/* ------------------------- Registrar la compra en inventario */}
      <Modal
        open={modalCompra !== null}
        onClose={() => setModalCompra(null)}
        title="Registrar la compra en inventario"
        description="Cada línea del XML se vincula a un producto del catálogo. La próxima factura de este proveedor llega con las líneas ya reconocidas."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalCompra(null)}>
              Cancelar
            </Button>
            <Button disabled={ocupado || !proveedorDelXml.id || !bodegaId} onClick={registrarCompra}>
              {ocupado ? "Registrando…" : "Registrar la entrada"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {!proveedorDelXml.id && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
              {/* SIN PROVEEDOR NO HAY COMPRA. Se dice qué falta en vez de
                  dejar el botón muerto sin explicación. */}
              La cédula del emisor del XML no corresponde a ningún proveedor del catálogo
              {proveedorDelXml.nombre ? ` («${proveedorDelXml.nombre}»)` : ""}. Creá el proveedor con
              esa identificación y volvé a intentar.
            </p>
          )}
          {proveedorDelXml.id && (
            <p className="text-sm text-text-muted">
              Proveedor: <strong>{proveedorDelXml.nombre}</strong>
            </p>
          )}
          <Select
            label="A qué bodega entra"
            value={bodegaId}
            onChange={(e) => setBodegaId(e.target.value)}
            options={bodegas.map((b) => ({ value: b.id, label: b.nombre }))}
          />

          <div className="space-y-3">
            {lineas.map((l, i) => (
              <div key={l.numeroLinea} className="rounded-xl border border-black/10 p-3">
                <p className="text-sm font-semibold text-text-primary">{l.descripcion}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {l.cantidad} × {l.precioUnitario.toLocaleString("es-CR")}
                  {l.codigoProveedor ? ` · código del proveedor: ${l.codigoProveedor}` : ""}
                </p>
                {l.productoId ? (
                  <p className="mt-2 text-sm text-success">
                    ✓ Reconocido: {l.productoNombre}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-text-muted">
                    Sin vincular. Esta línea no va a entrar al inventario: vinculá el producto desde
                    el catálogo del proveedor y volvé a cargar la factura.
                  </p>
                )}
                {l.productoId && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Input
                      label="Lote"
                      value={l.lote}
                      onChange={(e) =>
                        setLineas((xs) =>
                          xs.map((x, j) => (j === i ? { ...x, lote: e.target.value } : x))
                        )
                      }
                    />
                    <div>
                      <label className="text-sm font-semibold text-text-primary">Vencimiento</label>
                      <input
                        type="date"
                        className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                        value={l.vencimiento}
                        onChange={(e) =>
                          setLineas((xs) =>
                            xs.map((x, j) => (j === i ? { ...x, vencimiento: e.target.value } : x))
                          )
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
