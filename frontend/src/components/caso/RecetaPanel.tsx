import { useEffect, useRef, useState } from "react";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";
import { useFormularioSucio } from "../../hooks/useFormularioSucio";
import { Badge, BadgeVariant } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  AlertaReceta,
  CategoriaAlertaReceta,
  ItemRecetaInput,
  Medicamento,
  ValidacionReceta,
  workspaceApi,
} from "../../lib/workspaceApi";

const CATEGORIA_LABEL: Record<CategoriaAlertaReceta, string> = {
  interaccion_medicamentosa: "Interacción medicamentosa",
  contraindicacion: "Contraindicación",
  alergia_registrada: "Alergia registrada",
  duplicidad_terapeutica: "Duplicidad terapéutica",
  dosis_fuera_de_rango: "Dosis fuera de rango",
  incompatibilidad_enfermedad_existente: "Incompatibilidad con enfermedad existente",
  advertencia_edad: "Advertencia por edad",
  advertencia_peso: "Advertencia por peso",
  advertencia_especie: "Advertencia por especie",
  advertencia_raza: "Advertencia por raza",
};

// Mismos colores funcionales que ya usa el panel de Alertas del
// Dashboard (DashboardGcisPanel.tsx) — alta=error, media=warning, no se
// inventa una paleta nueva.
const NIVEL_BADGE: Record<AlertaReceta["nivel"], BadgeVariant> = {
  alta: "error",
  media: "warning",
};

interface ItemEnEdicion {
  clientId: string;
  medicamentoId: string;
  medicamentoNombre: string;
  concentracion: string | null;
  dosis: string;
  frecuencia: string;
  duracion: string;
  viaAdministracion: string;
  observaciones: string;
}

// prompt_code_registro_atencion.md, Paso 3 — el caso es opcional: una
// receta puede nacer directo de un caso (puerta vieja, CasoWorkspace,
// siempre con caso) o de una atención (puerta nueva, con o sin caso
// detrás — la atención misma cuelga de una cita, que puede o no estar
// ligada a un caso; el padre ya sabe eso al momento de abrir este panel,
// así que viaja en el origen y no hace falta esperar al primer guardado
// para saber si "Validar con IA" va a estar disponible).
export type OrigenReceta =
  | { tipo: "caso"; casoId: string }
  | { tipo: "atencion"; atencionId: string; tieneCaso: boolean };

interface RecetaPanelProps {
  origen: OrigenReceta;
  pacienteNombre: string;
  onClose: () => void;
}

// Módulo de Prescripción Médica — común a cualquier agente clínico
// (GCIS, ICIS, u otros a futuro). Nada acá depende de qué agente lleva
// el caso; el backend ya resuelve eso dinámicamente en /validar.
export function RecetaPanel({ origen, pacienteNombre, onClose }: RecetaPanelProps) {
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const [recetaId, setRecetaId] = useState<string | null>(null);
  const validacionDisponible = origen.tipo === "caso" ? true : origen.tieneCaso;
  const [items, setItems] = useState<ItemEnEdicion[]>([]);
  const [instruccionesGenerales, setInstruccionesGenerales] = useState("");
  const [instruccionesPropietario, setInstruccionesPropietario] = useState("");

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Medicamento[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [mostrarResultados, setMostrarResultados] = useState(false);

  const [validando, setValidando] = useState(false);
  const [validacion, setValidacion] = useState<ValidacionReceta | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [emitida, setEmitida] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busquedaRef = useRef<HTMLDivElement>(null);
  const inputBusquedaRef = useRef<HTMLInputElement>(null);

  // Autocompletado debounced ~300ms, mismo criterio que el resto de la
  // app (ver búsqueda de propietarios en el wizard de Nuevo Caso).
  useEffect(() => {
    if (!busqueda.trim()) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const timer = setTimeout(() => {
      workspaceApi
        .buscarMedicamentos(busqueda.trim())
        .then((data) => setResultados(data.medicamentos))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [busqueda]);

  // Cierra el dropdown de resultados al hacer clic afuera.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (busquedaRef.current && !busquedaRef.current.contains(e.target as Node)) {
        setMostrarResultados(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const agregarMedicamento = (medicamento: Medicamento) => {
    setItems((prev) => [
      {
        // id local propio de la card, no el índice del array — así
        // eliminar/reordenar no rompe la identidad de las demás cards en
        // React (ver prompt_receta_implementacion_final.md).
        clientId: crypto.randomUUID(),
        medicamentoId: medicamento.id,
        medicamentoNombre: medicamento.nombre,
        concentracion: medicamento.concentracion,
        dosis: "",
        frecuencia: "",
        duracion: "",
        viaAdministracion: medicamento.via_administracion_default ?? "",
        observaciones: "",
      },
      // Prepend, no append (ver prompt_receta_orden_lista.md): el
      // médico termina de cargar los campos de un ítem justo debajo del
      // buscador, sin tener que bajar hasta el final de la lista cada
      // vez que agrega uno nuevo. Los badges numerados (índice+1 en el
      // render) ya reflejan este nuevo orden solos, sin cambios extra.
      ...prev,
    ]);
    setBusqueda("");
    setResultados([]);
    setMostrarResultados(false);
  };

  const quitarItem = (clientId: string) => {
    setItems((prev) => prev.filter((i) => i.clientId !== clientId));
  };

  const actualizarItem = (clientId: string, campo: keyof ItemEnEdicion, valor: string) => {
    setItems((prev) => prev.map((i) => (i.clientId === clientId ? { ...i, [campo]: valor } : i)));
  };

  const itemsParaBackend = (): ItemRecetaInput[] =>
    items.map((i) => ({
      medicamentoId: i.medicamentoId,
      dosis: i.dosis,
      frecuencia: i.frecuencia,
      duracion: i.duracion,
      viaAdministracion: i.viaAdministracion,
      observaciones: i.observaciones || undefined,
    }));

  // "primero hay que crear el borrador si todavía no existe; guardá el
  // borrador automáticamente al hacer clic en Validar si el usuario no
  // lo guardó antes" — create-or-update, compartido entre validar y
  // emitir sin validar (los dos necesitan el borrador persistido antes).
  const guardarBorrador = async (): Promise<string> => {
    let idActual = recetaId;
    if (!idActual) {
      const { receta } =
        origen.tipo === "caso"
          ? await workspaceApi.crearReceta(origen.casoId, {
              instruccionesGenerales: instruccionesGenerales || undefined,
              instruccionesPropietario: instruccionesPropietario || undefined,
              items: itemsParaBackend(),
            })
          : await workspaceApi.crearRecetaDesdeAtencion(origen.atencionId, {
              instruccionesGenerales: instruccionesGenerales || undefined,
              instruccionesPropietario: instruccionesPropietario || undefined,
              items: itemsParaBackend(),
            });
      idActual = receta.id;
      setRecetaId(receta.id);
    } else {
      await workspaceApi.editarReceta(idActual, {
        instruccionesGenerales: instruccionesGenerales || undefined,
        instruccionesPropietario: instruccionesPropietario || undefined,
        items: itemsParaBackend(),
      });
    }
    return idActual;
  };

  const validarReceta = async () => {
    if (items.length === 0) return;
    setValidando(true);
    setError(null);
    try {
      const idActual = await guardarBorrador();
      const resultado = await workspaceApi.validarReceta(idActual);
      setValidacion(resultado);
    } catch (err) {
      console.error("Error al validar la receta:", err);
      setError(err instanceof Error ? err.message : "No pudimos validar la receta.");
    } finally {
      setValidando(false);
    }
  };

  const modificarReceta = () => {
    setValidacion(null);
    setError(null);
  };

  const descargarPdf = async (idReceta: string) => {
    const { blob, filename } = await workspaceApi.emitirReceta(idReceta);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename ?? "Receta.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const emitirReceta = async () => {
    if (!recetaId) return;
    setEmitiendo(true);
    setError(null);
    try {
      await descargarPdf(recetaId);
      setEmitida(true);
    } catch (err) {
      console.error("Error al emitir la receta:", err);
      setError(err instanceof Error ? err.message : "No pudimos emitir la receta.");
    } finally {
      setEmitiendo(false);
    }
  };

  // Validación IA opcional (el médico puede saltarla para recetas
  // simples/de rutina, igual criterio que ya tenía para emitir pese a
  // alertas) — arma/actualiza el borrador y emite directo, sin pasar
  // por /validar. validacion_ia/validado_en quedan en null.
  const emitirSinValidar = async () => {
    if (items.length === 0) return;
    setEmitiendo(true);
    setError(null);
    try {
      const idActual = await guardarBorrador();
      await descargarPdf(idActual);
      setEmitida(true);
    } catch (err) {
      console.error("Error al emitir la receta sin validar:", err);
      setError(err instanceof Error ? err.message : "No pudimos emitir la receta.");
    } finally {
      setEmitiendo(false);
    }
  };

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>} className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-black/10 bg-surface shadow-2xl">
      {dialogoSalida}
      <div className="border-b border-black/5 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="h-6 w-1 rounded-full bg-accent" aria-hidden="true" />
            <h2 className="text-lg font-bold text-primary">
              {emitida ? "Receta Emitida" : validacion ? "Validación de Prescripción" : "Nueva Prescripción"}
            </h2>
            {!emitida && <Badge variant="info">Borrador</Badge>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-error"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        {/* prompt_code_registro_atencion.md, respuesta del usuario — los
            dos caminos de receta no se unifican, pero acá se distinguen a
            simple vista: sin esto el médico usa el que tenga más cerca y
            el registro queda inconsistente entre "con visita" y "ajuste". */}
        <p className="mt-1.5 pl-4 text-xs font-medium text-text-muted">
          {origen.tipo === "atencion"
            ? "Con el paciente presente — se registra junto con esta atención."
            : "Ajuste sin visita — el paciente no está presente en esta consulta."}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {emitida ? (
          <div className="rounded-2xl border border-success/30 bg-success/5 p-5 text-center">
            <p className="text-2xl">✓</p>
            <p className="mt-2 text-sm font-semibold text-primary">Receta emitida correctamente</p>
            <p className="mt-1 text-xs text-text-muted">
              El PDF de la receta de {pacienteNombre} se descargó a tu navegador.
            </p>
          </div>
        ) : validacion ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-accent/5 p-4">
              <p className="text-sm font-semibold text-primary">{validacion.resumen_validacion}</p>
            </div>

            <div className="rounded-lg border border-black/10 bg-background p-3 text-xs text-text-muted">
              Esta validación es de apoyo clínico. La decisión final y la responsabilidad de la
              prescripción son exclusivamente del médico tratante.
            </div>

            {validacion.alertas.length === 0 ? (
              <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-success">
                No se identificaron riesgos relevantes con la información disponible.
              </div>
            ) : (
              <ul className="space-y-3">
                {validacion.alertas.map((alerta, i) => (
                  <li
                    key={i}
                    className={[
                      "rounded-xl border-l-4 p-4",
                      alerta.nivel === "alta"
                        ? "border-error bg-error/5"
                        : "border-warning bg-warning/10",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-text-primary">
                        {CATEGORIA_LABEL[alerta.categoria] ?? alerta.categoria}
                      </p>
                      <Badge variant={NIVEL_BADGE[alerta.nivel]} className="shrink-0">
                        {alerta.nivel}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-text-muted">
                      Afecta a: {alerta.medicamento_afectado}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-text-primary">{alerta.descripcion}</p>
                    <p className="mt-2 text-xs text-text-muted">Fuente: {alerta.fuente}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Sticky: sin esto, el buscador scrollea fuera de vista en
                cuanto hay un ítem + sus campos abajo, y en la práctica se
                sentía como si hubiera desaparecido — el médico terminaba
                de cargar dosis/frecuencia/duración del primer medicamento,
                bajaba a instrucciones, y ya no encontraba cómo agregar un
                segundo (ver prompt_fix_receta_multiitem.md). El estado y
                el backend ya soportaban N items desde siempre; esto era
                puramente de layout. */}
            <div
              ref={busquedaRef}
              className="sticky top-0 z-10 -mx-6 border-b border-black/5 bg-surface px-6 pb-3 pt-1"
            >
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-text-primary">
                  Buscar medicamento en catálogo
                </label>
                {/* Mismo mecanismo que el input de abajo — no es un flujo
                    de alta separado, solo le da foco al buscador para que
                    el médico pueda empezar a escribir de una. */}
                <button
                  type="button"
                  onClick={() => {
                    setMostrarResultados(true);
                    inputBusquedaRef.current?.focus();
                  }}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  + Agregar medicamento
                </button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                  🔍
                </span>
                <input
                  ref={inputBusquedaRef}
                  className="relative mt-1.5 w-full rounded-lg border border-black/10 bg-background py-2.5 pl-9 pr-4 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  placeholder="Ej. Metronidazol"
                  value={busqueda}
                  onChange={(e) => {
                    setBusqueda(e.target.value);
                    setMostrarResultados(true);
                  }}
                  onFocus={() => setMostrarResultados(true)}
                />
              </div>
              {mostrarResultados && busqueda.trim() && (
                <div className="absolute inset-x-6 z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-black/10 bg-surface shadow-lg">
                  {buscando ? (
                    <p className="p-3 text-xs text-text-muted">Buscando…</p>
                  ) : resultados.length === 0 ? (
                    <p className="p-3 text-xs text-text-muted">Sin resultados en el catálogo.</p>
                  ) : (
                    resultados.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => agregarMedicamento(m)}
                        className="flex w-full items-center gap-1 px-3 py-2 text-left text-sm hover:bg-accent/5"
                      >
                        <span className="text-accent">+</span>
                        <span className="font-medium text-text-primary">
                          {m.nombre}
                          {m.concentracion ? ` ${m.concentracion}` : ""}
                        </span>
                        {m.presentacion && (
                          <span className="text-text-muted">({m.presentacion})</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <p className="text-sm font-semibold text-text-primary">
              Medicamentos en esta receta ({items.length})
            </p>

            {items.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-black/15 p-8 text-center">
                <span className="text-3xl" aria-hidden="true">
                  💊
                </span>
                <p className="text-sm text-text-muted">
                  Aún no se han agregado medicamentos. Usá el buscador de arriba para agregar el primero.
                </p>
              </div>
            )}

            {items.map((item, index) => (
              <div key={item.clientId} className="rounded-2xl border border-black/10 bg-background p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <h3 className="text-sm font-bold text-primary">
                      {item.medicamentoNombre}
                      {item.concentracion && (
                        <span className="ml-1 font-normal text-text-muted">({item.concentracion})</span>
                      )}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => quitarItem(item.clientId)}
                    className="text-error hover:opacity-70"
                    aria-label={`Quitar ${item.medicamentoNombre}`}
                  >
                    🗑
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-text-muted">Dosis</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                      value={item.dosis}
                      onChange={(e) => actualizarItem(item.clientId, "dosis", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted">Frecuencia</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                      value={item.frecuencia}
                      onChange={(e) => actualizarItem(item.clientId, "frecuencia", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted">Duración</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                      value={item.duracion}
                      onChange={(e) => actualizarItem(item.clientId, "duracion", e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-2">
                  <label className="text-xs font-semibold text-text-muted">Vía de administración</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                    value={item.viaAdministracion}
                    onChange={(e) => actualizarItem(item.clientId, "viaAdministracion", e.target.value)}
                  />
                </div>

                <div className="mt-2">
                  <label className="text-xs font-semibold text-text-muted">Observaciones</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                    value={item.observaciones}
                    onChange={(e) => actualizarItem(item.clientId, "observaciones", e.target.value)}
                  />
                </div>
              </div>
            ))}

            <div>
              <label className="text-sm font-semibold text-text-primary">
                Instrucciones generales (internas)
              </label>
              <textarea
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                rows={2}
                value={instruccionesGenerales}
                onChange={(e) => setInstruccionesGenerales(e.target.value)}
                placeholder="Uso clínico interno — no se imprime en el PDF del propietario."
              />
            </div>

            {/* Distinción a propósito, fácil de confundir: "generales"
                arriba es uso clínico interno y NUNCA se imprime; este campo
                de acá SÍ va impreso en el PDF que recibe el propietario
                (ver ensamblado del PDF en el backend, recetas.routes.ts). */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                📄 Instrucciones para el propietario (va en PDF)
              </label>
              <textarea
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                rows={2}
                value={instruccionesPropietario}
                onChange={(e) => setInstruccionesPropietario(e.target.value)}
                placeholder="Este texto sale impreso en la receta que recibe el propietario."
              />
            </div>
          </div>
        )}

        {validando && (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
            <p className="text-sm font-semibold text-primary">Validando receta…</p>
            <p className="mt-1 text-xs text-text-muted">
              Esto puede tardar — es una llamada real al modelo clínico.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">
            {error}
          </div>
        )}
      </div>

      <div className="flex gap-3 border-t border-black/5 p-6">
        {emitida ? (
          <Button fullWidth onClick={onClose}>
            Cerrar
          </Button>
        ) : validacion ? (
          <>
            <Button variant="secondary" onClick={modificarReceta} disabled={emitiendo} className="flex-1">
              Modificar Receta
            </Button>
            <Button onClick={emitirReceta} disabled={emitiendo} className="flex-1">
              {emitiendo ? "Emitiendo…" : "Emitir receta"}
            </Button>
          </>
        ) : (
          <div className="flex w-full flex-col gap-2">
            {/* Las dos opciones tienen el mismo peso visual a propósito
                — validar es informativo, nunca obligatorio, la decisión
                final siempre es del médico. */}
            <div className="flex gap-3">
              <Button
                onClick={validarReceta}
                disabled={!validacionDisponible || validando || emitiendo || items.length === 0}
                className="flex-1"
              >
                {validando ? "Validando…" : "Validar receta"}
              </Button>
              <Button
                onClick={emitirSinValidar}
                disabled={validando || emitiendo || items.length === 0}
                className="flex-1"
              >
                {emitiendo ? "Emitiendo…" : "Emitir sin validar"}
              </Button>
            </div>
            {/* prompt_code_registro_atencion.md, Paso 3 — nunca ocultar el
                botón sin explicar por qué: el médico tiene que saber que
                esta receta se emite sin verificación, no encontrarse con
                que "Validar" simplemente no está. */}
            {!validacionDisponible ? (
              <p className="text-center text-xs text-warning">
                Esta atención no está ligada a un caso, así que no hay validación clínica por IA disponible — se
                emite directo.
              </p>
            ) : (
              <p className="text-center text-xs text-text-muted">
                "Emitir sin validar" generará la receta sin revisión de seguridad clínica por IA.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
