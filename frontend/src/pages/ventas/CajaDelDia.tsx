import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  LoadingState,
  KpiCard,
  Modal,
  PageHeader,
  Select,
  Table,
  TableColumn,
  TiraIndicadores,
  useToast,
} from "../../components/ui";
import { plural } from "../../lib/plural";
import { guardarComoArchivo } from "../../lib/descargas";
import {
  Caja,
  CobroListado,
  CuentaListada,
  ETIQUETA_MEDIO,
  LineaEsperada,
  LineaPorMedio,
  MovimientoEfectivo,
  QUE_DECLARAR,
  Sesion,
  formatearMonto,
  ventasApi,
} from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// LA CAJA DEL DÍA: la sesión abierta, sus cuentas, sus cobros y su
// cierre con arqueo.
//
// EL ARQUEO está hecho para que sirva: **el esperado NO se precarga en
// el campo del declarado**. Si lo hiciera, el cajero confirmaría el
// número del sistema sin contar y el arqueo dejaría de detectar nada.
// La diferencia aparece recién cuando el cajero escribe lo que contó.
//
// El esperado se muestra igual —no es un examen sorpresa— pero en otra
// columna.
// ---------------------------------------------------------------------

// LAS DENOMINACIONES SALEN DE LA BASE (prompt 08b, A2).
//
// Estaban acá, como constante, con el argumento de que «son un hecho del
// país y no una configuración de la clínica». El argumento se cayó por
// dos lados: el prompt pide que la clínica pueda editarlas, y una
// clínica que no recibe billetes de ₡20 000 no quiere esa línea en su
// planilla de conteo. Ahora vienen de `vta_denominaciones`, con la
// semilla del BCCR como filas de plataforma.
//
// EL RESPALDO ES VACÍO Y NO UNA COPIA: si la consulta falla, no se
// dibuja el conteo por denominación y se cuenta por total, que es lo que
// el cierre siempre permitió. Dejar acá una segunda lista sería tener el
// mismo dato en dos lugares, que es el defecto que esto corrige.
const SIN_DENOMINACIONES: Record<string, number[]> = {};

export function CajaDelDia() {
  const { id: sesionIdParam } = useParams();
  const navegar = useNavigate();
  const toast = useToast();

  const [cajas, setCajas] = useState<Caja[]>([]);
  // Las denominaciones vigentes de la clínica y el modo predeterminado
  // de conteo, los dos de la base (prompt 08b, A2).
  const [denominaciones, setDenominaciones] =
    useState<Record<string, number[]>>(SIN_DENOMINACIONES);
  const [porDenominacionPorOmision, setPorDenominacionPorOmision] = useState(false);
  /** El personal, para decir quién recibió un vale. */
  const [personas, setPersonas] = useState<Array<{ id: string; nombre: string }>>([]);
  // EL LOTE DEL DATÁFONO (prompt 08b, A4). Mismo criterio que las
  // denominaciones: si se carga, el declarado de tarjeta sale de su
  // suma. El banco y el tipo son los que imprime el papel.
  const [lote, setLote] = useState<
    Array<{ banco: string; tipoTarjeta: string; cantidad: string; monto: string; numeroLote: string }>
  >([]);
  const [sesionId, setSesionId] = useState(sesionIdParam ?? "");
  const [datos, setDatos] = useState<{
    sesion: Sesion;
    esperado: LineaEsperada[];
    cobros: CobroListado[];
    movimientos: MovimientoEfectivo[];
    cuentasAbiertas: CuentaListada[];
    porMedio: LineaPorMedio[];
    comprobantes: { facturas: number; tiquetes: number; sinComprobante: number };
  } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const [abriendo, setAbriendo] = useState(false);
  const [cajaId, setCajaId] = useState("");
  const [fondoCrc, setFondoCrc] = useState("0");
  const [fondoUsd, setFondoUsd] = useState("0");

  const [cerrando, setCerrando] = useState(false);
  const [declarado, setDeclarado] = useState<Record<string, string>>({});
  const [justificacion, setJustificacion] = useState<Record<string, string>>({});
  // EL CONTEO POR DENOMINACIÓN, opcional. Clave `moneda|valor` →
  // cantidad escrita. Cuando una moneda tiene al menos una cantidad
  // escrita, su efectivo declarado SALE de la suma y el campo manual
  // pasa a solo lectura: contar los billetes y además escribir el total
  // serían dos fuentes del mismo número.
  const [conteo, setConteo] = useState<Record<string, string>>({});

  const [movimiento, setMovimiento] = useState(false);
  const [mov, setMov] = useState({
    tipo: "retiro_caja_fuerte",
    // QUIÉN RECIBE (prompt 08b, A2). `persona_id` es quien lo registra;
    // en el caso que motiva el vale —el adelanto a un empleado, el pago
    // de la mensajería— la plata se la lleva otra persona, y es el dato
    // por el que se firma el vale.
    recibidoPor: "",
    recibidoPorNombre: "",
    moneda: "CRC",
    monto: "",
    categoriaGasto: "",
    motivo: "",
  });

  const recargar = async (id: string) => {
    const d = await ventasApi.sesion(id);
    setDatos(d);
    setDeclarado({});
    setJustificacion({});
  };

  useEffect(() => {
    ventasApi
      .cajas()
      .then((r) => {
        setCajas(r.cajas);
        if (!sesionId) {
          const abierta = r.cajas.find((c) => c.sesion_abierta);
          if (abierta?.sesion_abierta) {
            setSesionId(abierta.sesion_abierta);
            navegar(`/ventas/caja/${abierta.sesion_abierta}`, { replace: true });
          } else if (r.cajas[0]) {
            setCajaId(r.cajas[0].id);
          }
        }
      })
      .catch(() => setCajas([]))
      .finally(() => setCargando(false));

    // El catálogo de la clínica y el modo de conteo predeterminado. Si
    // falla, el cierre sigue contando por total: es lo que siempre pudo
    // hacer, y es mejor que dibujar una planilla con una lista inventada.
    ventasApi
      .denominaciones()
      .then((r) => {
        const porMoneda: Record<string, number[]> = {};
        for (const d of r.denominaciones) {
          porMoneda[d.moneda] = [...(porMoneda[d.moneda] ?? []), Number(d.valor)];
        }
        for (const moneda of Object.keys(porMoneda)) {
          porMoneda[moneda].sort((a, b) => b - a);
        }
        setDenominaciones(porMoneda);
      })
      .catch(() => setDenominaciones(SIN_DENOMINACIONES));
    ventasApi
      .parametros()
      .then((p) => setPorDenominacionPorOmision(p.parametros.arqueo_por_denominacion === true))
      .catch(() => setPorDenominacionPorOmision(false));
    ventasApi
      .personalDeLaClinica()
      .then((r) => setPersonas(r.personas))
      // Sin la lista, el vale se escribe con el nombre a mano: el campo
      // libre existe justamente porque quien recibe puede no ser del
      // personal.
      .catch(() => setPersonas([]));
  }, []);

  useEffect(() => {
    if (!sesionId) return;
    setCargando(true);
    recargar(sesionId)
      .catch((err) => toast.error(err.message))
      .finally(() => setCargando(false));
  }, [sesionId]);

  const abrir = async () => {
    setOcupado(true);
    try {
      const r = await ventasApi.abrirSesion({
        cajaId,
        fondoCrc: Number(fondoCrc.replace(",", ".")) || 0,
        fondoUsd: Number(fondoUsd.replace(",", ".")) || 0,
      });
      toast.exito("Caja abierta.");
      setAbriendo(false);
      setSesionId(r.id);
      navegar(`/ventas/caja/${r.id}`, { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const clave = (l: LineaEsperada) => `${l.medio}|${l.moneda}`;

  /** Las denominaciones escritas, listas para el backend. */
  const denominacionesEscritas = () =>
    Object.entries(conteo)
      .map(([k, texto]) => {
        const [moneda, valor] = k.split("|");
        return { moneda, valor: Number(valor), cantidad: Number(texto.replace(/\D/g, "")) || 0 };
      })
      .filter((d) => d.cantidad > 0);

  /** Lo contado por denominación en una moneda, o null si no se contó. */
  const contadoEn = (moneda: string): number | null => {
    const propias = denominacionesEscritas().filter((d) => d.moneda === moneda);
    if (propias.length === 0) return null;
    return propias.reduce((a, d) => a + d.valor * d.cantidad, 0);
  };

  const cerrar = async () => {
    if (!datos) return;
    setOcupado(true);
    try {
      const r = await ventasApi.cerrarSesion(sesionId, {
        lineas: datos.esperado.map((l) => ({
          medio: l.medio,
          moneda: l.moneda,
          declarado: Number((declarado[clave(l)] ?? "").replace(",", ".")) || 0,
          justificacion: justificacion[clave(l)]?.trim() || undefined,
        })),
        denominaciones: denominacionesEscritas(),
        // Las líneas con banco y monto: una fila a medio escribir no se
        // manda, para no guardar un lote de ₡0 que después nadie
        // entiende.
        loteDatafono: lote
          .filter((l) => l.banco.trim() && Number(l.monto.replace(",", ".")) > 0)
          .map((l) => ({
            banco: l.banco.trim(),
            tipoTarjeta: l.tipoTarjeta,
            cantidad: Number(l.cantidad) || 0,
            monto: Number(l.monto.replace(",", ".")),
            numeroLote: l.numeroLote.trim() || undefined,
          })),
      });
      if (!r.cerrada) {
        toast.aviso(
          `La diferencia es de ${formatearMonto(r.diferenciaTotalCrc)} y el umbral es ${formatearMonto(r.umbral)}: ` +
            `la caja NO se cerró. Quedó una solicitud para que la apruebe un administrador.`
        );
      } else {
        toast.exito("Caja cerrada. El arqueo queda inmutable.");
        setCerrando(false);
      }
      await recargar(sesionId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const registrarMovimiento = async () => {
    setOcupado(true);
    try {
      await ventasApi.movimientoEfectivo(sesionId, {
        tipo: mov.tipo,
        moneda: mov.moneda,
        monto: Number(mov.monto.replace(",", ".")),
        categoriaGasto: mov.categoriaGasto.trim() || undefined,
        motivo: mov.motivo,
              recibidoPor: mov.recibidoPor || undefined,
        recibidoPorNombre: mov.recibidoPorNombre.trim() || undefined,
      });
      toast.exito("Movimiento registrado. El arqueo ya lo considera.");
      setMovimiento(false);
      setMov({ ...mov, monto: "", motivo: "", categoriaGasto: "" });
      await recargar(sesionId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  // El total cobrado en colones sale de sumar los medios ya convertidos
  // (`monto_crc`), no de `total` de cada cobro: un cobro en dolares
  // guarda su total en la moneda del comprobante.
  const totalCobradoCrc = (datos?.porMedio ?? []).reduce((a, l) => a + Number(l.monto_crc), 0);

  if (cargando) return <LoadingState forma="tarjetas" cantidad={3} />;

  // ------------------------------------------------ Sin sesión abierta
  if (!sesionId || !datos) {
    return (
      <div>
        <PageHeader titulo="Caja" icono="caja" modulo="caja" />
        <Card>
          <CardTitle>No hay ninguna caja abierta</CardTitle>
          <CardDescription>
            Para cobrar hace falta una sesión abierta, con su fondo inicial. El fondo entra al
            arqueo del cierre.
          </CardDescription>
          <Button className="mt-4" onClick={() => setAbriendo(true)} disabled={cajas.length === 0}>
            Abrir caja
          </Button>
          {cajas.length === 0 && (
            <p className="mt-2 text-sm text-text-muted">
              Todavía no hay ninguna caja configurada. La crea un administrador.
            </p>
          )}
        </Card>

        <Modal
          open={abriendo}
          onClose={() => setAbriendo(false)}
          title="Abrir caja"
          description="El fondo inicial en cada moneda. Es el punto de partida del arqueo."
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAbriendo(false)}>
                Cancelar
              </Button>
              <Button disabled={ocupado || !cajaId} onClick={abrir}>
                Abrir
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Select
              label="Caja"
              value={cajaId}
              onChange={(e) => setCajaId(e.target.value)}
              options={cajas.map((c) => ({ value: c.id, label: `${c.nombre} — ${c.bodega}` }))}
            />
            <Input
              label="Fondo en colones"
              value={fondoCrc}
              onChange={(e) => setFondoCrc(e.target.value)}
            />
            <Input
              label="Fondo en dólares"
              value={fondoUsd}
              onChange={(e) => setFondoUsd(e.target.value)}
            />
          </div>
        </Modal>
      </div>
    );
  }

  const abiertaAun = datos.sesion.estado === "abierta";

  const columnasCobros: TableColumn<CobroListado>[] = [
    {
      key: "hora",
      header: "Hora",
      render: (c) => new Date(c.creado_en).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" }),
    },
    {
      key: "cuenta",
      header: "Cuenta",
      render: (c) => (
        <>
          <span className="font-medium">#{c.cuenta_numero ?? "—"}</span>
          {c.cliente_nombre && <span className="block text-xs text-text-muted">{c.cliente_nombre}</span>}
        </>
      ),
    },
    { key: "cajero", header: "Cobró", render: (c) => c.cajero ?? "—" },
    {
      key: "comprobante",
      header: "Comprobante",
      render: (c) => <span className="text-sm">{c.consecutivo ?? "—"}</span>,
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      render: (c) => (
        <span className={c.estado === "anulado" ? "line-through text-text-muted" : "font-medium"}>
          {formatearMonto(c.total)}
        </span>
      ),
    },
    {
      key: "acciones",
      header: "",
      render: (c) => (
        <Link to={`/ventas/tiquete/${c.id}`} className="text-sm text-accent hover:underline">
          Tiquete
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        titulo={datos.sesion.caja}
        icono="caja"
        modulo="caja"
        subtitulo={`Abierta por ${datos.sesion.abierta_por_nombre ?? "—"} el ${new Date(
          datos.sesion.abierta_en
        ).toLocaleString("es-CR")} · fondo ${formatearMonto(
          datos.sesion.fondo_crc
        )} y ${formatearMonto(datos.sesion.fondo_usd, "USD")}`}
        contexto={
          /* El estado NO va con el `Badge` del sistema: sus variantes
             estan calculadas para fondo claro, y sobre la franja de
             color un «success» verde oscuro sobre verde claro no se
             lee. Sobre la franja, el unico par garantizado es el
             primario con el texto que va encima. */
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sobre-primary/20 px-2.5 py-0.5 text-xs font-semibold text-sobre-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-sobre-primary" aria-hidden="true" />
            {abiertaAun ? "Caja abierta" : "Caja cerrada"}
          </span>
        }
        secundarias={
          <>
            {abiertaAun && (
              <>
                <Button variant="secondary" onClick={() => setMovimiento(true)}>
                  Movimiento de efectivo
                </Button>
                <Button variant="secondary" onClick={() => setCerrando(true)}>
                  Cerrar con arqueo
                </Button>
              </>
            )}
            {/* EL COMPROBANTE DEL CIERRE (prompt 08b, A2). Se puede bajar
                con la caja abierta —sale marcado «SIN CERRAR»— porque el
                cajero lo usa para contar antes de cerrar. */}
            {sesionId && (
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    // `apiFetchFile` devuelve el blob Y el nombre que
                    // mandó el servidor: se usa el del servidor, que es
                    // el que ya sabe cómo se llama el documento.
                    const r = await ventasApi.comprobanteDeCierre(sesionId);
                    guardarComoArchivo(
                      r.blob,
                      r.filename ?? `cierre-de-caja-${sesionId.slice(0, 8)}.pdf`
                    );
                  } catch (err) {
                    toast.mostrar(
                      "error",
                      err instanceof Error ? err.message : "No pudimos generar el comprobante."
                    );
                  }
                }}
              >
                Comprobante del cierre
              </Button>
            )}
          </>
        }
        accion={
          abiertaAun ? (
            <Button onClick={() => navegar(`/ventas/cobro?sesion=${sesionId}`)}>
              <Icono nombre="agregar" className="mr-1 h-4 w-4" />
              Cobrar
            </Button>
          ) : null
        }
        indicadores={
          /* UNA TARJETA POR MEDIO DE PAGO (prompt 01c, seccion 5), con
             monto, cantidad de cobros y, en dolares, su equivalente en
             colones al tipo con el que se cobro. La primera tarjeta es
             el total del dia: sin ella hay que sumar de memoria. */
          <TiraIndicadores>
            <KpiCard
              titulo="Cobrado hoy"
              valor={formatearMonto(totalCobradoCrc)}
              icono="caja"
              modulo="caja"
              variacionPorcentaje={null}
              detalle={[
                plural(datos.cobros.filter((c) => c.estado === "aplicado").length, "cobro", "cobros"),
                plural(datos.comprobantes?.facturas ?? 0, "factura", "facturas"),
                plural(datos.comprobantes?.tiquetes ?? 0, "tiquete", "tiquetes"),
              ].join(" · ")}
            />
            {(datos.porMedio ?? []).map((l) => (
              <KpiCard
                key={`${l.medio}-${l.moneda}`}
                titulo={`${ETIQUETA_MEDIO[l.medio] ?? l.medio}${l.moneda !== "CRC" ? ` (${l.moneda})` : ""}`}
                valor={formatearMonto(l.monto, l.moneda)}
                icono={l.medio === "efectivo" ? "caja" : l.medio === "tarjeta" ? "plan" : "panel"}
                modulo="caja"
                variacionPorcentaje={null}
                detalle={
                  l.moneda === "CRC"
                    ? plural(l.cobros, "cobro", "cobros")
                    : `${plural(l.cobros, "cobro", "cobros")} · ${formatearMonto(l.monto_crc)}`
                }
              />
            ))}
            {(datos.porMedio ?? []).length === 0 && (
              <KpiCard
                titulo="Sin cobros todavía"
                valor="—"
                icono="caja"
                modulo="caja"
                variacionPorcentaje={null}
                detalle="Las tarjetas por medio de pago aparecen con el primer cobro."
              />
            )}
          </TiraIndicadores>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>Lo que debería haber</CardTitle>
          <CardDescription>Calculado por el sistema. Se compara con lo contado al cerrar.</CardDescription>
          <ul className="mt-3 space-y-1 text-sm">
            {datos.esperado.map((l) => (
              <li key={clave(l)} className="flex justify-between border-b border-black/5 pb-1">
                <span className="text-text-muted">
                  {ETIQUETA_MEDIO[l.medio] ?? l.medio} {l.moneda !== "CRC" && l.moneda}
                </span>
                <span className="font-medium">{formatearMonto(l.esperado, l.moneda)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>Cuentas abiertas</CardTitle>
          <CardDescription>
            Una cuenta puede quedar abierta varios días acumulando cargos.
          </CardDescription>
          {/* PACIENTE, PROPIETARIO, CUANTOS CARGOS Y CUANTO SUMAN, con su
              antiguedad (prompt 01c, seccion 5). Antes decia literalmente
              «cargo(s)», sin numero: la consulta no traia la cantidad. */}
          <ul className="mt-3 space-y-2 text-sm">
            {datos.cuentasAbiertas.map((c) => {
              const horas = Math.floor(c.antiguedad_segundos / 3600);
              return (
                <li key={c.id}>
                  <Link
                    to={`/ventas/cobro/${c.id}?sesion=${sesionId}`}
                    className="block border-b border-black/5 pb-2 hover:bg-black/[0.02]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">
                        {c.primer_paciente ?? "Mostrador"}
                        {c.pacientes > 1 && (
                          <span className="font-normal text-text-muted">
                            {" "}
                            y {plural(c.pacientes - 1, "mascota más", "mascotas más")}
                          </span>
                        )}
                      </span>
                      <span className="whitespace-nowrap font-medium">
                        {formatearMonto(c.total)}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-2 text-xs text-text-muted">
                      <span>
                        #{c.numero} · {c.cliente_nombre ?? "Cliente sin registrar"} ·{" "}
                        {plural(c.cargos, "cargo", "cargos")}
                      </span>
                      {horas >= 24 ? (
                        <Badge variant="warning">
                          {plural(Math.floor(horas / 24), "día abierta", "días abierta")}
                        </Badge>
                      ) : (
                        <span className="whitespace-nowrap">
                          {horas < 1 ? "Abierta hace menos de una hora" : plural(horas, "hora", "horas")}
                        </span>
                      )}
                    </div>
                    {c.resumen && (
                      <p className="truncate text-xs text-text-muted" title={c.resumen}>
                        {c.resumen}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
            {datos.cuentasAbiertas.length === 0 && (
              <li className="text-text-muted">Ninguna cuenta abierta.</li>
            )}
          </ul>
        </Card>

        <Card>
          <CardTitle>Movimientos de efectivo</CardTitle>
          <CardDescription>Lo que entra y sale sin ser una venta.</CardDescription>
          <ul className="mt-3 space-y-1 text-sm">
            {datos.movimientos.map((m) => (
              <li key={m.id} className="border-b border-black/5 pb-1">
                <div className="flex justify-between">
                  <span>
                    {m.tipo === "ingreso_cambio" ? "+" : "−"}
                    {formatearMonto(m.monto, m.moneda)}
                  </span>
                  <span className="text-xs text-text-muted">{m.persona ?? "—"}</span>
                </div>
                <span className="block text-xs text-text-muted">{m.motivo}</span>
              </li>
            ))}
            {datos.movimientos.length === 0 && (
              <li className="text-text-muted">Ninguno todavía.</li>
            )}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Cobros de la sesión</CardTitle>
        <div className="mt-3">
          <Table
            columns={columnasCobros}
            data={datos.cobros}
            rowKey={(c) => c.id}
            emptyMessage="Todavía no se cobró nada."
          />
        </div>
      </Card>

      {/* ------------------------------------------------ Arqueo */}
      <Modal
        open={cerrando}
        onClose={() => setCerrando(false)}
        title="Cerrar con arqueo"
        description="Escribí lo CONTADO en cada medio. El esperado está al lado para comparar, no para copiar."
        ancho="xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCerrando(false)}>
              Cancelar
            </Button>
            <Button disabled={ocupado} onClick={cerrar}>
              Cerrar la caja
            </Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                <th className="py-2">Medio</th>
                <th className="py-2 text-right">Esperado</th>
                <th className="py-2 text-right">Declarado</th>
                <th className="py-2 text-right">Diferencia</th>
                <th className="py-2">Justificación</th>
              </tr>
            </thead>
            <tbody>
              {datos.esperado.map((l) => {
                const k = clave(l);
                const porConteo = l.medio === "efectivo" ? contadoEn(l.moneda) : null;
                const valor =
                  porConteo !== null ? String(porConteo) : declarado[k] ?? "";
                const dif =
                  valor === "" ? null : Number(valor.replace(",", ".")) - l.esperado;
                return (
                  <tr key={k} className="border-b border-black/5">
                    <td className="py-2">
                      <span className="font-medium">
                        {ETIQUETA_MEDIO[l.medio] ?? l.medio}
                        {l.moneda !== "CRC" ? ` (${l.moneda})` : ""}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {QUE_DECLARAR[l.medio] ?? "El total confirmado"}
                      </span>
                    </td>
                    <td className="py-2 text-right">{formatearMonto(l.esperado, l.moneda)}</td>
                    <td className="py-2 text-right">
                      <input
                        className={`w-32 rounded-lg border border-black/10 px-2 py-1 text-right ${
                          porConteo !== null ? "bg-background text-text-muted" : "bg-surface"
                        }`}
                        value={valor}
                        placeholder="0"
                        readOnly={porConteo !== null}
                        title={
                          porConteo !== null
                            ? "Sale del conteo por denominación de abajo"
                            : undefined
                        }
                        onChange={(e) => setDeclarado((d) => ({ ...d, [k]: e.target.value }))}
                      />
                      {porConteo !== null && (
                        <span className="block text-xs text-text-muted">del conteo</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {dif === null ? (
                        <span className="text-text-muted">—</span>
                      ) : dif === 0 ? (
                        <span className="text-success">cuadra</span>
                      ) : (
                        <span className="font-semibold text-error">
                          {dif > 0 ? "+" : ""}
                          {formatearMonto(dif, l.moneda)}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      {dif !== null && dif !== 0 && (
                        <input
                          className="w-full rounded-lg border border-black/10 bg-surface px-2 py-1"
                          value={justificacion[k] ?? ""}
                          placeholder="Por qué no cuadra"
                          onChange={(e) =>
                            setJustificacion((j) => ({ ...j, [k]: e.target.value }))
                          }
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* ------------------------------- Lote del datáfono (A4) */}
        <div className="mt-5 rounded-xl border border-black/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text-primary">
              Lote del datáfono <span className="font-normal text-text-muted">(opcional)</span>
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                setLote((l) => [
                  ...l,
                  { banco: "", tipoTarjeta: "credito", cantidad: "", monto: "", numeroLote: "" },
                ])
              }
            >
              + Agregar línea
            </Button>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Los totales que imprime el datáfono al cerrar el lote. Si los cargás, el{" "}
            <strong>declarado de tarjeta sale de esta suma</strong> y la diferencia contra lo que el
            sistema cobró queda en el comprobante del cierre.
          </p>
          {lote.length > 0 && (
            <div className="mt-3 space-y-2">
              {lote.map((l, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-5">
                  <Input
                    label="Banco"
                    value={l.banco}
                    placeholder="BAC"
                    onChange={(e) =>
                      setLote((xs) => xs.map((x, j) => (j === i ? { ...x, banco: e.target.value } : x)))
                    }
                  />
                  <Select
                    label="Tipo"
                    value={l.tipoTarjeta}
                    onChange={(e) =>
                      setLote((xs) =>
                        xs.map((x, j) => (j === i ? { ...x, tipoTarjeta: e.target.value } : x))
                      )
                    }
                    options={[
                      { value: "credito", label: "Crédito" },
                      { value: "debito", label: "Débito" },
                    ]}
                  />
                  <Input
                    label="Transacciones"
                    value={l.cantidad}
                    inputMode="numeric"
                    onChange={(e) =>
                      setLote((xs) =>
                        xs.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x))
                      )
                    }
                  />
                  <Input
                    label="Monto del lote"
                    value={l.monto}
                    inputMode="decimal"
                    onChange={(e) =>
                      setLote((xs) => xs.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))
                    }
                  />
                  <Input
                    label="N.º de lote"
                    value={l.numeroLote}
                    onChange={(e) =>
                      setLote((xs) =>
                        xs.map((x, j) => (j === i ? { ...x, numeroLote: e.target.value } : x))
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* --------------------------------- Conteo por denominación */}
        {Object.keys(denominaciones).length > 0 && (
        <div
          className="mt-5 rounded-xl border border-black/5 p-3"
          // El modo predeterminado lo decide la clínica (prompt 08b, A2):
          // con `arqueo_por_denominacion` en true, el bloque nace
          // abierto. Contar por total sigue permitido siempre.
          data-predeterminado={porDenominacionPorOmision ? "denominacion" : "total"}
        >
          <p className="text-sm font-semibold text-text-primary">
            Conteo por denominación{" "}
            <span className="font-normal text-text-muted">
              {porDenominacionPorOmision ? "(así cuenta esta clínica)" : "(opcional)"}
            </span>
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Contar billete por billete es más confiable que sumar de cabeza y deja el detalle
            guardado. Si escribas cantidades, el efectivo declarado de esa moneda{" "}
            <strong>sale de esta suma</strong> y el campo de arriba se bloquea: el mismo número en
            dos lugares es de donde salen los arqueos que no cuadran con su propio detalle.
          </p>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {Object.entries(denominaciones).map(([moneda, valores]) => {
              const total = contadoEn(moneda);
              return (
                <div key={moneda}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{moneda}</span>
                    <span className="text-sm">
                      {total === null ? (
                        <span className="text-text-muted">sin contar</span>
                      ) : (
                        <strong>{formatearMonto(total, moneda)}</strong>
                      )}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {valores.map((v) => {
                      const k = `${moneda}|${v}`;
                      const cantidad = Number((conteo[k] ?? "").replace(/\D/g, "")) || 0;
                      return (
                        <div key={k} className="flex items-center gap-2 text-sm">
                          <span className="w-20 text-right text-text-muted">
                            {formatearMonto(v, moneda)}
                          </span>
                          <span className="text-text-muted">×</span>
                          <input
                            className="w-16 rounded-lg border border-black/10 bg-surface px-2 py-1 text-right"
                            value={conteo[k] ?? ""}
                            placeholder="0"
                            inputMode="numeric"
                            onChange={(e) => setConteo((c) => ({ ...c, [k]: e.target.value }))}
                          />
                          <span className="w-24 text-right text-xs text-text-muted">
                            {cantidad > 0 ? formatearMonto(v * cantidad, moneda) : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {total !== null && (
                    <button
                      type="button"
                      className="mt-2 text-xs text-text-muted underline hover:text-primary"
                      onClick={() =>
                        setConteo((c) => {
                          const limpio = { ...c };
                          for (const v of valores) delete limpio[`${moneda}|${v}`];
                          return limpio;
                        })
                      }
                    >
                      Borrar el conteo de {moneda} y volver a declarar el total a mano
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}

        <p className="mt-3 text-xs text-text-muted">
          Cada diferencia lleva su justificación. Si la diferencia total supera el umbral de la
          clínica, la caja no cierra hasta que un administrador lo apruebe.
        </p>
      </Modal>

      {/* ------------------------------------- Movimiento de efectivo */}
      <Modal
        open={movimiento}
        onClose={() => setMovimiento(false)}
        title="Movimiento de efectivo"
        description="Lo que entra o sale de la caja sin ser una venta. El arqueo lo considera."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMovimiento(false)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado || !Number(mov.monto.replace(",", ".")) || !mov.motivo.trim()}
              onClick={registrarMovimiento}
            >
              Registrar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Select
            label="Tipo"
            value={mov.tipo}
            onChange={(e) => setMov({ ...mov, tipo: e.target.value })}
            options={[
              { value: "retiro_caja_fuerte", label: "Retiro a caja fuerte (sale)" },
              { value: "ingreso_cambio", label: "Ingreso de cambio (entra)" },
              { value: "gasto_caja_chica", label: "Gasto de caja chica (sale)" },
            ]}
          />
          <Select
            label="Moneda"
            value={mov.moneda}
            onChange={(e) => setMov({ ...mov, moneda: e.target.value })}
            options={[
              { value: "CRC", label: "Colones" },
              { value: "USD", label: "Dólares" },
            ]}
          />
          <Input label="Monto" value={mov.monto} onChange={(e) => setMov({ ...mov, monto: e.target.value })} />
          {mov.tipo === "gasto_caja_chica" && (
            <Input
              label="Categoría del gasto"
              value={mov.categoriaGasto}
              onChange={(e) => setMov({ ...mov, categoriaGasto: e.target.value })}
              placeholder="Limpieza, papelería, mensajería…"
            />
          )}
          <Input
            label="Motivo"
            value={mov.motivo}
            onChange={(e) => setMov({ ...mov, motivo: e.target.value })}
            placeholder="Retiro del mediodía a la caja fuerte"
          />
          {/* EL VALE DE CAJA. Las dos salidas de efectivo que no son una
              venta —el gasto de caja chica y el adelanto— se firman, y lo
              que se firma es a quién se le entregó la plata. */}
          {mov.tipo !== "ingreso_extra" && (
            <>
              <Select
                label="Quién recibió la plata"
                value={mov.recibidoPor}
                onChange={(e) =>
                  setMov({ ...mov, recibidoPor: e.target.value, recibidoPorNombre: "" })
                }
                options={[
                  { value: "", label: "Alguien de afuera (escribir el nombre)" },
                  ...personas.map((p) => ({ value: p.id, label: p.nombre })),
                ]}
              />
              {!mov.recibidoPor && (
                <Input
                  label="Nombre de quien recibió"
                  value={mov.recibidoPorNombre}
                  placeholder="La mensajería, el ferretero…"
                  onChange={(e) => setMov({ ...mov, recibidoPorNombre: e.target.value })}
                />
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
