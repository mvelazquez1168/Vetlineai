import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Table } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { MenuExportar } from "../../components/ui/MenuExportar";
import { Pagination } from "../../components/ui/Pagination";
import { useToast } from "../../components/ui/Toast";
import { guardarComoArchivo } from "../../lib/descargas";
import { ListaMetrica, metricasApi } from "../../lib/metricasApi";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { useAuth } from "../../hooks/useAuth";

// ---------------------------------------------------------------------
// LA LISTA QUE COMPONE UN NÚMERO — prompt 12, §7.
//
// UNA SOLA PANTALLA PARA TODAS LAS LISTAS. Las columnas, el título y la
// columna que suma vienen del backend: la pantalla no sabe qué es un
// comprobante ni qué es un cargo fugado, y por eso una lista nueva no
// necesita una pantalla nueva.
//
// LOS FILTROS VIVEN EN LA URL. Es lo que permite mandarle el enlace a
// alguien, y que el botón «atrás» del navegador vuelva al dashboard con
// el período que estaba puesto. Guardarlos en el estado del componente
// haría que al volver se perdieran.
//
// ARRIBA DE TODO, EL TOTAL, y debajo la suma de lo que se está viendo:
// el total es de la lista completa, no de la página. Si la página
// mostrara su propia suma como total, no coincidiría con la tarjeta.
// ---------------------------------------------------------------------

function formatearCelda(
  valor: unknown,
  tipo: string | undefined,
  zona: string | null
): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (tipo === "dinero") {
    return new Intl.NumberFormat("es-CR", {
      style: "currency",
      currency: "CRC",
      maximumFractionDigits: 0,
    }).format(Number(valor));
  }
  if (tipo === "numero") return new Intl.NumberFormat("es-CR").format(Number(valor));
  if (tipo === "fecha") return formatearFechaCorta(String(valor), zona);
  return String(valor);
}

export function ListaDeMetrica() {
  const { clave = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { zonaHoraria } = useAuth();

  const desde = params.get("desde") ?? new Date().toISOString().slice(0, 10);
  const hasta = params.get("hasta") ?? new Date().toISOString().slice(0, 10);
  const pagina = Number(params.get("pagina") ?? 1);

  const [datos, setDatos] = useState<ListaMetrica | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await metricasApi.lista(clave, desde, hasta, pagina));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista.");
    } finally {
      setCargando(false);
    }
  }, [clave, desde, hasta, pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const exportar = async (formato: "excel" | "pdf") => {
    try {
      const blob = await metricasApi.exportarLista(clave, desde, hasta, formato);
      guardarComoArchivo(blob, `${clave}-${desde}-${hasta}.${formato === "excel" ? "xlsx" : "pdf"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo exportar.");
    }
  };

  const total = datos?.total ?? 0;
  const sumaPagina = datos?.columnaSuma
    ? datos.filas.reduce((s, f) => s + Number(f[datos.columnaSuma!] ?? 0), 0)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={datos?.titulo ?? "Detalle"}
        subtitulo={
          datos?.sinPeriodo
            ? "Saldo de hoy: el período no afecta esta lista"
            : `Del ${formatearFechaCorta(desde, zonaHoraria)} al ${formatearFechaCorta(hasta, zonaHoraria)}`
        }
        icono="reportes"
        modulo="admin"
        accion={<MenuExportar onExportar={exportar} deshabilitado={!datos || datos.cantidad === 0} />}
        secundarias={
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Volver
          </Button>
        }
      />

      {/* EL TOTAL DE LA LISTA COMPLETA, que es el número del que se vino.
          Se muestra arriba para poder compararlo de un vistazo con la
          tarjeta: es la verificación que cualquiera puede hacer sin
          mirar el código. */}
      <div className="rounded-2xl border border-black/5 bg-surface p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
          Total de la lista
        </p>
        <p className="mt-1 text-2xl font-bold text-text-primary">
          {datos?.columnaSuma
            ? new Intl.NumberFormat("es-CR", {
                style: "currency",
                currency: "CRC",
                maximumFractionDigits: 0,
              }).format(total)
            : new Intl.NumberFormat("es-CR").format(total)}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {datos?.cantidad ?? 0} fila(s)
          {sumaPagina !== null && datos && datos.cantidad > datos.filas.length
            ? ` · en esta página se ve ${new Intl.NumberFormat("es-CR", {
                style: "currency",
                currency: "CRC",
                maximumFractionDigits: 0,
              }).format(sumaPagina)}`
            : ""}
        </p>
      </div>

      {cargando && <LoadingState />}
      {error && <EmptyState titulo="No se pudo cargar" texto={error} icono="aviso" />}

      {!cargando && !error && datos && datos.filas.length === 0 && (
        <EmptyState
          titulo="No hay nada en este período"
          texto="Probá con un período más amplio."
          icono="reportes"
        />
      )}

      {!cargando && datos && datos.filas.length > 0 && (
        <>
          <Table
            columns={[
              ...datos.columnas.map((c) => ({
                key: c.clave,
                header: c.etiqueta,
                // Los números a la derecha: una columna de montos
                // alineada a la izquierda no se puede comparar de un
                // vistazo, que es para lo que se mira una lista de
                // montos.
                className:
                  c.tipo === "dinero" || c.tipo === "numero"
                    ? "px-6 py-4 text-right tabular-nums"
                    : undefined,
                render: (fila: Record<string, unknown>) =>
                  formatearCelda(fila[c.clave], c.tipo, zonaHoraria),
              })),
              // DE CADA FILA SE LLEGA AL REGISTRO. Es la segunda mitad
              // del drill-down: sin esto la lista explica el número pero
              // no deja hacer nada con él.
              {
                key: "_ir",
                header: "",
                render: (fila: Record<string, unknown>) =>
                  fila._destino ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(String(fila._destino))}
                    >
                      Ver →
                    </Button>
                  ) : null,
              },
            ]}
            data={datos.filas}
            rowKey={(f) => String(f.id ?? JSON.stringify(f))}
            emptyMessage="Sin filas"
          />

          {datos.cantidad > datos.porPagina && (
            <Pagination
              pagina={datos.pagina}
              porPagina={datos.porPagina}
              total={datos.cantidad}
              onPagina={(p) => {
                const siguiente = new URLSearchParams(params);
                siguiente.set("pagina", String(p));
                setParams(siguiente);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
