import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "../ui";
import {
  AtencionDetalle,
  ItemAtencion,
  SistemaExaminado,
  atencionApi,
} from "../../lib/expedienteApi";
import { inventarioApi } from "../../lib/inventarioApi";
import { formatearMonto } from "../../lib/ventasApi";
import { BotonDictado, IndicadorMicrofono, useDictado } from "../ui";
import { plural } from "../../lib/plural";
import {
  ModalEstudio,
  ModalPreventivo,
  PanelReceta,
  ResumenDelCierre,
} from "./AccionesClinicas";

// ---------------------------------------------------------------------
// LA ATENCIÓN EN EL EXPEDIENTE — sección 9 del prompt 07.
//
// Es la pantalla donde el médico trabaja con el paciente delante, y eso
// manda sobre el diseño:
//
//   * GUARDADO AUTOMÁTICO con retardo. Nadie aprieta "guardar" mientras
//     sostiene un perro. Se manda solo lo que cambió, 1,2 s después de
//     la última tecla.
//   * LO REALIZADO SE ELIGE DEL CATÁLOGO, nunca se escribe. El texto
//     libre no tiene precio, ni CABYS, ni descarga stock.
//   * EL TOTAL ESTÁ A LA VISTA mientras se trabaja: el cliente pregunta
//     "¿cuánto va a ser?" ANTES de que termine la consulta.
//   * ATAJOS: F2 servicio, F3 producto, F4 cerrar. Mismos que la caja
//     usa para lo equivalente, para no tener dos vocabularios.
//
// EL IVA NO SE MUESTRA ACÁ. Lo calcula la caja con la tarifa del
// catálogo al convertir el ítem en cargo; estimarlo en esta pantalla
// sería tener dos criterios de impuesto. El texto lo dice.
// ---------------------------------------------------------------------

interface Props {
  pacienteId: string;
  pacienteNombre: string;
  /** Para sugerir la próxima fecha según el protocolo de la especie. */
  pacienteEspecie?: string | null;
  esMedico: boolean;
  /** Para refrescar la franja de alertas y la línea de tiempo al cerrar. */
  onCerrada?: () => void;
}

interface PresentacionElegible {
  id: string;
  nombre: string;
  producto: string;
  productoId: string;
  precio: string | null;
  existencia: number;
  unidad: string;
}

const ESTADOS_SISTEMA: Array<{ valor: SistemaExaminado["estado"]; etiqueta: string }> = [
  { valor: "no_evaluado", etiqueta: "No evaluado" },
  { valor: "normal", etiqueta: "Normal" },
  { valor: "anormal", etiqueta: "Anormal" },
];

export function AtencionActual({
  pacienteId,
  pacienteNombre,
  pacienteEspecie,
  esMedico,
  onCerrada,
}: Props) {
  const toast = useToast();
  const navegar = useNavigate();

  const [atencionId, setAtencionId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<AtencionDetalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [plantillas, setPlantillas] = useState<
    Array<{ id: string; tipo_consulta: string; nombre: string }>
  >([]);
  const [tipoConsulta, setTipoConsulta] = useState("consulta_general");

  const [servicios, setServicios] = useState<
    Array<{ id: string; nombre: string; precio: string; linea_negocio: string | null }>
  >([]);
  const [presentaciones, setPresentaciones] = useState<PresentacionElegible[]>([]);

  const [panel, setPanel] = useState<
    | null
    | "servicio"
    | "producto"
    | "vacuna"
    | "desparasitacion"
    | "receta"
    | "estudio"
    | "cerrar"
    | "diagnostico"
  >(
    null
  );
  const [busqueda, setBusqueda] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [elegido, setElegido] = useState<PresentacionElegible | null>(null);
  const [lotes, setLotes] = useState<
    Array<{ id: string; numero: string; vencimiento: string | null; cantidad: string }>
  >([]);
  const [loteId, setLoteId] = useState("");
  const [dispensadoAqui, setDispensadoAqui] = useState(true);
  const [avisos, setAvisos] = useState<
    Array<{ porque: string; severidad: string; detalle: string }>
  >([]);

  const [diagTipo, setDiagTipo] = useState<"presuntivo" | "definitivo">("presuntivo");
  const [diagTexto, setDiagTexto] = useState("");
  const [diagAProblemas, setDiagAProblemas] = useState(false);

  const refBusqueda = useRef<HTMLInputElement>(null);
  const pendientes = useRef<Record<string, unknown>>({});
  const temporizador = useRef<number | null>(null);

  // --- Carga ----------------------------------------------------------
  const cargar = useCallback(async (id: string) => {
    const d = await atencionApi.detalle(id);
    setDetalle(d);
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [p, s] = await Promise.all([atencionApi.plantillas(), inventarioApi.servicios()]);
        if (!vivo) return;
        setPlantillas(p.plantillas);
        setServicios(s.servicios as typeof servicios);
      } catch {
        /* el catálogo vacío no impide escribir la nota */
      }
      try {
        const r = await inventarioApi.productos({ porPagina: 100 });
        const todas: PresentacionElegible[] = [];
        for (const prod of r.productos) {
          try {
            const d = await inventarioApi.producto(prod.id);
            for (const pr of d.presentaciones.filter((x) => x.activo)) {
              todas.push({
                id: pr.id,
                nombre: pr.nombre,
                producto: prod.nombre,
                productoId: prod.id,
                precio: pr.precio_venta,
                existencia: Number(prod.existencia),
                unidad: prod.unidad_base,
              });
            }
          } catch {
            /* un producto que no carga no bloquea la consulta */
          }
        }
        if (vivo) setPresentaciones(todas);
      } catch {
        /* idem */
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // ¿Hay una atención en curso de este paciente? Es lo primero que el
  // médico necesita saber al entrar: si ya hay una empezada, sigue en
  // esa. Dos atenciones en borrador del mismo paciente serían dos
  // mitades de la misma visita.
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    atencionApi
      .enCurso(pacienteId)
      .then((r) => {
        if (!vivo) return;
        setAtencionId(r.atencionId);
        setDetalle(r.detalle);
      })
      .catch(() => {
        if (vivo) setAtencionId(null);
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
  }, [pacienteId]);

  // --- Guardado automático -------------------------------------------
  const guardarCampo = (campo: string, valor: unknown) => {
    if (!atencionId) return;
    setDetalle((d) =>
      d ? { ...d, atencion: { ...d.atencion, [campo]: valor as string } } : d
    );
    pendientes.current[campo] = valor;
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(async () => {
      const campos = pendientes.current;
      pendientes.current = {};
      if (Object.keys(campos).length === 0) return;
      setGuardando(true);
      try {
        await atencionApi.guardar(atencionId, campos);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setGuardando(false);
      }
    }, 1200);
  };

  // --- Atajos ---------------------------------------------------------
  useEffect(() => {
    // LOS ATAJOS SON Alt + letra, NO las teclas de funcion que pedia el
    // prompt. El motivo es que no alcanzan: de F1 a F12, el navegador
    // ya usa F1 (ayuda), F3 (buscar), F5 (recargar), F7 (cursor de
    // texto en Firefox), F10 (barra de menu), F11 (pantalla completa) y
    // F12 (herramientas). Quedan cinco libres y hacen falta siete.
    //
    // Se podia hacer un remiendo —algunas de funcion y otras con Alt—
    // pero un juego de atajos a medias es peor que uno distinto y
    // consistente: nadie recuerda cual es de cada clase. Queda dicho en
    // el informe, que es lo que el prompt pide cuando un atajo esta
    // ocupado.
    const atajo = (e: KeyboardEvent) => {
      if (!atencionId || !esMedico) return;
      if (e.key === "Escape") {
        setPanel(null);
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const destino: Record<string, typeof panel> = {
        s: "servicio",
        p: "producto",
        v: "vacuna",
        d: "desparasitacion",
        r: "receta",
        e: "estudio",
        c: "cerrar",
      };
      const elegido = destino[e.key.toLowerCase()];
      if (!elegido) return;
      e.preventDefault();
      setPanel(elegido);
      if (elegido === "producto") setTimeout(() => refBusqueda.current?.focus(), 50);
    };
    window.addEventListener("keydown", atajo);
    return () => window.removeEventListener("keydown", atajo);
  }, [atencionId, esMedico]);

  // --- Acciones -------------------------------------------------------
  const abrir = async () => {
    setOcupado(true);
    try {
      const r = await atencionApi.abrir({ pacienteId, tipoConsulta });
      setAtencionId(r.atencion.id);
      await cargar(r.atencion.id);
      toast.exito(
        r.atencion.creada
          ? "Atención abierta. La cita se creó sola."
          : "Seguís en la atención que ya estaba abierta."
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const marcar = async (sistema: string, estado: string, nota?: string | null) => {
    if (!atencionId) return;
    setDetalle((d) =>
      d
        ? {
            ...d,
            sistemas: d.sistemas.map((s) =>
              s.sistema === sistema
                ? { ...s, estado: estado as SistemaExaminado["estado"], nota: nota ?? null }
                : s
            ),
          }
        : d
    );
    try {
      await atencionApi.marcarSistema(atencionId, sistema, estado, nota);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // TODO NORMAL: marca de una vez lo que sigue sin evaluar. No toca lo
  // que el medico ya marco —ni los anormales ni los normales— porque
  // "todo normal" quiere decir "lo que no mire estaba bien", no "borra
  // lo que escribi".
  const todoNormal = async () => {
    if (!atencionId || !detalle) return;
    const pendientes = detalle.sistemas.filter((s) => s.estado === "no_evaluado");
    if (pendientes.length === 0) return;
    setOcupado(true);
    try {
      for (const s of pendientes) {
        await atencionApi.marcarSistema(atencionId, s.sistema, "normal", null);
      }
      setDetalle((d) =>
        d
          ? {
              ...d,
              sistemas: d.sistemas.map((s) =>
                s.estado === "no_evaluado" ? { ...s, estado: "normal" as const, nota: null } : s
              ),
            }
          : d
      );
      toast.exito(`${plural(pendientes.length, "sistema", "sistemas")} sin evaluar: marcados normales.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const agregarServicio = async (servicioId: string) => {
    if (!atencionId) return;
    setOcupado(true);
    try {
      const r = await atencionApi.agregarItem(atencionId, {
        tipo: "servicio",
        servicioId,
        cantidad: Number(cantidad.replace(",", ".")) || 1,
      });
      toast.exito(`${r.descripcion} · ${formatearMonto(r.total)}`);
      await cargar(atencionId);
      setPanel(null);
      setCantidad("1");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const elegirPresentacion = async (p: PresentacionElegible) => {
    setElegido(p);
    setLoteId("");
    setAvisos([]);
    try {
      const [d, a] = await Promise.all([
        inventarioApi.producto(p.productoId),
        atencionApi.avisosReceta(pacienteId, p.id),
      ]);
      setLotes(
        (d.lotes ?? [])
          .filter((l) => Number(l.cantidad) > 0)
          .map((l) => ({
            id: l.id,
            numero: l.numero,
            vencimiento: l.vencimiento,
            cantidad: l.cantidad,
          }))
      );
      setAvisos(a.avisos);
    } catch {
      setLotes([]);
    }
  };

  const agregarProducto = async () => {
    if (!atencionId || !elegido) return;
    setOcupado(true);
    try {
      // Esta accion es la de PRODUCTO, y nada mas. La vacuna, la
      // desparasitacion y la receta tienen la suya: el tipo ya no se
      // elige en una casilla escondida (prompt 07c, seccion 1).
      const r = await atencionApi.agregarItem(atencionId, {
        tipo: "producto",
        presentacionId: elegido.id,
        loteId: loteId || undefined,
        cantidad: Number(cantidad.replace(",", ".")) || 1,
        dispensadoAqui,
      });
      toast.exito(`${r.descripcion} · ${formatearMonto(r.total)}`);
      await cargar(atencionId);
      setPanel(null);
      setElegido(null);
      setBusqueda("");
      setCantidad("1");
      setDispensadoAqui(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const quitar = async (item: ItemAtencion) => {
    if (!atencionId) return;
    try {
      await atencionApi.quitarItem(atencionId, item.id);
      await cargar(atencionId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const guardarDiagnostico = async () => {
    if (!atencionId || !diagTexto.trim()) return;
    setOcupado(true);
    try {
      await atencionApi.agregarDiagnostico(atencionId, {
        tipo: diagTipo,
        descripcion: diagTexto.trim(),
        aLaListaDeProblemas: diagAProblemas,
      });
      await cargar(atencionId);
      setDiagTexto("");
      setDiagAProblemas(false);
      setPanel(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const cerrar = async () => {
    if (!atencionId) return;
    setOcupado(true);
    try {
      // Lo pendiente del guardado automático primero: cerrar con una
      // nota que todavía no llegó al servidor la perdería.
      if (Object.keys(pendientes.current).length > 0) {
        const campos = pendientes.current;
        pendientes.current = {};
        await atencionApi.guardar(atencionId, campos);
      }
      const r = await atencionApi.cerrar(atencionId);
      toast.exito(
        r.cargos > 0
          ? `Atención cerrada. Cuenta #${r.cuentaNumero} en caja por ${formatearMonto(r.total)}.`
          : "Atención cerrada y firmada. No había nada que cobrar."
      );
      setPanel(null);
      onCerrada?.();
      if (r.cargos > 0) {
        navegar(`/ventas/cobro/${r.cuentaId}`);
      } else {
        await cargar(atencionId);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return presentaciones
      .filter((p) => p.producto.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q))
      .slice(0, 8);
  }, [busqueda, presentaciones]);

  // --- Vistas ---------------------------------------------------------
  if (cargando) return <LoadingState forma="tarjetas" cantidad={2} />;

  const a = detalle?.atencion as Record<string, string | number | null> | undefined;
  const cerrada = a?.estado === "cerrada";

  if (!atencionId || !detalle) {
    return (
      <Card className="mt-4">
        <CardTitle>No hay ninguna atención abierta</CardTitle>
        <CardDescription>
          Una atención es el registro de una visita: lo que el dueño cuenta, lo que el examen
          encuentra, la evaluación y el plan. Al cerrarla, lo realizado pasa a la cuenta del
          cliente en caja y el inventario se descarga.
        </CardDescription>
        {esMedico ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="w-72">
              <Select
                label="Tipo de consulta"
                value={tipoConsulta}
                onChange={(e) => setTipoConsulta(e.target.value)}
                options={plantillas.map((p) => ({ value: p.tipo_consulta, label: p.nombre }))}
              />
            </div>
            <Button onClick={abrir} disabled={ocupado}>
              <Icono nombre="agregar" className="mr-1 h-4 w-4" />
              Registrar atención de {pacienteNombre}
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-text-muted">
            Una atención la registra un médico: es contenido clínico y lleva su firma.
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      {/* ------------------------------------------------ El registro */}
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>
                {cerrada ? "Atención cerrada" : "Atención en curso"}
                {a?.tipo_consulta ? ` · ${String(a.tipo_consulta).replace(/_/g, " ")}` : ""}
              </CardTitle>
              <CardDescription>
                {cerrada
                  ? `Firmada por ${a?.firmada_nombre ?? "—"}. Lo que ya se firmó no se edita: la corrección es una adenda.`
                  : "Alt+S servicio · Alt+P producto · Alt+V vacuna · Alt+D desparasitación · Alt+R receta · Alt+E estudio · Alt+C cerrar · se guarda solo"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {guardando && <Badge variant="neutral">Guardando…</Badge>}
              {cerrada && <Badge variant="success">Firmada</Badge>}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Subjetivo</CardTitle>
          <CardDescription>Lo que cuenta quien trae al paciente.</CardDescription>
          <div className="mt-3 space-y-3">
            <Campo
              etiqueta="Motivo de consulta"
              valor={a?.motivo_consulta}
              deshabilitado={cerrada || !esMedico}
              onCambio={(v) => guardarCampo("motivo_consulta", v)}
            />
            <Campo
              etiqueta="Anamnesis"
              valor={a?.anamnesis}
              filas={4}
              deshabilitado={cerrada || !esMedico}
              onCambio={(v) => guardarCampo("anamnesis", v)}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Objetivo</CardTitle>
          <CardDescription>Los signos y el examen por sistemas.</CardDescription>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Input
              label="Peso (kg)"
              value={String(a?.peso ?? "")}
              disabled={cerrada || !esMedico}
              onChange={(e) => guardarCampo("peso", e.target.value || null)}
            />
            <Input
              label="Temperatura (°C)"
              value={String(a?.temperatura ?? "")}
              disabled={cerrada || !esMedico}
              onChange={(e) => guardarCampo("temperatura", e.target.value || null)}
            />
            <Input
              label="Condición corporal (1–9)"
              value={String(a?.condicion_corporal ?? "")}
              disabled={cerrada || !esMedico}
              onChange={(e) => guardarCampo("condicion_corporal", e.target.value || null)}
            />
            <Input
              label="FC (lpm)"
              value={String(a?.frecuencia_cardiaca ?? "")}
              disabled={cerrada || !esMedico}
              onChange={(e) => guardarCampo("frecuencia_cardiaca", e.target.value || null)}
            />
            <Input
              label="FR (rpm)"
              value={String(a?.frecuencia_respiratoria ?? "")}
              disabled={cerrada || !esMedico}
              onChange={(e) => guardarCampo("frecuencia_respiratoria", e.target.value || null)}
            />
            <Input
              label="Mucosas"
              value={String(a?.mucosas ?? "")}
              disabled={cerrada || !esMedico}
              onChange={(e) => guardarCampo("mucosas", e.target.value || null)}
            />
          </div>

          {/* EL ESTADO SE VE (prompt 07c, seccion 5). Antes los tres
              estados se leian igual y la fila repetia "Sin evaluar" al
              lado del boton que ya lo decia. Ahora la TARJETA toma el
              color del estado, con su icono, asi que al recorrer el
              examen lo anormal salta a la vista y lo no evaluado se
              distingue de lo revisado.

              Los colores son los TOKENS DE ESTADO del sistema de
              diseno, que no son configurables por clinica: un hallazgo
              anormal tiene que leerse igual en todas. */}
          <div className="mt-4 space-y-2">
            {detalle.sistemas.map((s) => {
              const faltaDetalle = s.estado === "anormal" && !(s.nota ?? "").trim();
              return (
                <div
                  key={s.sistema}
                  className={[
                    "grid items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_auto_1fr]",
                    s.estado === "anormal"
                      ? faltaDetalle
                        ? "border-error bg-error/10"
                        : "border-warning/40 bg-warning/10"
                      : s.estado === "normal"
                        ? "border-success/30 bg-success/5"
                        : "border-black/5",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                    {s.estado === "normal" && (
                      <Icono nombre="check" tamano={14} className="text-success" />
                    )}
                    {s.estado === "anormal" && (
                      <Icono nombre="aviso" tamano={14} className="text-error" />
                    )}
                    {s.sistema}
                  </span>
                  <div className="flex gap-1">
                    {ESTADOS_SISTEMA.map((e) => (
                      <button
                        key={e.valor}
                        type="button"
                        disabled={cerrada || !esMedico}
                        aria-pressed={s.estado === e.valor}
                        onClick={() => marcar(s.sistema, e.valor, s.nota)}
                        className={[
                          "rounded-md px-2 py-1 text-xs font-semibold",
                          s.estado === e.valor
                            ? e.valor === "anormal"
                              ? "bg-error text-white"
                              : e.valor === "normal"
                                ? "bg-success text-white"
                                : "bg-black/20 text-text-primary"
                            : "border border-black/10 bg-transparent text-text-muted hover:bg-black/5",
                        ].join(" ")}
                      >
                        {e.etiqueta}
                      </button>
                    ))}
                  </div>
                  {s.estado === "anormal" ? (
                    <div>
                      {/* El hallazgo tambien se dicta (prompt 07d): es el
                          campo que mas se escribe con el animal encima
                          de la mesa. */}
                      <CampoHallazgo
                        sistema={s.sistema}
                        valor={s.nota ?? ""}
                        deshabilitado={cerrada || !esMedico}
                        onCambio={(v) =>
                          setDetalle((d) =>
                            d
                              ? {
                                  ...d,
                                  sistemas: d.sistemas.map((x) =>
                                    x.sistema === s.sistema ? { ...x, nota: v } : x
                                  ),
                                }
                              : d
                          )
                        }
                        onConfirmar={() => marcar(s.sistema, "anormal", s.nota)}
                      />
                      {faltaDetalle && (
                        <p className="mt-1 text-xs text-error">
                          Un sistema anormal sin describir no se puede cerrar.
                        </p>
                      )}
                    </div>
                  ) : (
                    /* El estado lo dice el control: no se repite en texto. */
                    <span />
                  )}
                </div>
              );
            })}
          </div>

          {/* EL RESUMEN EN VIVO y "Todo normal". Sin esto hay que contar
              trece filas a ojo para saber si falta mirar algo. */}
          {detalle.sistemas.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3">
              <p className="text-sm text-text-muted">
                {[
                  plural(
                    detalle.sistemas.filter((x) => x.estado === "normal").length,
                    "normal",
                    "normales"
                  ),
                  plural(
                    detalle.sistemas.filter((x) => x.estado === "anormal").length,
                    "anormal",
                    "anormales"
                  ),
                  plural(
                    detalle.sistemas.filter((x) => x.estado === "no_evaluado").length,
                    "sin evaluar",
                    "sin evaluar"
                  ),
                ].join(" · ")}
              </p>
              {!cerrada && esMedico && (
                <Button variant="secondary" onClick={() => void todoNormal()} disabled={ocupado}>
                  Todo normal
                </Button>
              )}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Evaluación</CardTitle>
              <CardDescription>Diagnósticos presuntivos y definitivos.</CardDescription>
            </div>
            {!cerrada && esMedico && (
              <Button variant="secondary" onClick={() => setPanel("diagnostico")}>
                Agregar diagnóstico
              </Button>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {detalle.diagnosticos.length === 0 && (
              <p className="text-sm text-text-muted">Todavía no hay diagnósticos.</p>
            )}
            {detalle.diagnosticos.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg border border-black/5 p-2 text-sm"
              >
                <span>{d.descripcion}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={d.tipo === "definitivo" ? "success" : "neutral"}>{d.tipo}</Badge>
                  {d.problema_id && <Badge variant="warning">en la lista de problemas</Badge>}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Campo
              etiqueta="Evaluación"
              valor={a?.evaluacion}
              filas={4}
              deshabilitado={cerrada || !esMedico}
              onCambio={(v) => guardarCampo("evaluacion", v)}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Plan</CardTitle>
          <CardDescription>
            Tratamiento, indicaciones al cliente y el control recomendado. El control se agenda
            como una cita al cerrar, y de ahí sale su recordatorio.
          </CardDescription>
          <div className="mt-3 space-y-3">
            <Campo
              etiqueta="Tratamiento"
              valor={a?.plan_tratamiento}
              filas={3}
              deshabilitado={cerrada || !esMedico}
              onCambio={(v) => guardarCampo("plan_tratamiento", v)}
            />
            <Campo
              etiqueta="Indicaciones al cliente"
              valor={a?.indicaciones_cliente}
              filas={3}
              deshabilitado={cerrada || !esMedico}
              onCambio={(v) => guardarCampo("indicaciones_cliente", v)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-text-primary">Control el</label>
                <input
                  type="date"
                  className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                  value={String(a?.control_fecha ?? "").slice(0, 10)}
                  disabled={cerrada || !esMedico}
                  onChange={(e) => guardarCampo("control_fecha", e.target.value || null)}
                />
              </div>
              <Input
                label="Motivo del control"
                value={String(a?.control_motivo ?? "")}
                disabled={cerrada || !esMedico}
                onChange={(e) => guardarCampo("control_motivo", e.target.value || null)}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* --------------------------------------------- La cuenta viva */}
      <div className="space-y-4">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Lo realizado</CardTitle>
            {/* UNA ACCION POR CADA COSA QUE EL MEDICO HACE (prompt 07c,
                seccion 1). Antes eran dos, y la vacuna, la
                desparasitacion y la receta estaban escondidas dentro de
                "Producto" detras de una casilla. */}
            {!cerrada && esMedico && (
              <div className="flex flex-wrap gap-1">
                <Button variant="secondary" onClick={() => setPanel("servicio")}>
                  Servicio <Atajo>Alt+S</Atajo>
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPanel("producto");
                    setTimeout(() => refBusqueda.current?.focus(), 50);
                  }}
                >
                  Producto <Atajo>Alt+P</Atajo>
                </Button>
                <Button variant="secondary" onClick={() => setPanel("vacuna")}>
                  Vacuna <Atajo>Alt+V</Atajo>
                </Button>
                <Button variant="secondary" onClick={() => setPanel("desparasitacion")}>
                  Desparasitación <Atajo>Alt+D</Atajo>
                </Button>
                <Button variant="secondary" onClick={() => setPanel("receta")}>
                  Receta <Atajo>Alt+R</Atajo>
                </Button>
                <Button variant="secondary" onClick={() => setPanel("estudio")}>
                  Estudio <Atajo>Alt+E</Atajo>
                </Button>
              </div>
            )}
          </div>
          <CardDescription>
            Elegido del catálogo: así tiene precio, código fiscal y descarga de inventario.
          </CardDescription>

          <div className="mt-3 space-y-2">
            {detalle.items.length === 0 && (
              <p className="text-sm text-text-muted">Todavía no hay nada cargado.</p>
            )}
            {detalle.items.map((i) => (
              <div key={i.id} className="rounded-lg border border-black/5 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{i.descripcion}</p>
                    <p className="text-xs text-text-muted">
                      {i.cantidad} × {formatearMonto(i.precio_unitario)}
                      {!i.dispensado_aqui && " · lo compra afuera"}
                      {i.cobrado && " · ya está en la cuenta"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {i.dispensado_aqui ? formatearMonto(i.total) : "—"}
                    </p>
                    {!cerrada && esMedico && !i.cobrado && (
                      <button
                        type="button"
                        onClick={() => quitar(i)}
                        className="text-xs text-error hover:underline"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-black/5 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-text-primary">Va en</span>
              <span className="text-xl font-bold text-primary">{formatearMonto(detalle.total)}</span>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Sin impuesto: el IVA lo calcula la caja con la tarifa de cada ítem al cobrar.
            </p>
          </div>

          {!cerrada && esMedico && (
            <Button className="mt-4 w-full" onClick={() => setPanel("cerrar")} disabled={ocupado}>
              Cerrar la atención (F4)
            </Button>
          )}
          {cerrada && a?.cuenta_numero && (
            <Button
              className="mt-4 w-full"
              variant="secondary"
              onClick={() => navegar(`/ventas/cobro/${a.cuenta_id}`)}
            >
              Ver la cuenta #{a.cuenta_numero} en caja
            </Button>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------- Modales */}
      <Modal
        open={panel === "servicio"}
        onClose={() => setPanel(null)}
        title="Agregar un servicio"
        description="Del catálogo de servicios de la clínica, con su línea de negocio y su precio."
      >
        <Input label="Cantidad" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        <ul className="mt-3 max-h-72 overflow-auto rounded-lg border border-black/10">
          {servicios.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => agregarServicio(s.id)}
                disabled={ocupado}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
              >
                <span className="font-medium">{s.nombre}</span>
                <span className="block text-xs text-text-muted">
                  {formatearMonto(s.precio)}
                  {s.linea_negocio ? ` · ${s.linea_negocio}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={panel === "producto"}
        onClose={() => {
          setPanel(null);
          setElegido(null);
          setAvisos([]);
        }}
        title="Agregar un producto"
        description="Lo que se aplica o se vende y no es vacuna, desparasitación ni receta: cada una de esas tiene su propia acción."
        ancho="lg"
        footer={
          elegido && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setElegido(null)}>
                Elegir otro
              </Button>
              <Button onClick={agregarProducto} disabled={ocupado}>
                Agregar
              </Button>
            </div>
          )
        }
      >
        {!elegido ? (
          <>
            <Input
              ref={refBusqueda}
              label="Producto"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="vacuna, amoxicilina, 7501234…"
            />
            <ul className="mt-2 max-h-72 overflow-auto rounded-lg border border-black/10">
              {coincidencias.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => elegirPresentacion(p)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
                  >
                    <span className="font-medium">
                      {p.producto} — {p.nombre}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {p.precio ? formatearMonto(p.precio) : "sin precio"} · hay {p.existencia}{" "}
                      {p.unidad}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-text-primary">
              {elegido.producto} — {elegido.nombre}
            </p>

            {avisos.length > 0 && (
              <div className="rounded-lg border border-error/30 bg-error/10 p-3">
                <p className="text-sm font-semibold text-error">
                  Este paciente tiene una alergia registrada
                </p>
                <ul className="mt-1 space-y-1 text-xs text-error">
                  {avisos.map((av, i) => (
                    <li key={i}>
                      Coincide por {av.porque} · {av.severidad}
                      {av.detalle ? ` · ${av.detalle}` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-text-muted">
                  Se puede agregar igual —puede haber una razón clínica—, pero queda dicho.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Cantidad"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
              <Select
                label="Lote"
                value={loteId}
                onChange={(e) => setLoteId(e.target.value)}
                options={[
                  { value: "", label: "El que venza primero (FEFO)" },
                  ...lotes.map((l) => ({
                    value: l.id,
                    label: `${l.numero}${l.vencimiento ? ` · vence ${String(l.vencimiento).slice(0, 10)}` : ""} · ${l.cantidad}`,
                  })),
                ]}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={dispensadoAqui}
                onChange={(e) => setDispensadoAqui(e.target.checked)}
                className="h-4 w-4 rounded border-black/20"
              />
              Se dispensa en la clínica (si no, el cliente lo compra afuera: no se cobra ni
              descuenta stock)
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={panel === "diagnostico"}
        onClose={() => setPanel(null)}
        title="Agregar un diagnóstico"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPanel(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarDiagnostico} disabled={ocupado || !diagTexto.trim()}>
              Agregar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Select
            label="Tipo"
            value={diagTipo}
            onChange={(e) => setDiagTipo(e.target.value as "presuntivo" | "definitivo")}
            options={[
              { value: "presuntivo", label: "Presuntivo" },
              { value: "definitivo", label: "Definitivo" },
            ]}
          />
          <Input
            label="Diagnóstico"
            value={diagTexto}
            onChange={(e) => setDiagTexto(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={diagAProblemas}
              onChange={(e) => setDiagAProblemas(e.target.checked)}
              className="h-4 w-4 rounded border-black/20"
            />
            Agregarlo a la lista de problemas del paciente (es del paciente, no solo de esta visita)
          </label>
        </div>
      </Modal>

      {atencionId && (
        <>
          <ModalPreventivo
            abierto={panel === "vacuna"}
            tipo="vacunacion"
            atencionId={atencionId}
            pacienteEspecie={pacienteEspecie ?? ""}
            onCerrar={() => setPanel(null)}
            onAgregado={() => atencionId && void cargar(atencionId)}
          />
          <ModalPreventivo
            abierto={panel === "desparasitacion"}
            tipo="desparasitacion"
            atencionId={atencionId}
            pacienteEspecie={pacienteEspecie ?? ""}
            onCerrar={() => setPanel(null)}
            onAgregado={() => atencionId && void cargar(atencionId)}
          />
          <PanelReceta
            abierto={panel === "receta"}
            atencionId={atencionId}
            pacienteId={pacienteId}
            onCerrar={() => setPanel(null)}
            onCambio={() => atencionId && void cargar(atencionId)}
          />
          <ModalEstudio
            abierto={panel === "estudio"}
            atencionId={atencionId}
            servicios={servicios.map((x) => ({
              id: x.id,
              nombre: x.nombre,
              precio: x.precio === null ? null : Number(x.precio),
            }))}
            onCerrar={() => setPanel(null)}
            onPedido={() => atencionId && void cargar(atencionId)}
          />
        </>
      )}

      <Modal
        open={panel === "cerrar"}
        onClose={() => setPanel(null)}
        title="Cerrar la atención"
        description="Pasa todo junto o no pasa nada."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPanel(null)}>
              Seguir editando
            </Button>
            <Button onClick={cerrar} disabled={ocupado}>
              {ocupado ? "Cerrando…" : "Cerrar y firmar"}
            </Button>
          </div>
        }
      >
        {/* LO QUE VA A PASAR, con nombre y monto (prompt 07c, seccion
            6). Antes era una lista de frases generales —"el inventario
            se descarga por lote"— que no decia QUE sale ni por cual
            lote. Ahora lo dice, leido del servidor. */}
        {panel === "cerrar" && atencionId && <ResumenDelCierre atencionId={atencionId} />}
        <p className="mt-3 text-sm text-text-primary">
          Después de firmar no se edita: la corrección es una adenda. Pasa todo junto o no pasa
          nada.
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------
// Un campo de texto que se guarda solo. Está acá y no en el sistema de
// diseño porque el guardado con retardo es de esta pantalla: en un
// formulario normal, guardar al tipear sería peor.
// ---------------------------------------------------------------------
/**
 * El hallazgo de un sistema anormal, con su micrófono.
 *
 * Es un componente aparte y no un `Campo` porque la fila del examen es
 * compacta: acá la etiqueta ya la pone el nombre del sistema y el campo
 * va sin título propio.
 */
function CampoHallazgo({
  sistema,
  valor,
  deshabilitado,
  onCambio,
  onConfirmar,
}: {
  sistema: string;
  valor: string;
  deshabilitado?: boolean;
  onCambio: (v: string) => void;
  onConfirmar: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const valorRef = useRef(valor);
  valorRef.current = valor;
  const dictado = useDictado(
    () => valorRef.current,
    onCambio,
    ref as React.RefObject<HTMLElement>
  );

  return (
    <div className="flex items-center gap-1">
      <input
        ref={ref}
        className="min-h-11 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm disabled:opacity-60"
        placeholder="Qué se encontró (obligatorio)"
        value={valor}
        disabled={deshabilitado}
        onChange={(e) => onCambio(e.target.value)}
        onBlur={onConfirmar}
      />
      {!deshabilitado && (
        <BotonDictado
          grabando={dictado.grabando}
          soportado={dictado.soportado}
          onAlternar={dictado.alternar}
          etiquetaCampo={`el hallazgo de ${sistema.toLowerCase()}`}
        />
      )}
      {dictado.grabando && <IndicadorMicrofono campo={`Hallazgo · ${sistema}`} />}
    </div>
  );
}

/** El atajo, al lado de su acción. Visible, que es como se aprende. */
function Atajo({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1.5 rounded border border-current/30 px-1 text-[10px] font-normal opacity-70">
      {children}
    </kbd>
  );
}

function Campo({
  etiqueta,
  valor,
  filas = 1,
  deshabilitado,
  onCambio,
}: {
  etiqueta: string;
  valor: string | number | null | undefined;
  filas?: number;
  deshabilitado?: boolean;
  onCambio: (v: string) => void;
}) {
  const [texto, setTexto] = useState(String(valor ?? ""));
  const refCampo = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  useEffect(() => {
    setTexto(String(valor ?? ""));
    // Solo cuando cambia desde afuera (carga o plantilla): mientras se
    // tipea, el estado local manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deshabilitado]);

  // DICTADO (prompt 07d, fase 1). `textoRef` y no `texto` a secas: el
  // hook pregunta el valor actual cuando se toca el microfono, y con la
  // variable capturada se quedaria con el de cuando se monto el
  // componente, borrando lo que el medico escribio despues.
  const textoRef = useRef(texto);
  textoRef.current = texto;
  const escribir = (v: string) => {
    setTexto(v);
    onCambio(v);
  };
  const dictado = useDictado(
    () => textoRef.current,
    escribir,
    refCampo as React.RefObject<HTMLElement>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-semibold text-text-primary">{etiqueta}</label>
        {!deshabilitado && (
          <BotonDictado
            grabando={dictado.grabando}
            soportado={dictado.soportado}
            onAlternar={dictado.alternar}
            etiquetaCampo={etiqueta.toLowerCase()}
          />
        )}
      </div>
      {dictado.aviso && <p className="text-xs text-error">{dictado.aviso}</p>}
      {dictado.grabando && <IndicadorMicrofono campo={etiqueta} />}
      {filas > 1 ? (
        <textarea
          ref={refCampo as React.RefObject<HTMLTextAreaElement>}
          rows={filas}
          className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm disabled:opacity-60"
          value={texto}
          disabled={deshabilitado}
          onChange={(e) => escribir(e.target.value)}
        />
      ) : (
        <input
          ref={refCampo as React.RefObject<HTMLInputElement>}
          className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm disabled:opacity-60"
          value={texto}
          disabled={deshabilitado}
          onChange={(e) => escribir(e.target.value)}
        />
      )}
    </div>
  );
}
