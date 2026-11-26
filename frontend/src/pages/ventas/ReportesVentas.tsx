import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardDescription,
  CardTitle,
  LoadingState,
  MenuExportar,
  Select,
  useToast,
} from "../../components/ui";
import { guardarComoArchivo } from "../../lib/descargas";
import { formatearMonto, ventasApi } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// Los cinco reportes del prompt, con su selector de período.
//
// EL TÍTULO, LAS COLUMNAS Y SU TIPO LOS DECLARA EL BACKEND, al lado de
// la consulta que los produce. Antes esta pantalla derivaba las columnas
// de las claves de la primera fila y las etiquetaba con un diccionario
// propio, y adivinaba qué era dinero con una expresión regular sobre el
// nombre. Eso funcionaba, pero la exportación —que se arma en el
// backend— tenía su propia lista de columnas: dos listas que ya no
// coincidían (la tabla mostraba el código del medio de pago y el archivo
// no). El archivo y la pantalla tienen que decir lo mismo, y para eso
// hay una sola lista.
// ---------------------------------------------------------------------

const REPORTES = [
  { value: "ventas", label: "Ventas por cajero, caja y medio de pago" },
  { value: "lineas-negocio", label: "Ventas por línea de negocio" },
  { value: "arqueos", label: "Arqueos y diferencias" },
  { value: "aprobaciones", label: "Anulaciones, devoluciones y descuentos" },
  { value: "por-cobrar", label: "Cuentas por cobrar con antigüedad" },
];

interface Columna {
  clave: string;
  titulo: string;
  tipo?: "texto" | "numero" | "dinero" | "fecha";
}

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
  const [titulo, setTitulo] = useState("");
  const [columnas, setColumnas] = useState<Columna[]>([]);
  const [filas, setFilas] = useState<Array<Record<string, string | number | null>>>([]);
  const [ignoraPeriodo, setIgnoraPeriodo] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    ventasApi
      .reporte(cual, desde, hasta)
      .then((r) => {
        setTitulo(r.titulo);
        // Con `?? []` y no directo: una pantalla que se queda en blanco
        // porque el backend devolvió una forma vieja es peor que una
        // tabla vacía. Ya pasó al verificar esto en el navegador.
        setColumnas(r.columnas ?? []);
        setFilas(r.filas ?? []);
        setIgnoraPeriodo(!!r.ignoraPeriodo);
      })
      .catch((err) => {
        toast.error(err.message);
        setFilas([]);
      })
      .finally(() => setCargando(false));
  }, [cual, desde, hasta]);

  const exportar = async (formato: "excel" | "pdf") => {
    try {
      const { blob, filename } = await ventasApi.exportarReporte(cual, desde, hasta, formato);
      guardarComoArchivo(blob, filename ?? `reporte.${formato === "excel" ? "xlsx" : "pdf"}`);
      toast.exito("Descargado con el período que está aplicado.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const mostrar = (valor: string | number | null, col: Columna) => {
    if (valor === null || valor === undefined || valor === "") return "—";
    if (col.tipo === "dinero") return formatearMonto(valor);
    if (col.tipo === "fecha") {
      const d = new Date(String(valor));
      return Number.isNaN(d.getTime()) ? String(valor) : d.toLocaleDateString("es-CR");
    }
    return String(valor);
  };

  const aLaDerecha = (col: Columna) => col.tipo === "dinero" || col.tipo === "numero";

  return (
    <div>
      <Link to="/ventas" className="text-sm text-text-muted hover:text-primary">
        ← Caja
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-primary">Reportes de ventas</h2>
        <MenuExportar onExportar={exportar} deshabilitado={filas.length === 0} />
      </div>

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
        <CardTitle>{titulo || REPORTES.find((r) => r.value === cual)?.label}</CardTitle>
        <CardDescription>
          {ignoraPeriodo
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
                    <th key={c.clave} className={aLaDerecha(c) ? "py-2 text-right" : "py-2"}>
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i} className="border-b border-black/5">
                    {columnas.map((c) => (
                      <td key={c.clave} className={aLaDerecha(c) ? "py-2 text-right" : "py-2"}>
                        {mostrar(f[c.clave], c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-text-muted">
          La exportación se genera en el backend con el mismo cálculo, los mismos filtros y las
          mismas columnas que esta tabla: el archivo y la pantalla no pueden decir cosas distintas.
        </p>
      </Card>
    </div>
  );
}
