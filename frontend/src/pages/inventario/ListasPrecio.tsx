import { plural } from "../../lib/plural";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  LoadingState,
  Modal,
  Select,
  useToast,
  PageHeader,
} from "../../components/ui";
import {
  FilaPrecioMasivo,
  ItemListaPrecio,
  ListaPrecio,
  formatearMonto,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// LISTAS DE PRECIO — prompt 06, sección 2.
//
// Tres cosas en una pantalla porque son el mismo trabajo: ver qué
// listas hay, poner el precio de la lista ítem por ítem, y subir o
// bajar un conjunto por porcentaje.
//
// LA TABLA MUESTRA TODO LO VENDIBLE, no solo lo que la lista cubre. Una
// lista que solo muestra sus propios ítems esconde justamente lo que se
// está por revisar: qué quedó afuera. La columna «Precio de la lista»
// vacía significa "a precio base", y se dice con palabras.
//
// LA ACTUALIZACIÓN MASIVA NO APLICA SIN VISTA PREVIA. El botón de
// aplicar aparece recién cuando hay una previa en pantalla, y si se
// cambia cualquier parámetro la previa se descarta: autorizar un
// porcentaje y aplicar otro sería peor que no tener previa.
// ---------------------------------------------------------------------

const REDONDEOS = [
  { value: "colon", label: "Al colón" },
  { value: "cinco", label: "A los 5 colones" },
  { value: "decena", label: "A la decena" },
  { value: "ninguno", label: "Sin redondear" },
];

export function ListasPrecio() {
  const toast = useToast();
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const [elegida, setElegida] = useState<string>("");
  const [items, setItems] = useState<ItemListaPrecio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState("");

  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState({
    codigo: "",
    nombre: "",
    vigenteDesde: "",
    vigenteHasta: "",
  });

  // La actualización masiva. `previa` en null = todavía no se miró.
  const [masiva, setMasiva] = useState(false);
  const [alcance, setAlcance] = useState({
    destino: "base" as "base" | "lista",
    porcentaje: "10",
    incluirProductos: true,
    incluirServicios: true,
    redondeo: "colon",
  });
  const [previa, setPrevia] = useState<{
    filas: FilaPrecioMasivo[];
    cuantos: number;
    sinPrecio: number;
  } | null>(null);

  const recargarListas = async () => {
    const r = await inventarioApi.listasPrecio();
    setListas(r.listas);
    if (r.listas.length > 0 && !r.listas.some((l) => l.id === elegida)) {
      setElegida(r.listas[0].id);
    }
    return r.listas;
  };

  useEffect(() => {
    recargarListas()
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    if (!elegida) {
      setItems([]);
      return;
    }
    inventarioApi
      .itemsListaPrecio(elegida)
      .then((r) => setItems(r.items))
      .catch((err) => toast.error((err as Error).message));
  }, [elegida]);

  const lista = listas.find((l) => l.id === elegida);

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return q ? items.filter((i) => i.etiqueta.toLowerCase().includes(q)) : items;
  }, [items, filtro]);

  const conPrecioPropio = items.filter((i) => i.precioLista !== null).length;

  const crear = async () => {
    setOcupado(true);
    try {
      const r = await inventarioApi.crearListaPrecio(nueva);
      toast.exito("Lista creada. Ahora cargale los precios que reemplazan al base.");
      setCreando(false);
      setNueva({ codigo: "", nombre: "", vigenteDesde: "", vigenteHasta: "" });
      await recargarListas();
      setElegida(r.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const alternarActivo = async () => {
    if (!lista) return;
    setOcupado(true);
    try {
      await inventarioApi.editarListaPrecio(lista.id, { activo: !lista.activo });
      await recargarListas();
      toast.exito(
        lista.activo
          ? "Lista desactivada: a partir de ahora se cobra el precio base."
          : "Lista activada."
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const guardarItem = async (item: ItemListaPrecio, texto: string) => {
    const limpio = texto.trim().replace(",", ".");
    const precio = limpio === "" ? null : Number(limpio);
    if (precio !== null && !Number.isFinite(precio)) {
      toast.error("Ese precio no es un número.");
      return;
    }
    try {
      await inventarioApi.fijarItemListaPrecio(elegida, {
        presentacionId: item.presentacionId,
        servicioId: item.servicioId,
        precio,
      });
      setItems((xs) =>
        xs.map((x) => (x.etiqueta === item.etiqueta ? { ...x, precioLista: precio } : x))
      );
      await recargarListas();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const cuerpoMasivo = () => ({
    destino: alcance.destino,
    listaId: alcance.destino === "lista" ? elegida : null,
    porcentaje: Number(alcance.porcentaje.replace(",", ".")),
    incluirProductos: alcance.incluirProductos,
    incluirServicios: alcance.incluirServicios,
    redondeo: alcance.redondeo,
  });

  const verPrevia = async () => {
    setOcupado(true);
    try {
      setPrevia(await inventarioApi.vistaPreviaPrecios(cuerpoMasivo()));
    } catch (err) {
      toast.error((err as Error).message);
      setPrevia(null);
    } finally {
      setOcupado(false);
    }
  };

  const aplicar = async () => {
    setOcupado(true);
    try {
      const r = await inventarioApi.aplicarPrecios(cuerpoMasivo());
      toast.exito(`${plural(r.aplicadas, "precio actualizado", "precios actualizados")}.`);
      setMasiva(false);
      setPrevia(null);
      if (elegida) {
        const i = await inventarioApi.itemsListaPrecio(elegida);
        setItems(i.items);
      }
      await recargarListas();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  /** Cambiar cualquier parámetro invalida la previa, a propósito. */
  const cambiarAlcance = (cambios: Partial<typeof alcance>) => {
    setAlcance((a) => ({ ...a, ...cambios }));
    setPrevia(null);
  };

  if (cargando) return <LoadingState forma="tabla" cantidad={6} />;

  return (
    <div>
      <PageHeader
        titulo="Listas de precio"
        icono="plan"
        modulo="inventario"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mt-1 text-sm text-text-muted">
            El precio base vive en el producto y el servicio. Una lista lo <strong>reemplaza</strong>{" "}
            para los ítems que carga, mientras está vigente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMasiva(true)}>
            <Icono nombre="ajustes" className="mr-1 h-4 w-4" />
            Actualizar por porcentaje
          </Button>
          <Button onClick={() => setCreando(true)}>
            <Icono nombre="agregar" className="mr-1 h-4 w-4" />
            Nueva lista
          </Button>
        </div>
      </div>

      {listas.length === 0 ? (
        <Card className="mt-6">
          <CardTitle>Todavía no hay listas</CardTitle>
          <CardDescription>
            Sin listas se cobra el precio base, que es lo correcto para la mayoría de las clínicas.
            Una lista sirve para el precio de urgencia, el nocturno, el de fin de semana o el de un
            convenio.
          </CardDescription>
        </Card>
      ) : (
        <>
          <Card className="mt-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Lista"
                value={elegida}
                onChange={(e) => setElegida(e.target.value)}
                options={listas.map((l) => ({
                  value: l.id,
                  label: `${l.nombre} (${l.codigo})${l.activo ? "" : " — inactiva"}`,
                }))}
              />
              <Input
                label="Buscar en la tabla"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Nombre del producto o servicio"
              />
              <div className="flex items-end">
                {lista && (
                  <Button variant="secondary" disabled={ocupado} onClick={alternarActivo}>
                    {lista.activo ? "Desactivar" : "Activar"}
                  </Button>
                )}
              </div>
            </div>

            {lista && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <Badge variant={lista.vigenteHoy ? "success" : "warning"} dot>
                  {lista.vigenteHoy ? "Vigente hoy" : "No vigente hoy"}
                </Badge>
                <span className="text-text-muted">
                  {lista.vigenteDesde || lista.vigenteHasta
                    ? `Vigencia ${lista.vigenteDesde ?? "sin inicio"} → ${lista.vigenteHasta ?? "sin fin"}`
                    : "Sin vigencia limitada"}
                </span>
                <span className="text-text-muted">
                  {conPrecioPropio} de {items.length} ítems con precio propio
                </span>
              </div>
            )}

            {lista && !lista.vigenteHoy && (
              <p className="mt-3 rounded-lg bg-warning/10 p-3 text-sm text-text-primary">
                Esta lista no está vigente hoy: aunque la caja la tenga elegida, los cargos van a
                salir al <strong>precio base</strong>. Es a propósito — cobrar el precio de una
                lista vencida sería cobrar mal.
              </p>
            )}
          </Card>

          <Card className="mt-4">
            <CardTitle>Precios de la lista</CardTitle>
            <CardDescription>
              Se muestra todo lo vendible, no solo lo que la lista cubre. Un campo vacío significa
              que ese ítem se cobra al precio base.
            </CardDescription>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                    <th className="py-2">Producto o servicio</th>
                    <th className="py-2">Línea</th>
                    <th className="py-2 text-right">Precio base</th>
                    <th className="py-2 text-right">Precio de la lista</th>
                    <th className="py-2 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((i) => (
                    <tr key={i.etiqueta} className="border-b border-black/5">
                      <td className="py-2">
                        {i.etiqueta}
                        {i.servicioId && (
                          <span className="ml-2 text-xs text-text-muted">servicio</span>
                        )}
                      </td>
                      <td className="py-2 text-xs text-text-muted">{i.lineaNegocio ?? "—"}</td>
                      <td className="py-2 text-right">{formatearMonto(i.precioBase)}</td>
                      <td className="py-2 text-right">
                        <input
                          className="w-28 rounded-lg border border-black/10 bg-surface px-2 py-1 text-right text-sm"
                          defaultValue={i.precioLista ?? ""}
                          placeholder="base"
                          onBlur={(e) => {
                            const texto = e.target.value;
                            const actual = i.precioLista === null ? "" : String(i.precioLista);
                            if (texto.trim() !== actual) guardarItem(i, texto);
                          }}
                        />
                      </td>
                      <td className="py-2 text-right text-xs text-text-muted">
                        {i.precioLista === null || i.precioBase === 0
                          ? "—"
                          : `${(((i.precioLista - i.precioBase) / i.precioBase) * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-sm text-text-muted">
                        Nada que coincida con ese texto.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Modal
        open={creando}
        onClose={() => setCreando(false)}
        title="Nueva lista de precio"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreando(false)}>
              Cancelar
            </Button>
            <Button disabled={ocupado || !nueva.codigo || !nueva.nombre} onClick={crear}>
              Crear
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input
            label="Código"
            value={nueva.codigo}
            onChange={(e) => setNueva({ ...nueva, codigo: e.target.value })}
            placeholder="NOCTURNO"
          />
          <Input
            label="Nombre"
            value={nueva.nombre}
            onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
            placeholder="Tarifa nocturna"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-text-primary">Vigente desde</label>
              <input
                type="date"
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                value={nueva.vigenteDesde}
                onChange={(e) => setNueva({ ...nueva, vigenteDesde: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-text-primary">Vigente hasta</label>
              <input
                type="date"
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                value={nueva.vigenteHasta}
                onChange={(e) => setNueva({ ...nueva, vigenteHasta: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-text-muted">
            Las dos fechas son opcionales. Vacías, la lista vale mientras esté activa.
          </p>
        </div>
      </Modal>

      <Modal
        open={masiva}
        onClose={() => {
          setMasiva(false);
          setPrevia(null);
        }}
        title="Actualizar precios por porcentaje"
        ancho="xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setMasiva(false);
                setPrevia(null);
              }}
            >
              Cancelar
            </Button>
            <Button variant="secondary" disabled={ocupado} onClick={verPrevia}>
              Ver la vista previa
            </Button>
            <Button disabled={ocupado || previa === null || previa.cuantos === 0} onClick={aplicar}>
              Aplicar {previa ? `a ${previa.cuantos}` : ""}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label="Qué se actualiza"
              value={alcance.destino}
              onChange={(e) => cambiarAlcance({ destino: e.target.value as "base" | "lista" })}
              options={[
                { value: "base", label: "El precio base del catálogo" },
                {
                  value: "lista",
                  label: lista ? `La lista ${lista.nombre}` : "La lista elegida",
                },
              ]}
            />
            <Input
              label="Porcentaje"
              value={alcance.porcentaje}
              onChange={(e) => cambiarAlcance({ porcentaje: e.target.value })}
              placeholder="10 o −5"
            />
            <Select
              label="Redondeo"
              value={alcance.redondeo}
              onChange={(e) => cambiarAlcance({ redondeo: e.target.value })}
              options={REDONDEOS}
            />
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={alcance.incluirProductos}
                onChange={(e) => cambiarAlcance({ incluirProductos: e.target.checked })}
              />
              Productos
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={alcance.incluirServicios}
                onChange={(e) => cambiarAlcance({ incluirServicios: e.target.checked })}
              />
              Servicios
            </label>
          </div>

          {alcance.destino === "lista" && !elegida && (
            <p className="text-sm text-error">Primero hay que elegir una lista.</p>
          )}

          {previa === null ? (
            <p className="rounded-lg bg-background p-3 text-sm text-text-muted">
              Nada se aplica sin verlo antes. Apretá «Ver la vista previa» y el botón de aplicar se
              habilita. Si cambiás cualquier parámetro, la previa se descarta.
            </p>
          ) : (
            <>
              <p className="text-sm">
                <strong>{previa.cuantos}</strong> ítems entran en el alcance.
                {previa.sinPrecio > 0 && (
                  <span className="text-text-muted">
                    {" "}
                    {previa.sinPrecio} están en cero: un porcentaje sobre cero sigue siendo cero, así
                    que esos hay que cargarlos a mano.
                  </span>
                )}
              </p>
              <div className="max-h-72 overflow-auto rounded-lg border border-black/5">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                      <th className="px-3 py-2">Ítem</th>
                      <th className="px-3 py-2 text-right">Hoy</th>
                      <th className="px-3 py-2 text-right">Queda en</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.filas.map((f) => (
                      <tr key={`${f.presentacionId ?? f.servicioId}`} className="border-b border-black/5">
                        <td className="px-3 py-1.5">{f.etiqueta}</td>
                        <td className="px-3 py-1.5 text-right text-text-muted">
                          {formatearMonto(f.actual)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium">
                          {formatearMonto(f.nuevo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
