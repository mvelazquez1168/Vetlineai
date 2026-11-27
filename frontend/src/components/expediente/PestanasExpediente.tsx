import { plural } from "../../lib/plural";
import { useEffect, useMemo, useState } from "react";
import { apiFetchFile } from "../../lib/api";
import { guardarComoArchivo } from "../../lib/descargas";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  LimiteDeError,
  LoadingState,
  Modal,
  Select,
  useToast,
} from "../ui";
import { getStoredToken, useAuth } from "../../hooks/useAuth";
import { AtencionActual } from "./AtencionActual";
import { ModalLaboratorio } from "./ModalLaboratorio";
import { DondeSeRegistra, ModalHistorico } from "./AccionesClinicas";
import { PreventivosYGasto } from "../metricas/PreventivosYGasto";
import { PanelFirma } from "../ui/PanelFirma";
import { DocumentosDelPaciente } from "./DocumentosDelPaciente";
import {
  EncabezadoExpediente,
  EstudioLab,
  EventoHistoria,
  FichaRacial,
  GroomingRegistro,
  Tendencia,
  atencionApi,
  expedienteApi,
} from "../../lib/expedienteApi";

// ---------------------------------------------------------------------
// LAS PESTAÑAS DEL EXPEDIENTE — secciones 3 a 8 del prompt 07.
//
// POR QUÉ LAS PESTAÑAS "POR TIPO" SON LA LÍNEA DE TIEMPO FILTRADA:
// Visitas, Vacunas, Desparasitaciones, Prescripciones, Documentos y
// Casos son la misma pregunta —"qué pasó, de lo más nuevo a lo más
// viejo"— mirada por una dimensión distinta. Una implementación por
// pestaña serían seis listas con seis formatos de fecha y seis criterios
// de orden. Laboratorio, Grooming y Consentimientos SÍ tienen vista
// propia porque muestran cosas que una línea de tiempo no puede: una
// tabla de analitos con su rango, un hallazgo que hay que atender, un
// documento firmado.
//
// LO CLÍNICO ES DEL MÉDICO: los botones que escriben contenido clínico
// aparecen solo si quien mira es médico. No se muestran deshabilitados
// —un botón que nunca se puede apretar es ruido— salvo cuando explicar
// por qué ayuda.
// ---------------------------------------------------------------------

type Pestana =
  | "resumen"
  | "atencion"
  | "linea"
  | "visitas"
  | "vacunas"
  | "desparasitaciones"
  | "laboratorio"
  | "documentos"
  | "prescripciones"
  | "grooming"
  | "casos"
  | "consentimientos";

/**
 * Qué se registra desde dónde. Solo las pestañas que son historia pura
 * de algo que nace en la atención: «Visitas» o «Casos» no llevan este
 * aviso porque no hay una acción equivalente que ofrecer.
 */
const DONDE_SE_REGISTRA: Partial<
  Record<string, { que: string; atajo: string; historico?: "vacunacion" | "desparasitacion" }>
> = {
  vacunas: { que: "una vacuna", atajo: "Vacuna (Alt+V)", historico: "vacunacion" },
  desparasitaciones: {
    que: "una desparasitación",
    atajo: "Desparasitación (Alt+D)",
    historico: "desparasitacion",
  },
  prescripciones: { que: "una receta", atajo: "Receta (Alt+R)" },
};

const PESTANAS: Array<{ clave: Pestana; etiqueta: string; tipoEvento?: string }> = [
  { clave: "resumen", etiqueta: "Resumen" },
  // La atención va segunda y no última: cuando el médico abre esta
  // pantalla, el paciente está delante.
  { clave: "atencion", etiqueta: "Atención actual" },
  { clave: "linea", etiqueta: "Línea de tiempo" },
  { clave: "visitas", etiqueta: "Visitas", tipoEvento: "visita" },
  { clave: "vacunas", etiqueta: "Vacunas", tipoEvento: "vacuna" },
  { clave: "desparasitaciones", etiqueta: "Desparasitaciones", tipoEvento: "desparasitacion" },
  { clave: "laboratorio", etiqueta: "Laboratorio" },
  { clave: "documentos", etiqueta: "Imágenes y documentos", tipoEvento: "documento" },
  { clave: "prescripciones", etiqueta: "Prescripciones", tipoEvento: "receta" },
  { clave: "grooming", etiqueta: "Grooming" },
  { clave: "casos", etiqueta: "Casos de Vetline Ai", tipoEvento: "caso" },
  { clave: "consentimientos", etiqueta: "Consentimientos" },
];

const ETIQUETA_EVENTO: Record<string, string> = {
  visita: "Visita",
  vacuna: "Vacuna",
  desparasitacion: "Desparasitación",
  receta: "Prescripción",
  laboratorio: "Laboratorio",
  grooming: "Grooming",
  documento: "Documento",
  consentimiento: "Consentimiento",
  caso: "Caso",
};

function fechaCorta(valor: string): string {
  const d = new Date(valor);
  return Number.isNaN(d.getTime())
    ? valor
    : d.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
}

export interface PestanasExpedienteProps {
  pacienteId: string;
  /**
   * El encabezado del expediente, o `null` si no se pudo cargar.
   *
   * ES NULABLE A PROPÓSITO (defecto 1.1 de la revisión del
   * 2026-11-27): antes era obligatorio, así que la pantalla de arriba no
   * dibujaba las pestañas hasta tenerlo, y si fallaba no las dibujaba
   * nunca. El expediente no depende de la franja de alertas.
   */
  encabezado: EncabezadoExpediente | null;
  onCambio: () => void;
  /**
   * La pestaña abierta, cuando la manda la pantalla de arriba. Existe
   * para que las acciones rápidas del encabezado —"registrar atención"—
   * lleven a su pestaña en vez de duplicar el formulario en un modal.
   */
  pestanaActiva?: string;
  onPestana?: (clave: string) => void;
}

export function PestanasExpediente({
  pacienteId,
  encabezado,
  onCambio,
  pestanaActiva,
  onPestana,
}: PestanasExpedienteProps) {
  const toast = useToast();
  const { esMedico } = useAuth();
  const [propia, setPropia] = useState<Pestana>("resumen");
  const pestana = (pestanaActiva as Pestana) ?? propia;
  const setPestana = (clave: Pestana) => {
    setPropia(clave);
    onPestana?.(clave);
  };

  // Para el aviso de "dónde se registra": si ya hay una atención
  // empezada, el botón dice «Ir a la atención abierta» y no «Abrir
  // una», que seria mentir y ademas abriria una segunda.
  const [hayAtencionAbierta, setHayAtencionAbierta] = useState(false);
  const [historico, setHistorico] = useState<null | "vacunacion" | "desparasitacion">(null);

  useEffect(() => {
    atencionApi
      .enCurso(pacienteId)
      .then((r) => setHayAtencionAbierta(!!r.atencionId))
      .catch(() => setHayAtencionAbierta(false));
  }, [pacienteId, pestana]);

  return (
    <div className="mt-6">
      {/* Las pestañas scrollean en horizontal en pantallas angostas: el
          médico usa esto en una tablet y once pestañas no entran. */}
      <div className="overflow-x-auto border-b border-black/5">
        <div className="flex gap-1">
          {PESTANAS.map((p) => (
            <button
              key={p.clave}
              type="button"
              onClick={() => setPestana(p.clave)}
              className={[
                "whitespace-nowrap px-3 py-2 text-sm",
                pestana === p.clave
                  ? "border-b-2 border-primary font-semibold text-primary"
                  : "text-text-muted hover:text-primary",
              ].join(" ")}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {/* UNA PESTAÑA QUE EXPLOTA NO SE LLEVA LAS OTRAS
            (defecto del 2026-11-27). La `key` es la pestaña:
            cambiar de pestaña rearma el límite, así que un
            error en «Atención actual» no deja Vacunas muerta. */}
        <LimiteDeError key={pestana} ambito={`la pestaña ${PESTANAS.find((p) => p.clave === pestana)?.etiqueta ?? pestana}`}>
        {pestana === "resumen" && !encabezado && (
          <p className="text-sm text-text-muted">
            El resumen necesita la cabecera del expediente, que no se pudo cargar. Las demás
            pestañas sí están disponibles.
          </p>
        )}
        {pestana === "resumen" && encabezado && (
          <Resumen
            pacienteId={pacienteId}
            encabezado={encabezado}
            esMedico={!!esMedico}
            onCambio={onCambio}
          />
        )}
        {pestana === "atencion" && (
          <AtencionActual
            pacienteEspecie={
              encabezado?.paciente?.especie ? String(encabezado.paciente.especie) : null
            }
            pacienteId={pacienteId}
            pacienteNombre={String(encabezado?.paciente?.nombre ?? "el paciente")}
            esMedico={!!esMedico}
            onCerrada={onCambio}
          />
        )}
        {pestana === "linea" && <LineaDeTiempo pacienteId={pacienteId} />}

        {/* IMÁGENES Y DOCUMENTOS (revisión del 2026-11-27).
            Antes esta pestaña era la línea de tiempo filtrada por el
            tipo «documento» y no permitía agregar nada: el médico que
            saca una radiografía no tenía dónde ponerla. Ahora es la
            galería con su carga, y la historia filtrada queda debajo,
            que es donde aparecen los documentos que llegaron por otros
            caminos (un resultado de laboratorio, un caso). */}
        {pestana === "documentos" && (
          <div className="space-y-6">
            <DocumentosDelPaciente pacienteId={pacienteId} onCambio={onCambio} />
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                En la historia del paciente
              </h4>
              <LineaDeTiempo pacienteId={pacienteId} tipoFijo="documento" />
            </div>
          </div>
        )}

        {PESTANAS.filter((p) => p.tipoEvento && p.clave !== "documentos").map(
          (p) =>
            pestana === p.clave && (
              <div key={p.clave}>
                {/* DONDE SE REGISTRA (prompt 07c, seccion 4). Estas
                    pestanas son historia y no lo decian: un medico que
                    entraba a "Vacunas" a poner la vacuna de hoy se
                    quedaba mirando una lista. */}
                {DONDE_SE_REGISTRA[p.clave] && (
                  <DondeSeRegistra
                    que={DONDE_SE_REGISTRA[p.clave]!.que}
                    atajo={DONDE_SE_REGISTRA[p.clave]!.atajo}
                    esMedico={!!esMedico}
                    hayAtencionAbierta={hayAtencionAbierta}
                    onIrALaAtencion={() => setPestana("atencion")}
                    accionExtra={
                      esMedico && DONDE_SE_REGISTRA[p.clave]!.historico ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setHistorico(DONDE_SE_REGISTRA[p.clave]!.historico ?? null)
                          }
                        >
                          Registrar histórico
                        </Button>
                      ) : undefined
                    }
                  />
                )}
                <LineaDeTiempo
                  pacienteId={pacienteId}
                  tipoFijo={p.tipoEvento}
                  titulo={p.etiqueta}
                />
              </div>
            )
        )}
        {pestana === "laboratorio" && (
          <>
            <DondeSeRegistra
              que="un estudio"
              atajo="Estudio (Alt+E)"
              esMedico={!!esMedico}
              hayAtencionAbierta={hayAtencionAbierta}
              onIrALaAtencion={() => setPestana("atencion")}
            />
            <Laboratorio pacienteId={pacienteId} esMedico={!!esMedico} onCambio={onCambio} />
          </>
        )}
        {pestana === "grooming" && (
          <Grooming pacienteId={pacienteId} esMedico={!!esMedico} onCambio={onCambio} />
        )}
        {pestana === "consentimientos" && (
          <Consentimientos pacienteId={pacienteId} onCambio={onCambio} />
        )}
        </LimiteDeError>
      </div>

      {historico && (
        <ModalHistorico
          abierto
          tipo={historico}
          pacienteId={pacienteId}
          onCerrar={() => setHistorico(null)}
          onRegistrado={onCambio}
        />
      )}
    </div>
  );
}

// =====================================================================
// RESUMEN: problemas, medicación activa, ficha racial y evolución
// =====================================================================
function Resumen({
  pacienteId,
  encabezado,
  esMedico,
  onCambio,
}: {
  pacienteId: string;
  encabezado: EncabezadoExpediente;
  esMedico: boolean;
  onCambio: () => void;
}) {
  const toast = useToast();
  const [ficha, setFicha] = useState<FichaRacial | null>(null);
  const [puntos, setPuntos] = useState<
    Array<{ fecha: string; peso: string | null; temperatura: string | null }>
  >([]);
  const [nuevoProblema, setNuevoProblema] = useState("");
  const [nuevaAlergia, setNuevaAlergia] = useState({ sustancia: "", grupo: "", severidad: "moderada" });
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    expedienteApi.fichaRacial(pacienteId).then(setFicha).catch(() => setFicha(null));
    expedienteApi
      .evolucion(pacienteId)
      .then((r) => setPuntos(r.puntos))
      .catch(() => setPuntos([]));
  }, [pacienteId]);

  const agregarProblema = async () => {
    if (!nuevoProblema.trim()) return;
    setOcupado(true);
    try {
      await expedienteApi.agregarProblema(pacienteId, { descripcion: nuevoProblema.trim() });
      setNuevoProblema("");
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const resolver = async (problemaId: string, estado: string) => {
    try {
      await expedienteApi.cambiarProblema(problemaId, { estado });
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const agregarAlergia = async () => {
    if (!nuevaAlergia.sustancia.trim()) return;
    setOcupado(true);
    try {
      await expedienteApi.registrarAlergia(pacienteId, {
        sustancia: nuevaAlergia.sustancia.trim(),
        grupo: nuevaAlergia.grupo.trim() || undefined,
        severidad: nuevaAlergia.severidad,
      });
      setNuevaAlergia({ sustancia: "", grupo: "", severidad: "moderada" });
      toast.exito("Registrada. A partir de ahora avisa al recetar.");
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const pesos = puntos.filter((p) => p.peso !== null);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* -------------------------------------- Lista de problemas */}
      <Card>
        <CardTitle>Lista de problemas</CardTitle>
        <CardDescription>
          El hilo que une visitas separadas en el tiempo. Un problema nace en una consulta, se trata
          en varias y se resuelve en otra.
        </CardDescription>
        <ul className="mt-3 space-y-2">
          {encabezado.problemas.map((p) => (
            <li key={p.id} className="rounded-lg border border-black/5 p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{p.descripcion}</span>
                <Badge
                  variant={
                    p.estado === "resuelto" ? "neutral" : p.estado === "cronico" ? "warning" : "info"
                  }
                  dot
                >
                  {p.estado}
                </Badge>
              </div>
              <span className="block text-xs text-text-muted">
                desde {fechaCorta(p.fecha_inicio)}
                {p.fecha_resolucion ? ` · resuelto el ${fechaCorta(p.fecha_resolucion)}` : ""}
                {p.atenciones > 0 ? ` · ${plural(p.atenciones, "visita", "visitas")}` : ""}
              </span>
              {esMedico && p.estado !== "resuelto" && (
                <div className="mt-1 flex gap-2">
                  {p.estado !== "cronico" && (
                    <button
                      type="button"
                      className="text-xs underline text-text-muted"
                      onClick={() => resolver(p.id, "cronico")}
                    >
                      marcar crónico
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-xs underline text-text-muted"
                    onClick={() => resolver(p.id, "resuelto")}
                  >
                    resolver
                  </button>
                </div>
              )}
            </li>
          ))}
          {encabezado.problemas.length === 0 && (
            <li className="text-sm text-text-muted">Sin problemas registrados.</li>
          )}
        </ul>
        {esMedico && (
          <div className="mt-3 flex gap-2">
            <Input
              name="nuevo-problema"
              label="Agregar un problema"
              value={nuevoProblema}
              onChange={(e) => setNuevoProblema(e.target.value)}
              placeholder="Dermatitis alérgica"
            />
            <div className="flex items-end">
              <Button disabled={ocupado || !nuevoProblema.trim()} onClick={agregarProblema}>
                Agregar
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ------------------------------------------ Medicación activa */}
      <Card>
        <CardTitle>Medicación activa</CardTitle>
        <CardDescription>
          Lo recetado cuya duración todavía no terminó. Una duración que no se puede interpretar se
          muestra igual, marcada: desaparecer de la lista sería peor.
        </CardDescription>
        <ul className="mt-3 space-y-2 text-sm">
          {encabezado.medicacionActiva.map((m, i) => (
            <li key={`${m.receta_id}-${i}`} className="rounded-lg border border-black/5 p-2">
              <span className="font-medium">{m.medicamento}</span>
              <span className="block text-xs text-text-muted">
                {[m.dosis, m.frecuencia, m.duracion].filter(Boolean).join(" · ")}
                {m.fecha_fin
                  ? ` · hasta el ${fechaCorta(m.fecha_fin)}`
                  : m.duracionEstructurada
                    ? ""
                    : " · duración sin fecha calculable"}
              </span>
            </li>
          ))}
          {encabezado.medicacionActiva.length === 0 && (
            <li className="text-text-muted">Sin medicación activa.</li>
          )}
        </ul>

        <CardTitle className="mt-6">Alergias y reacciones</CardTitle>
        <CardDescription>
          Estas son las que <strong>avisan al recetar</strong>. La nota libre de la ficha se lee en
          la franja de arriba, pero no puede dispararse sola.
        </CardDescription>
        <ul className="mt-3 space-y-1 text-sm">
          {encabezado.alergias.map((a) => (
            <li key={a.id}>
              <span className="font-medium">{a.sustancia}</span>
              {a.grupo && <span className="text-text-muted"> · grupo {a.grupo}</span>}
              <Badge variant={a.severidad === "grave" ? "error" : "warning"} className="ml-2">
                {a.severidad}
              </Badge>
              {a.reaccion && <span className="block text-xs text-text-muted">{a.reaccion}</span>}
            </li>
          ))}
          {encabezado.alergias.length === 0 && (
            <li className="text-text-muted">Ninguna registrada.</li>
          )}
        </ul>
        {esMedico && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Input
              name="alergia-sustancia"
              label="Sustancia"
              value={nuevaAlergia.sustancia}
              onChange={(e) => setNuevaAlergia({ ...nuevaAlergia, sustancia: e.target.value })}
              placeholder="Penicilina"
            />
            <Input
              name="alergia-grupo"
              label="Grupo (opcional)"
              value={nuevaAlergia.grupo}
              onChange={(e) => setNuevaAlergia({ ...nuevaAlergia, grupo: e.target.value })}
              placeholder="penicilinas"
            />
            <Select
              name="alergia-severidad"
              label="Severidad"
              value={nuevaAlergia.severidad}
              onChange={(e) => setNuevaAlergia({ ...nuevaAlergia, severidad: e.target.value })}
              options={[
                { value: "leve", label: "Leve" },
                { value: "moderada", label: "Moderada" },
                { value: "grave", label: "Grave" },
              ]}
            />
            <div className="sm:col-span-3">
              <Button
                variant="secondary"
                disabled={ocupado || !nuevaAlergia.sustancia.trim()}
                onClick={agregarAlergia}
              >
                Registrar alergia
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ----------------------------------------- Ficha racial */}
      <Card>
        <CardTitle>Predisposiciones raciales</CardTitle>
        <CardDescription>
          Salen del documento de la base de conocimiento de Vetline Ai, no de un texto escrito acá.
        </CardDescription>
        {!ficha ? (
          <LoadingState forma="lineas" cantidad={3} />
        ) : ficha.texto ? (
          <>
            <p className="mt-2 text-sm font-medium text-text-primary">{ficha.raza}</p>
            {ficha.seccionAgrupada && (
              <p className="mt-1 rounded-lg bg-warning/10 p-2 text-xs text-text-primary">
                La sección del documento agrupa varias razas: {ficha.motivo}
              </p>
            )}
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs text-text-primary">
              {ficha.texto}
            </pre>
            <p className="mt-2 text-xs text-text-muted">
              Es una recomendación al médico para orientar los chequeos preventivos, nunca una
              indicación automática.
            </p>
          </>
        ) : (
          <p className="mt-2 rounded-lg bg-background p-3 text-sm text-text-muted">
            {ficha.motivo}
          </p>
        )}
      </Card>

      {/* -------------------------------------------- Evolución */}
      <Card>
        <CardTitle>Evolución</CardTitle>
        <CardDescription>Peso y temperatura registrados en cada visita.</CardDescription>
        {pesos.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            Todavía no hay pesos registrados en ninguna visita.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                <th className="py-1">Fecha</th>
                <th className="py-1 text-right">Peso</th>
                <th className="py-1 text-right">Temperatura</th>
              </tr>
            </thead>
            <tbody>
              {puntos.map((p, i) => (
                <tr key={i} className="border-b border-black/5">
                  <td className="py-1">{fechaCorta(p.fecha)}</td>
                  <td className="py-1 text-right">{p.peso ? `${Number(p.peso)} kg` : "—"}</td>
                  <td className="py-1 text-right">
                    {p.temperatura ? `${Number(p.temperatura)} °C` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Prompt 12, §5: el estado de preventivos POR TIPO —distinguiendo
          «sin registro» de «no vacunado»—, el gasto acumulado y los
          casos abiertos. Va al final del Resumen y no reemplaza nada: la
          cabecera, los problemas y la evolución ya estaban. */}
      <PreventivosYGasto pacienteId={pacienteId} />
    </div>
  );
}

// =====================================================================
// LÍNEA DE TIEMPO (y las pestañas por tipo, que son esto con el tipo fijo)
// =====================================================================
function LineaDeTiempo({
  pacienteId,
  tipoFijo,
  titulo,
}: {
  pacienteId: string;
  tipoFijo?: string;
  titulo?: string;
}) {
  const toast = useToast();
  const { esAdminClinica } = useAuth();
  const [eventos, setEventos] = useState<EventoHistoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState({ tipo: "", desde: "", hasta: "" });
  const [busqueda, setBusqueda] = useState("");
  const [coincidencias, setCoincidencias] = useState<
    Array<{ tipo: string; fecha: string; donde: string; fragmento: string }>
  >([]);

  const tipoAplicado = tipoFijo ?? filtros.tipo;

  useEffect(() => {
    setCargando(true);
    const q: Record<string, string> = {};
    if (tipoAplicado) q.tipo = tipoAplicado;
    if (filtros.desde) q.desde = filtros.desde;
    if (filtros.hasta) q.hasta = filtros.hasta;
    expedienteApi
      .lineaDeTiempo(pacienteId, q)
      .then((r) => setEventos(r.eventos))
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  }, [pacienteId, tipoAplicado, filtros.desde, filtros.hasta]);

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setCoincidencias([]);
      return;
    }
    const t = setTimeout(() => {
      expedienteApi
        .buscar(pacienteId, busqueda)
        .then((r) => setCoincidencias(r.coincidencias))
        .catch(() => setCoincidencias([]));
    }, 300);
    return () => clearTimeout(t);
  }, [pacienteId, busqueda]);

  return (
    <Card>
      <CardTitle>{titulo ?? "Línea de tiempo"}</CardTitle>
      <CardDescription>
        {tipoFijo
          ? "Es la línea de tiempo del paciente filtrada por este tipo: una sola implementación, para que todas las pestañas ordenen y fechen igual."
          : "Todo lo que le pasó al paciente, de lo más reciente a lo más antiguo."}
      </CardDescription>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {!tipoFijo && (
          <Select
            name="linea-tipo"
            label="Tipo"
            value={filtros.tipo}
            onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}
            options={[
              { value: "", label: "Todos" },
              ...Object.entries(ETIQUETA_EVENTO).map(([v, l]) => ({ value: v, label: l })),
            ]}
          />
        )}
        <div>
          <label className="text-sm font-semibold text-text-primary">Desde</label>
          <input
            type="date"
            className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
            value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-text-primary">Hasta</label>
          <input
            type="date"
            className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
            value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
          />
        </div>
        <Input
          name="linea-busqueda"
          label="Buscar en la historia"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="vómito, carprofeno…"
        />
      </div>

      {coincidencias.length > 0 && (
        <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="text-sm font-semibold text-text-primary">
            {plural(coincidencias.length, "coincidencia", "coincidencias")} de «{busqueda}» en toda la historia
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {coincidencias.map((c, i) => (
              <li key={i}>
                <span className="text-xs uppercase text-text-muted">
                  {fechaCorta(c.fecha)} · {c.donde}
                </span>
                <span className="block">{c.fragmento}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cargando ? (
        <LoadingState forma="lineas" cantidad={5} />
      ) : eventos.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          Nada registrado{tipoFijo ? " de este tipo" : ""} en ese período.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {eventos.map((e) => (
            <li key={`${e.tipo}-${e.referencia_id}`} className="border-l-2 border-black/10 pl-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}</Badge>
                {/* El enlace al caso lo tenía la sección "Casos" de la
                    ficha antes de las pestañas, y se conserva: el
                    detalle del caso vive en /admin/casos/:id y es solo
                    para administrador —un médico entra a sus casos por
                    su área de trabajo, con una ruta que necesita el
                    agenteId—. Mandarlo a una ruta que lo va a rebotar
                    sería peor que no enlazar. */}
                {e.tipo === "caso" && esAdminClinica ? (
                  <a
                    href={`/admin/casos/${e.referencia_id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {e.titulo}
                  </a>
                ) : (
                  <span className="text-sm font-medium text-text-primary">{e.titulo}</span>
                )}
                <span className="text-xs text-text-muted">{fechaCorta(e.fecha)}</span>
                {e.medico && <span className="text-xs text-text-muted">· {e.medico}</span>}
                {/* HISTÓRICO: lo cargó alguien de la cartilla del
                    cliente, no se aplicó acá. Una vacuna que la clínica
                    puso y una que el cliente dice que le pusieron en
                    otro lado no valen lo mismo para quien lee el
                    expediente. */}
                {e.historico && (
                  <Badge variant="info" title="Cargado de la cartilla; no se aplicó en esta clínica.">
                    histórico
                  </Badge>
                )}
              </div>
              {e.detalle && <p className="mt-0.5 text-sm text-text-muted">{e.detalle}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// =====================================================================
// LABORATORIO
// =====================================================================
function Laboratorio({
  pacienteId,
  esMedico,
  onCambio,
}: {
  pacienteId: string;
  esMedico: boolean;
  onCambio: () => void;
}) {
  const toast = useToast();
  const [estudios, setEstudios] = useState<EstudioLab[]>([]);
  const [analitos, setAnalitos] = useState<
    Array<{ codigo: string; nombre: string; unidad: string; mediciones: number }>
  >([]);
  const [cargando, setCargando] = useState(true);
  const [tendencia, setTendencia] = useState<Tendencia | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [cerrando, setCerrando] = useState<EstudioLab | null>(null);

  const recargar = () => {
    setCargando(true);
    expedienteApi
      .laboratorio(pacienteId)
      .then((r) => {
        setEstudios(r.estudios);
        setAnalitos(r.analitos);
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  };

  useEffect(recargar, [pacienteId]);

  const verTendencia = async (codigo: string) => {
    try {
      setTendencia(await expedienteApi.tendencia(pacienteId, codigo));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // El adjunto se baja por el endpoint autenticado, igual que el de un
  // caso: nunca por una URL directa al almacenamiento, que no tiene
  // sesion ni chequeo de clinica.
  const abrirAdjunto = async (archivoId: string, nombre: string) => {
    try {
      const { blob } = await apiFetchFile(`/archivos/${archivoId}`, { token: getStoredToken() });
      guardarComoArchivo(blob, nombre);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const marcarVisto = async (id: string) => {
    try {
      await expedienteApi.marcarVisto(id);
      recargar();
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {/* REGISTRAR LABORATORIO es la accion principal (anexo 07-03, A6):
          el caso normal es que el estudio YA SE HIZO y lo que falta es
          dejar su resultado. El formulario de tres campos que habia aca
          solo sabia crear una orden. */}
      {esMedico && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Laboratorio</CardTitle>
              <CardDescription>
                Registre un estudio ya realizado con su archivo, o dejelo pendiente si el resultado
                todavia no llego. Tambien entra lo que el cliente trae de otra clinica.
              </CardDescription>
            </div>
            <Button onClick={() => setRegistrando(true)}>+ Registrar laboratorio</Button>
          </div>
        </Card>
      )}

      <ModalLaboratorio
        abierto={registrando}
        pacienteId={pacienteId}
        onCerrar={() => setRegistrando(false)}
        onRegistrado={() => {
          recargar();
          onCambio();
        }}
      />

      {analitos.length > 0 && (
        <Card>
          <CardTitle>Tendencias</CardTitle>
          <CardDescription>
            La evolución de un valor a lo largo de las visitas, con su rango de referencia por
            especie marcado.
          </CardDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            {analitos.map((a) => (
              <Button key={a.codigo} variant="secondary" onClick={() => verTendencia(a.codigo)}>
                {a.nombre} ({a.mediciones})
              </Button>
            ))}
          </div>

          {tendencia && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-text-primary">
                {tendencia.nombre} {tendencia.unidad ? `(${tendencia.unidad})` : ""}
                {tendencia.refMin !== null || tendencia.refMax !== null ? (
                  <span className="ml-2 text-xs font-normal text-text-muted">
                    rango {tendencia.refMin ?? "—"}–{tendencia.refMax ?? "—"}
                  </span>
                ) : (
                  <span className="ml-2 text-xs font-normal text-text-muted">
                    sin rango de referencia cargado
                  </span>
                )}
              </p>
              <table className="mt-2 w-full text-left text-sm">
                <tbody>
                  {tendencia.puntos.map((p, i) => (
                    <tr key={i} className="border-b border-black/5">
                      <td className="py-1">{fechaCorta(p.fecha)}</td>
                      <td className="py-1 text-right font-medium">{p.valor}</td>
                      <td className="py-1 pl-3">
                        {p.bandera && p.bandera !== "normal" ? (
                          <Badge variant="error">{p.bandera}</Badge>
                        ) : (
                          <span className="text-xs text-success">normal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {cargando ? (
        <LoadingState forma="tarjetas" cantidad={2} />
      ) : estudios.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">Sin estudios de laboratorio.</p>
        </Card>
      ) : (
        estudios.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{e.tipo_estudio}</CardTitle>
                <p className="text-xs text-text-muted">
                  {e.fecha_muestra
                    ? `muestra del ${fechaCorta(e.fecha_muestra)}`
                    : fechaCorta(e.fecha_resultado ?? e.fecha_solicitud)}
                  {e.es_externo ? ` · externo${e.laboratorio ? `: ${e.laboratorio}` : ""}` : " · interno"}
                  {e.solicitado_por_nombre ? ` · pedido por ${e.solicitado_por_nombre}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* LOS PENDIENTES SE DISTINGUEN A SIMPLE VISTA, y con el
                    nombre que entiende el medico: «solicitado» es el
                    valor de la base, no lo que se dice en una clinica
                    (anexo 07-03, A6). */}
                <Badge
                  variant={
                    e.estado === "resultado_recibido"
                      ? e.visto_en
                        ? "success"
                        : "warning"
                      : e.estado === "cancelado"
                        ? "neutral"
                        : "info"
                  }
                  dot
                >
                  {e.estado === "resultado_recibido"
                    ? e.visto_en
                      ? "con resultado"
                      : "resultado sin revisar"
                    : e.estado === "cancelado"
                      ? "cancelado"
                      : "pendiente de resultado"}
                </Badge>
                {esMedico && e.estado === "solicitado" && (
                  <Button variant="secondary" onClick={() => setCerrando(e)}>
                    Cargar el resultado
                  </Button>
                )}
                {esMedico && e.estado === "resultado_recibido" && !e.visto_en && (
                  <Button variant="secondary" onClick={() => marcarVisto(e.id)}>
                    Marcar visto
                  </Button>
                )}
              </div>
            </div>

            {e.resultados.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                      <th className="py-1">Analito</th>
                      <th className="py-1 text-right">Valor</th>
                      <th className="py-1">Unidad</th>
                      <th className="py-1">Referencia</th>
                      <th className="py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {e.resultados.map((r, i) => (
                      <tr key={i} className="border-b border-black/5">
                        <td className="py-1">{r.analito}</td>
                        <td className="py-1 text-right font-medium">
                          {r.valor ?? r.valor_texto}
                        </td>
                        <td className="py-1 text-xs text-text-muted">{r.unidad ?? "—"}</td>
                        <td className="py-1 text-xs text-text-muted">
                          {r.ref_min !== null || r.ref_max !== null
                            ? `${r.ref_min ?? "—"}–${r.ref_max ?? "—"}`
                            : "sin rango"}
                        </td>
                        <td className="py-1">
                          {r.bandera === "alto" || r.bandera === "bajo" ? (
                            <Badge variant="error">{r.bandera}</Badge>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {e.observaciones && (
              <p className="mt-2 text-sm text-text-muted">{e.observaciones}</p>
            )}

            {/* LOS ARCHIVOS DEL RESULTADO (anexo 07-03, A6). Se abren con
                el mismo descargador autenticado que los adjuntos de un
                caso: nunca una URL directa al almacenamiento. */}
            {e.adjuntos?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-black/5 pt-3">
                {e.adjuntos.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-black/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-black/5"
                    onClick={() => void abrirAdjunto(a.id, a.nombre_archivo)}
                  >
                    <Icono nombre={a.tipo === "imagen" ? "paciente" : "pdf"} tamano={14} />
                    {a.nombre_archivo}
                  </button>
                ))}
              </div>
            )}
          </Card>
        ))
      )}

      {/* CERRAR UN PENDIENTE: el mismo estudio gana su resultado, no se
          crea otro registro. */}
      {cerrando && (
        <ModalCerrarPendiente
          estudio={cerrando}
          onCerrar={() => setCerrando(null)}
          onListo={() => {
            recargar();
            onCambio();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// «Ya llegó el resultado» — anexo 07-03, A6.
//
// No crea un estudio nuevo: cierra el que ya estaba pendiente, con su
// fecha de muestra, su comentario y sus archivos.
// ---------------------------------------------------------------------
function ModalCerrarPendiente({
  estudio,
  onCerrar,
  onListo,
}: {
  estudio: EstudioLab;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const toast = useToast();
  const [fechaMuestra, setFechaMuestra] = useState(new Date().toISOString().slice(0, 10));
  const [observaciones, setObservaciones] = useState(estudio.observaciones ?? "");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const guardar = async () => {
    setOcupado(true);
    try {
      await atencionApi.cerrarPendienteConResultado(estudio.id, {
        fechaMuestra,
        observaciones: observaciones || null,
      });
      let fallados = 0;
      for (const archivo of archivos) {
        try {
          await atencionApi.adjuntarAlEstudio(estudio.id, archivo);
        } catch {
          fallados++;
        }
      }
      if (fallados > 0) {
        toast.error(`El resultado quedó cargado, pero ${fallados} archivo(s) no se subieron.`);
      } else {
        toast.exito("Resultado cargado.");
      }
      onListo();
      onCerrar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCerrar}
      title={`Resultado de ${estudio.tipo_estudio}`}
      description="Se cierra el estudio que estaba pendiente. No se crea otro."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCerrar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={ocupado}>
            {ocupado ? "Guardando…" : "Cargar el resultado"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input
          label="Fecha de la toma de la muestra"
          type="date"
          value={fechaMuestra}
          onChange={(e) => setFechaMuestra(e.target.value)}
        />
        <div>
          <span className="mb-1 block text-sm font-semibold text-text-primary">
            Resultado (PDF o foto)
          </span>
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => setArchivos(Array.from(e.target.files ?? []))}
            className="block w-full text-sm text-text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-sobre-primary"
          />
        </div>
        <Input
          label="Comentario o interpretación"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />
      </div>
    </Modal>
  );
}

// =====================================================================
// GROOMING
// =====================================================================
function Grooming({
  pacienteId,
  esMedico,
  onCambio,
}: {
  pacienteId: string;
  esMedico: boolean;
  onCambio: () => void;
}) {
  const toast = useToast();
  const [registros, setRegistros] = useState<GroomingRegistro[]>([]);
  const [cargando, setCargando] = useState(true);
  const [registrando, setRegistrando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [nuevo, setNuevo] = useState({
    tipoCorte: "",
    comportamiento: "tranquilo",
    observaciones: "",
    servicio: "Baño y corte",
    hallazgoTipo: "",
    hallazgoDescripcion: "",
  });

  const recargar = () => {
    setCargando(true);
    expedienteApi
      .grooming(pacienteId)
      .then((r) => setRegistros(r.grooming))
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  };

  useEffect(recargar, [pacienteId]);

  const registrar = async () => {
    setOcupado(true);
    try {
      const r = await expedienteApi.registrarGrooming(pacienteId, {
        tipoCorte: nuevo.tipoCorte.trim() || undefined,
        comportamiento: nuevo.comportamiento,
        observaciones: nuevo.observaciones.trim() || undefined,
        servicios: nuevo.servicio.trim() ? [{ descripcion: nuevo.servicio.trim() }] : [],
        hallazgos:
          nuevo.hallazgoTipo && nuevo.hallazgoDescripcion.trim()
            ? [{ tipo: nuevo.hallazgoTipo, descripcion: nuevo.hallazgoDescripcion.trim() }]
            : [],
      });
      toast.exito(
        r.hallazgos > 0
          ? "Grooming registrado. El hallazgo queda en las alertas del paciente y avisa al médico."
          : "Grooming registrado."
      );
      setRegistrando(false);
      setNuevo({
        tipoCorte: "",
        comportamiento: "tranquilo",
        observaciones: "",
        servicio: "Baño y corte",
        hallazgoTipo: "",
        hallazgoDescripcion: "",
      });
      recargar();
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const atender = async (hallazgoId: string) => {
    try {
      await expedienteApi.atenderHallazgo(hallazgoId);
      toast.exito("Hallazgo revisado: sale de las alertas.");
      recargar();
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          El groomer es quien toca al animal entero cada mes: lo que encuentra se marca como{" "}
          <strong>hallazgo</strong> y llega al médico.
        </p>
        <Button onClick={() => setRegistrando(true)}>
          <Icono nombre="agregar" className="mr-1 h-4 w-4" />
          Registrar grooming
        </Button>
      </div>

      {cargando ? (
        <LoadingState forma="tarjetas" cantidad={2} />
      ) : registros.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">Sin registros de grooming.</p>
        </Card>
      ) : (
        registros.map((g) => (
          <Card key={g.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{fechaCorta(g.fecha)}</CardTitle>
                <p className="text-xs text-text-muted">
                  {[g.groomer_nombre, g.tipo_corte, g.comportamiento].filter(Boolean).join(" · ")}
                </p>
              </div>
              {g.servicios.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {g.servicios.map((s, i) => (
                    <Badge key={i} variant="neutral">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {g.observaciones && <p className="mt-2 text-sm">{g.observaciones}</p>}
            {g.hallazgos.length > 0 && (
              <ul className="mt-3 space-y-2">
                {g.hallazgos.map((h) => (
                  <li
                    key={h.id}
                    className={[
                      "rounded-lg p-2 text-sm",
                      h.atendido_en ? "bg-background" : "bg-error/10",
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong>{h.tipo}</strong> · {h.descripcion}
                      </span>
                      {h.atendido_en ? (
                        <Badge variant="success" dot>
                          revisado
                        </Badge>
                      ) : esMedico ? (
                        <Button variant="secondary" onClick={() => atender(h.id)}>
                          Marcar revisado
                        </Button>
                      ) : (
                        <Badge variant="warning" dot>
                          espera al médico
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))
      )}

      <Modal
        open={registrando}
        onClose={() => setRegistrando(false)}
        title="Registrar grooming"
        ancho="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRegistrando(false)}>
              Cancelar
            </Button>
            <Button disabled={ocupado} onClick={registrar}>
              Registrar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input
            name="groom-servicio"
            label="Servicios"
            value={nuevo.servicio}
            onChange={(e) => setNuevo({ ...nuevo, servicio: e.target.value })}
            placeholder="Baño, corte, uñas, oídos"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              name="groom-corte"
              label="Tipo de corte"
              value={nuevo.tipoCorte}
              onChange={(e) => setNuevo({ ...nuevo, tipoCorte: e.target.value })}
            />
            <Select
              name="groom-comportamiento"
              label="Comportamiento"
              value={nuevo.comportamiento}
              onChange={(e) => setNuevo({ ...nuevo, comportamiento: e.target.value })}
              options={[
                { value: "tranquilo", label: "Tranquilo" },
                { value: "nervioso", label: "Nervioso" },
                { value: "agresivo", label: "Agresivo" },
                { value: "no_coopera", label: "No coopera" },
              ]}
            />
          </div>
          <Input
            name="groom-observaciones"
            label="Observaciones"
            value={nuevo.observaciones}
            onChange={(e) => setNuevo({ ...nuevo, observaciones: e.target.value })}
          />
          <div className="rounded-lg border border-black/5 p-3">
            <p className="text-sm font-semibold text-text-primary">¿Encontraste algo?</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Lo que marques acá va a la franja de alertas del paciente y queda esperando a que un
              médico lo revise. No es un diagnóstico: es lo que viste.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Select
                name="groom-hallazgo-tipo"
                label="Qué"
                value={nuevo.hallazgoTipo}
                onChange={(e) => setNuevo({ ...nuevo, hallazgoTipo: e.target.value })}
                options={[
                  { value: "", label: "Nada para reportar" },
                  { value: "bulto", label: "Un bulto" },
                  { value: "herida", label: "Una herida" },
                  { value: "parasitos", label: "Parásitos" },
                  { value: "otitis", label: "Oídos sucios o con olor" },
                  { value: "dermatitis", label: "Piel irritada" },
                  { value: "dolor", label: "Dolor al tocar" },
                  { value: "dientes", label: "Dientes o encías" },
                  { value: "otro", label: "Otra cosa" },
                ]}
              />
              <Input
                name="groom-hallazgo-desc"
                label="Dónde y cómo"
                value={nuevo.hallazgoDescripcion}
                onChange={(e) => setNuevo({ ...nuevo, hallazgoDescripcion: e.target.value })}
                placeholder="Bulto de 1 cm en el flanco derecho"
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// =====================================================================
// CONSENTIMIENTOS
// =====================================================================
function Consentimientos({
  pacienteId,
  onCambio,
}: {
  pacienteId: string;
  onCambio: () => void;
}) {
  const toast = useToast();
  const [firmados, setFirmados] = useState<
    Array<{
      id: string;
      titulo: string;
      firmante_nombre: string;
      firmado_en: string;
      testigo: string | null;
      /** false en los firmados antes del arreglo del 2026-11-27. */
      firma_valida: boolean;
      firma_invalida_motivo: string | null;
      firmado_a_distancia: boolean;
      firmante_relacion: string | null;
      verificable: boolean;
    }>
  >([]);
  const [plantillas, setPlantillas] = useState<
    Array<{ id: string; tipo: string; titulo: string; activo: boolean }>
  >([]);
  const [firmando, setFirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [elegida, setElegida] = useState("");
  const [procedimiento, setProcedimiento] = useState("");
  const [preparado, setPreparado] = useState<{
    titulo: string;
    texto: string;
    firmanteSugerido: string;
    identificacion: string | null;
  } | null>(null);
  const [firmante, setFirmante] = useState({ nombre: "", identificacion: "" });
  // LA FIRMA REAL, en data URL. Antes era un booleano `firmaTrazada` y
  // el PNG era una constante: el booleano decía «ya firmó» y lo que se
  // guardaba era siempre la misma imagen vacía.
  const [firmaPng, setFirmaPng] = useState<string | null>(null);
  const [relacion, setRelacion] = useState<"propietario" | "autorizado">("propietario");
  const [autorizadoPor, setAutorizadoPor] = useState("");
  const [enviandoEnlace, setEnviandoEnlace] = useState(false);

  const recargar = () => {
    expedienteApi
      .consentimientos(pacienteId)
      .then((r) => setFirmados(r.consentimientos))
      .catch(() => setFirmados([]));
    expedienteApi
      .plantillasConsentimiento()
      .then((r) => setPlantillas(r.plantillas.filter((p) => p.activo)))
      .catch(() => setPlantillas([]));
  };

  useEffect(recargar, [pacienteId]);

  const sembrar = async () => {
    try {
      const r = await expedienteApi.sembrarPlantillasBase();
      toast.exito(
        r.creadas > 0
          ? `${plural(r.creadas, "plantilla creada", "plantillas creadas")}. Son un punto de partida: el texto es de la clínica y se edita.`
          : "Las plantillas base ya estaban."
      );
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const preparar = async (plantillaId: string) => {
    setElegida(plantillaId);
    if (!plantillaId) {
      setPreparado(null);
      return;
    }
    try {
      const p = await expedienteApi.prepararConsentimiento(pacienteId, plantillaId, procedimiento);
      setPreparado(p);
      setFirmante({ nombre: p.firmanteSugerido, identificacion: p.identificacion ?? "" });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const pedirADistancia = async () => {
    if (!preparado) return;
    setEnviandoEnlace(true);
    try {
      const r = await expedienteApi.firmaADistancia(pacienteId, {
        plantillaId: elegida || undefined,
        titulo: preparado.titulo,
        texto: preparado.texto,
      });
      toast.exito(
        `Enlace enviado por ${r.canal === "whatsapp" ? "WhatsApp" : "correo"} a ${r.destino}. ` +
          "Sirve una sola vez y vence en 48 horas."
      );
      setFirmando(false);
      setPreparado(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEnviandoEnlace(false);
    }
  };

  const firmar = async () => {
    if (!preparado) return;
    setOcupado(true);
    try {
      // EL TRAZO QUE DIBUJÓ EL CLIENTE, no una imagen fija. El
      // dispositivo, la IP, la hora y el testigo los pone el servidor:
      // si viajaran desde acá, serían cuatro datos que el navegador
      // puede inventar.
      if (!firmaPng) {
        toast.error("Falta la firma del cliente.");
        return;
      }
      const r = await expedienteApi.firmarConsentimiento(pacienteId, {
        plantillaId: elegida,
        titulo: preparado.titulo,
        texto: preparado.texto,
        firmanteNombre: firmante.nombre,
        firmanteIdentificacion: firmante.identificacion || undefined,
        firmaPng,
        relacion,
        autorizadoPor: relacion === "autorizado" ? autorizadoPor : undefined,
      });
      toast.exito(
        r.envio?.enviado
          ? "Firmado. Queda en el expediente y se le mandó el PDF al cliente."
          : `Firmado. Queda en el expediente.${r.envio?.motivo ? ` No se le pudo mandar el PDF: ${r.envio.motivo}` : ""}`
      );
      setFirmando(false);
      setPreparado(null);
      setFirmaPng(null);
      setRelacion("propietario");
      setAutorizadoPor("");
      recargar();
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          Un consentimiento firmado guarda el <strong>texto tal como se firmó</strong>: corregir la
          plantilla después no cambia lo que el cliente aceptó.
        </p>
        <div className="flex gap-2">
          {plantillas.length === 0 && (
            <Button variant="secondary" onClick={sembrar}>
              Crear las plantillas base
            </Button>
          )}
          <Button disabled={plantillas.length === 0} onClick={() => setFirmando(true)}>
            <Icono nombre="agregar" className="mr-1 h-4 w-4" />
            Firmar uno
          </Button>
        </div>
      </div>

      {firmados.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">Este paciente no tiene consentimientos firmados.</p>
        </Card>
      ) : (
        firmados.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{c.titulo}</CardTitle>
                <p className="text-xs text-text-muted">
                  firmado por {c.firmante_nombre}
                  {c.firmante_relacion === "autorizado" ? " (autorizado)" : ""} el{" "}
                  {fechaCorta(c.firmado_en)}
                  {c.testigo ? ` · testigo: ${c.testigo}` : ""}
                  {c.firmado_a_distancia ? " · firmado a distancia" : ""}
                </p>
                {/* LO QUE NO SE PUEDE ESCONDER. Los consentimientos
                    firmados antes del arreglo del 2026-11-27 llevan una
                    imagen de relleno en lugar del trazo del cliente: la
                    conversación existió, la firma no. Decirlo es lo que
                    permite volver a pedirla. */}
                {!c.firma_valida && (
                  <p className="mt-1 text-xs text-warning">
                    {c.firma_invalida_motivo ??
                      "Este consentimiento no tiene una firma verificable."}{" "}
                    Conviene volver a firmarlo.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {c.firma_valida ? (
                  <Badge variant="success" dot>
                    firmado
                  </Badge>
                ) : (
                  <Badge variant="warning" dot>
                    sin firma válida
                  </Badge>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      const { blob } = await expedienteApi.consentimientoPdf(c.id);
                      guardarComoArchivo(blob, `consentimiento-${c.titulo}.pdf`);
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                  }}
                >
                  PDF
                </Button>
              </div>
            </div>
          </Card>
        ))
      )}

      <Modal
        open={firmando}
        onClose={() => setFirmando(false)}
        title="Firmar un consentimiento"
        ancho="xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFirmando(false)}>
              Cancelar
            </Button>
            {/* FIRMA A DISTANCIA: el dueño no está en el mostrador. Se
                le manda un enlace de un solo uso con un código. */}
            <Button
              variant="secondary"
              disabled={ocupado || !preparado || enviandoEnlace}
              onClick={pedirADistancia}
            >
              {enviandoEnlace ? "Mandando…" : "Mandarle el enlace para firmar"}
            </Button>
            <Button
              disabled={ocupado || !preparado || !firmante.nombre.trim() || !firmaPng}
              onClick={firmar}
            >
              Firmar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              name="consent-plantilla"
              label="Plantilla"
              value={elegida}
              onChange={(e) => preparar(e.target.value)}
              options={[
                { value: "", label: "Elija la plantilla" },
                ...plantillas.map((p) => ({ value: p.id, label: p.titulo })),
              ]}
            />
            <Input
              name="consent-procedimiento"
              label="Procedimiento"
              value={procedimiento}
              onChange={(e) => setProcedimiento(e.target.value)}
              onBlur={() => elegida && preparar(elegida)}
              placeholder="extracción de masa en el flanco"
            />
          </div>

          {preparado && (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs text-text-primary">
                {preparado.texto}
              </pre>
              <p className="text-xs text-text-muted">
                Lo que quede entre corchetes es un dato que falta en la ficha: se ve a propósito,
                para que nadie firme un documento con huecos sin notarlo.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  name="consent-firmante"
                  label="Quién firma"
                  value={firmante.nombre}
                  onChange={(e) => setFirmante({ ...firmante, nombre: e.target.value })}
                />
                <Input
                  name="consent-identificacion"
                  label="Identificación"
                  value={firmante.identificacion}
                  onChange={(e) => setFirmante({ ...firmante, identificacion: e.target.value })}
                />
              </div>
              {/* LA FIRMA DE VERDAD (defecto reportado el 2026-11-27).

                  Acá había un botón que, al tocarlo, marcaba
                  `firmaTrazada` y hacía que `firmar()` mandara un PNG
                  fijo de 1×1 píxel. Ahora se dibuja, y lo que se manda
                  es ese trazo. El servidor además lo comprueba: cuenta
                  los píxeles con tinta y rechaza un recuadro vacío. */}
              {firmaPng ? (
                <div className="rounded-lg border border-success/40 bg-success/10 p-3">
                  <p className="text-sm font-semibold text-text-primary">Firma tomada</p>
                  <img
                    src={firmaPng}
                    alt="Firma del cliente"
                    className="mt-2 max-h-28 bg-white"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => setFirmaPng(null)}
                  >
                    Volver a firmar
                  </Button>
                </div>
              ) : (
                <PanelFirma
                  etiqueta={`Firma de ${firmante.nombre || "quien autoriza"}`}
                  onFirmar={(dataUrl) => setFirmaPng(dataUrl)}
                  deshabilitado={ocupado}
                />
              )}

              {/* LA RELACIÓN CON EL PACIENTE es evidencia: «Juan Pérez»
                  no dice si podía firmar. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  name="consent-relacion"
                  label="Quién firma, respecto del paciente"
                  value={relacion}
                  onChange={(e) => setRelacion(e.target.value as typeof relacion)}
                  options={[
                    { value: "propietario", label: "El propietario" },
                    { value: "autorizado", label: "Una persona autorizada por el propietario" },
                  ]}
                />
                {relacion === "autorizado" && (
                  <Input
                    name="consent-autorizado-por"
                    label="Autorizado por"
                    value={autorizadoPor}
                    onChange={(e) => setAutorizadoPor(e.target.value)}
                    placeholder="nombre del propietario"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
