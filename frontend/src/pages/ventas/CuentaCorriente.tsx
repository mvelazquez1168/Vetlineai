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
  Input,
  LoadingState,
  useToast,
  PageHeader,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { ReceptorEncontrado, facturacionCrApi } from "../../lib/facturacionCrApi";
import { formatearMonto, ventasApi } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// Cuenta corriente del cliente: lo que debe, con antigüedad, lo que
// abonó y su saldo a favor.
//
// EL ABONO emite el Recibo Electrónico de Pago que exige Hacienda, y
// se puede repartir entre varias facturas. Por eso cada factura
// pendiente tiene su propio campo: abonar 50 000 "al cliente" sin
// decir a qué facturas dejaría la antigüedad sin poder calcularse.
//
// EL ANTICIPO **no emite comprobante** al recibirse, y la pantalla lo
// dice. Es el criterio conservador frente a unas fuentes oficiales que
// no tratan el tema — ver el reporte del prompt 08.
// ---------------------------------------------------------------------

export function CuentaCorriente() {
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const toast = useToast();
  const { esAdminClinica } = useAuth();

  const [busqueda, setBusqueda] = useState("");
  const [clientes, setClientes] = useState<ReceptorEncontrado[]>([]);
  const [cliente, setCliente] = useState<ReceptorEncontrado | null>(null);
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof ventasApi.cuentaCorriente>> | null>(
    null
  );
  const [cargando, setCargando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const [aplicaciones, setAplicaciones] = useState<Record<string, string>>({});
  const [anticipo, setAnticipo] = useState({ motivo: "", monto: "" });
  const [credito, setCredito] = useState({ habilitado: false, limite: "0", plazoDias: "30" });

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setClientes([]);
      return;
    }
    const t = setTimeout(() => {
      facturacionCrApi
        .buscarClientes(busqueda)
        .then((r) => setClientes(r.clientes))
        .catch(() => setClientes([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cargar = async (c: ReceptorEncontrado) => {
    setCliente(c);
    setClientes([]);
    setBusqueda("");
    setCargando(true);
    try {
      const d = await ventasApi.cuentaCorriente(c.id);
      setDatos(d);
      setCredito({
        habilitado: d.credito.habilitado,
        limite: String(d.credito.limite),
        plazoDias: String(d.credito.plazoDias),
      });
      setAplicaciones({});
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCargando(false);
    }
  };

  const abonar = async () => {
    if (!cliente) return;
    const lista = Object.entries(aplicaciones)
      .map(([comprobanteId, monto]) => ({
        comprobanteId,
        monto: Number(monto.replace(",", ".")) || 0,
      }))
      .filter((a) => a.monto > 0);
    if (lista.length === 0) {
      toast.aviso("Escribí cuánto se abona a cada factura.");
      return;
    }
    setOcupado(true);
    try {
      const r = await ventasApi.abonar({ propietarioId: cliente.id, aplicaciones: lista });
      toast.exito(
        `Abono de ${formatearMonto(r.aplicado)} registrado. Recibo Electrónico de Pago ${r.repConsecutivo ?? ""} (${r.repEstado ?? ""}).`
      );
      await cargar(cliente);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const registrarAnticipo = async () => {
    if (!cliente) return;
    setOcupado(true);
    try {
      await ventasApi.anticipo({
        propietarioId: cliente.id,
        motivo: anticipo.motivo,
        monto: Number(anticipo.monto.replace(",", ".")),
      });
      toast.exito(
        "Anticipo registrado como saldo a favor. No emite comprobante: el hecho fiscal ocurre con la factura final."
      );
      setAnticipo({ motivo: "", monto: "" });
      await cargar(cliente);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const guardarCredito = async () => {
    if (!cliente) return;
    setOcupado(true);
    try {
      await ventasApi.guardarCredito(cliente.id, {
        habilitado: credito.habilitado,
        limite: Number(credito.limite.replace(",", ".")) || 0,
        plazoDias: Number(credito.plazoDias) || 30,
      });
      toast.exito("Crédito actualizado.");
      await cargar(cliente);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>}>
      {dialogoSalida}
      <PageHeader
        titulo="Cuenta corriente del cliente"
        icono="propietario"
        modulo="caja"
      />

      <Card className="mt-6">
        <div className="relative">
          <Input
            label="Cliente"
            value={cliente?.nombre ?? busqueda}
            onChange={(e) => {
              setCliente(null);
              setDatos(null);
              setBusqueda(e.target.value);
            }}
            placeholder="Buscar por nombre, identificación o teléfono"
          />
          {clientes.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-black/10 bg-surface shadow-lg">
              {clientes.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
                    onClick={() => cargar(c)}
                  >
                    {c.nombre}
                    <span className="block text-xs text-text-muted">
                      {c.numero_identificacion ?? "sin identificación"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {cargando && <LoadingState forma="tarjetas" cantidad={2} />}

      {datos && cliente && (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardTitle>Crédito</CardTitle>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">Estado</dt>
                  <dd>
                    <Badge variant={datos.credito.habilitado ? "success" : "neutral"} dot>
                      {datos.credito.habilitado ? "Habilitado" : "Sin crédito"}
                    </Badge>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">Límite</dt>
                  <dd>{formatearMonto(datos.credito.limite)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">Usado</dt>
                  <dd>{formatearMonto(datos.credito.usado)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>Disponible</dt>
                  <dd>{formatearMonto(datos.credito.disponible)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">Plazo</dt>
                  <dd>{datos.credito.plazoDias} días</dd>
                </div>
              </dl>

              {esAdminClinica && (
                <div className="mt-4 space-y-2 border-t border-black/5 pt-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={credito.habilitado}
                      onChange={(e) => setCredito({ ...credito, habilitado: e.target.checked })}
                    />
                    Crédito habilitado
                  </label>
                  <Input
                    label="Límite"
                    value={credito.limite}
                    onChange={(e) => setCredito({ ...credito, limite: e.target.value })}
                  />
                  <Input
                    label="Plazo (días)"
                    value={credito.plazoDias}
                    onChange={(e) => setCredito({ ...credito, plazoDias: e.target.value })}
                  />
                  <Button className="w-full" disabled={ocupado} onClick={guardarCredito}>
                    Guardar
                  </Button>
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>Saldo a favor</CardTitle>
              <CardDescription>
                Anticipos recibidos y todavía sin aplicar. No emiten comprobante al recibirse.
              </CardDescription>
              <p className="mt-3 text-2xl font-bold text-primary">
                {formatearMonto(datos.saldoAFavor)}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-text-muted">
                {datos.anticipos.map((a) => (
                  <li key={String(a.id)}>
                    {String(a.motivo)} — {formatearMonto(String(a.monto))}{" "}
                    {Number(a.aplicado) > 0 && `(${formatearMonto(String(a.aplicado))} aplicado)`} ·{" "}
                    {String(a.estado)}
                  </li>
                ))}
                {datos.anticipos.length === 0 && <li>Sin anticipos.</li>}
              </ul>

              <div className="mt-4 space-y-2 border-t border-black/5 pt-3">
                <Input
                  label="Motivo del anticipo"
                  value={anticipo.motivo}
                  onChange={(e) => setAnticipo({ ...anticipo, motivo: e.target.value })}
                  placeholder="Anticipo de la castración de Nina"
                />
                <Input
                  label="Monto"
                  value={anticipo.monto}
                  onChange={(e) => setAnticipo({ ...anticipo, monto: e.target.value })}
                />
                <Button
                  className="w-full"
                  disabled={ocupado || !anticipo.motivo.trim() || !Number(anticipo.monto)}
                  onClick={registrarAnticipo}
                >
                  Registrar anticipo
                </Button>
              </div>
            </Card>

            <Card>
              <CardTitle>Abonos</CardTitle>
              <CardDescription>Cada uno con su Recibo Electrónico de Pago.</CardDescription>
              <ul className="mt-3 space-y-1 text-sm">
                {datos.abonos.map((a) => (
                  <li key={String(a.id)} className="border-b border-black/5 pb-1">
                    <div className="flex justify-between">
                      <span>{formatearMonto(String(a.monto))}</span>
                      <span className="text-xs text-text-muted">
                        {new Date(String(a.creado_en)).toLocaleDateString("es-CR")}
                      </span>
                    </div>
                    <span className="block text-xs text-text-muted">
                      REP {String(a.rep_consecutivo ?? "—")} · {String(a.rep_estado ?? "")}
                    </span>
                  </li>
                ))}
                {datos.abonos.length === 0 && <li className="text-text-muted">Sin abonos.</li>}
              </ul>
            </Card>
          </div>

          <Card className="mt-4">
            <CardTitle>Facturas a crédito pendientes</CardTitle>
            <CardDescription>
              Escribí cuánto se abona a cada una. El recibo sale con una referencia por factura.
            </CardDescription>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                    <th className="py-2">Factura</th>
                    <th className="py-2">Emitida</th>
                    <th className="py-2">Vence</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2 text-right">Pendiente</th>
                    <th className="py-2 text-right">Abonar</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.facturas.map((f) => {
                    const id = String(f.id);
                    const vencida = Number(f.dias_vencida) > 0;
                    return (
                      <tr key={id} className="border-b border-black/5">
                        <td className="py-2 font-medium">{String(f.consecutivo)}</td>
                        <td className="py-2">
                          {new Date(String(f.fecha_emision)).toLocaleDateString("es-CR")}
                          <span className="block text-xs text-text-muted">
                            {String(f.antiguedad_dias)} días
                          </span>
                        </td>
                        <td className="py-2">
                          <span className={vencida ? "font-semibold text-error" : ""}>
                            {f.vence_el ? new Date(String(f.vence_el)).toLocaleDateString("es-CR") : "—"}
                            {vencida && ` · ${String(f.dias_vencida)} días vencida`}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          {formatearMonto(String(f.total_comprobante))}
                        </td>
                        <td className="py-2 text-right font-medium">
                          {formatearMonto(String(f.pendiente))}
                        </td>
                        <td className="py-2 text-right">
                          <input
                            className="w-28 rounded-lg border border-black/10 bg-surface px-2 py-1 text-right"
                            value={aplicaciones[id] ?? ""}
                            placeholder="0"
                            onChange={(e) =>
                              setAplicaciones((a) => ({ ...a, [id]: e.target.value }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {datos.facturas.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-text-muted">
                        Este cliente no tiene facturas a crédito pendientes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {datos.facturas.length > 0 && (
              <Button className="mt-3" disabled={ocupado} onClick={abonar}>
                Registrar el abono y emitir el recibo
              </Button>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
