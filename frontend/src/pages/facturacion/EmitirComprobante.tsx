import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  Select,
  useToast,
} from "../../components/ui";
import {
  Catalogos,
  DocumentoVenta,
  LineaDocumento,
  ResultadoCabys,
  facturacionCrApi,
  formatearMonto,
} from "../../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// Emisión manual de una factura o un tiquete.
//
// Es de USO SECUNDARIO a propósito: el camino normal va a ser caja
// llamando a la API. Esta pantalla existe para el caso suelto —una
// factura que hay que emitir a mano, una corrección— y para poder probar
// el motor sin caja.
//
// Dos cosas que la pantalla NO hace, y es deliberado:
//
//   * NO calcula los totales que van al XML. Muestra una estimación para
//     que quien factura vea el orden de magnitud antes de emitir, y lo
//     dice. Los números del comprobante los calcula el backend según el
//     Anexo de Hacienda: si esta pantalla los calculara, habría dos
//     fórmulas y la que Hacienda valida es la del backend.
//
//   * NO inventa el código CABYS. Si el catálogo no está cargado, lo dice
//     y deja escribirlo a mano.
// ---------------------------------------------------------------------

interface LineaFormulario {
  codigoCabys: string;
  cantidad: string;
  unidadMedida: string;
  detalle: string;
  precioUnitario: string;
  codigoTarifaIva: string;
}

function lineaVacia(): LineaFormulario {
  return {
    codigoCabys: "",
    cantidad: "1",
    unidadMedida: "Sp",
    detalle: "",
    precioUnitario: "",
    // La tarifa general del 13% es el caso normal de una clínica. El
    // default existe pero el selector muestra las once opciones con su
    // nombre completo, así que elegir "exenta" es explícito.
    codigoTarifaIva: "08",
  };
}

export function EmitirComprobante() {
  const navegar = useNavigate();
  const toast = useToast();
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [cabysVacio, setCabysVacio] = useState<{ vacio: boolean; aviso?: string } | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);

  const [tipo, setTipo] = useState("01");
  const [condicionVenta, setCondicionVenta] = useState("01");
  const [medioPago, setMedioPago] = useState("01");
  const [plazoCredito, setPlazoCredito] = useState("");
  const [receptorNombre, setReceptorNombre] = useState("");
  const [receptorTipoId, setReceptorTipoId] = useState("01");
  const [receptorNumeroId, setReceptorNumeroId] = useState("");
  const [receptorCorreo, setReceptorCorreo] = useState("");
  const [lineas, setLineas] = useState<LineaFormulario[]>([lineaVacia()]);

  const [buscaCabys, setBuscaCabys] = useState<{ indice: number; texto: string } | null>(null);
  const [resultadosCabys, setResultadosCabys] = useState<ResultadoCabys["resultados"]>([]);

  useEffect(() => {
    facturacionCrApi
      .catalogos()
      .then(setCatalogos)
      .catch((err) => toast.error(err.message));
    facturacionCrApi
      .buscarCabys("")
      .then((r) => setCabysVacio({ vacio: r.catalogoVacio, aviso: r.aviso }))
      .catch(() => setCabysVacio(null));
  }, []);

  useEffect(() => {
    if (!buscaCabys || buscaCabys.texto.trim().length < 3) {
      setResultadosCabys([]);
      return;
    }
    const t = setTimeout(() => {
      facturacionCrApi
        .buscarCabys(buscaCabys.texto)
        .then((r) => setResultadosCabys(r.resultados))
        .catch(() => setResultadosCabys([]));
    }, 300);
    return () => clearTimeout(t);
  }, [buscaCabys]);

  const esTiquete = tipo === "04";
  const esCredito = condicionVenta === "02";

  /**
   * La estimación local. Está a la vista y etiquetada como estimación:
   * el total real lo calcula el backend.
   *
   * Es una suma simple de `cantidad × precio × (1 + tarifa)`, sin
   * descuentos ni exoneraciones ni impuestos específicos — justamente lo
   * que el backend sí hace bien. Por eso dice "aproximado".
   */
  const estimacion = useMemo(() => {
    let neto = 0;
    let impuesto = 0;
    for (const l of lineas) {
      const cantidad = Number(l.cantidad.replace(",", "."));
      const precio = Number(l.precioUnitario.replace(",", "."));
      if (!Number.isFinite(cantidad) || !Number.isFinite(precio)) continue;
      const sub = cantidad * precio;
      const tarifa = catalogos?.tarifasIva.find((t) => t.codigo === l.codigoTarifaIva)?.tarifa ?? 0;
      neto += sub;
      impuesto += (sub * tarifa) / 100;
    }
    return { neto, impuesto, total: neto + impuesto };
  }, [lineas, catalogos]);

  const actualizarLinea = (i: number, cambios: Partial<LineaFormulario>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambios } : l)));

  const problemas: string[] = [];
  if (!esTiquete && !receptorNombre.trim()) {
    problemas.push("Una factura exige los datos del receptor. Para una venta sin identificar, el comprobante que corresponde es el tiquete.");
  }
  if (!esTiquete && !receptorNumeroId.trim()) {
    problemas.push("Una factura exige la identificación del receptor.");
  }
  if (lineas.length === 0) problemas.push("Hace falta al menos una línea.");
  lineas.forEach((l, i) => {
    if (!l.detalle.trim()) problemas.push(`Línea ${i + 1}: falta el detalle.`);
    if (!Number(l.precioUnitario.replace(",", "."))) problemas.push(`Línea ${i + 1}: falta el precio.`);
    if (!/^[0-9]{13}$/.test(l.codigoCabys)) {
      problemas.push(`Línea ${i + 1}: el código CABYS son 13 dígitos y Hacienda lo exige.`);
    }
  });

  const emitir = async () => {
    setEmitiendo(true);
    try {
      const documento: DocumentoVenta = {
        tipoComprobante: tipo,
        condicionVenta,
        plazoCreditoDias: esCredito && plazoCredito ? Number(plazoCredito) : undefined,
        receptor: receptorNombre.trim()
          ? {
              nombre: receptorNombre.trim(),
              identificacion: receptorNumeroId.trim()
                ? { tipo: receptorTipoId, numero: receptorNumeroId.trim() }
                : undefined,
              correo: receptorCorreo.trim() || undefined,
            }
          : undefined,
        lineas: lineas.map(
          (l): LineaDocumento => ({
            codigoCabys: l.codigoCabys,
            cantidad: l.cantidad.replace(",", "."),
            unidadMedida: l.unidadMedida,
            detalle: l.detalle.trim(),
            precioUnitario: l.precioUnitario.replace(",", "."),
            impuestos: [{ codigo: "01", codigoTarifaIva: l.codigoTarifaIva }],
          })
        ),
        mediosPago: [{ codigo: medioPago }],
      };

      const r = await facturacionCrApi.emitir(documento);
      // El mensaje dice el ESTADO REAL, no "emitido" a secas: si quedó en
      // cola, quien factura tiene que saber que Hacienda todavía no lo
      // validó — y que eso no es un problema.
      const mensajes: Record<string, string> = {
        aceptado: `Comprobante ${r.consecutivo} aceptado por Hacienda.`,
        aceptado_parcial: `Comprobante ${r.consecutivo} aceptado parcialmente.`,
        enviado: `Comprobante ${r.consecutivo} transmitido. Hacienda todavía no respondió; se consulta solo.`,
        en_cola: `Comprobante ${r.consecutivo} firmado y en cola: Hacienda no respondió y se reintenta solo. La venta está hecha.`,
        rechazado: `Comprobante ${r.consecutivo} RECHAZADO: ${r.detalle ?? "ver el detalle"}.`,
        error: `Comprobante ${r.consecutivo} con error: ${r.detalle ?? "requiere revisión"}.`,
      };
      const mensaje = mensajes[r.estado] ?? `Comprobante ${r.consecutivo}: ${r.estado}.`;
      if (r.estado === "rechazado" || r.estado === "error") toast.error(mensaje);
      else if (r.estado === "en_cola" || r.estado === "enviado") toast.aviso(mensaje);
      else toast.exito(mensaje);

      navegar(`/facturacion/comprobantes/${r.comprobanteId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEmitiendo(false);
    }
  };

  return (
    <div>
      <Link to="/facturacion" className="text-sm text-text-muted hover:text-primary">
        ← Comprobantes
      </Link>
      <h2 className="mt-2 text-xl font-bold text-primary">Emitir un comprobante</h2>
      <p className="mt-1 text-sm text-text-muted">
        Para el caso suelto. Lo normal es que caja emita por la API.
      </p>

      {cabysVacio?.vacio && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium text-text">El catálogo CABYS no está cargado.</p>
          <p className="text-text-muted">{cabysVacio.aviso}</p>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Comprobante</CardTitle>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Select
              label="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              options={(catalogos?.tiposComprobante ?? [])
                // Las notas se emiten DESDE el comprobante que corrigen,
                // no desde un formulario en blanco: necesitan su
                // referencia y su código de efecto contable.
                .filter((t) => t.codigo === "01" || t.codigo === "04")
                .map((t) => ({ value: t.codigo, label: t.nombre }))}
            />
            <Select
              label="Condición de venta"
              value={condicionVenta}
              onChange={(e) => setCondicionVenta(e.target.value)}
              options={(catalogos?.condicionesVenta ?? []).map((c) => ({
                value: c.codigo,
                label: `${c.codigo} — ${c.nombre}`,
              }))}
            />
            <Select
              label="Medio de pago"
              value={medioPago}
              onChange={(e) => setMedioPago(e.target.value)}
              options={(catalogos?.mediosPago ?? []).map((m) => ({
                value: m.codigo,
                label: m.nombre,
              }))}
            />
            {esCredito && (
              <Input
                label="Plazo del crédito (días)"
                type="number"
                min={0}
                value={plazoCredito}
                onChange={(e) => setPlazoCredito(e.target.value)}
                placeholder="30"
              />
            )}
          </div>

          <CardTitle className="mt-6">Receptor</CardTitle>
          <CardDescription>
            {esTiquete
              ? "Un tiquete puede ir sin receptor: se emite a consumidor final."
              : "Una factura lo exige. Sin identificación, el comprobante que corresponde es el tiquete."}
          </CardDescription>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Nombre"
              value={receptorNombre}
              onChange={(e) => setReceptorNombre(e.target.value)}
              placeholder="Ana María Rodríguez Jiménez"
            />
            <Input
              label="Correo (para enviarle el comprobante)"
              type="email"
              value={receptorCorreo}
              onChange={(e) => setReceptorCorreo(e.target.value)}
              placeholder="ana@correo.com"
            />
            <Select
              label="Tipo de identificación"
              value={receptorTipoId}
              onChange={(e) => setReceptorTipoId(e.target.value)}
              options={(catalogos?.tiposIdentificacion ?? []).map((t) => ({
                value: t.codigo,
                label: t.nombre,
              }))}
            />
            <Input
              label="Número de identificación"
              value={receptorNumeroId}
              onChange={(e) => setReceptorNumeroId(e.target.value)}
              placeholder="112345678"
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Total aproximado</CardTitle>
          <CardDescription>
            Una estimación para ver el orden de magnitud. El total del comprobante lo calcula el
            servidor según el Anexo de Hacienda, y puede diferir si hay descuentos, exoneraciones o
            impuestos específicos.
          </CardDescription>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">Venta</dt>
              <dd>{formatearMonto(estimacion.neto)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">Impuesto</dt>
              <dd>{formatearMonto(estimacion.impuesto)}</dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-black/5 pt-2 text-base font-bold text-primary">
              <dt>Aproximado</dt>
              <dd>{formatearMonto(estimacion.total)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <CardTitle>Líneas</CardTitle>
          <Button variant="secondary" size="sm" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
            <Icono nombre="agregar" tamano={16} /> Agregar línea
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          {lineas.map((l, i) => (
            <div key={i} className="rounded-xl border border-black/5 bg-background/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-text-muted">
                  Línea {i + 1}
                </span>
                {lineas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                    className="text-text-muted hover:text-error"
                    aria-label={`Quitar la línea ${i + 1}`}
                  >
                    <Icono nombre="borrar" tamano={16} etiqueta={`Quitar la línea ${i + 1}`} />
                  </button>
                )}
              </div>

              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
                  <Input
                    label="Detalle"
                    value={l.detalle}
                    onChange={(e) => actualizarLinea(i, { detalle: e.target.value })}
                    placeholder="Consulta veterinaria general"
                    maxLength={200}
                  />
                </div>
                <Input
                  label="Cantidad"
                  value={l.cantidad}
                  onChange={(e) => actualizarLinea(i, { cantidad: e.target.value })}
                />
                <Input
                  label="Precio unitario"
                  value={l.precioUnitario}
                  onChange={(e) => actualizarLinea(i, { precioUnitario: e.target.value })}
                  placeholder="10000"
                />
                <Select
                  label="Unidad de medida"
                  value={l.unidadMedida}
                  onChange={(e) => actualizarLinea(i, { unidadMedida: e.target.value })}
                  options={(catalogos?.unidadesMedida ?? []).map((u) => ({
                    value: u.codigo,
                    label: `${u.codigo} — ${u.descripcion}`,
                  }))}
                />
                <Select
                  label="Tarifa de IVA"
                  value={l.codigoTarifaIva}
                  onChange={(e) => actualizarLinea(i, { codigoTarifaIva: e.target.value })}
                  options={(catalogos?.tarifasIva ?? []).map((t) => ({
                    value: t.codigo,
                    label: `${t.codigo} — ${t.nombre}`,
                  }))}
                />
                <div className="lg:col-span-2">
                  <Input
                    label="Código CABYS (13 dígitos)"
                    value={l.codigoCabys}
                    onChange={(e) => {
                      actualizarLinea(i, { codigoCabys: e.target.value });
                      setBuscaCabys(null);
                    }}
                    placeholder="8690100000000"
                    maxLength={13}
                  />
                  {!cabysVacio?.vacio && (
                    <div className="mt-2">
                      <Input
                        label="Buscar en CABYS"
                        value={buscaCabys?.indice === i ? buscaCabys.texto : ""}
                        onChange={(e) => setBuscaCabys({ indice: i, texto: e.target.value })}
                        placeholder="consulta veterinaria…"
                      />
                      {buscaCabys?.indice === i && resultadosCabys.length > 0 && (
                        <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-black/5 bg-surface text-sm">
                          {resultadosCabys.map((r) => (
                            <li key={r.codigo}>
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left hover:bg-background"
                                onClick={() => {
                                  actualizarLinea(i, {
                                    codigoCabys: r.codigo,
                                    codigoTarifaIva: r.codigoTarifaIvaSugerido ?? l.codigoTarifaIva,
                                  });
                                  setBuscaCabys(null);
                                }}
                              >
                                <span className="font-mono text-xs">{r.codigo}</span>{" "}
                                {r.descripcion}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {problemas.length > 0 && (
        <div className="mt-4 rounded-xl border border-black/5 bg-surface p-3 text-sm">
          <p className="font-medium text-text">Falta esto antes de emitir:</p>
          <ul className="mt-1 list-inside list-disc text-text-muted">
            {/* Se listan TODOS los problemas y no solo el primero: con uno
                por vez, completar una factura de cinco líneas son cinco
                intentos. */}
            {problemas.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Link to="/facturacion">
          <Button variant="ghost">Cancelar</Button>
        </Link>
        <Button onClick={emitir} disabled={emitiendo || problemas.length > 0}>
          {emitiendo ? "Emitiendo…" : "Emitir y enviar a Hacienda"}
        </Button>
      </div>
    </div>
  );
}
