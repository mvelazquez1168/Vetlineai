import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import {
  CatalogosInventario,
  Presentacion,
  formatearCantidad,
  inventarioApi,
} from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// Alta y edición de un producto, con el CONSTRUCTOR DE PRESENTACIONES.
//
// Lo que hace que el constructor valga la pena: muestra la equivalencia
// EN VIVO ("1 caja = 20 tabletas"). El factor es el número que más se
// equivoca —es fácil escribir 20 pensando en cajas por bulto y no en
// tabletas por caja— y un factor mal puesto descuadra el inventario de
// forma silenciosa, porque cada venta descuenta una cantidad que parece
// razonable.
//
// La unidad base se escribe en palabras del mostrador ("tableta", "ml",
// "g") y NO sale del catálogo fiscal de Hacienda: ese catálogo es el de
// la FACTURA, y "tableta" no está ahí. La unidad fiscal se elige en la
// presentación, que es lo que se factura.
// ---------------------------------------------------------------------

interface FormaPresentacion {
  codigoInterno: string;
  nombre: string;
  factor: string;
  unidadMedida: string;
  precioVenta: string;
  paraCompra: boolean;
  paraVenta: boolean;
  paraConsumo: boolean;
}

function presentacionVacia(): FormaPresentacion {
  return {
    codigoInterno: "",
    nombre: "",
    factor: "1",
    unidadMedida: "Unid",
    precioVenta: "",
    paraCompra: false,
    paraVenta: true,
    paraConsumo: false,
  };
}

export function ProductoEditor() {
  const { id } = useParams();
  const esNuevo = !id || id === "nuevo";
  const navegar = useNavigate();
  const toast = useToast();

  const [catalogos, setCatalogos] = useState<CatalogosInventario | null>(null);
  const [cargando, setCargando] = useState(!esNuevo);
  const [guardando, setGuardando] = useState(false);
  const [presentacionesExistentes, setPresentacionesExistentes] = useState<Presentacion[]>([]);

  const [form, setForm] = useState<Record<string, string | boolean>>({
    codigo: "",
    nombre: "",
    principioActivo: "",
    concentracion: "",
    categoria: "",
    lineaNegocio: "farmacia",
    codigoCabys: "",
    codigoTarifaIva: "08",
    unidadBase: "",
    requiereReceta: false,
    esControlado: false,
    requiereRefrigeracion: false,
    vidaUtilAperturaDias: "",
    permiteStockNegativo: false,
    minimo: "0",
    puntoReorden: "0",
    // Posología sugerida (anexo 07-03, A3): lo que la receta precarga
    // al elegir este producto. Opcional entero.
    dosisPorKg: "",
    dosisFija: "",
    unidadDosis: "",
    viaAdministracion: "",
    frecuenciaSugerida: "",
    duracionSugeridaCantidad: "",
    duracionSugeridaUnidad: "dias",
    // Campos fiscales de la v4.4 (prompt 09b, B3): el comprobante los
    // incluye cuando la estructura los exige para ese tipo de línea.
    registroMedicamento: "",
    formaFarmaceutica: "",
    codigoComercial: "",
    codigoComercialTipo: "",
    partidaArancelaria: "",
  });

  const [nuevas, setNuevas] = useState<FormaPresentacion[]>([presentacionVacia()]);

  useEffect(() => {
    inventarioApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
  }, []);

  useEffect(() => {
    if (esNuevo) return;
    setCargando(true);
    inventarioApi
      .producto(id!)
      .then((d) => {
        const p = d.producto as Record<string, string | number | boolean | null>;
        setForm({
          codigo: String(p.codigo ?? ""),
          nombre: String(p.nombre ?? ""),
          principioActivo: String(p.principio_activo ?? ""),
          concentracion: String(p.concentracion ?? ""),
          categoria: String(p.categoria ?? ""),
          lineaNegocio: String(p.linea_negocio ?? "farmacia"),
          codigoCabys: String(p.codigo_cabys ?? ""),
          codigoTarifaIva: String(p.codigo_tarifa_iva ?? "08"),
          unidadBase: String(p.unidad_base ?? ""),
          requiereReceta: !!p.requiere_receta,
          registroMedicamento: String(p.registro_medicamento ?? ""),
          formaFarmaceutica: String(p.forma_farmaceutica ?? ""),
          codigoComercial: String(p.codigo_comercial ?? ""),
          codigoComercialTipo: String(p.codigo_comercial_tipo ?? ""),
          partidaArancelaria: String(p.partida_arancelaria ?? ""),
          dosisPorKg: p.dosis_por_kg === null || p.dosis_por_kg === undefined ? "" : String(p.dosis_por_kg),
          dosisFija: p.dosis_fija === null || p.dosis_fija === undefined ? "" : String(p.dosis_fija),
          unidadDosis: String(p.unidad_dosis ?? ""),
          viaAdministracion: String(p.via_administracion ?? ""),
          frecuenciaSugerida: String(p.frecuencia_sugerida ?? ""),
          duracionSugeridaCantidad:
            p.duracion_sugerida_cantidad === null || p.duracion_sugerida_cantidad === undefined
              ? ""
              : String(p.duracion_sugerida_cantidad),
          duracionSugeridaUnidad: String(p.duracion_sugerida_unidad ?? "dias"),
          esControlado: !!p.es_controlado,
          requiereRefrigeracion: !!p.requiere_refrigeracion,
          vidaUtilAperturaDias: p.vida_util_apertura_dias ? String(p.vida_util_apertura_dias) : "",
          permiteStockNegativo: !!p.permite_stock_negativo,
          minimo: String(p.minimo ?? "0"),
          puntoReorden: String(p.punto_reorden ?? "0"),
        });
        setPresentacionesExistentes(d.presentaciones.filter((x) => x.activo));
        setNuevas([]);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setCargando(false));
  }, [id, esNuevo]);

  const texto = (clave: string) => String(form[clave] ?? "");
  const marcado = (clave: string) => !!form[clave];
  const set = (clave: string, valor: string | boolean) =>
    setForm((f) => ({ ...f, [clave]: valor }));

  const problemas: string[] = [];
  if (!texto("codigo").trim()) problemas.push("Falta el código del producto.");
  if (!texto("nombre").trim()) problemas.push("Falta el nombre.");
  if (!texto("unidadBase").trim()) {
    problemas.push("Falta la unidad base: la más chica en que el producto se mueve.");
  }
  if (esNuevo && nuevas.filter((p) => p.nombre.trim()).length === 0) {
    problemas.push("Hace falta al menos una presentación: sin ella no se puede comprar ni vender.");
  }
  nuevas.forEach((p, i) => {
    if (!p.nombre.trim()) return;
    if (!p.codigoInterno.trim()) problemas.push(`Presentación ${i + 1}: falta el código interno.`);
    const f = Number(p.factor.replace(",", "."));
    if (!Number.isFinite(f) || f <= 0) {
      problemas.push(`Presentación ${i + 1}: el factor tiene que ser mayor que cero.`);
    }
  });

  const guardar = async () => {
    setGuardando(true);
    try {
      const cuerpo = {
        codigo: texto("codigo").trim(),
        nombre: texto("nombre").trim(),
        principioActivo: texto("principioActivo").trim() || null,
        concentracion: texto("concentracion").trim() || null,
        categoria: texto("categoria").trim() || null,
        lineaNegocio: texto("lineaNegocio"),
        codigoCabys: texto("codigoCabys").trim() || null,
        codigoTarifaIva: texto("codigoTarifaIva") || null,
        unidadBase: texto("unidadBase").trim(),
        requiereReceta: marcado("requiereReceta"),
        esControlado: marcado("esControlado"),
        requiereRefrigeracion: marcado("requiereRefrigeracion"),
        vidaUtilAperturaDias: texto("vidaUtilAperturaDias")
          ? Number(texto("vidaUtilAperturaDias"))
          : null,
        permiteStockNegativo: marcado("permiteStockNegativo"),
        minimo: Number(texto("minimo").replace(",", ".")) || 0,
        puntoReorden: Number(texto("puntoReorden").replace(",", ".")) || 0,
        // Vacío es null y no cero: «sin posología cargada» no es «dosis
        // cero», y el cero haría que la receta precargue un 0.
        dosisPorKg: texto("dosisPorKg") ? Number(texto("dosisPorKg").replace(",", ".")) : null,
        dosisFija: texto("dosisFija") ? Number(texto("dosisFija").replace(",", ".")) : null,
        unidadDosis: texto("unidadDosis").trim() || null,
        viaAdministracion: texto("viaAdministracion").trim() || null,
        frecuenciaSugerida: texto("frecuenciaSugerida").trim() || null,
        duracionSugeridaCantidad: texto("duracionSugeridaCantidad")
          ? Number(texto("duracionSugeridaCantidad"))
          : null,
        duracionSugeridaUnidad: texto("duracionSugeridaCantidad")
          ? texto("duracionSugeridaUnidad")
          : null,
        registroMedicamento: texto("registroMedicamento").trim() || null,
        formaFarmaceutica: texto("formaFarmaceutica").trim() || null,
        // EL CÓDIGO Y SU TIPO VAN JUNTOS: hay un CHECK en la base que lo
        // exige, porque el nodo del XML lleva los dos. Si falta uno, no
        // se manda ninguno.
        codigoComercial:
          texto("codigoComercial").trim() && texto("codigoComercialTipo")
            ? texto("codigoComercial").trim()
            : null,
        codigoComercialTipo:
          texto("codigoComercial").trim() && texto("codigoComercialTipo")
            ? texto("codigoComercialTipo")
            : null,
        partidaArancelaria: texto("partidaArancelaria").trim() || null,
      };

      const productoId = esNuevo
        ? (await inventarioApi.crearProducto(cuerpo)).id
        : (await inventarioApi.actualizarProducto(id!, cuerpo), id!);

      for (const p of nuevas.filter((x) => x.nombre.trim())) {
        await inventarioApi.crearPresentacion(productoId, {
          codigoInterno: p.codigoInterno.trim(),
          nombre: p.nombre.trim(),
          factor: Number(p.factor.replace(",", ".")),
          unidadMedida: p.unidadMedida,
          precioVenta: p.precioVenta ? Number(p.precioVenta.replace(",", ".")) : null,
          paraCompra: p.paraCompra,
          paraVenta: p.paraVenta,
          paraConsumo: p.paraConsumo,
        });
      }

      toast.exito(esNuevo ? "Producto creado." : "Producto actualizado.");
      navegar(`/inventario/productos/${productoId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" cantidad={2} />;

  const unidadBase = texto("unidadBase").trim() || "unidad base";

  return (
    <div>
      <PageHeader
        variante="compacta"
        titulo={esNuevo ? "Nuevo producto" : "Editar producto"}
        icono="producto"
        modulo="inventario"
        padre={{ a: "/inventario", etiqueta: "Catálogo" }}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Identificación</CardTitle>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Código interno"
              value={texto("codigo")}
              onChange={(e) => set("codigo", e.target.value)}
              disabled={!esNuevo}
              placeholder="MED-001"
            />
            <Input
              label="Nombre"
              value={texto("nombre")}
              onChange={(e) => set("nombre", e.target.value)}
              placeholder="Amoxicilina 500 mg"
            />
            <Input
              label="Principio activo"
              value={texto("principioActivo")}
              onChange={(e) => set("principioActivo", e.target.value)}
              placeholder="Amoxicilina"
            />
            <Input
              label="Concentración"
              value={texto("concentracion")}
              onChange={(e) => set("concentracion", e.target.value)}
              placeholder="500 mg"
            />
            <Input
              label="Categoría"
              value={texto("categoria")}
              onChange={(e) => set("categoria", e.target.value)}
              placeholder="Antibióticos"
            />
            <Select
              label="Línea de negocio"
              value={texto("lineaNegocio")}
              onChange={(e) => set("lineaNegocio", e.target.value)}
              options={(catalogos?.lineasNegocio ?? []).map((l) => ({
                value: l.codigo,
                label: l.nombre,
              }))}
            />
            <Input
              label="Unidad base"
              value={texto("unidadBase")}
              onChange={(e) => set("unidadBase", e.target.value)}
              placeholder="tableta, ml, g, unidad…"
              disabled={!esNuevo}
            />
            <div className="text-xs text-text-muted sm:pt-7">
              La más chica en que el producto se mueve. Todo el stock se guarda así.
              {!esNuevo && " No se cambia después: cambiarla reinterpretaría el stock que ya hay."}
            </div>
          </div>

          <CardTitle className="mt-6">Fiscal</CardTitle>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Código CABYS (13 dígitos)"
              value={texto("codigoCabys")}
              onChange={(e) => set("codigoCabys", e.target.value)}
              maxLength={13}
              placeholder="3564012000000"
            />
            <Select
              label="Tarifa de impuesto"
              value={texto("codigoTarifaIva")}
              onChange={(e) => set("codigoTarifaIva", e.target.value)}
              options={(catalogos?.tarifasIva ?? []).map((t) => ({
                value: t.codigo,
                label: t.nombre,
              }))}
            />
          </div>

          {/* POSOLOGÍA SUGERIDA (anexo 07-03, A3). Lo que la receta
              precarga al elegir este producto, para que el médico no
              tipee la misma dosis de amoxicilina todas las veces. Es
              una sugerencia editable, no una indicación. */}
          {/* ------------------- Campos fiscales de la v4.4 (B3) */}
          <CardTitle className="mt-6">Datos fiscales del producto (opcional)</CardTitle>
          <p className="mt-1 text-sm text-text-muted">
            Lo que la factura electrónica incluye cuando corresponde. Si el producto es un
            medicamento, Hacienda pide su número de registro del Ministerio de Salud y su forma
            farmacéutica.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Registro del Ministerio de Salud"
              value={String(form.registroMedicamento)}
              onChange={(e) => set("registroMedicamento", e.target.value)}
            />
            <Input
              label="Forma farmacéutica (código de 3)"
              value={String(form.formaFarmaceutica)}
              placeholder="INY, TAB…"
              maxLength={3}
              onChange={(e) => set("formaFarmaceutica", e.target.value.toUpperCase())}
            />
            <Input
              label="Código comercial"
              value={String(form.codigoComercial)}
              onChange={(e) => set("codigoComercial", e.target.value)}
            />
            <Select
              label="Tipo del código comercial"
              value={String(form.codigoComercialTipo)}
              onChange={(e) => set("codigoComercialTipo", e.target.value)}
              options={[
                { value: "", label: "Sin código comercial" },
                { value: "01", label: "01 — Del vendedor" },
                { value: "02", label: "02 — Del comprador" },
                { value: "03", label: "03 — De la industria" },
                { value: "04", label: "04 — De uso interno" },
                { value: "99", label: "99 — Otros" },
              ]}
            />
            <Input
              label="Partida arancelaria (12 caracteres, solo exportación)"
              className="sm:col-span-2"
              value={String(form.partidaArancelaria)}
              maxLength={12}
              onChange={(e) => set("partidaArancelaria", e.target.value)}
            />
          </div>

          <CardTitle className="mt-6">Posología sugerida (opcional)</CardTitle>
          <p className="mt-1 text-sm text-text-muted">
            Lo que se precarga al agregar este producto a una receta. El médico lo ajusta siempre.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Dosis por kilo"
              value={texto("dosisPorKg")}
              onChange={(e) => {
                set("dosisPorKg", e.target.value);
                // Las dos a la vez no se pueden: el CHECK de la base lo
                // impide, y conceptualmente una dosis es por kilo o es
                // fija, nunca las dos.
                if (e.target.value) set("dosisFija", "");
              }}
              placeholder="4"
            />
            <Input
              label="o dosis fija"
              value={texto("dosisFija")}
              onChange={(e) => {
                set("dosisFija", e.target.value);
                if (e.target.value) set("dosisPorKg", "");
              }}
              placeholder="1"
            />
            <Input
              label="Unidad de la dosis"
              value={texto("unidadDosis")}
              onChange={(e) => set("unidadDosis", e.target.value)}
              placeholder="mg, ml, tableta…"
            />
            <Input
              label="Vía de administración"
              value={texto("viaAdministracion")}
              onChange={(e) => set("viaAdministracion", e.target.value)}
              placeholder="oral, subcutanea…"
            />
            <Input
              label="Frecuencia"
              value={texto("frecuenciaSugerida")}
              onChange={(e) => set("frecuenciaSugerida", e.target.value)}
              placeholder="c24h, c12h…"
            />
            <div className="flex gap-2">
              <Input
                label="Duración"
                value={texto("duracionSugeridaCantidad")}
                onChange={(e) => set("duracionSugeridaCantidad", e.target.value)}
                placeholder="7"
              />
              <Select
                label="Unidad"
                value={texto("duracionSugeridaUnidad")}
                onChange={(e) => set("duracionSugeridaUnidad", e.target.value)}
                options={[
                  { value: "dias", label: "días" },
                  { value: "semanas", label: "semanas" },
                  { value: "meses", label: "meses" },
                ]}
              />
            </div>
          </div>

          <CardTitle className="mt-6">Manejo</CardTitle>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[
              ["requiereReceta", "Requiere receta"],
              ["esControlado", "Es controlado"],
              ["requiereRefrigeracion", "Requiere refrigeración"],
              ["permiteStockNegativo", "Admite stock negativo"],
            ].map(([clave, etiqueta]) => (
              <label key={clave} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={marcado(clave)}
                  onChange={(e) => set(clave, e.target.checked)}
                />
                {etiqueta}
              </label>
            ))}
            <Input
              label="Vida útil tras la apertura (días)"
              value={texto("vidaUtilAperturaDias")}
              onChange={(e) => set("vidaUtilAperturaDias", e.target.value)}
              placeholder="30"
            />
            <div className="text-xs text-text-muted sm:pt-7">
              Para multidosis, alcohol y soluciones. Al primer fraccionamiento queda registrada la
              apertura y su vencimiento efectivo.
            </div>
            <Input
              label={`Mínimo (en ${unidadBase})`}
              value={texto("minimo")}
              onChange={(e) => set("minimo", e.target.value)}
            />
            <Input
              label={`Punto de reorden (en ${unidadBase})`}
              value={texto("puntoReorden")}
              onChange={(e) => set("puntoReorden", e.target.value)}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Guardar</CardTitle>
          <Button
            className="mt-3 w-full"
            disabled={guardando || problemas.length > 0}
            onClick={guardar}
          >
            {guardando ? "Guardando…" : esNuevo ? "Crear producto" : "Guardar cambios"}
          </Button>
          {problemas.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-text-muted">
              {problemas.map((p, i) => (
                <li key={i}>· {p}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --------------------------------- Constructor de presentaciones */}
      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <CardTitle>Presentaciones</CardTitle>
          <Button variant="secondary" onClick={() => setNuevas((n) => [...n, presentacionVacia()])}>
            <Icono nombre="agregar" className="mr-1 h-4 w-4" />
            Agregar presentación
          </Button>
        </div>
        <CardDescription>
          Cada forma de comprar, vender o consumir, con cuántas unidades base equivale.
        </CardDescription>

        {presentacionesExistentes.length > 0 && (
          <ul className="mt-3 space-y-1">
            {presentacionesExistentes.map((pr) => (
              <li
                key={pr.id}
                className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{pr.nombre}</span>{" "}
                  <span className="text-text-muted">
                    — 1 {pr.nombre} = {formatearCantidad(pr.factor)} {unidadBase} ({pr.codigo_interno})
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs text-text-muted underline hover:text-error"
                  onClick={async () => {
                    await inventarioApi.borrarPresentacion(pr.id);
                    setPresentacionesExistentes((ps) => ps.filter((x) => x.id !== pr.id));
                    toast.exito("Presentación desactivada. Los movimientos viejos la conservan.");
                  }}
                >
                  desactivar
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 space-y-3">
          {nuevas.map((p, i) => {
            const factor = Number(p.factor.replace(",", "."));
            return (
              <div key={i} className="rounded-xl border border-black/5 p-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Input
                    label="Nombre"
                    value={p.nombre}
                    onChange={(e) =>
                      setNuevas((ns) => ns.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))
                    }
                    placeholder="Caja de 20 tabletas"
                  />
                  <Input
                    label="Código interno"
                    value={p.codigoInterno}
                    onChange={(e) =>
                      setNuevas((ns) =>
                        ns.map((x, j) => (j === i ? { ...x, codigoInterno: e.target.value } : x))
                      )
                    }
                    placeholder="1001"
                  />
                  <Input
                    label={`Equivale a … ${unidadBase}`}
                    value={p.factor}
                    onChange={(e) =>
                      setNuevas((ns) => ns.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))
                    }
                    placeholder="20"
                  />
                  <Select
                    label="Unidad de medida (factura)"
                    value={p.unidadMedida}
                    onChange={(e) =>
                      setNuevas((ns) =>
                        ns.map((x, j) => (j === i ? { ...x, unidadMedida: e.target.value } : x))
                      )
                    }
                    options={(catalogos?.unidadesMedida ?? []).map((u) => ({
                      value: u.codigo,
                      label: `${u.codigo} — ${u.descripcion}`,
                    }))}
                  />
                  <Input
                    label="Precio de venta"
                    value={p.precioVenta}
                    onChange={(e) =>
                      setNuevas((ns) =>
                        ns.map((x, j) => (j === i ? { ...x, precioVenta: e.target.value } : x))
                      )
                    }
                    placeholder="5000"
                  />
                  <div className="flex flex-wrap items-center gap-3 text-sm sm:pt-7">
                    {([
                      ["paraCompra", "Compra"],
                      ["paraVenta", "Venta"],
                      ["paraConsumo", "Consumo"],
                    ] as Array<[keyof FormaPresentacion, string]>).map(([clave, etiqueta]) => (
                      <label key={clave} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!p[clave]}
                          onChange={(e) =>
                            setNuevas((ns) =>
                              ns.map((x, j) => (j === i ? { ...x, [clave]: e.target.checked } : x))
                            )
                          }
                        />
                        {etiqueta}
                      </label>
                    ))}
                  </div>
                  <div className="sm:col-span-2 lg:col-span-2 flex items-center justify-between">
                    {/* La equivalencia EN VIVO. Es el número que más se
                        equivoca, y verlo escrito evita el error. */}
                    <p className="text-sm font-medium text-accent">
                      {p.nombre.trim() && factor > 0
                        ? `1 ${p.nombre.trim()} = ${formatearCantidad(factor)} ${unidadBase}`
                        : "Escribí el nombre y el factor para ver la equivalencia."}
                    </p>
                    <button
                      type="button"
                      className="text-xs text-text-muted underline"
                      onClick={() => setNuevas((ns) => ns.filter((_, j) => j !== i))}
                    >
                      quitar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {nuevas.length === 0 && (
            <p className="text-sm text-text-muted">
              Sin presentaciones nuevas. Agregá una si hace falta otra forma de venderlo.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
