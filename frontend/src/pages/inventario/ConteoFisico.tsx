import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import {
  Bodega,
  Conteo,
  formatearCantidad,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// Conteos físicos.
//
// Abrir un conteo CONGELA lo que el sistema cree que hay. Esa es la
// propiedad que hace que sirva: entre que alguien empieza a contar y
// termina, la clínica sigue vendiendo, y comparar contra la existencia
// del momento de cerrar convertiría cada venta en una diferencia falsa.
//
// Cerrar NO ajusta solo: pide un ajuste, que pasa por el mismo umbral
// de aprobación que cualquier otro.
// ---------------------------------------------------------------------

export function ConteoFisico() {
  const toast = useToast();
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [conteos, setConteos] = useState<Conteo[]>([]);
  const [bodegaId, setBodegaId] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const [abierto, setAbierto] = useState<{
    conteo: Conteo;
    lineas: Array<Record<string, string | null>>;
  } | null>(null);
  const [contado, setContado] = useState<Record<string, string>>({});

  const recargar = () =>
    inventarioApi.conteos().then((r) => setConteos(r.conteos)).catch(() => setConteos([]));

  useEffect(() => {
    inventarioApi
      .bodegas()
      .then((r) => {
        setBodegas(r.bodegas);
        const def = r.bodegas.find((b) => b.es_default) ?? r.bodegas[0];
        if (def) setBodegaId(def.id);
      })
      .catch(() => setBodegas([]));
    recargar();
  }, []);

  const abrirConteo = async (tipo: "total" | "ciclico") => {
    setOcupado(true);
    try {
      const r = await inventarioApi.abrirConteo({ bodegaId, tipo });
      toast.exito(
        `Conteo abierto con ${r.lineas} línea(s). La existencia quedó congelada: lo que se venda ahora no va a aparecer como diferencia.`
      );
      await recargar();
      await abrir(r.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const abrir = async (id: string) => {
    try {
      const d = await inventarioApi.conteo(id);
      setAbierto(d);
      const inicial: Record<string, string> = {};
      for (const l of d.lineas) {
        inicial[String(l.id)] = l.cantidad_contada_base ?? "";
      }
      setContado(inicial);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const anotar = async (lineaId: string) => {
    if (!abierto) return;
    const valor = contado[lineaId];
    if (valor === "" || valor === undefined) return;
    try {
      await inventarioApi.anotarConteo(abierto.conteo.id, lineaId, { cantidad: valor });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const cerrar = async () => {
    if (!abierto) return;
    setOcupado(true);
    try {
      const r = await inventarioApi.cerrarConteo(abierto.conteo.id);
      toast.exito(
        r.diferencias.length === 0
          ? `Conteo cerrado sin diferencias.${r.sinContar > 0 ? ` Quedaron ${r.sinContar} línea(s) sin contar, que no se tocaron.` : ""}`
          : `Conteo cerrado con ${r.diferencias.length} diferencia(s). Se pidió el ajuste correspondiente; si supera el umbral, espera aprobación.`
      );
      setAbierto(null);
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<Conteo>[] = [
    {
      key: "fecha",
      header: "Conteo",
      render: (c) => (
        <button type="button" className="text-left hover:underline" onClick={() => abrir(c.id)}>
          <span className="font-medium text-primary">
            {new Date(c.creado_en).toLocaleDateString("es-CR")} · {c.tipo}
          </span>
          <span className="block text-xs text-text-muted">{c.bodega}</span>
        </button>
      ),
    },
    {
      key: "avance",
      header: "Avance",
      render: (c) => (
        <span className="text-sm">
          {c.contadas} de {c.lineas} línea(s)
        </span>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (c) => (
        <Badge variant={c.estado === "abierto" ? "warning" : "neutral"} dot>
          {c.estado}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <Link to="/inventario" className="text-sm text-text-muted hover:text-primary">
        ← Catálogo
      </Link>
      <h2 className="mt-2 text-xl font-bold text-primary">Conteo físico</h2>

      <Card className="mt-6">
        <CardTitle>Abrir un conteo</CardTitle>
        <CardDescription>
          Al abrirlo se congela la existencia de la bodega, lote por lote. Eso es lo que después se
          compara con lo contado.
        </CardDescription>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Select
            label="Bodega"
            value={bodegaId}
            onChange={(e) => setBodegaId(e.target.value)}
            options={bodegas.map((b) => ({ value: b.id, label: b.nombre }))}
          />
          <div className="flex items-end">
            <Button className="w-full" disabled={ocupado || !bodegaId} onClick={() => abrirConteo("total")}>
              Conteo total
            </Button>
          </div>
          <div className="flex items-end">
            <Button
              variant="secondary"
              className="w-full"
              disabled
              title="El conteo cíclico por clasificación ABC necesita la clasificación, que todavía no se calcula."
            >
              Conteo cíclico (ABC)
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          El conteo cíclico queda deshabilitado a propósito: la clasificación ABC se calcula con la
          rotación, y eso llega con los dashboards. Habilitarlo sin ella haría que "contar los A"
          no signifique nada.
        </p>
      </Card>

      {abierto && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              Contando — {abierto.conteo.bodega} ({abierto.conteo.estado})
            </CardTitle>
            {abierto.conteo.estado === "abierto" && (
              <Button disabled={ocupado} onClick={cerrar}>
                Cerrar y pedir el ajuste
              </Button>
            )}
          </div>
          <CardDescription>
            Lo que no se cuente queda sin tocar: no contar algo no es decir que hay cero.
          </CardDescription>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                  <th className="py-2">Producto</th>
                  <th className="py-2">Lote</th>
                  <th className="py-2 text-right">Decía el sistema</th>
                  <th className="py-2 text-right">Contado</th>
                  <th className="py-2 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {abierto.lineas.map((l) => {
                  const id = String(l.id);
                  const sistema = Number(l.cantidad_sistema);
                  const valor = contado[id] ?? "";
                  const dif = valor === "" ? null : Number(valor.replace(",", ".")) - sistema;
                  return (
                    <tr key={id} className="border-b border-black/5">
                      <td className="py-2 font-medium">{l.producto}</td>
                      <td className="py-2">{l.lote ?? "—"}</td>
                      <td className="py-2 text-right">
                        {formatearCantidad(sistema)} {l.unidad_base}
                      </td>
                      <td className="py-2 text-right">
                        <input
                          className="w-28 rounded-lg border border-black/10 bg-surface px-2 py-1 text-right"
                          value={valor}
                          disabled={abierto.conteo.estado !== "abierto"}
                          onChange={(e) => setContado((c) => ({ ...c, [id]: e.target.value }))}
                          onBlur={() => anotar(id)}
                        />
                      </td>
                      <td className="py-2 text-right">
                        {dif === null ? (
                          <span className="text-text-muted">sin contar</span>
                        ) : dif === 0 ? (
                          <span className="text-success">cuadra</span>
                        ) : (
                          <span className="font-semibold text-error">
                            {dif > 0 ? "+" : ""}
                            {formatearCantidad(dif)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <CardTitle>Conteos</CardTitle>
        <div className="mt-3">
          <Table
            columns={columnas}
            data={conteos}
            rowKey={(c) => c.id}
            emptyMessage="Todavía no se hizo ningún conteo."
          />
        </div>
      </Card>
    </div>
  );
}
