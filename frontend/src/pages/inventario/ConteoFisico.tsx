import { plural } from "../../lib/plural";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Input,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import {
  Bodega,
  CatalogosInventario,
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
    presentaciones: Array<{ id: string; producto_id: string; nombre: string; factor: string }>;
  } | null>(null);
  const [contado, setContado] = useState<Record<string, string>>({});
  // En qué presentación se contó cada línea. Vacío = en unidad base.
  // La conversión la hace el backend: contar "2 cajas" y que la
  // pantalla multiplique por 20 sería la misma regla en dos lugares.
  const [presentacionPorLinea, setPresentacionPorLinea] = useState<Record<string, string>>({});
  /** Lo contado YA convertido a unidad base, como lo devolvió el backend. */
  const [contadoBase, setContadoBase] = useState<Record<string, number>>({});
  const [catalogos, setCatalogos] = useState<CatalogosInventario | null>(null);
  const [grupo, setGrupo] = useState({ criterio: "linea_negocio", valor: "" });

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
    inventarioApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
    recargar();
  }, []);

  const abrirConteo = async (tipo: "total" | "ciclico" | "grupo") => {
    setOcupado(true);
    try {
      const r = await inventarioApi.abrirConteo({
        bodegaId,
        tipo,
        ...(tipo === "grupo"
          ? {
              grupoCriterio: grupo.criterio,
              grupoValor: grupo.criterio === "controlados" ? undefined : grupo.valor,
            }
          : {}),
      });
      toast.exito(
        `Conteo abierto con ${plural(r.lineas, "línea", "líneas")}. La existencia quedó congelada: lo que se venda ahora no va a aparecer como diferencia.`
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
      const r = await inventarioApi.anotarConteo(abierto.conteo.id, lineaId, {
        cantidad: valor,
        presentacionId: presentacionPorLinea[lineaId] || undefined,
      });
      // Se guarda lo que el backend convirtió, no lo tecleado: así la
      // diferencia que muestra la fila está en unidad base, que es la
      // única comparable con lo que decía el sistema.
      setContadoBase((c) => ({ ...c, [lineaId]: r.cantidadBase }));
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
          ? `Conteo cerrado sin diferencias.${r.sinContar > 0 ? ` Quedaron ${plural(r.sinContar, "línea", "líneas")} sin contar, que no se tocaron.` : ""}`
          : `Conteo cerrado con ${plural(r.diferencias.length, "diferencia", "diferencias")}. Se pidió el ajuste correspondiente; si supera el umbral, espera aprobación.`
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
            {new Date(c.creado_en).toLocaleDateString("es-CR")} ·{" "}
            {c.tipo === "grupo"
              ? `grupo: ${c.grupo_valor ?? c.grupo_criterio}`
              : c.tipo}
          </span>
          <span className="block text-xs text-text-muted">
            {c.bodega}
            {c.tipo === "grupo" && c.grupo_criterio
              ? ` · por ${c.grupo_criterio.replace("_", " ")}`
              : ""}
          </span>
        </button>
      ),
    },
    {
      key: "avance",
      header: "Avance",
      render: (c) => (
        <span className="text-sm">
          {c.contadas} de {plural(c.lineas, "línea", "líneas")}
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
      <h2 className="mt-2 text-xl font-bold text-primary">Toma física</h2>

      <Card className="mt-6">
        <CardTitle>Abrir un conteo</CardTitle>
        <CardDescription>
          Al abrirlo se congela la existencia de la bodega, lote por lote. Eso es lo que después se
          compara con lo contado.
        </CardDescription>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Select
            name="conteo-bodega"
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

        {/* ------------------------------------------ Por grupo */}
        <div className="mt-4 rounded-xl border border-black/5 p-3">
          <p className="text-sm font-semibold text-text-primary">Contar un grupo</p>
          <p className="mt-1 text-xs text-text-muted">
            Contar todo de una vez es raro: lo normal es "hoy, farmacia". El conteo queda marcado
            con el grupo que abarcó, así que seis meses después se sabe qué se contó y qué no. Lo
            que queda afuera <strong>no se toca</strong>.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Select
              name="grupo-criterio"
              label="Agrupar por"
              value={grupo.criterio}
              onChange={(e) => setGrupo({ criterio: e.target.value, valor: "" })}
              options={[
                { value: "linea_negocio", label: "Línea de negocio" },
                { value: "categoria", label: "Categoría" },
                { value: "controlados", label: "Solo los controlados" },
              ]}
            />
            {grupo.criterio === "linea_negocio" && (
              <Select
                name="grupo-valor"
                label="Línea"
                value={grupo.valor}
                onChange={(e) => setGrupo({ ...grupo, valor: e.target.value })}
                options={[
                  { value: "", label: "Elegí la línea" },
                  ...(catalogos?.lineasNegocio ?? []).map((l) => ({
                    value: l.codigo,
                    label: l.nombre,
                  })),
                ]}
              />
            )}
            {grupo.criterio === "categoria" && (
              <Input
                name="grupo-valor"
                label="Categoría"
                value={grupo.valor}
                onChange={(e) => setGrupo({ ...grupo, valor: e.target.value })}
                placeholder="Tal como está escrita en el producto"
              />
            )}
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={
                  ocupado ||
                  !bodegaId ||
                  (grupo.criterio !== "controlados" && !grupo.valor)
                }
                onClick={() => abrirConteo("grupo")}
              >
                Contar el grupo
              </Button>
            </div>
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
                  <th className="py-2">Se contó en</th>
                  <th className="py-2 text-right">Contado</th>
                  <th className="py-2 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {abierto.lineas.map((l) => {
                  const id = String(l.id);
                  const sistema = Number(l.cantidad_sistema);
                  const valor = contado[id] ?? "";
                  const presElegida = presentacionPorLinea[id] ?? "";
                  const factorElegido = Number(
                    (abierto.presentaciones ?? []).find((pr) => pr.id === presElegida)?.factor ?? 1
                  );
                  // La diferencia se calcula sobre la BASE: lo que el
                  // backend devolvió si ya se anotó, y el estimado con
                  // el factor mientras se está tecleando.
                  const base =
                    contadoBase[id] ??
                    (valor === "" ? null : Number(valor.replace(",", ".")) * factorElegido);
                  const dif = base === null ? null : base - sistema;
                  return (
                    <tr key={id} className="border-b border-black/5">
                      <td className="py-2 font-medium">{l.producto}</td>
                      <td className="py-2">{l.lote ?? "—"}</td>
                      <td className="py-2 text-right">
                        {formatearCantidad(sistema)} {l.unidad_base}
                      </td>
                      <td className="py-2">
                        <select
                          className="rounded-lg border border-black/10 bg-surface px-2 py-1 text-xs"
                          value={presElegida}
                          disabled={abierto.conteo.estado !== "abierto"}
                          onChange={(e) => {
                            setPresentacionPorLinea((m) => ({ ...m, [id]: e.target.value }));
                            // Cambiar la presentación invalida lo
                            // convertido: "2" en cajas no es "2" en
                            // tabletas, y mostrar la diferencia vieja
                            // sería mentir hasta el próximo blur.
                            setContadoBase((c) => {
                              const { [id]: _, ...resto } = c;
                              return resto;
                            });
                          }}
                        >
                          <option value="">{l.unidad_base} (unidad base)</option>
                          {(abierto.presentaciones ?? [])
                            .filter((pr) => pr.producto_id === l.producto_id)
                            .map((pr) => (
                              <option key={pr.id} value={pr.id}>
                                {pr.nombre} (×{Number(pr.factor)})
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="py-2 text-right">
                        <input
                          className="w-28 rounded-lg border border-black/10 bg-surface px-2 py-1 text-right"
                          value={valor}
                          disabled={abierto.conteo.estado !== "abierto"}
                          onChange={(e) => setContado((c) => ({ ...c, [id]: e.target.value }))}
                          onBlur={() => anotar(id)}
                        />
                        {base !== null && presElegida && (
                          <span className="block text-xs text-text-muted">
                            = {formatearCantidad(base)} {l.unidad_base}
                          </span>
                        )}
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
