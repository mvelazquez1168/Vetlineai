import { useEffect, useState } from "react";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";
import { useFormularioSucio } from "../../hooks/useFormularioSucio";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { fechaHoyEnZona, formatearFecha, ZONA_HORARIA_PLATAFORMA } from "../../lib/formatFecha";
import { platformAdminApi, RentabilidadClinica, SaldoProveedorIa as SaldoProveedorIaTipo } from "../../lib/platformAdminApi";

// prompt_code_panel_consumo_sin_api — la cuenta de Anthropic es individual,
// sin acceso a la API de administración. Todo lo que este panel muestra
// como "saldo" o "días restantes" es una ESTIMACIÓN derivada de datos
// propios (recargas registradas menos consumo ya calculado en uso_api),
// nunca el número real de la consola del proveedor — de ahí el badge en
// cada cifra y el control manual del Bloque 1 para contrastarla.
// Pantalla de plataforma, sin tenant — zona de referencia de plataforma,
// nunca la del navegador (mismo bug de fondo que el reporte de atenciones).
const hoyISO = () => fechaHoyEnZona(ZONA_HORARIA_PLATAFORMA);

function Estimacion({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
      {children}
    </span>
  );
}

function GraficoConsumoDiario({ datos }: { datos: { fecha: string; costoUsd: number }[] }) {
  const max = Math.max(...datos.map((d) => d.costoUsd), 0.01);
  const ancho = 720;
  const alto = 140;
  const anchoBarra = ancho / datos.length;

  return (
    <svg width="100%" viewBox={`0 0 ${ancho} ${alto}`} className="text-accent" preserveAspectRatio="none">
      {datos.map((d, i) => {
        const h = (d.costoUsd / max) * (alto - 4);
        return (
          <rect
            key={d.fecha}
            x={i * anchoBarra + 1}
            y={alto - h}
            width={Math.max(anchoBarra - 2, 1)}
            height={h}
            fill="currentColor"
            opacity={0.85}
          >
            <title>
              {d.fecha}: USD {d.costoUsd.toFixed(2)}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

const BUCKET_LABEL: Record<string, string> = {
  plan: "Crédito de plan",
  comprado: "Crédito comprado",
  prueba: "Pruebas gratuitas",
  colchon: "Colchón sin saldar",
  otro: "Otro / sin resolver",
};

export function SaldoProveedorIa() {
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const [datos, setDatos] = useState<SaldoProveedorIaTipo | null>(null);
  const [clinicas, setClinicas] = useState<RentabilidadClinica[]>([]);
  const [periodoDias, setPeriodoDias] = useState(30);
  const [isLoading, setIsLoading] = useState(true);

  const [fechaControl, setFechaControl] = useState(hoyISO());
  const [saldoObservado, setSaldoObservado] = useState("");
  const [notaControl, setNotaControl] = useState("");
  const [guardandoControl, setGuardandoControl] = useState(false);
  const [errorControl, setErrorControl] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    Promise.all([platformAdminApi.obtenerSaldoProveedorIa(), platformAdminApi.obtenerRentabilidadClinicas()])
      .then(([saldo, rentabilidad]) => {
        setDatos(saldo);
        setClinicas(rentabilidad.clinicas);
        setPeriodoDias(rentabilidad.periodoDias);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const saldoObservadoNum = Number(saldoObservado);
  const controlValido = saldoObservado !== "" && Number.isFinite(saldoObservadoNum) && saldoObservadoNum >= 0;

  const registrarControl = async () => {
    if (!controlValido || !fechaControl) return;
    setGuardandoControl(true);
    setErrorControl(null);
    try {
      await platformAdminApi.registrarControlSaldoProveedorIa({
        fecha: fechaControl,
        saldoObservadoUsd: saldoObservadoNum,
        nota: notaControl.trim() || undefined,
      });
      setSaldoObservado("");
      setNotaControl("");
      setFechaControl(hoyISO());
      cargar();
    } catch (err) {
      setErrorControl(err instanceof Error ? err.message : "No pudimos registrar el control.");
    } finally {
      setGuardandoControl(false);
    }
  };

  if (isLoading || !datos) return <p className="text-text-muted">Cargando…</p>;

  const totalBolsas =
    datos.desgloseBolsas.plan +
    datos.desgloseBolsas.comprado +
    datos.desgloseBolsas.prueba +
    datos.desgloseBolsas.colchon +
    datos.desgloseBolsas.otro;

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>}>
      {dialogoSalida}
      <h1 className="text-2xl font-bold text-primary">Saldo del proveedor de IA</h1>
      <p className="mt-1 text-text-muted">
        La cuenta de Anthropic es individual: no hay API de administración que exponga el saldo o el consumo real.
        Todo lo marcado como <Estimacion>estimado</Estimacion> se deriva de las recargas registradas y del costo que
        la plataforma ya calculó en cada consumo — no es el número de la consola del proveedor.
      </p>

      {/* Bloque 1 — ¿Me quedo sin crédito? */}
      <Card className="mt-6">
        <CardTitle>¿Me quedo sin crédito?</CardTitle>
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-text-muted">
              Saldo derivado <Estimacion>estimado</Estimacion>
            </p>
            <p className="mt-1 text-3xl font-bold text-text-primary">USD {datos.saldoDerivadoUsd.toFixed(2)}</p>
            <p className="mt-1 text-xs text-text-muted">
              {datos.origenDerivacion === "sin_datos"
                ? "Sin recargas registradas todavía."
                : datos.origenDerivacion === "control"
                ? `Calculado desde el último control manual (${datos.desdeFecha ? formatearFecha(datos.desdeFecha, undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—"}).`
                : `Calculado desde la primera recarga registrada (${datos.desdeFecha ? formatearFecha(datos.desdeFecha, undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—"}).`}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted">
              Días de saldo restante <Estimacion>estimado</Estimacion>
            </p>
            <p className="mt-1 text-3xl font-bold text-text-primary">
              {datos.diasProyeccion === null ? "—" : Math.floor(datos.diasProyeccion)}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {datos.diasProyeccion === null
                ? "Sin consumo reciente para proyectar un ritmo."
                : `A un ritmo de USD ${datos.ritmoDiarioUsd.toFixed(2)}/día (últimos 7 días).`}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold text-text-primary">Consumo diario — últimos 30 días</p>
          <div className="mt-2">
            <GraficoConsumoDiario datos={datos.consumoDiario} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-black/5 pt-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-text-primary">Última recarga</p>
            {datos.ultimaRecarga ? (
              <p className="mt-1 text-sm text-text-muted">
                USD {datos.ultimaRecarga.montoUsd.toFixed(2)} —{" "}
                {formatearFecha(datos.ultimaRecarga.fecha, undefined, { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-muted">Todavía no se registró ninguna.</p>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">Último control manual</p>
            {datos.ultimoControl ? (
              <p className="mt-1 text-sm text-text-muted">
                Observado USD {datos.ultimoControl.saldoObservadoUsd.toFixed(2)} —{" "}
                {formatearFecha(datos.ultimoControl.fecha, undefined, { day: "2-digit", month: "short", year: "numeric" })} · diferencia{" "}
                <span
                  className={
                    Math.abs(datos.ultimoControl.diferenciaUsd) < 0.01
                      ? "font-semibold text-success"
                      : "font-semibold text-error"
                  }
                >
                  USD {datos.ultimoControl.diferenciaUsd.toFixed(2)}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-muted">Todavía no se registró ningún control.</p>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-black/5 pt-4">
          <p className="text-sm font-semibold text-text-primary">Registrar control manual</p>
          <p className="mt-1 text-xs text-text-muted">
            Lo más valioso del panel: cargue el saldo que ves en la consola de Anthropic para esta fecha y comparalo
            contra lo derivado. Si difieren, hay una tarifa mal cargada o consumo sin registrar.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Fecha del control"
              type="date"
              value={fechaControl}
              onChange={(e) => setFechaControl(e.target.value)}
              max={hoyISO()}
            />
            <Input
              label="Saldo observado (USD)"
              type="number"
              min={0}
              step="0.01"
              value={saldoObservado}
              onChange={(e) => setSaldoObservado(e.target.value)}
              error={saldoObservado && !controlValido ? "El saldo debe ser mayor o igual a cero." : undefined}
            />
            <Input label="Nota (opcional)" value={notaControl} onChange={(e) => setNotaControl(e.target.value)} />
          </div>
          {errorControl && <p className="mt-2 text-sm text-error">{errorControl}</p>}
          <div className="mt-3 flex justify-end">
            <Button onClick={registrarControl} disabled={!controlValido || !fechaControl || guardandoControl}>
              {guardandoControl ? "Guardando…" : "Registrar control"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Bloque 2 — ¿De dónde sale el consumo? */}
      <Card className="mt-6">
        <CardTitle>¿De dónde sale el consumo? (últimos 30 días)</CardTitle>
        <div className="mt-4 space-y-3">
          {(["plan", "comprado", "prueba", "colchon", "otro"] as const).map((bucket) => {
            const monto = datos.desgloseBolsas[bucket];
            const pct = totalBolsas > 0 ? (monto / totalBolsas) * 100 : 0;
            return (
              <div key={bucket}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-text-primary">{BUCKET_LABEL[bucket]}</span>
                  <span className="text-text-muted">
                    USD {monto.toFixed(2)} ({pct.toFixed(0)}%)
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/5">
                  <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-text-muted">Total del período: USD {totalBolsas.toFixed(2)}</p>
      </Card>

      {/* Bloque 3 — ¿Qué clínica me conviene? */}
      <Card className="mt-6">
        <CardTitle>¿Qué clínica me conviene? (últimos {periodoDias} días)</CardTitle>
        {clinicas.length === 0 ? (
          <p className="mt-4 text-text-muted">No hay clínicas activas en este período.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-black/5">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-background/60">
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Clínica</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Ingreso</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Costo IA</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Bonif.</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Comisión</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Margen</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">% ingreso en IA</th>
                  <th className="px-4 py-2 text-xs font-bold uppercase text-primary">Señales</th>
                </tr>
              </thead>
              <tbody>
                {clinicas.map((c) => (
                  <tr key={c.tenantId} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 font-semibold text-text-primary">{c.nombre}</td>
                    <td className="px-4 py-3">USD {c.ingresoUsd.toFixed(2)}</td>
                    <td className="px-4 py-3">USD {c.costoIaUsd.toFixed(2)}</td>
                    <td className="px-4 py-3 text-text-muted">USD {c.bonificacionUsd.toFixed(2)}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {c.comisionConocida ? `USD ${c.comisionUsd.toFixed(2)}` : "Sin dato"}
                    </td>
                    <td className={["px-4 py-3 font-semibold", c.margenUsd >= 0 ? "text-success" : "text-error"].join(" ")}>
                      USD {c.margenUsd.toFixed(2)}
                      {c.margenSinComision && <span className="ml-1 text-xs font-normal text-text-muted">(sin comisión)</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.proporcionIaSobreIngreso === null ? "—" : `${(c.proporcionIaSobreIngreso * 100).toFixed(0)}%`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {c.senalConsumoCercaDeIngreso && (
                          <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-semibold text-error">
                            Consumo cerca del ingreso
                          </span>
                        )}
                        {c.senalBajoConsumoRelativo && (
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                            Usa poco su crédito incluido
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
