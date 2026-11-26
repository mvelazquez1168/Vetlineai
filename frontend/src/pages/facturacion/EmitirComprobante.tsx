import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  LoadingState,
  Select,
  useToast,
  PageHeader,
} from "../../components/ui";
import { SelectorUbicacion, ValorUbicacion } from "../../components/SelectorUbicacion";
import { SelectorReceptor } from "../../components/SelectorReceptor";
import {
  Catalogos,
  DocumentoVenta,
  LineaDocumento,
  ReceptorEncontrado,
  ResultadoCabys,
  VistaPrevia,
  facturacionCrApi,
  formatearMonto,
} from "../../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// Emisión manual de una factura o un tiquete.
//
// Es de USO SECUNDARIO a propósito: el camino normal va a ser caja
// llamando a la API. Esta pantalla existe para el caso suelto —una
// factura que hay que emitir a mano, una corrección— y para poder
// probar el motor sin caja.
//
// Tres reglas que explican la forma de la pantalla:
//
//   * LOS TOTALES NO SE CALCULAN ACÁ. Se piden al backend, al mismo
//     motor que emite (`/comprobantes/vista-previa`). Antes había una
//     estimación local rotulada "aproximado", y una estimación es dos
//     implementaciones de las reglas del Anexo —redondeo, base
//     imponible, descuentos— que pueden diferir. Ahora hay una sola.
//
//   * EL RECEPTOR SALE DE LA FICHA DE CLIENTES (`propietarios`), con
//     búsqueda tolerante a erratas. No hay una segunda tabla de
//     clientes de facturación. Lo que se emite queda COPIADO en el
//     comprobante, así que corregir la ficha mañana no altera una
//     factura de hoy.
//
//   * CADA LÍNEA ES UN RENGLÓN. En pantallas angostas la tabla se
//     desplaza en horizontal; la línea nunca se parte en varios
//     renglones, porque comparar precios y totales entre líneas es
//     justamente lo que se hace mirando una tabla.
//
// NO inventa el código CABYS: si el catálogo no está cargado, lo dice y
// deja escribirlo a mano.
// ---------------------------------------------------------------------

interface DescuentoFormulario {
  monto: string;
  codigoDescuento: string;
  naturaleza: string;
}

interface LineaFormulario {
  codigoCabys: string;
  cantidad: string;
  unidadMedida: string;
  detalle: string;
  precioUnitario: string;
  codigoTarifaIva: string;
  descuento: DescuentoFormulario | null;
}

function lineaVacia(): LineaFormulario {
  return {
    codigoCabys: "",
    cantidad: "1",
    unidadMedida: "Sp",
    detalle: "",
    precioUnitario: "",
    // La tarifa general del 13% es el caso normal de una clínica. El
    // default existe pero el selector muestra todas las opciones con su
    // nombre completo, así que elegir "exenta" es explícito.
    codigoTarifaIva: "08",
    descuento: null,
  };
}

const MAX_OBSERVACIONES = 500;

export function EmitirComprobante() {
  const navegar = useNavigate();
  const toast = useToast();
  const [parametros] = useSearchParams();
  const borradorId = parametros.get("borrador");

  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [cabysVacio, setCabysVacio] = useState<{ vacio: boolean; aviso?: string } | null>(null);
  const [cargando, setCargando] = useState(!!borradorId);
  const [ocupado, setOcupado] = useState(false);

  const [tipo, setTipo] = useState("01");
  const [condicionVenta, setCondicionVenta] = useState("01");
  const [medioPago, setMedioPago] = useState("01");
  const [plazoCredito, setPlazoCredito] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaFormulario[]>([lineaVacia()]);

  // Receptor
  const [receptorId, setReceptorId] = useState<string | null>(null);
  const [receptorNombre, setReceptorNombre] = useState("");
  const [receptorTipoId, setReceptorTipoId] = useState("01");
  const [receptorNumeroId, setReceptorNumeroId] = useState("");
  const [receptorCorreo, setReceptorCorreo] = useState("");
  const [receptorTelPais, setReceptorTelPais] = useState("506");
  const [receptorTelNumero, setReceptorTelNumero] = useState("");
  const [receptorUbicacion, setReceptorUbicacion] = useState<ValorUbicacion>({});
  const [receptorOtrasSenas, setReceptorOtrasSenas] = useState("");
  /** De qué perfil de facturación salió el receptor, si salió de uno. */
  const [perfilElegido, setPerfilElegido] = useState<string | null>(null);


  const [buscaCabys, setBuscaCabys] = useState<{ indice: number; texto: string } | null>(null);
  const [resultadosCabys, setResultadosCabys] = useState<ResultadoCabys["resultados"]>([]);
  const [descuentoAbierto, setDescuentoAbierto] = useState<number | null>(null);

  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  const [motivoSinPrevia, setMotivoSinPrevia] = useState<string | null>(null);

  const esTiquete = tipo === "04";
  const esCredito = condicionVenta === "02";

  useEffect(() => {
    facturacionCrApi.catalogos().then(setCatalogos).catch((err) => toast.error(err.message));
    facturacionCrApi
      .buscarCabys("")
      .then((r) => setCabysVacio({ vacio: r.catalogoVacio, aviso: r.aviso }))
      .catch(() => setCabysVacio(null));
  }, []);

  // --- Cargar un borrador existente para editarlo --------------------
  useEffect(() => {
    if (!borradorId) return;
    setCargando(true);
    facturacionCrApi
      .detalle(borradorId)
      .then((d) => {
        const c = d.comprobante as Record<string, unknown>;
        if (c.estado !== "borrador") {
          toast.error("Ese comprobante ya fue emitido: no se puede editar.");
          navegar(`/facturacion/comprobantes/${borradorId}`);
          return;
        }
        setTipo(String(c.tipo_comprobante));
        setCondicionVenta(String(c.condicion_venta));
        setPlazoCredito(c.plazo_credito_dias ? String(c.plazo_credito_dias) : "");
        setObservaciones((c.observaciones as string) ?? "");
        setReceptorId((c.receptor_propietario_id as string) ?? null);
        setReceptorNombre((c.receptor_nombre as string) ?? "");
        setReceptorTipoId((c.receptor_tipo_identificacion as string) ?? "01");
        setReceptorNumeroId((c.receptor_numero_identificacion as string) ?? "");
        setReceptorCorreo((c.receptor_correo as string) ?? "");
        setReceptorTelPais((c.receptor_telefono_codigo_pais as string) ?? "506");
        setReceptorTelNumero((c.receptor_telefono_numero as string) ?? "");
        setReceptorUbicacion({
          provincia: (c.receptor_ubicacion_provincia as string) ?? "",
          canton: (c.receptor_ubicacion_canton as string) ?? "",
          distrito: (c.receptor_ubicacion_distrito as string) ?? "",
          barrio: (c.receptor_ubicacion_barrio as string) ?? "",
        });
        setReceptorOtrasSenas((c.receptor_ubicacion_otras_senas as string) ?? "");
        if (d.mediosPago.length > 0) setMedioPago(d.mediosPago[0].codigo_medio_pago);
        setLineas(
          d.lineas.map((l) => ({
            codigoCabys: l.codigo_cabys ?? "",
            cantidad: String(Number(l.cantidad)),
            unidadMedida: l.unidad_medida,
            detalle: l.detalle,
            precioUnitario: String(Number(l.precio_unitario)),
            codigoTarifaIva: l.impuestos[0]?.codigoTarifaIva ?? "08",
            descuento:
              l.descuentos.length > 0
                ? {
                    monto: String(Number(l.descuentos[0].monto)),
                    codigoDescuento: l.descuentos[0].codigo,
                    naturaleza: l.descuentos[0].naturaleza ?? "",
                  }
                : null,
          }))
        );
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setCargando(false));
  }, [borradorId]);


  // --- Búsqueda CABYS -------------------------------------------------
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

  const actualizarLinea = (i: number, cambios: Partial<LineaFormulario>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambios } : l)));

  /** El documento tal como se le manda al backend. Una sola fuente. */
  const armarDocumento = useCallback((): DocumentoVenta => {
    const hayUbicacion =
      !!receptorUbicacion.provincia && !!receptorUbicacion.canton && !!receptorUbicacion.distrito;
    return {
      tipoComprobante: tipo,
      condicionVenta,
      plazoCreditoDias: esCredito && plazoCredito ? Number(plazoCredito) : undefined,
      observaciones: observaciones.trim() || undefined,
      receptorPropietarioId: receptorId ?? undefined,
      receptorPerfilId: perfilElegido ?? undefined,
      receptor: receptorNombre.trim()
        ? {
            nombre: receptorNombre.trim(),
            identificacion: receptorNumeroId.trim()
              ? { tipo: receptorTipoId, numero: receptorNumeroId.trim() }
              : undefined,
            correo: receptorCorreo.trim() || undefined,
            telefono: receptorTelNumero.trim()
              ? { codigoPais: receptorTelPais || "506", numero: receptorTelNumero.trim() }
              : undefined,
            ubicacion: hayUbicacion
              ? {
                  provincia: receptorUbicacion.provincia!,
                  canton: receptorUbicacion.canton!,
                  distrito: receptorUbicacion.distrito!,
                  barrio: receptorUbicacion.barrio?.trim() || undefined,
                  otrasSenas: receptorOtrasSenas.trim(),
                }
              : undefined,
          }
        : undefined,
      lineas: lineas.map(
        (l): LineaDocumento => ({
          codigoCabys: l.codigoCabys,
          cantidad: l.cantidad.replace(",", "."),
          unidadMedida: l.unidadMedida,
          detalle: l.detalle.trim(),
          precioUnitario: l.precioUnitario.replace(",", "."),
          descuentos:
            l.descuento && Number(l.descuento.monto.replace(",", ".")) > 0
              ? [
                  {
                    monto: l.descuento.monto.replace(",", "."),
                    codigoDescuento: l.descuento.codigoDescuento,
                    naturaleza: l.descuento.naturaleza.trim() || undefined,
                  },
                ]
              : undefined,
          impuestos: [{ codigo: "01", codigoTarifaIva: l.codigoTarifaIva }],
        })
      ),
      mediosPago: [{ codigo: medioPago }],
    };
  }, [
    tipo,
    condicionVenta,
    esCredito,
    plazoCredito,
    observaciones,
    receptorId,
    receptorNombre,
    receptorTipoId,
    receptorNumeroId,
    receptorCorreo,
    receptorTelPais,
    receptorTelNumero,
    receptorUbicacion,
    receptorOtrasSenas,
    lineas,
    medioPago,
  ]);

  // --- Totales: del motor, no de acá ---------------------------------
  //
  // Se piden con un retraso corto mientras se escribe. Un documento a
  // medio llenar da 400 con el motivo, y eso NO es un error que haya
  // que gritar: es el estado normal de un formulario abierto. Se
  // muestra el motivo en gris y el total en blanco.
  const ultimaPrevia = useRef(0);
  useEffect(() => {
    const documento = armarDocumento();
    const hayAlgo = documento.lineas.some(
      (l) => l.detalle && Number(String(l.precioUnitario).replace(",", ".")) > 0
    );
    if (!hayAlgo) {
      setPrevia(null);
      setMotivoSinPrevia(null);
      return;
    }
    const ticket = ++ultimaPrevia.current;
    const t = setTimeout(() => {
      facturacionCrApi
        .vistaPrevia(documento)
        .then((r) => {
          if (ticket !== ultimaPrevia.current) return; // llegó vieja
          setPrevia(r);
          setMotivoSinPrevia(null);
        })
        .catch((err) => {
          if (ticket !== ultimaPrevia.current) return;
          setPrevia(null);
          setMotivoSinPrevia((err as Error).message);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [armarDocumento]);


  const problemas: string[] = [];
  if (!esTiquete && !receptorNombre.trim()) {
    problemas.push(
      "Una factura exige los datos del receptor. Para una venta sin identificar, el comprobante que corresponde es el tiquete."
    );
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
  const barrio = (receptorUbicacion.barrio ?? "").trim();
  if (barrio !== "" && barrio.length < 5) {
    // Hacienda publica barrios de menos de 5 letras y su propio XSD
    // exige 5. Se avisa acá para no llegar al error del servidor.
    problemas.push(
      `El barrio "${barrio}" tiene ${barrio.length} caracteres y Hacienda exige al menos 5. Escribilo completo o dejalo vacío.`
    );
  }

  const guardar = async () => {
    setOcupado(true);
    try {
      const r = await facturacionCrApi.guardarBorrador(armarDocumento(), borradorId ?? undefined);
      toast.exito("Borrador guardado. No consumió número: el consecutivo se asigna al emitir.");
      if (!borradorId) navegar(`/facturacion/emitir?borrador=${r.id}`, { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const eliminar = async () => {
    if (!borradorId) return;
    setOcupado(true);
    try {
      await facturacionCrApi.borrarBorrador(borradorId);
      toast.exito("Borrador eliminado.");
      navegar("/facturacion");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const avisarResultado = (r: { estado: string; consecutivo: string; detalle?: string }) => {
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
  };

  const emitir = async () => {
    setOcupado(true);
    try {
      // Si estamos editando un borrador se emite ESE, para que no quede
      // el borrador por un lado y el comprobante por otro.
      const r = borradorId
        ? await (async () => {
            await facturacionCrApi.guardarBorrador(armarDocumento(), borradorId);
            return facturacionCrApi.emitirBorrador(borradorId);
          })()
        : await facturacionCrApi.emitir(armarDocumento());
      avisarResultado(r);
      navegar(`/facturacion/comprobantes/${r.comprobanteId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" cantidad={2} />;

  const tarifaDe = (codigo: string) =>
    catalogos?.tarifasIva.find((t) => t.codigo === codigo)?.tarifa ?? 0;

  const totalLinea = (i: number) =>
    previa?.lineas.find((l) => l.numeroLinea === i + 1)?.montoTotalLinea;

  return (
    <div>
      <PageHeader
        variante="compacta"
        titulo={borradorId ? "Editar borrador" : "Emitir un comprobante"}
        icono="comprobante"
        modulo="facturacion"
        padre={{ a: "/facturacion", etiqueta: "Comprobantes" }}
        contexto={
          <>
            {borradorId
              ? "Este borrador todavía no tiene número. El consecutivo se asigna al emitirlo."
              : "Para el caso suelto. Lo normal es que caja emita por la API."}
          </>
        }
      />

      {cabysVacio?.vacio && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium text-text">El catálogo CABYS no está cargado.</p>
          <p className="text-text-muted">{cabysVacio.aviso}</p>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* ---------------------------------------------- Comprobante */}
        <Card className="lg:col-span-2">
          <CardTitle>Comprobante</CardTitle>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Select
              label="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              options={(catalogos?.tiposComprobante ?? []).map((t) => ({
                value: t.codigo,
                label: t.nombre,
              }))}
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
                label="Plazo de crédito (días)"
                value={plazoCredito}
                onChange={(e) => setPlazoCredito(e.target.value)}
                placeholder="30"
              />
            )}
          </div>

          {/* ------------------------------------------------ Receptor */}
          <CardTitle className="mt-6">Receptor</CardTitle>
          <CardDescription>
            {esTiquete
              ? "Un tiquete puede ir sin receptor. Si lo elige, sale en el comprobante."
              : "Una factura lo exige. Puede ser el cliente, su empresa, una fundación o cualquiera que se registre acá."}
          </CardDescription>

          <SelectorReceptor
            className="mt-3"
            propietarioId={receptorId}
            propietarioNombre={receptorNombre || null}
            exigeIdentificacion={!esTiquete}
            onCambio={(eleccion, resumen) => {
              // La pantalla "Emitir" tiene los campos del receptor a la
              // vista a propósito: es donde se completa lo que falta sin
              // salir de la emisión. Así que lo elegido LLENA los
              // campos, y de ahí sale el documento. La caja, que no
              // tiene campos, manda la elección y el backend la
              // resuelve: el mismo componente, dos formas de usarlo.
              setPerfilElegido(resumen.perfilId ?? null);
              setReceptorId(resumen.propietarioId ?? null);
              if (eleccion.modo === "sin_datos") {
                setReceptorNombre("");
                setReceptorNumeroId("");
                setReceptorCorreo("");
                return;
              }
              const d = resumen.datos;
              if (!d) {
                // El dueño: los datos los tiene el backend. Se muestra
                // el nombre y se deja que `resolverReceptor` complete.
                setReceptorNombre(resumen.nombre);
                return;
              }
              setReceptorNombre(d.nombre);
              if (d.tipoIdentificacion) setReceptorTipoId(d.tipoIdentificacion);
              setReceptorNumeroId(d.numeroIdentificacion ?? "");
              setReceptorCorreo(d.correo ?? "");
              setReceptorTelPais(d.telefonoCodigoPais ?? "506");
              setReceptorTelNumero(d.telefonoNumero ?? "");
              setReceptorUbicacion({
                provincia: d.ubicacionProvincia ?? "",
                canton: d.ubicacionCanton ?? "",
                distrito: d.ubicacionDistrito ?? "",
                barrio: d.ubicacionBarrio ?? "",
              });
              setReceptorOtrasSenas(d.ubicacionOtrasSenas ?? "");
            }}
          />

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Nombre"
              value={receptorNombre}
              onChange={(e) => {
                setReceptorNombre(e.target.value);
                setReceptorId(null);
              }}
              placeholder="Ana María Rodríguez Jiménez"
            />
            <Input
              label="Correo (para enviarle el comprobante)"
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
            <Input
              label="Código de país del teléfono"
              value={receptorTelPais}
              onChange={(e) => setReceptorTelPais(e.target.value)}
              maxLength={3}
              placeholder="506"
            />
            <Input
              label="Teléfono"
              value={receptorTelNumero}
              onChange={(e) => setReceptorTelNumero(e.target.value)}
              maxLength={20}
              placeholder="88887777"
            />
          </div>


          <CardTitle className="mt-6">Dirección del receptor</CardTitle>
          <CardDescription>
            Provincia, cantón y distrito según la codificación oficial de Hacienda. Es opcional; si
            la ponés, va en el XML y en el PDF.
          </CardDescription>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectorUbicacion
              idPrefijo="receptor"
              valor={receptorUbicacion}
              onChange={setReceptorUbicacion}
            />
            <div className="sm:col-span-2 lg:col-span-4">
              <Input
                label="Otras señas"
                value={receptorOtrasSenas}
                onChange={(e) => setReceptorOtrasSenas(e.target.value)}
                maxLength={250}
                placeholder="100 metros norte de la escuela, casa verde"
              />
            </div>
          </div>
        </Card>

        {/* ------------------------------------------------- Totales */}
        <Card>
          <CardTitle>Totales</CardTitle>
          <CardDescription>
            Los calcula el mismo motor que emite, con las reglas del Anexo de Hacienda. Son los que
            va a tener el comprobante.
          </CardDescription>
          {previa ? (
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-muted">Venta neta</dt>
                <dd>{formatearMonto(String(previa.resumen.totalVentaNeta ?? 0), "CRC")}</dd>
              </div>
              {Number(previa.resumen.totalDescuentos ?? 0) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">Descuentos</dt>
                  <dd>−{formatearMonto(String(previa.resumen.totalDescuentos), "CRC")}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-text-muted">Impuesto</dt>
                <dd>{formatearMonto(String(previa.resumen.totalImpuesto ?? 0), "CRC")}</dd>
              </div>
              <div className="mt-2 flex justify-between border-t border-black/5 pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd>{formatearMonto(String(previa.resumen.totalComprobante ?? 0), "CRC")}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-text-muted">
              {motivoSinPrevia ?? "Completá las líneas para ver el total."}
            </p>
          )}

          <div className="mt-5 space-y-2">
            <Button className="w-full" disabled={ocupado || problemas.length > 0} onClick={emitir}>
              {ocupado ? "Procesando…" : "Emitir y enviar"}
            </Button>
            <Button variant="secondary" className="w-full" disabled={ocupado} onClick={guardar}>
              Guardar borrador
            </Button>
            {borradorId && (
              <Button variant="danger" className="w-full" disabled={ocupado} onClick={eliminar}>
                Eliminar borrador
              </Button>
            )}
          </div>

          {problemas.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-text-muted">
              {problemas.map((p, i) => (
                <li key={i}>· {p}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ----------------------------------------------------- Líneas */}
      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <CardTitle>Líneas</CardTitle>
          <Button variant="secondary" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
            <Icono nombre="agregar" className="mr-1 h-4 w-4" />
            Agregar línea
          </Button>
        </div>

        {/* Una línea = un renglón. En pantallas angostas la TABLA se
            desplaza en horizontal; la línea no se parte. */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-black/5 text-left text-xs uppercase text-text-muted">
                <th className="w-[190px] py-2 pr-2">CABYS</th>
                <th className="py-2 pr-2">Detalle</th>
                <th className="w-[90px] py-2 pr-2">Cantidad</th>
                <th className="w-[130px] py-2 pr-2">Unidad</th>
                <th className="w-[120px] py-2 pr-2 text-right">Precio</th>
                <th className="w-[130px] py-2 pr-2 text-right">Descuento</th>
                <th className="w-[150px] py-2 pr-2">Impuesto</th>
                <th className="w-[120px] py-2 pr-2 text-right">Total</th>
                <th className="w-[40px] py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} className="border-b border-black/5 align-top">
                  <td className="py-2 pr-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-sm"
                      value={l.codigoCabys}
                      maxLength={13}
                      placeholder="8351000000000"
                      onChange={(e) => {
                        actualizarLinea(i, { codigoCabys: e.target.value });
                        setBuscaCabys(null);
                      }}
                    />
                    {!cabysVacio?.vacio && (
                      <div className="relative">
                        <input
                          className="mt-1 w-full rounded-lg border border-dashed border-black/10 bg-transparent px-2 py-1 text-xs"
                          placeholder="buscar en CABYS…"
                          value={buscaCabys?.indice === i ? buscaCabys.texto : ""}
                          onChange={(e) => setBuscaCabys({ indice: i, texto: e.target.value })}
                        />
                        {buscaCabys?.indice === i && resultadosCabys.length > 0 && (
                          <ul className="absolute z-10 mt-1 max-h-44 w-[320px] overflow-auto rounded-lg border border-black/10 bg-surface text-xs shadow-lg">
                            {resultadosCabys.map((r) => (
                              <li key={r.codigo}>
                                <button
                                  type="button"
                                  className="block w-full px-2 py-1.5 text-left hover:bg-black/5"
                                  onClick={() => {
                                    actualizarLinea(i, {
                                      codigoCabys: r.codigo,
                                      // La tarifa la sugiere el propio
                                      // catálogo CABYS; se puede cambiar.
                                      codigoTarifaIva:
                                        r.codigoTarifaIvaSugerido ?? l.codigoTarifaIva,
                                    });
                                    setBuscaCabys(null);
                                  }}
                                >
                                  <span className="font-mono">{r.codigo}</span> — {r.descripcion}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-sm"
                      value={l.detalle}
                      placeholder="Consulta veterinaria general"
                      onChange={(e) => actualizarLinea(i, { detalle: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-right text-sm"
                      value={l.cantidad}
                      onChange={(e) => actualizarLinea(i, { cantidad: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-sm"
                      value={l.unidadMedida}
                      onChange={(e) => actualizarLinea(i, { unidadMedida: e.target.value })}
                    >
                      {(catalogos?.unidadesMedida ?? []).map((u) => (
                        <option key={u.codigo} value={u.codigo}>
                          {u.codigo} — {u.descripcion}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-right text-sm"
                      value={l.precioUnitario}
                      placeholder="10000"
                      onChange={(e) => actualizarLinea(i, { precioUnitario: e.target.value })}
                    />
                  </td>
                  {/* El descuento se escribe en el renglón; la
                      naturaleza y el código, que son texto largo, se
                      eligen en un panel que se abre debajo SIN partir
                      la fila. */}
                  <td className="relative py-2 pr-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-right text-sm"
                      value={l.descuento?.monto ?? ""}
                      placeholder="0"
                      onFocus={() => setDescuentoAbierto(i)}
                      onChange={(e) =>
                        actualizarLinea(i, {
                          descuento: {
                            monto: e.target.value,
                            codigoDescuento: l.descuento?.codigoDescuento ?? "01",
                            naturaleza: l.descuento?.naturaleza ?? "",
                          },
                        })
                      }
                    />
                    {descuentoAbierto === i && l.descuento && Number(l.descuento.monto) > 0 && (
                      <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-black/10 bg-surface p-3 shadow-lg">
                        <Select
                          label="Naturaleza del descuento"
                          value={l.descuento.codigoDescuento}
                          onChange={(e) =>
                            actualizarLinea(i, {
                              descuento: { ...l.descuento!, codigoDescuento: e.target.value },
                            })
                          }
                          options={(catalogos?.codigosDescuento ?? []).map((c) => ({
                            value: c.codigo,
                            label: c.nombre,
                          }))}
                        />
                        {l.descuento.codigoDescuento === "99" && (
                          <Input
                            label="Describa la naturaleza"
                            className="mt-2"
                            value={l.descuento.naturaleza}
                            onChange={(e) =>
                              actualizarLinea(i, {
                                descuento: { ...l.descuento!, naturaleza: e.target.value },
                              })
                            }
                          />
                        )}
                        <Button
                          variant="secondary"
                          className="mt-2 w-full"
                          onClick={() => setDescuentoAbierto(null)}
                        >
                          Listo
                        </Button>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-sm"
                      value={l.codigoTarifaIva}
                      onChange={(e) => actualizarLinea(i, { codigoTarifaIva: e.target.value })}
                    >
                      {(catalogos?.tarifasIva ?? []).map((t) => (
                        <option key={t.codigo} value={t.codigo}>
                          {t.nombre}
                        </option>
                      ))}
                    </select>
                    <span className="mt-0.5 block text-right text-xs text-text-muted">
                      {tarifaDe(l.codigoTarifaIva)}%
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right text-sm font-medium">
                    {totalLinea(i) !== undefined
                      ? formatearMonto(String(totalLinea(i)), "CRC")
                      : "—"}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      aria-label={`Quitar la línea ${i + 1}`}
                      className="rounded p-1 text-text-muted hover:bg-black/5 hover:text-error"
                      onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Icono nombre="borrar" className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ------------------------------------------- Observaciones */}
        <div className="mt-4">
          <label
            htmlFor="observaciones"
            className="text-sm font-semibold text-text-primary"
          >
            Observaciones
          </label>
          <p className="mb-1 text-xs text-text-muted">
            Sale en el comprobante: en el XML, en el campo <code>Otros/OtroTexto</code> que define
            el Anexo 4.4, y en el PDF.
          </p>
          <textarea
            id="observaciones"
            rows={3}
            maxLength={MAX_OBSERVACIONES}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Control postoperatorio. Próxima revisión en 10 días."
            className="w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
          />
          <p className="mt-0.5 text-right text-xs text-text-muted">
            {observaciones.length}/{MAX_OBSERVACIONES}
          </p>
        </div>
      </Card>
    </div>
  );
}
