import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Input,
  Modal,
  Select,
  useToast,
} from "../ui";
import { Icono } from "../ui/Icono";
import {
  LineaRecetaCalculada,
  ProductoClinico,
  RecetaDeAtencion,
  ResumenCierre,
  TipoClinico,
  atencionApi,
} from "../../lib/expedienteApi";
import { apiFetchFile } from "../../lib/api";
import { getStoredToken } from "../../hooks/useAuth";
import { plural } from "../../lib/plural";

// ---------------------------------------------------------------------
// LAS ACCIONES CON NOMBRE — prompt 07c, secciones 1, 2 y 3.
//
// Antes todo entraba por «Producto» y había que marcar «¿es un
// preventivo?» en una casilla dentro del modal. Funcionaba, y nadie lo
// encontraba. Ahora hay una acción por cada cosa que el médico hace, y
// cada una pide exactamente lo suyo:
//
//   * Vacuna y desparasitación exigen LOTE —una cartilla sin lote no
//     sirve— y sugieren la próxima fecha del protocolo.
//   * La receta pide posología y permite texto libre, que es lo que el
//     cliente compra afuera.
//   * El estudio crea la orden ligada a esta atención.
//
// Ninguna de las tres inventa un camino nuevo para el dinero ni para el
// stock: todas terminan en el mismo `agregarItem` de siempre.
// ---------------------------------------------------------------------

export interface OpcionCatalogo {
  id: string;
  codigo: string;
  etiqueta: string;
  horas: number | null;
}

/** Los catálogos clínicos, cargados una vez por pantalla. */
export function useCatalogosClinicos() {
  const [cat, setCat] = useState<Record<string, OpcionCatalogo[]>>({});
  useEffect(() => {
    atencionApi
      .catalogosClinicos()
      .then((c) => setCat(c as Record<string, OpcionCatalogo[]>))
      .catch(() => setCat({}));
  }, []);
  return cat;
}

// =====================================================================
// VACUNA Y DESPARASITACIÓN
// =====================================================================

export function ModalPreventivo({
  abierto,
  tipo,
  atencionId,
  pacienteEspecie,
  onCerrar,
  onAgregado,
}: {
  abierto: boolean;
  tipo: "vacunacion" | "desparasitacion";
  atencionId: string;
  pacienteEspecie: string;
  onCerrar: () => void;
  onAgregado: () => void;
}) {
  const toast = useToast();
  const [productos, setProductos] = useState<ProductoClinico[]>([]);
  const [elegido, setElegido] = useState<ProductoClinico | null>(null);
  const [loteId, setLoteId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [nombre, setNombre] = useState("");
  const [subtipo, setSubtipo] = useState<"interna" | "externa">("interna");
  const [proxima, setProxima] = useState("");
  const [origenProxima, setOrigenProxima] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const esVacuna = tipo === "vacunacion";

  useEffect(() => {
    if (!abierto) return;
    atencionApi
      .catalogoClinico(esVacuna ? "vacuna" : "antiparasitario")
      .then((r) => setProductos(r.productos))
      .catch(() => setProductos([]));
  }, [abierto, esVacuna]);

  const elegir = async (p: ProductoClinico) => {
    setElegido(p);
    // EL LOTE SUGERIDO ES EL DE FEFO, que es el que de verdad va a
    // salir. Preseleccionarlo evita que el número de la cartilla sea
    // uno y el del inventario otro.
    setLoteId(p.lotes[0]?.id ?? "");
    setNombre(p.nombre);
    try {
      const sug = await atencionApi.proximaSugerida({
        tipo,
        especie: pacienteEspecie,
        productoId: p.productoId,
        nombre: p.nombre,
      });
      setProxima(sug.fecha ?? "");
      setOrigenProxima(sug.origen);
    } catch {
      setProxima("");
      setOrigenProxima(null);
    }
  };

  const agregar = async () => {
    if (!elegido) return;
    if (!loteId) {
      toast.error("Elija el lote: una vacuna sin lote no sirve en la cartilla.");
      return;
    }
    setOcupado(true);
    try {
      await atencionApi.agregarItem(atencionId, {
        tipo: esVacuna ? "vacuna" : "desparasitacion",
        presentacionId: elegido.presentacionId,
        loteId,
        cantidad: Number(cantidad) || 1,
        preventivo: {
          tipo,
          nombre: nombre || elegido.nombre,
          subtipo: esVacuna ? undefined : subtipo,
          proxima: proxima || null,
        },
      });
      toast.exito(`${esVacuna ? "Vacuna" : "Desparasitación"} registrada.`);
      setElegido(null);
      onAgregado();
      onCerrar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal
      open={abierto}
      onClose={() => {
        setElegido(null);
        onCerrar();
      }}
      title={esVacuna ? "Aplicar una vacuna" : "Registrar una desparasitación"}
      description={
        esVacuna
          ? "Solo aparecen los productos marcados como vacuna en el catálogo."
          : "Solo aparecen los antiparasitarios del catálogo."
      }
      ancho="lg"
      footer={
        elegido && (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setElegido(null)}>
              Elegir otro
            </Button>
            <Button onClick={() => void agregar()} disabled={ocupado}>
              Registrar
            </Button>
          </div>
        )
      }
    >
      {!elegido ? (
        productos.length === 0 ? (
          <div className="rounded-lg border border-black/10 p-4 text-sm text-text-muted">
            <p className="font-medium text-text-primary">
              No hay {esVacuna ? "vacunas" : "antiparasitarios"} en el catálogo.
            </p>
            <p className="mt-1">
              Un producto aparece acá cuando tiene su <strong>tipo clínico</strong> puesto en el
              catálogo de inventario. Sin eso, el sistema no puede saber que es{" "}
              {esVacuna ? "una vacuna" : "un antiparasitario"}.
            </p>
          </div>
        ) : (
          <ul className="max-h-80 overflow-auto rounded-lg border border-black/10">
            {productos.map((p) => (
              <li key={p.presentacionId}>
                <button
                  type="button"
                  onClick={() => void elegir(p)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
                >
                  <span className="font-medium">
                    {p.nombre} — {p.presentacion}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {p.lotes.length > 0
                      ? `${plural(p.lotes.length, "lote", "lotes")} con existencia · el primero vence ${
                          p.lotes[0].vence ?? "sin fecha"
                        }`
                      : "Sin existencia: no se puede aplicar lo que no hay"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-text-primary">
            {elegido.nombre} — {elegido.presentacion}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={esVacuna ? "Nombre en la cartilla" : "Nombre del producto"}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            <Select
              label="Lote (obligatorio)"
              value={loteId}
              onChange={(e) => setLoteId(e.target.value)}
              options={[
                { value: "", label: "Elija el lote" },
                ...elegido.lotes.map((l, i) => ({
                  value: l.id,
                  label: `${l.numero}${l.vence ? ` · vence ${l.vence}` : ""}${
                    i === 0 ? " · sugerido" : ""
                  }`,
                })),
              ]}
            />
            <Input
              label="Cantidad"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
            {!esVacuna && (
              <Select
                label="Tipo"
                value={subtipo}
                onChange={(e) => setSubtipo(e.target.value as "interna" | "externa")}
                options={[
                  { value: "interna", label: "Interna" },
                  { value: "externa", label: "Externa" },
                ]}
              />
            )}
            <div>
              <label className="text-sm font-semibold text-text-primary">Próxima</label>
              <input
                type="date"
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                value={proxima}
                onChange={(e) => setProxima(e.target.value)}
              />
              <p className="mt-1 text-xs text-text-muted">
                {origenProxima
                  ? `Sugerida por ${origenProxima}. Se puede cambiar.`
                  : "No hay protocolo para esto: indique la fecha, o el aviso nunca se dispara."}
              </p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// =====================================================================
// EL ESTUDIO
// =====================================================================

// El modal de laboratorio se mudó a `ModalLaboratorio.tsx` con el anexo
// 07-03 (A6): dejó de ser «pedir un estudio» para ser «registrar un
// laboratorio», y lo usan dos pantallas (la atención y la pestaña
// Laboratorio del expediente), no una.

// =====================================================================
// LA RECETA
// =====================================================================

export function PanelReceta({
  abierto,
  atencionId,
  pacienteId,
  onCerrar,
  onCambio,
}: {
  abierto: boolean;
  atencionId: string;
  pacienteId: string;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const toast = useToast();
  const cat = useCatalogosClinicos();
  const [receta, setReceta] = useState<RecetaDeAtencion | null>(null);
  const [productos, setProductos] = useState<ProductoClinico[]>([]);
  const [anteriores, setAnteriores] = useState<
    Array<{ id: string; fecha: string; medico: string; lineas: number; resumen: string }>
  >([]);
  const [ocupado, setOcupado] = useState(false);

  // La línea que se está escribiendo.
  const [origen, setOrigen] = useState<"catalogo" | "libre">("catalogo");
  const [presentacionId, setPresentacionId] = useState("");
  const [textoLibre, setTextoLibre] = useState("");
  const [dosisCantidad, setDosisCantidad] = useState("");
  const [dosisUnidad, setDosisUnidad] = useState("mg");
  const [dosisPorKg, setDosisPorKg] = useState(true);
  const [viaCodigo, setViaCodigo] = useState("oral");
  const [frecuenciaCodigo, setFrecuenciaCodigo] = useState("c12h");
  const [duracionCantidad, setDuracionCantidad] = useState("7");
  const [duracionUnidad, setDuracionUnidad] = useState<"dias" | "semanas" | "meses">("dias");
  const [dispensadoAqui, setDispensadoAqui] = useState(false);
  const [cantidadDispensada, setCantidadDispensada] = useState("1");
  // Qué campos se llenaron solos desde la posología del producto
  // (anexo 07-03, A3). Sirve para decirlo en pantalla: un campo que se
  // llenó sin que nadie lo tocara tiene que verse distinto de uno que
  // el médico escribió.
  const [sugeridos, setSugeridos] = useState<string[]>([]);

  /**
   * Elegir un producto PRECARGA su posología (anexo 07-03, A3).
   *
   * Las columnas estaban en `inv_productos` desde la migración 111 y no
   * las leía nadie: el médico tipeaba la misma dosis de amoxicilina
   * todas las veces. Es una sugerencia editable, no una indicación: se
   * marca cuáles campos vinieron del catálogo y cualquiera se cambia.
   */
  const elegirPresentacion = (id: string) => {
    setPresentacionId(id);
    const producto = productos.find((p) => p.presentacionId === id);
    const pos = producto?.posologia;
    if (!pos) {
      setSugeridos([]);
      return;
    }
    const puestos: string[] = [];
    if (pos.dosisPorKg !== null) {
      setDosisCantidad(String(pos.dosisPorKg));
      setDosisPorKg(true);
      puestos.push("dosis");
    } else if (pos.dosisFija !== null) {
      setDosisCantidad(String(pos.dosisFija));
      setDosisPorKg(false);
      puestos.push("dosis");
    }
    if (pos.unidadDosis) {
      setDosisUnidad(pos.unidadDosis);
      puestos.push("unidad");
    }
    if (pos.viaAdministracion) {
      setViaCodigo(pos.viaAdministracion);
      puestos.push("via");
    }
    if (pos.frecuencia) {
      setFrecuenciaCodigo(pos.frecuencia);
      puestos.push("frecuencia");
    }
    if (pos.duracionCantidad !== null) {
      setDuracionCantidad(String(pos.duracionCantidad));
      if (pos.duracionUnidad) setDuracionUnidad(pos.duracionUnidad);
      puestos.push("duracion");
    }
    setSugeridos(puestos);
  };

  const recargar = () => {
    atencionApi
      .receta(atencionId)
      .then(setReceta)
      .catch(() => setReceta(null));
  };

  useEffect(() => {
    if (!abierto) return;
    recargar();
    atencionApi
      .catalogoClinico("medicamento")
      .then((r) => setProductos(r.productos))
      .catch(() => setProductos([]));
    atencionApi
      .recetasAnteriores(pacienteId, atencionId)
      .then((r) => setAnteriores(r.recetas))
      .catch(() => setAnteriores([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, atencionId, pacienteId]);

  // LA CUENTA EN VIVO, antes de agregar: el médico ve el resultado
  // mientras escribe la dosis, no después de guardarla.
  const pesoKg = receta?.pesoKg ?? null;

  // DE DÓNDE SALIÓ EL PESO, dicho en la pantalla (anexo 07-03, A3).
  // «Las dosis se calculan con 32,4 kg» no se puede revisar si no se
  // sabe que esos kilos son de la visita del año pasado.
  const procedenciaDelPeso = (() => {
    if (!receta || pesoKg === null) return null;
    switch (receta.pesoOrigen) {
      case "dictado":
        return "del dictado de hoy, todavía sin aceptar";
      case "atencion_actual":
        return "pesado en esta consulta";
      case "ultima_atencion":
        return receta.pesoAntiguedadDias !== null
          ? `de la visita anterior, hace ${receta.pesoAntiguedadDias} ${
              receta.pesoAntiguedadDias === 1 ? "día" : "días"
            }`
          : "de una visita anterior";
      default:
        return null;
    }
  })();
  const cantidadNum = Number(dosisCantidad);
  const previsualizacion =
    dosisPorKg && pesoKg && cantidadNum > 0
      ? `${cantidadNum} ${dosisUnidad}/kg × ${pesoKg} kg = ${Math.round(cantidadNum * pesoKg * 100) / 100} ${dosisUnidad}`
      : null;

  const agregar = async () => {
    setOcupado(true);
    try {
      await atencionApi.agregarLineaReceta(atencionId, {
        presentacionId: origen === "catalogo" ? presentacionId || null : null,
        textoLibre: origen === "libre" ? textoLibre || null : null,
        dosisCantidad: dosisCantidad ? Number(dosisCantidad) : null,
        dosisUnidad,
        dosisPorKg,
        viaCodigo,
        frecuenciaCodigo,
        duracionCantidad: duracionCantidad ? Number(duracionCantidad) : null,
        duracionUnidad,
        dispensadoAqui: origen === "catalogo" ? dispensadoAqui : false,
        cantidadDispensada:
          origen === "catalogo" && dispensadoAqui ? Number(cantidadDispensada) || 1 : null,
      });
      setTextoLibre("");
      setPresentacionId("");
      setDosisCantidad("");
      recargar();
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const quitar = async (lineaId: string) => {
    try {
      await atencionApi.quitarLineaReceta(atencionId, lineaId);
      recargar();
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const imprimir = async () => {
    setOcupado(true);
    try {
      const { blob, filename } = await apiFetchFile(
        `/expediente/atenciones/${atencionId}/receta.pdf`,
        { token: getStoredToken() }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? "receta.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async () => {
    setOcupado(true);
    try {
      const r = await atencionApi.enviarReceta(atencionId);
      if (r.enviado) {
        toast.exito(`Receta enviada a ${r.destinatario}.`);
      } else {
        // NO se dice "enviado" cuando no salio: el bloqueo por
        // consentimiento o por falta de correo es informacion que la
        // clinica necesita, no un detalle que esconder.
        toast.error(r.motivo ?? "No se pudo enviar.");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const repetir = async (recetaId: string) => {
    setOcupado(true);
    try {
      const r = await atencionApi.repetirReceta(atencionId, recetaId);
      toast.exito(
        r.recalculadas > 0
          ? `Se copiaron ${plural(r.copiadas, "línea", "líneas")} y se recalcularon ${r.recalculadas} con el peso de hoy.`
          : `Se copiaron ${plural(r.copiadas, "línea", "líneas")}.`
      );
      recargar();
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const vias = cat.via_administracion ?? [];
  const frecuencias = cat.frecuencia ?? [];
  const unidades = cat.unidad_dosis ?? [];

  return (
    <Modal
      open={abierto}
      onClose={onCerrar}
      title="Receta"
      description={
        pesoKg
          ? `Las dosis por kilo se calculan con ${pesoKg} kg${
              procedenciaDelPeso ? ` (${procedenciaDelPeso})` : ""
            }. La receta se firma al cerrar la atención.`
          : "Sin peso registrado no se pueden calcular dosis por kilo. La receta se firma al cerrar la atención."
      }
      ancho="xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* IMPRIMIR Y ENVIAR. Se pueden usar con la receta en
              borrador: el propietario a veces se lleva el papel antes
              de que la atencion se cierre, y negarselo por un estado
              interno del sistema no tiene sentido. Lo que la firma
              cambia es que despues solo admite adendas. */}
          {(receta?.lineas.length ?? 0) > 0 && (
            <>
              <Button variant="secondary" onClick={() => void imprimir()} disabled={ocupado}>
                <Icono nombre="pdf" className="mr-1 h-4 w-4" />
                Imprimir
              </Button>
              <Button variant="secondary" onClick={() => void enviar()} disabled={ocupado}>
                <Icono nombre="campana" className="mr-1 h-4 w-4" />
                Enviar al propietario
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={onCerrar}>
            Listo
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {receta && receta.avisos.length > 0 && (
          <div className="rounded-lg border border-error/30 bg-error/10 p-3">
            <p className="text-sm font-semibold text-error">
              Este paciente tiene una alergia registrada
            </p>
            <ul className="mt-1 space-y-1 text-xs text-error">
              {receta.avisos.map((a, i) => (
                <li key={i}>
                  {a.linea} — coincide por {a.porque} · {a.severidad}
                  {a.detalle ? ` · ${a.detalle}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* «NO HAY AVISO» PUEDE QUERER DECIR DOS COSAS. El aviso por
            grupo farmacológico sale del catálogo de medicamentos, y un
            producto del inventario sin medicamento ligado no tiene
            grupo. Callarlo haría creer que se comprobó. */}
        {receta && receta.sinGrupoFarmacologico.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-text-primary">
            <p className="font-semibold">El aviso por grupo farmacológico no se pudo comprobar</p>
            <p className="mt-0.5 text-text-muted">
              {receta.sinGrupoFarmacologico.join(", ")} — sin medicamento ligado en el catálogo, el
              sistema no sabe a qué grupo pertenece. Las alergias por sustancia sí se revisaron.
            </p>
          </div>
        )}

        {/* --- Las líneas que ya están --- */}
        {receta && receta.lineas.length > 0 && (
          <div className="space-y-2">
            {receta.lineas.map((l) => (
              <LineaEnLista key={l.id} linea={l} onQuitar={() => void quitar(l.id)} />
            ))}
          </div>
        )}

        {/* --- La línea nueva --- */}
        <div className="rounded-xl border border-black/10 p-3">
          <div className="flex gap-2">
            <Button
              variant={origen === "catalogo" ? "primary" : "secondary"}
              onClick={() => setOrigen("catalogo")}
            >
              Del inventario
            </Button>
            <Button
              variant={origen === "libre" ? "primary" : "secondary"}
              onClick={() => setOrigen("libre")}
            >
              Texto libre
            </Button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {origen === "catalogo" ? (
              <Select
                label="Medicamento"
                value={presentacionId}
                onChange={(e) => elegirPresentacion(e.target.value)}
                options={[
                  { value: "", label: "Elija del inventario" },
                  ...productos.map((p) => ({
                    value: p.presentacionId,
                    label: `${p.nombre} — ${p.presentacion}`,
                  })),
                ]}
              />
            ) : (
              <Input
                label="Medicamento"
                value={textoLibre}
                onChange={(e) => setTextoLibre(e.target.value)}
                placeholder="Lo que la clínica no vende"
              />
            )}

            {/* LA SUGERENCIA SE DICE, no se disimula (anexo 07-03, A3).
                Un campo que se llenó solo y no avisa es un campo que el
                médico da por suyo y no revisa. */}
            {sugeridos.length > 0 && (
              <p className="sm:col-span-2 -mt-1 text-xs text-info">
                Dosis, vía, frecuencia y duración vienen de la posología que la clínica cargó para
                este producto. Son una sugerencia: cambiá lo que no corresponda.
              </p>
            )}

            {/* EL PESO VIEJO NO BLOQUEA, AVISA. Con un peso de hace
                meses la dosis sale igual, y lo único que no puede pasar
                es que nadie se entere. */}
            {receta?.pesoViejo && (
              <p className="sm:col-span-2 -mt-1 text-xs font-semibold text-warning">
                El peso con el que se calcula es de hace {receta.pesoAntiguedadDias} días. Si el
                paciente cambió, pesalo antes de recetar.
              </p>
            )}

            <div className="flex gap-2">
              <Input
                label="Dosis"
                value={dosisCantidad}
                onChange={(e) => {
                  setDosisCantidad(e.target.value);
                  // Tocado a mano: deja de ser una sugerencia.
                  setSugeridos((s) => s.filter((x) => x !== "dosis"));
                }}
              />
              <Select
                label="Unidad"
                value={dosisUnidad}
                onChange={(e) => setDosisUnidad(e.target.value)}
                options={unidades.map((u) => ({ value: u.codigo, label: u.etiqueta }))}
              />
            </div>

            <Select
              label="Vía"
              value={viaCodigo}
              onChange={(e) => setViaCodigo(e.target.value)}
              options={vias.map((v) => ({ value: v.codigo, label: v.etiqueta }))}
            />
            <Select
              label="Frecuencia"
              value={frecuenciaCodigo}
              onChange={(e) => setFrecuenciaCodigo(e.target.value)}
              options={frecuencias.map((f) => ({ value: f.codigo, label: f.etiqueta }))}
            />
            <div className="flex gap-2">
              <Input
                label="Duración"
                value={duracionCantidad}
                onChange={(e) => setDuracionCantidad(e.target.value)}
              />
              <Select
                label="Unidad"
                value={duracionUnidad}
                onChange={(e) =>
                  setDuracionUnidad(e.target.value as "dias" | "semanas" | "meses")
                }
                options={[
                  { value: "dias", label: "días" },
                  { value: "semanas", label: "semanas" },
                  { value: "meses", label: "meses" },
                ]}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={dosisPorKg}
                onChange={(e) => setDosisPorKg(e.target.checked)}
                className="h-4 w-4 rounded border-black/20"
              />
              La dosis es por kilo
            </label>
            {origen === "catalogo" && (
              <label className="flex items-center gap-2 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={dispensadoAqui}
                  onChange={(e) => setDispensadoAqui(e.target.checked)}
                  className="h-4 w-4 rounded border-black/20"
                />
                Se dispensa en la clínica (genera su cargo y descuenta stock)
              </label>
            )}
          </div>

          {/* CUANTO SE ENTREGA, aparte de cuantas tomas son. La cuenta
              de las tomas no se puede usar como cantidad de la
              presentacion: 14 tomas no son 14 cajas. */}
          {origen === "catalogo" && dispensadoAqui && (
            <div className="mt-3 flex items-end gap-3">
              <Input
                label="Cuántas se entregan"
                value={cantidadDispensada}
                onChange={(e) => setCantidadDispensada(e.target.value)}
              />
              <p className="pb-2 text-xs text-text-muted">
                Presentaciones (cajas, frascos), no tomas. Esto es lo que se cobra y lo que sale
                del inventario.
              </p>
            </div>
          )}

          {previsualizacion && (
            <p className="mt-2 text-sm font-medium text-primary">{previsualizacion}</p>
          )}
          {dosisPorKg && !pesoKg && (
            <p className="mt-2 text-sm text-warning">
              Falta el peso del paciente: la dosis por kilo no se puede calcular.
            </p>
          )}

          <Button
            className="mt-3"
            onClick={() => void agregar()}
            disabled={
              ocupado || (origen === "catalogo" ? !presentacionId : !textoLibre.trim())
            }
          >
            <Icono nombre="agregar" className="mr-1 h-4 w-4" />
            Agregar a la receta
          </Button>
        </div>

        {/* --- Repetir una anterior --- */}
        {anteriores.length > 0 && (
          <div className="rounded-xl border border-black/10 p-3">
            <p className="text-sm font-semibold text-text-primary">Repetir una receta anterior</p>
            <p className="text-xs text-text-muted">
              Copia las líneas y <strong>recalcula las dosis por kilo con el peso de hoy</strong>.
            </p>
            <ul className="mt-2 space-y-1">
              {anteriores.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {String(r.fecha).slice(0, 10)} · {r.resumen}
                  </span>
                  <Button variant="secondary" onClick={() => void repetir(r.id)} disabled={ocupado}>
                    Repetir
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function LineaEnLista({
  linea,
  onQuitar,
}: {
  linea: LineaRecetaCalculada;
  onQuitar: () => void;
}) {
  return (
    <div className="rounded-lg border border-black/5 bg-background p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">
            {linea.nombre}{" "}
            {linea.dispensadoAqui ? (
              <Badge variant="info">Se entrega acá</Badge>
            ) : (
              <Badge variant="neutral">Se compra afuera</Badge>
            )}
          </p>
          <p className="text-xs text-text-muted">{linea.indicaciones}</p>
          {linea.explicacionDosis && (
            <p className="text-xs text-primary">{linea.explicacionDosis}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar ${linea.nombre}`}
          className="text-xs text-error hover:underline"
        >
          Quitar
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// EL RESUMEN DEL CIERRE
// =====================================================================

export function ResumenDelCierre({ atencionId }: { atencionId: string }) {
  const [r, setR] = useState<ResumenCierre | null>(null);

  useEffect(() => {
    atencionApi
      .resumenCierre(atencionId)
      .then(setR)
      .catch(() => setR(null));
  }, [atencionId]);

  if (!r) return null;

  const colones = (n: number) =>
    new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC" }).format(n);

  return (
    <div className="space-y-3 rounded-xl border border-black/10 bg-background p-3 text-sm">
      <p className="font-semibold text-text-primary">Al cerrar va a pasar esto:</p>

      {r.impedimentos.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-error/30 bg-error/10 p-2 text-error">
          {r.impedimentos.map((i, n) => (
            <li key={n}>{i}</li>
          ))}
        </ul>
      )}

      <div>
        <p className="text-text-muted">
          {r.cargos.length === 0
            ? "Ningún cargo va a caja."
            : `${plural(r.cargos.length, "cargo", "cargos")} a caja, ${colones(r.total)}:`}
        </p>
        <ul className="mt-1 space-y-0.5">
          {r.cargos.map((c, n) => (
            <li key={n} className="flex justify-between gap-2">
              <span className="truncate">
                {c.cantidad} × {c.descripcion}
              </span>
              <span className="whitespace-nowrap">{colones(c.total)}</span>
            </li>
          ))}
        </ul>
      </div>

      {r.salidas.length > 0 && (
        <div>
          <p className="text-text-muted">Sale del inventario:</p>
          <ul className="mt-1 space-y-0.5">
            {r.salidas.map((s, n) => (
              <li key={n}>
                {s.cantidad} × {s.descripcion}
                {s.lote ? ` · lote ${s.lote}` : " · el lote que venza primero"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.recordatorios.length > 0 && (
        <div>
          <p className="text-text-muted">Se programan estos avisos:</p>
          <ul className="mt-1 space-y-0.5">
            {r.recordatorios.map((x, n) => (
              <li key={n}>
                {x.que} — próxima el {x.cuando}
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.control && (
        <p>
          Se agenda el control del <strong>{r.control.fecha}</strong>
          {r.control.motivo ? ` (${r.control.motivo})` : ""}.
        </p>
      )}

      {r.receta && (
        <p>
          Se firma la receta con {plural(r.receta.lineas, "línea", "líneas")}
          {r.receta.dispensadas > 0
            ? `, ${r.receta.dispensadas} de ellas entregadas en la clínica`
            : ""}
          .
        </p>
      )}
    </div>
  );
}

// =====================================================================
// LAS PESTAÑAS DE HISTORIA DICEN DÓNDE SE REGISTRA CADA COSA
// — prompt 07c, sección 4.
//
// Las cuatro pestañas (Vacunas, Desparasitaciones, Prescripciones,
// Laboratorio) son historia: muestran lo que ya pasó y no dejan
// registrar nada. Eso está bien —el contenido clínico nace en la
// atención— pero NO ESTABA DICHO, y un médico que entra a «Vacunas»
// buscando dónde poner la vacuna de hoy se queda mirando una lista.
//
// Para quien no es médico se explica otra cosa: que el contenido
// clínico lo registra un médico. No es lo mismo «esto se hace en otro
// lado» que «esto no lo hace usted».
// =====================================================================

export function DondeSeRegistra({
  que,
  atajo,
  esMedico,
  hayAtencionAbierta,
  onIrALaAtencion,
  accionExtra,
}: {
  /** «una vacuna», «una receta»… */
  que: string;
  /** «Vacuna (Alt+V)». Vacío para las que no tienen acción propia. */
  atajo?: string;
  esMedico: boolean;
  hayAtencionAbierta: boolean;
  onIrALaAtencion: () => void;
  accionExtra?: React.ReactNode;
}) {
  if (!esMedico) {
    return (
      <div className="mb-3 rounded-xl border border-black/10 bg-background p-3 text-sm">
        <p className="font-medium text-text-primary">Esto es historia clínica.</p>
        <p className="mt-0.5 text-text-muted">
          La registra un médico durante la atención, y queda firmada con ella. Acá se consulta.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary-borde bg-primary-suave p-3 text-sm">
      <p className="text-text-primary">
        {atajo ? (
          <>
            Para registrar {que}, vaya a la atención: <strong>{atajo}</strong>.
          </>
        ) : (
          <>Para registrar {que}, vaya a la atención del paciente.</>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {accionExtra}
        <Button variant="secondary" onClick={onIrALaAtencion}>
          {hayAtencionAbierta ? "Ir a la atención abierta" : "Abrir una atención"}
        </Button>
      </div>
    </div>
  );
}

// =====================================================================
// REGISTRAR UN PREVENTIVO HISTÓRICO
//
// Una vacuna puesta el año pasado en otra clínica es información
// clínica real y no tenía dónde ponerse: `cuidados_preventivos` nacía
// siempre de una atención.
//
// NO lleva cargo ni movimiento de inventario, y el formulario lo dice:
// no se aplicó nada acá.
// =====================================================================

export function ModalHistorico({
  abierto,
  tipo,
  pacienteId,
  onCerrar,
  onRegistrado,
}: {
  abierto: boolean;
  tipo: "vacunacion" | "desparasitacion";
  pacienteId: string;
  onCerrar: () => void;
  onRegistrado: () => void;
}) {
  const toast = useToast();
  const [nombre, setNombre] = useState("");
  const [fecha, setFecha] = useState("");
  const [proxima, setProxima] = useState("");
  const [lote, setLote] = useState("");
  const [lugar, setLugar] = useState("");
  const [subtipo, setSubtipo] = useState<"interna" | "externa">("interna");
  const [ocupado, setOcupado] = useState(false);

  const esVacuna = tipo === "vacunacion";

  const registrar = async () => {
    setOcupado(true);
    try {
      const r = await atencionApi.preventivoHistorico(pacienteId, {
        tipo,
        nombre,
        subtipo: esVacuna ? null : subtipo,
        fechaAplicacion: fecha,
        fechaProxima: proxima || null,
        lote: lote || null,
        lugar: lugar || null,
      });
      toast.exito(`Registrado. La próxima queda para el ${r.proxima}.`);
      setNombre("");
      setFecha("");
      setProxima("");
      setLote("");
      setLugar("");
      onRegistrado();
      onCerrar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal
      open={abierto}
      onClose={onCerrar}
      title={esVacuna ? "Registrar una vacuna histórica" : "Registrar una desparasitación histórica"}
      description="Algo aplicado antes de usar el sistema, o en otro lugar. No genera cargo ni mueve el inventario: acá no se aplicó nada."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            onClick={() => void registrar()}
            disabled={ocupado || !nombre.trim() || !fecha}
          >
            Registrar
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={esVacuna ? "Vacuna" : "Producto"}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder={esVacuna ? "Polivalente, Rabia…" : "Nombre del antiparasitario"}
        />
        {!esVacuna && (
          <Select
            label="Tipo"
            value={subtipo}
            onChange={(e) => setSubtipo(e.target.value as "interna" | "externa")}
            options={[
              { value: "interna", label: "Interna" },
              { value: "externa", label: "Externa" },
            ]}
          />
        )}
        <div>
          <label className="text-sm font-semibold text-text-primary">Fecha de aplicación</label>
          <input
            type="date"
            className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-text-primary">Próxima (opcional)</label>
          <input
            type="date"
            className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
            value={proxima}
            onChange={(e) => setProxima(e.target.value)}
          />
          <p className="mt-1 text-xs text-text-muted">
            Sin fecha, se calcula con el protocolo <strong>desde la aplicación</strong>, no desde
            hoy.
          </p>
        </div>
        <Input
          label="Lote (opcional)"
          value={lote}
          onChange={(e) => setLote(e.target.value)}
        />
        <Input
          label="Dónde se aplicó"
          value={lugar}
          onChange={(e) => setLugar(e.target.value)}
          placeholder="Otra clínica, campaña, el propietario…"
        />
      </div>
    </Modal>
  );
}
