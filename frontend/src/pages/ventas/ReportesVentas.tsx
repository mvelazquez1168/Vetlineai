import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardDescription,
  CardTitle,
  LoadingState,
  Select,
  useToast,
} from "../../components/ui";
import { formatearMonto, ventasApi } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// Los cinco reportes del prompt, con su selector de período.
//
// Las columnas se derivan de lo que devuelve el backend en vez de
// declararse acá: cada reporte agrupa por algo distinto y una tabla
// escrita a mano por reporte sería cinco tablas que hay que tocar cada
// vez que el SQL cambia una columna.
//
// Los montos se detectan por el nombre de la columna. Es una
// convención y está dicha: una columna que se llame `total`, `monto`,
// `neto` o `pendiente` se formatea como dinero.
// ---------------------------------------------------------------------

const REPORTES = [
  { value: "ventas", label: "Ventas por cajero, caja y medio de pago" },
  { value: "lineas-negocio", label: "Ventas por línea de negocio" },
  { value: "arqueos", label: "Arqueos y diferencias" },
  { value: "aprobaciones", label: "Anulaciones, devoluciones y descuentos" },
  { value: "por-cobrar", label: "Cuentas por cobrar con antigüedad" },
];

const ETIQUETAS: Record<string, string> = {
  cajero: "Cajero",
  caja: "Caja",
  medio: "Medio",
  medio_nombre: "Medio de pago",
  cobros: "Cobros",
  total: "Total",
  linea: "Línea de negocio",
  neto: "Neto",
  lineas: "Líneas",
  cerrada_en: "Cerrada",
  diferencia_total: "Diferencia",
  medios_con_diferencia: "Medios con diferencia",
  tipo: "Tipo",
  estado: "Estado",
  monto: "Monto",
  motivo: "Motivo",
  solicitada_en: "Pedida",
  resuelta_en: "Resuelta",
  solicitada_por: "Pidió",
  resuelta_por: "Resolvió",
  cliente: "Cliente",
  pendiente: "Pendiente",
  mas_antigua: "Más antigua",
  antiguedad_max_dias: "Antigüedad (días)",
};

const ES_DINERO = /^(total|monto|neto|pendiente|diferencia_total)$/;
const ES_FECHA = /_en$|^mas_antigua$/;

function haceUnMes(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export function ReportesVentas() {
  const toast = useToast();
  const [cual, setCual] = useState("ventas");
  const [desde, setDesde] = useState(haceUnMes());
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10));
  const [filas, setFilas] = useState<Array<Record<string, string | number | null>>>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    ventasApi
      .reporte(cual, desde, hasta)
      .then((r) => setFilas(r.filas))
      .catch((err) => {
        toast.error(err.message);
        setFilas([]);
      })
      .finally(() => setCargando(false));
  }, [cual, desde, hasta]);

  const columnas = filas.length > 0 ? Object.keys(filas[0]).filter((c) => !c.endsWith("_id")) : [];

  const mostrar = (valor: string | number | null, columna: string) => {
    if (valor === null || valor === undefined) return "—";
    if (ES_DINERO.test(columna)) return formatearMonto(valor);
    if (ES_FECHA.test(columna)) {
      const d = new Date(String(valor));
      return Number.isNaN(d.getTime()) ? String(valor) : d.toLocaleDateString("es-CR");
    }
    return String(valor);
  };

  return (
    <div>
      <Link to="/ventas" className="text-sm text-text-muted hover:text-primary">
        ← Caja
      </Link>
      <h2 className="mt-2 text-xl font-bold text-primary">Reportes de ventas</h2>

      <Card className="mt-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Reporte"
            value={cual}
            onChange={(e) => setCual(e.target.value)}
            options={REPORTES}
          />
          <div>
            <label className="text-sm font-semibold text-text-primary">Desde</label>
            <input
              type="date"
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-text-primary">Hasta</label>
            <input
              type="date"
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle>{REPORTES.find((r) => r.value === cual)?.label}</CardTitle>
        <CardDescription>
          {cual === "por-cobrar"
            ? "El saldo pendiente no depende del período: es lo que se debe hoy."
            : `Del ${new Date(desde).toLocaleDateString("es-CR")} al ${new Date(hasta).toLocaleDateString("es-CR")}.`}
        </CardDescription>

        {cargando ? (
          <LoadingState forma="tabla" cantidad={5} />
        ) : filas.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">Sin datos en ese período.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                  {columnas.map((c) => (
                    <th
                      key={c}
                      className={ES_DINERO.test(c) ? "py-2 text-right" : "py-2"}
                    >
                      {ETIQUETAS[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i} className="border-b border-black/5">
                    {columnas.map((c) => (
                      <td key={c} className={ES_DINERO.test(c) ? "py-2 text-right" : "py-2"}>
                        {mostrar(f[c], c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-text-muted">
          La exportación a Excel y PDF todavía no está: se genera en el backend con los filtros
          aplicados y queda en la auditoría, y eso es trabajo propio. Ver el reporte del prompt 08.
        </p>
      </Card>
    </div>
  );
}
