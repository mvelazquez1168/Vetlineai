import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BackdropMenuMovil } from "../../components/BackdropMenuMovil";
import { BotonMenuMovil } from "../../components/BotonMenuMovil";
import { useMenuColapsable } from "../../hooks/useMenuColapsable";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { BreedCombobox } from "../../components/ui/BreedCombobox";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import {
  AvisoSuficienciaClinica,
  calcularSuficienciaClinica,
  ConsumoBanner,
  generacionDetenidaPorSaldo,
  RechazoGeneracionAviso,
} from "../../components/caso/ConsumoBanner";
import { CasoDashboardPanel } from "../../components/caso/CasoDashboardPanel";
import { CerrarCasoModal } from "../../components/caso/CerrarCasoModal";
import { CronologiaModal } from "../../components/caso/CronologiaModal";
import { VincularAtencionModal } from "../../components/caso/VincularAtencionModal";
import { ReabrirCasoModal } from "../../components/caso/ReabrirCasoModal";
import { DashboardGcisPanel } from "../../components/caso/DashboardGcisPanel";
import { FichaPropietarioModal } from "../../components/caso/FichaPropietarioModal";
import { RegistroAtencionModal } from "../../components/caso/RegistroAtencionModal";
import { ResolverCitaModal } from "../../components/caso/ResolverCitaModal";
import { MensajesLista } from "../../components/caso/MensajesLista";
import { RecetaPanel } from "../../components/caso/RecetaPanel";
import { useAuth } from "../../hooks/useAuth";
import { ApiError } from "../../lib/api";
import { citasApi } from "../../lib/agendaApi";
import { exportarDashboardHtml } from "../../lib/exportarDashboardHtml";
import { fechaHoyEnZona, formatearFecha, formatearFechaCorta } from "../../lib/formatFecha";
import {
  Archivo,
  ArchivoDeMensaje,
  CasoDetalle,
  CasoResumen,
  ConsumoWorkspace,
  DashboardGcis,
  Derivacion,
  GrupoTiposReporte,
  InformeGenerado,
  Mensaje,
  PacienteDePropietario,
  Propietario,
  RechazoGeneracion,
  TipoIdentificacion,
  workspaceApi,
} from "../../lib/workspaceApi";

const ESPECIE_OPTIONS = [
  { value: "Canino", label: "Canino" },
  { value: "Felino", label: "Felino" },
];

// pacientes.especie sigue usando "Canino"/"Felino" (sin tocar, ver
// pacientes.routes.ts) — razas.especie usa la convención distinta que
// pidió esa migración ('canina'/'felina'). Se quitó "Otro" de las
// opciones de especie: el catálogo de razas no tiene fila para eso, así
// que no había nada seleccionable si el usuario lo elegía.
const ESPECIE_A_RAZA_ESPECIE: Record<string, "canina" | "felina"> = {
  Canino: "canina",
  Felino: "felina",
};

const LIMITE_ARCHIVOS_POR_MENSAJE = 8;

// prompt_code_paciente_nacimiento_estado.md, Parte C — el selector de
// reportes no está en uso todavía. Se va a retomar: NO borrar el bloque
// de abajo, solo ocultarlo detrás de esta bandera.
const SELECTOR_REPORTES_VISIBLE = false;

// Un chip por archivo seleccionado/arrastrado, con su propio ciclo de vida
// independiente — no hay un solo booleano "subiendo" global como antes.
interface AdjuntoEnProgreso {
  clientId: string;
  file: File;
  estado: "subiendo" | "listo" | "error";
  archivo?: Archivo;
}

const ESTADO_BADGE: Record<string, BadgeVariant> = {
  triage: "neutral",
  en_curso: "warning",
  completado: "success",
};

export function CasoWorkspace() {
  const { agenteId, casoId } = useParams<{ agenteId: string; casoId?: string }>();
  const navigate = useNavigate();
  const { user, zonaHoraria } = useAuth();
  const { abierto: menuAbierto, alternar: alternarMenu, cerrar: cerrarMenu } = useMenuColapsable();

  const [casos, setCasos] = useState<CasoResumen[]>([]);
  // Búsqueda del sidebar — client-side, sobre la lista ya cargada
  // (prompt_code_expediente_y_propietario, Parte A5: "el veterinario dice
  // 'traeme el 1042' y lo encuentra"). Matchea nombre de paciente O
  // número de expediente; no hace falta ida y vuelta al backend porque
  // esta lista ya está completa en memoria (un médico+agente, no
  // paginada).
  const [busquedaSidebar, setBusquedaSidebar] = useState("");
  const casosFiltrados = useMemo(() => {
    const q = busquedaSidebar.trim().toLowerCase();
    if (!q) return casos;
    return casos.filter(
      (c) => c.paciente_nombre.toLowerCase().includes(q) || String(c.numero_expediente).includes(q)
    );
  }, [casos, busquedaSidebar]);
  const [detalle, setDetalle] = useState<CasoDetalle | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [derivacion, setDerivacion] = useState<Derivacion | null>(null);
  const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null);
  const [exportandoDashboard, setExportandoDashboard] = useState(false);
  const [generandoInforme, setGenerandoInforme] = useState(false);
  const [errorInforme, setErrorInforme] = useState<string | null>(null);
  const [informeMotivo, setInformeMotivo] = useState<RechazoGeneracion["motivo"]>(undefined);
  const [informesAnteriores, setInformesAnteriores] = useState<InformeGenerado[]>([]);
  const [panelInformesAbierto, setPanelInformesAbierto] = useState(false);
  const [descargandoInformeId, setDescargandoInformeId] = useState<string | null>(null);
  const [recetaPanelAbierto, setRecetaPanelAbierto] = useState(false);
  // prompt_code_registro_atencion.md — reemplaza historialFarmacologicoAbierto.
  // Primero se resuelve la cita (elegir la de hoy / crear una nueva), y
  // solo entonces se abre el registro propiamente dicho.
  const [resolverCitaAbierto, setResolverCitaAbierto] = useState(false);
  const [registroAtencionCitaId, setRegistroAtencionCitaId] = useState<string | null>(null);
  const [fichaPropietarioAbierta, setFichaPropietarioAbierta] = useState(false);
  const [cronologiaAbierta, setCronologiaAbierta] = useState(false);
  const [vincularAtencionAbierto, setVincularAtencionAbierto] = useState(false);
  const [cerrarCasoAbierto, setCerrarCasoAbierto] = useState(false);
  const [reabrirCasoAbierto, setReabrirCasoAbierto] = useState(false);

  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Pantallas faltantes, Prompt B, Paso 2 — único caso donde un 402 de
  // "Analizar el caso" NO trae `mensaje` en el cuerpo: la caja estaba
  // vacía (solo información pendiente por analizar), así que no hay nada
  // que agregar al hilo con el aviso "sin respuesta" — se muestra un
  // error simple en su lugar.
  const [errorAnalisis, setErrorAnalisis] = useState<string | null>(null);
  // Anotar vs consultar — loading state separado del de "Analizar el caso":
  // son dos acciones distintas sobre la misma caja, cada botón necesita su
  // propio texto/spinner. Nunca corren a la vez (misma caja de origen).
  const [agregando, setAgregando] = useState(false);

  // Cuántos bloques de información quedan sin analizar — se deriva del
  // hilo ya cargado (todo lo de tipo='informacion' después de la última
  // 'respuesta'), no de un contador aparte, para que nunca se desincronice
  // de lo que el médico ve en pantalla. Determina si "Analizar el caso" se
  // puede usar con la caja vacía.
  const pendientesInformacion = useMemo(() => {
    let ultimaRespuestaIdx = -1;
    mensajes.forEach((m, i) => {
      if (m.tipo === "respuesta") ultimaRespuestaIdx = i;
    });
    return mensajes.slice(ultimaRespuestaIdx + 1).filter((m) => m.tipo === "informacion").length;
  }, [mensajes]);

  // Dictado por voz (Web Speech API) — disponible para cualquier agente
  // con integración real (detalle.agente_operativo, ver soportaDictado
  // más abajo — ese flag es "system_prompt IS NOT NULL", no literalmente
  // GCIS pese a su nombre anterior). textoBaseVozRef guarda lo que ya había escrito el médico antes
  // de tocar el micrófono (para no borrarlo); textoFinalVozRef acumula los
  // resultados "final" de esta sesión de grabación para no repetirlos en
  // cada evento onresult (que reenvía todo el resultIndex hacia adelante).
  const [grabandoVoz, setGrabandoVoz] = useState(false);
  const [avisoVoz, setAvisoVoz] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const textoBaseVozRef = useRef("");
  const textoFinalVozRef = useRef("");
  // Ids de mensajes del médico que llegaron a guardarse pero NO generaron
  // respuesta de IA (límite de uso alcanzado con limite_accion='bloquear')
  // — se renderiza un aviso en su lugar en vez de la burbuja de la IA.
  // Mapa mensajeId -> texto del aviso a mostrar en vez de la burbuja de la
  // IA — cubre tanto el 402 (límite de uso alcanzado) como el 502 (falló
  // la llamada real a Claude), cada uno con su propio texto pero el mismo
  // mecanismo de render.
  const [avisosSinRespuesta, setAvisosSinRespuesta] = useState<Map<string, RechazoGeneracion>>(new Map());

  // Indexado por casoId — un caso con archivos ya subidos pero sin enviar
  // no debe perder ese estado si el médico cambia a otro caso y vuelve.
  const [adjuntosPorCaso, setAdjuntosPorCaso] = useState<Record<string, AdjuntoEnProgreso[]>>({});
  const adjuntos = casoId ? adjuntosPorCaso[casoId] ?? [] : [];
  // Adjuntar estudios sin escribir nada es un análisis válido — el médico
  // que arrastra una endoscopía y le da a "Analizar el caso" no tiene por
  // qué inventar un texto para que el agente los reciba. Antes el botón
  // quedaba deshabilitado en ese caso.
  const adjuntosListos = adjuntos.filter((a) => a.estado === "listo" && a.archivo);
  const adjuntosSubiendo = adjuntos.some((a) => a.estado === "subiendo");
  const adjuntosNoLegibles = adjuntosListos.filter((a) => a.archivo!.legible_por_agente === false);
  const [avisoLimiteAdjuntos, setAvisoLimiteAdjuntos] = useState<string | null>(null);
  const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false);
  const [cambioCasoPendiente, setCambioCasoPendiente] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const actualizarAdjuntosDeCaso = (
    casoIdDestino: string,
    updater: (prev: AdjuntoEnProgreso[]) => AdjuntoEnProgreso[]
  ) => {
    setAdjuntosPorCaso((prev) => ({ ...prev, [casoIdDestino]: updater(prev[casoIdDestino] ?? []) }));
  };

  // Wizard "Nuevo caso" — 3 pasos: propietario → mascota → motivo.
  const [modalAbierto, setModalAbierto] = useState(false);
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [errorWizard, setErrorWizard] = useState<string | null>(null);

  const [busquedaPropietario, setBusquedaPropietario] = useState("");
  const [resultadosPropietarios, setResultadosPropietarios] = useState<Propietario[]>([]);
  const [buscandoPropietarios, setBuscandoPropietarios] = useState(false);
  const [propietarioSeleccionado, setPropietarioSeleccionado] = useState<Propietario | null>(null);
  const [formNuevoPropietarioAbierto, setFormNuevoPropietarioAbierto] = useState(false);
  const [nuevoPropietario, setNuevoPropietario] = useState({
    tipoIdentificacionId: "",
    numeroIdentificacion: "",
    nombre: "",
    telefono: "",
    email: "",
    direccion: "",
  });
  const [creandoPropietario, setCreandoPropietario] = useState(false);
  const [tiposIdentificacion, setTiposIdentificacion] = useState<TipoIdentificacion[]>([]);
  // prompt_code_propietarios, Ajuste 1 — la identificación es la llave de
  // entrada: apenas se completan tipo+número, se busca si ese propietario
  // ya existe en la clínica, para ofrecer usarlo en vez de duplicarlo.
  const [propietarioEncontradoPorId, setPropietarioEncontradoPorId] = useState<Propietario | null>(null);
  const [buscandoPorIdentificacion, setBuscandoPorIdentificacion] = useState(false);

  const [pacientesDelPropietario, setPacientesDelPropietario] = useState<PacienteDePropietario[]>([]);
  const [cargandoPacientes, setCargandoPacientes] = useState(false);
  const [pacienteSeleccionado, setPacienteSeleccionado] = useState<PacienteDePropietario | null>(null);
  const [formNuevoPacienteAbierto, setFormNuevoPacienteAbierto] = useState(false);
  const [nuevoPaciente, setNuevoPaciente] = useState({
    nombre: "",
    especie: "Canino",
    razaId: null as string | null,
    fechaNacimiento: "",
  });
  const [creandoPaciente, setCreandoPaciente] = useState(false);

  const [motivoNuevoCaso, setMotivoNuevoCaso] = useState("");
  const [creandoCaso, setCreandoCaso] = useState(false);

  // prompt: vincular caso↔cita — Paso 3 del wizard ofrece, además del
  // motivo, un vínculo opcional a una cita de agenda (nunca bloquea la
  // creación del caso). "sin_cita" es el default: no fuerza nada.
  const [vinculoCita, setVinculoCita] = useState<"sin_cita" | "elegir" | "crear">("sin_cita");
  const [citasDeHoyDisponibles, setCitasDeHoyDisponibles] = useState<
    { id: string; hora_inicio: string; hora_fin: string; estado: string }[]
  >([]);
  const [citaSeleccionadaId, setCitaSeleccionadaId] = useState<string | null>(null);
  const [nuevaCitaHoraInicio, setNuevaCitaHoraInicio] = useState("");
  const [nuevaCitaDuracion, setNuevaCitaDuracion] = useState(30);
  const [avisoVinculoCita, setAvisoVinculoCita] = useState<string | null>(null);

  const [ultimaActualizacion, setUltimaActualizacion] = useState<string | null>(null);
  // Paso 2 de prompt_code_dashboards_informes — indicación no bloqueante:
  // hay actividad en el caso posterior a la fecha del dashboard mostrado.
  const [hayInformacionPosteriorDashboard, setHayInformacionPosteriorDashboard] = useState(false);

  // Estado del Dashboard real de GCIS — independiente del stub ICIS
  // (severidad/confianza_diagnostica/derivacion, sin cambios arriba).
  // "sin_permiso" viene de un 403 explícito; "error" cubre cualquier otra
  // falla de red/servidor/parseo (ver Fase A del prompt de frontend).
  type DashboardGcisEstado = "idle" | "generando" | "error" | "sin_permiso" | "sin_datos" | "listo";
  const [dashboardGcisEstado, setDashboardGcisEstado] = useState<DashboardGcisEstado>("idle");
  const [dashboardGcis, setDashboardGcis] = useState<DashboardGcis | null>(null);
  const [dashboardGcisError, setDashboardGcisError] = useState<string | null>(null);
  const [dashboardGcisMotivo, setDashboardGcisMotivo] = useState<RechazoGeneracion["motivo"]>(undefined);

  const [gruposReporte, setGruposReporte] = useState<GrupoTiposReporte[]>([]);
  const [estadoReporte, setEstadoReporte] = useState<"idle" | "generando" | "listo">("idle");
  const [tipoReporteSeleccionado, setTipoReporteSeleccionado] = useState("");

  // Implementación de pantallas, prompt 1 — barra de consumo de prueba +
  // avisos de saldo. Se consulta al entrar al workspace y de nuevo
  // después de cada generación (cargarConsumo se llama desde
  // analizarCaso/actualizarDashboard/generarInforme, tanto en éxito como
  // en rechazo — el saldo puede cambiar en ambos casos. agregarInformacion
  // NO la llama: no consume saldo, no hay nada que refrescar.
  const [consumo, setConsumo] = useState<ConsumoWorkspace | null>(null);
  const cargarConsumo = () => {
    workspaceApi.obtenerConsumo().then(setConsumo).catch(() => {});
  };
  useEffect(() => {
    cargarConsumo();
  }, []);
  const suficienciaClinica = calcularSuficienciaClinica(detalle, mensajes.length);
  const generacionDetenida = generacionDetenidaPorSaldo(consumo);
  // prompt_code_cierre_caso.md, Paso 2 — un caso cerrado es de solo
  // lectura: la caja de mensaje, adjuntar, "Agregar información",
  // "Analizar el caso" y "Nueva receta" se deshabilitan acá abajo.
  const casoCerrado = detalle?.estado === "completado";

  // Carga la lista de casos cada vez que cambia el agente activo.
  useEffect(() => {
    if (!agenteId) return;
    workspaceApi.listarCasos(agenteId).then((data) => setCasos(data.casos));
  }, [agenteId]);

  // Carga el detalle del caso seleccionado. Los adjuntos pendientes NO se
  // limpian acá — viven en adjuntosPorCaso indexados por casoId
  // precisamente para sobrevivir un cambio de caso (ver Fase A del bugfix).
  useEffect(() => {
    setAvisoLimiteAdjuntos(null);
    setDashboardGcisEstado("idle");
    setDashboardGcis(null);
    setDashboardGcisError(null);
    setErrorInforme(null);
    setErrorAnalisis(null);
    setInformesAnteriores([]);
    setPanelInformesAbierto(false);
    setRecetaPanelAbierto(false);
    setResolverCitaAbierto(false);
    setRegistroAtencionCitaId(null);
    setHayInformacionPosteriorDashboard(false);
    if (!casoId) {
      setDetalle(null);
      setMensajes([]);
      setDerivacion(null);
      setUltimaActualizacion(null);
      return;
    }
    workspaceApi.obtenerCaso(casoId).then((data) => {
      setDetalle(data.caso);
      setMensajes(data.mensajes);
      setDerivacion(data.derivacion);
      setUltimaActualizacion(null);

      // Cache del Dashboard (migración 015) — solo aplica a casos cuyo
      // agente tiene integración real: para el resto dashboard_cache nunca
      // se puebla, así que ni se consulta (evita mostrar el estado
      // "sin_datos" para siempre en un caso que nunca va a tener Dashboard
      // real).
      if (data.caso.agente_operativo) {
        workspaceApi.obtenerDashboardCache(casoId).then((cache) => {
          if (cache.dashboard) {
            setDashboardGcis(cache.dashboard);
            // Bug real (prompt_code_dashboards_informes, Paso 1): esta
            // carga desde cache nunca completaba ultimaActualizacion, así
            // que el badge de fecha quedaba vacío hasta la próxima
            // regeneración en vivo, aunque el dashboard sí se mostrara.
            setUltimaActualizacion(cache.generado_en);
            setHayInformacionPosteriorDashboard(cache.hayInformacionPosterior);
            setDashboardGcisEstado("listo");
          } else {
            setDashboardGcisEstado("sin_datos");
          }
        });
      }
      // prompt_code_informes_anteriores, Paso 3 — a propósito FUERA del
      // `if` de arriba: el acceso a informes anteriores no se condiciona
      // por agente. Un caso de un agente sin integración real
      // simplemente no puede tener informes generados (la generación en
      // sí lo exige), así que esto siempre devuelve la lista correcta
      // (vacía o no) sin necesidad de adivinar de antemano si hay algo
      // que buscar.
      cargarInformes(casoId);
    });
  }, [casoId]);

  // Historial versionado de informes (migración 018). Reutilizada tanto
  // al abrir el caso como después de generar uno nuevo, para que
  // aparezca en la lista sin recargar la página.
  const cargarInformes = (casoIdDestino: string) => {
    workspaceApi
      .listarInformes(casoIdDestino)
      .then((data) => setInformesAnteriores(data.informes))
      .catch((err) => console.error("Error al cargar informes anteriores:", err));
  };

  useEffect(() => {
    workspaceApi.obtenerTiposReporte().then((data) => setGruposReporte(data.grupos));
  }, []);

  // Logo de la clínica (tenants.logo_url) — se necesita para el export a
  // HTML del Dashboard GCIS (Fase D), no para nada de la pantalla en sí.
  useEffect(() => {
    workspaceApi.obtenerMe().then((data) => setTenantLogoUrl(data.persona?.tenant_logo_url ?? null));
  }, []);

  // Discrimina en runtime entre el stub ICIS (shape plano, sin cambios) y
  // el Dashboard real de GCIS (shape con "meta", ver dashboard_schema.json)
  // por la presencia de "meta" — es el único campo que no existe en el stub.
  const actualizarDashboard = async () => {
    if (!casoId) return;
    setDashboardGcisEstado("generando");
    setDashboardGcisError(null);
    setDashboardGcisMotivo(undefined);
    try {
      const { dashboard } = await workspaceApi.actualizarDashboard(casoId);
      cargarConsumo();
      // Recién generado: nada del caso es posterior a esto todavía.
      setHayInformacionPosteriorDashboard(false);
      if ("meta" in dashboard) {
        setDashboardGcis(dashboard);
        if (dashboard.meta.estado_generacion === "sin_datos") {
          setDashboardGcisEstado("sin_datos");
          return;
        }
        setUltimaActualizacion(dashboard.meta.generado_en);
        setDashboardGcisEstado("listo");
        return;
      }

      setDashboardGcis(null);
      setDetalle((prev) =>
        prev
          ? { ...prev, severidad: dashboard.severidad, confianza_diagnostica: dashboard.confianzaDiagnostica }
          : prev
      );
      setDerivacion(dashboard.derivacion);
      setUltimaActualizacion(dashboard.ultimaActualizacion);
      setDashboardGcisEstado("listo");
    } catch (err) {
      console.error("Error al actualizar el Dashboard:", err);
      cargarConsumo();
      if (err instanceof ApiError && err.status === 403) {
        setDashboardGcisEstado("sin_permiso");
      } else if (err instanceof ApiError && err.status === 402) {
        const data = err.data as RechazoGeneracion | null;
        setDashboardGcisError(data?.error ?? err.message);
        setDashboardGcisMotivo(data?.motivo);
        setDashboardGcisEstado("error");
      } else {
        setDashboardGcisError(err instanceof Error ? err.message : "No pudimos generar el Dashboard.");
        setDashboardGcisEstado("error");
      }
    }
  };

  // 100% client-side (ver FASE D) — el JSON completo ya está en memoria
  // (dashboardGcis), no vuelve a llamar al backend.
  const exportarDashboard = async () => {
    if (!dashboardGcis || !detalle) return;
    setExportandoDashboard(true);
    try {
      await exportarDashboardHtml({
        dashboard: dashboardGcis,
        pacienteNombre: dashboardGcis.executive_summary?.paciente.nombre ?? detalle.paciente_nombre,
        tenantLogoUrl,
        zonaHoraria,
      });
    } catch (err) {
      console.error("Error al exportar el Dashboard como HTML:", err);
    } finally {
      setExportandoDashboard(false);
    }
  };

  // Endpoint completamente distinto de actualizarDashboard (POST
  // /:id/informe/generar, no /dashboard/actualizar) — genera el .docx
  // real del lado del backend y lo manda como binario; acá solo se
  // dispara la descarga con el nombre que ya viene en Content-Disposition.
  const generarInforme = async () => {
    if (!casoId) return;
    setGenerandoInforme(true);
    setErrorInforme(null);
    setInformeMotivo(undefined);
    try {
      const { blob, filename } = await workspaceApi.generarInforme(casoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? "Informe.docx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      cargarInformes(casoId);
      cargarConsumo();
    } catch (err) {
      console.error("Error al generar el informe:", err);
      cargarConsumo();
      if (err instanceof ApiError && err.status === 402) {
        const data = err.data as RechazoGeneracion | null;
        setErrorInforme(data?.error ?? err.message);
        setInformeMotivo(data?.motivo);
      } else {
        setErrorInforme(err instanceof Error ? err.message : "No pudimos generar el informe.");
      }
    } finally {
      setGenerandoInforme(false);
    }
  };

  // Descarga instantánea de una versión ya persistida — no vuelve a
  // llamar a Claude, es una simple lectura de bytea (ver migración 018).
  const descargarInformeAnterior = async (informe: InformeGenerado) => {
    setDescargandoInformeId(informe.id);
    try {
      const { blob, filename } = await workspaceApi.descargarInforme(informe.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? informe.nombre_archivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      console.error("Error al descargar el informe anterior:", err);
      setErrorInforme(err instanceof Error ? err.message : "No pudimos descargar el informe.");
    } finally {
      setDescargandoInformeId(null);
    }
  };

  // STUB: no genera contenido real todavía (llega con la integración de la
  // API de Claude en una fase posterior) — solo simula el flujo de UI.
  const generarReporte = (tipo: string) => {
    setTipoReporteSeleccionado(tipo);
    setEstadoReporte("generando");
    setTimeout(() => {
      setEstadoReporte("listo");
      setTimeout(() => {
        setEstadoReporte("idle");
        setTipoReporteSeleccionado("");
      }, 2000);
    }, 1200);
  };

  const abrirModalNuevoCaso = () => {
    setModalAbierto(true);
    setPaso(1);
    setErrorWizard(null);
    setBusquedaPropietario("");
    setResultadosPropietarios([]);
    setPropietarioSeleccionado(null);
    setFormNuevoPropietarioAbierto(false);
    setNuevoPropietario({
      tipoIdentificacionId: "",
      numeroIdentificacion: "",
      nombre: "",
      telefono: "",
      email: "",
      direccion: "",
    });
    setPropietarioEncontradoPorId(null);
    setPacientesDelPropietario([]);
    setPacienteSeleccionado(null);
    setFormNuevoPacienteAbierto(false);
    setNuevoPaciente({ nombre: "", especie: "Canino", razaId: null as string | null, fechaNacimiento: "" });
    setMotivoNuevoCaso("");
    setVinculoCita("sin_cita");
    setCitasDeHoyDisponibles([]);
    setCitaSeleccionadaId(null);
    setNuevaCitaHoraInicio("");
    setNuevaCitaDuracion(30);
    setAvisoVinculoCita(null);
  };

  // prompt: vincular caso↔cita — se busca en cuanto hay paciente
  // seleccionado y se llega al Paso 3 (no antes: no tiene sentido buscar
  // citas de un paciente que todavía no se eligió). Si no hay resultados,
  // la opción "elegir cita de hoy" simplemente no se ofrece.
  useEffect(() => {
    if (paso !== 3 || !pacienteSeleccionado || !user?.userId) {
      setCitasDeHoyDisponibles([]);
      return;
    }
    workspaceApi
      .listarCitasDeHoyDelPaciente(pacienteSeleccionado.id, user.userId, zonaHoraria)
      .then(setCitasDeHoyDisponibles)
      .catch(() => setCitasDeHoyDisponibles([]));
  }, [paso, pacienteSeleccionado, user?.userId, zonaHoraria]);

  // Catálogo de tipos de identificación del país de la propia clínica —
  // se carga una sola vez por apertura del modal, no en cada tecla.
  useEffect(() => {
    if (!modalAbierto) return;
    workspaceApi.listarTiposIdentificacion().then((data) => setTiposIdentificacion(data.tipos));
  }, [modalAbierto]);

  // prompt_code_propietarios, Ajuste 1 — la identificación es la llave de
  // entrada: apenas tipo y número están completos, se busca (debounce
  // ~400ms) si ya existe un propietario con esa identificación en la
  // clínica. Sin ambos campos, no hay nada que buscar todavía.
  useEffect(() => {
    if (!formNuevoPropietarioAbierto) return;
    const { tipoIdentificacionId, numeroIdentificacion } = nuevoPropietario;
    if (!tipoIdentificacionId || !numeroIdentificacion.trim()) {
      setPropietarioEncontradoPorId(null);
      return;
    }
    setBuscandoPorIdentificacion(true);
    const timer = setTimeout(() => {
      workspaceApi
        .buscarPropietarioPorIdentificacion(tipoIdentificacionId, numeroIdentificacion.trim())
        .then((data) => setPropietarioEncontradoPorId(data.propietario))
        .finally(() => setBuscandoPorIdentificacion(false));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formNuevoPropietarioAbierto, nuevoPropietario.tipoIdentificacionId, nuevoPropietario.numeroIdentificacion]);

  // Debounce ~300ms: no dispara una búsqueda por cada tecla. También trae
  // el listado inicial (query vacía) apenas se abre el paso 1.
  useEffect(() => {
    if (!modalAbierto || paso !== 1) return;
    setBuscandoPropietarios(true);
    const timer = setTimeout(() => {
      workspaceApi
        .buscarPropietarios(busquedaPropietario)
        .then((data) => setResultadosPropietarios(data.propietarios))
        .finally(() => setBuscandoPropietarios(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [busquedaPropietario, modalAbierto, paso]);

  // Reutilizada tanto al elegir un propietario existente como justo
  // después de crear uno nuevo — en ambos casos hay que traer sus
  // mascotas antes de mostrar el paso 2.
  const seleccionarPropietario = async (p: Propietario) => {
    setPropietarioSeleccionado(p);
    setPacienteSeleccionado(null);
    setCargandoPacientes(true);
    try {
      const data = await workspaceApi.listarPacientesDePropietario(p.id);
      setPacientesDelPropietario(data.pacientes);
    } finally {
      setCargandoPacientes(false);
    }
    setPaso(2);
  };

  const crearPropietarioYAvanzar = async () => {
    if (!nuevoPropietario.nombre.trim()) return;
    if (Boolean(nuevoPropietario.tipoIdentificacionId) !== Boolean(nuevoPropietario.numeroIdentificacion.trim())) {
      setErrorWizard("Si cargás la identificación del propietario, hacen falta el tipo y el número juntos.");
      return;
    }
    setCreandoPropietario(true);
    setErrorWizard(null);
    try {
      const { propietario } = await workspaceApi.crearPropietario({
        nombre: nuevoPropietario.nombre.trim(),
        telefono: nuevoPropietario.telefono.trim() || undefined,
        email: nuevoPropietario.email.trim() || undefined,
        direccion: nuevoPropietario.direccion.trim() || undefined,
        tipoIdentificacionId: nuevoPropietario.tipoIdentificacionId || undefined,
        numeroIdentificacion: nuevoPropietario.numeroIdentificacion.trim() || undefined,
      });
      await seleccionarPropietario(propietario);
      setFormNuevoPropietarioAbierto(false);
      setNuevoPropietario({
        tipoIdentificacionId: "",
        numeroIdentificacion: "",
        nombre: "",
        telefono: "",
        email: "",
        direccion: "",
      });
      setPropietarioEncontradoPorId(null);
    } catch (err: any) {
      setErrorWizard(err?.message ?? "No pudimos crear el propietario.");
    } finally {
      setCreandoPropietario(false);
    }
  };

  const crearPacienteYAvanzar = async () => {
    if (!propietarioSeleccionado || !nuevoPaciente.nombre.trim() || !nuevoPaciente.especie.trim()) return;
    setCreandoPaciente(true);
    setErrorWizard(null);
    try {
      const { paciente } = await workspaceApi.crearPaciente({
        propietarioId: propietarioSeleccionado.id,
        nombre: nuevoPaciente.nombre.trim(),
        especie: nuevoPaciente.especie,
        razaId: nuevoPaciente.razaId ?? undefined,
        fechaNacimiento: nuevoPaciente.fechaNacimiento || undefined,
      });
      setPacienteSeleccionado(paciente);
      // La agregamos a la grilla del paso 2 (no solo a la selección) para
      // que si el usuario vuelve con "Atrás" a revisar, la mascota recién
      // creada siga apareciendo y pueda re-confirmarla sin perder nada.
      setPacientesDelPropietario((prev) => [...prev, paciente]);
      setFormNuevoPacienteAbierto(false);
      setNuevoPaciente({ nombre: "", especie: "Canino", razaId: null as string | null, fechaNacimiento: "" });
      setPaso(3);
    } catch (err: any) {
      setErrorWizard(err?.message ?? "No pudimos crear la mascota.");
    } finally {
      setCreandoPaciente(false);
    }
  };

  const crearCaso = async () => {
    if (!agenteId || !pacienteSeleccionado || !motivoNuevoCaso.trim()) return;
    setCreandoCaso(true);
    setErrorWizard(null);
    setAvisoVinculoCita(null);
    try {
      const { caso, citaVinculada } = await workspaceApi.crearCaso({
        pacienteId: pacienteSeleccionado.id,
        agenteId,
        motivoConsulta: motivoNuevoCaso.trim(),
        citaId: vinculoCita === "elegir" && citaSeleccionadaId ? citaSeleccionadaId : undefined,
      });
      if (vinculoCita === "elegir" && citaSeleccionadaId && citaVinculada === false) {
        // No bloquea: el caso ya existe. Solo se informa que el vínculo no
        // prendió (p.ej. la cita se vinculó a otra cosa mientras tanto).
        console.warn("No se pudo vincular la cita elegida — el caso se creó igual.");
      }

      // prompt: vincular caso↔cita — rama "crear cita ahora": la cita no
      // existía todavía, se crea recién acá, ya vinculada al caso. Es
      // best-effort: si falla, el caso ya se creó y no se bloquea la
      // navegación, solo se avisa.
      if (vinculoCita === "crear" && nuevaCitaHoraInicio && user?.userId) {
        try {
          await citasApi.crear({
            pacienteId: pacienteSeleccionado.id,
            medicoId: user.userId,
            fecha: fechaHoyEnZona(zonaHoraria),
            horaInicio: nuevaCitaHoraInicio,
            duracionMinutos: nuevaCitaDuracion,
            motivoConsulta: motivoNuevoCaso.trim(),
            casoId: caso.id,
          });
        } catch {
          setAvisoVinculoCita("El caso se creó, pero no pudimos registrar la cita.");
        }
      }

      setModalAbierto(false);
      setCasos((prev) => [caso, ...prev]);
      navigate(`/workspace/agentes/${agenteId}/casos/${caso.id}`);
    } catch (err: any) {
      setErrorWizard(err?.message ?? "No pudimos crear el caso.");
    } finally {
      setCreandoCaso(false);
    }
  };

  // Anotar vs consultar, Capa 2 — "Analizar el caso". La caja puede venir
  // vacía si hay información pendiente (pendientesInformacion > 0): el
  // backend arma el disparador él solo. Lo único que no se permite es
  // analizar sin texto y sin nada pendiente — no hay nada nuevo que
  // mandar, sería una llamada completa para regenerar la misma respuesta.
  const analizarCaso = async () => {
    if (!casoId || (!nuevoMensaje.trim() && pendientesInformacion === 0 && adjuntosListos.length === 0)) return;
    setEnviando(true);
    setErrorAnalisis(null);
    try {
      const archivoIds = adjuntosListos.map((a) => a.archivo!.id);
      const { mensaje, respuesta } = await workspaceApi.enviarMensaje(
        casoId,
        nuevoMensaje.trim(),
        archivoIds
      );
      setMensajes((prev) => [...prev, ...(mensaje ? [mensaje] : []), respuesta]);
      setNuevoMensaje("");
      actualizarAdjuntosDeCaso(casoId, () => []);
      setAvisoLimiteAdjuntos(null);
      setErrorAnalisis(null);
      cargarConsumo();
    } catch (err) {
      // 402: la clínica alcanzó su límite de uso con limite_accion='bloquear',
      // o el motor de crédito rechazó por sin_saldo/colchon_agotado/
      // agente_no_habilitado/suscripcion_finalizada. 502: falló la llamada
      // real a Claude (GCIS). En todos los casos el mensaje del médico
      // igual quedó guardado en el backend (si escribió algo) — viene en
      // el cuerpo del error para agregarlo a la conversación sin respuesta
      // de IA, en vez de perderlo.
      if (err instanceof ApiError && (err.status === 402 || err.status === 502)) {
        const data = err.data as RechazoGeneracion | null;
        if (data?.mensaje) {
          const mensajeGuardado = data.mensaje;
          setMensajes((prev) => [...prev, mensajeGuardado]);
          setAvisosSinRespuesta((prev) => new Map(prev).set(mensajeGuardado.id, { error: err.message, motivo: data.motivo }));
          setNuevoMensaje("");
          actualizarAdjuntosDeCaso(casoId, () => []);
          setAvisoLimiteAdjuntos(null);
          cargarConsumo();
          return;
        }
        // Único caso sin `mensaje`: la caja estaba vacía (solo
        // información pendiente) y el rechazo llegó igual — no hay nada
        // que agregar al hilo, se muestra el error solo.
        if (data?.error) {
          setErrorAnalisis(data.error);
          cargarConsumo();
          return;
        }
      }
      throw err;
    } finally {
      setEnviando(false);
      // setTimeout(0) en vez de llamar a .focus() directo: React todavía
      // no bajó el `disabled` del textarea en el DOM en este punto (el
      // setEnviando de arriba recién se flushea después), y un elemento
      // disabled no puede recibir foco — el enfoque llegaba a un
      // textarea que técnicamente seguía deshabilitado y el navegador lo
      // ignoraba en silencio.
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

  // Anotar vs consultar, Capa 2 — "Agregar información". Nunca llama al
  // modelo: solo persiste el bloque y lo agrega al hilo. Latencia y costo
  // cero, así que no hace falta el manejo de 402/502 ni cargarConsumo() —
  // no hay nada que descontar del saldo.
  const agregarInformacion = async () => {
    if (!casoId || !nuevoMensaje.trim()) return;
    setAgregando(true);
    try {
      const archivoIds = adjuntosListos.map((a) => a.archivo!.id);
      const { mensaje } = await workspaceApi.agregarInformacion(
        casoId,
        nuevoMensaje.trim(),
        archivoIds
      );
      setMensajes((prev) => [...prev, mensaje]);
      setNuevoMensaje("");
      actualizarAdjuntosDeCaso(casoId, () => []);
      setAvisoLimiteAdjuntos(null);
    } finally {
      setAgregando(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

  // Ajustes del área de trabajo, Prioridad 2 — el campo crece con el
  // contenido (arranca en ~3 líneas, hasta ~8) y a partir de ahí scrollea
  // en vez de seguir creciendo (max-height + overflow-y-auto en el JSX
  // hacen el tope; acá solo se recalcula el alto real contra el contenido).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [nuevoMensaje]);

  // Soporte de navegador para Web Speech API — solo Chrome/Edge
  // (Chromium). Si no existe ninguno de los dos constructores, el botón de
  // dictado directamente no se renderiza (ver JSX más abajo), nunca se
  // muestra deshabilitado ni con mensaje de error.
  const soportaDictado =
    typeof window !== "undefined" &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Se apaga la grabación si el médico cambia de caso a mitad de un
  // dictado, para no dejar un micrófono abierto en el caso viejo.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, [casoId]);

  const alternarDictado = () => {
    if (grabandoVoz) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "es-ES";
    recognition.continuous = true;
    recognition.interimResults = true;

    // Lo que ya había escrito el médico antes de tocar el micrófono se
    // conserva — el dictado se agrega a continuación, nunca lo pisa.
    textoBaseVozRef.current =
      nuevoMensaje && !/\s$/.test(nuevoMensaje) ? `${nuevoMensaje} ` : nuevoMensaje;
    textoFinalVozRef.current = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      let finalNuevo = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalNuevo += transcript;
        } else {
          interim += transcript;
        }
      }
      if (finalNuevo) {
        textoFinalVozRef.current += finalNuevo;
      }
      setNuevoMensaje(textoBaseVozRef.current + textoFinalVozRef.current + interim);
    };

    recognition.onerror = (event: any) => {
      console.error("Error de reconocimiento de voz:", event.error);
      setAvisoVoz(
        event.error === "not-allowed" || event.error === "permission-denied"
          ? "No se pudo acceder al micrófono — revisá los permisos del navegador."
          : "Hubo un problema con el dictado por voz. Podés seguir escribiendo normalmente."
      );
      setTimeout(() => setAvisoVoz(null), 5000);
    };

    // onend cubre tanto el corte automático por silencio (comportamiento
    // nativo del motor) como el clic manual en el micrófono para detener
    // antes — en ambos casos el texto ya quedó consolidado en nuevoMensaje.
    recognition.onend = () => {
      setGrabandoVoz(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setGrabandoVoz(true);
    recognition.start();
  };

  // Sube un archivo individual y actualiza SOLO su propio chip al terminar
  // — un fallo acá nunca toca el estado de los demás chips en curso. Recibe
  // el casoId explícito (no lo toma de la ruta actual): si el médico
  // cambia de caso mientras la subida está en curso, el resultado tiene
  // que seguir cayendo en el balde del caso original, no en el que esté
  // activo cuando la promesa resuelva.
  const subirUnArchivo = async (casoIdDestino: string, clientId: string, file: File) => {
    try {
      const { archivo } = await workspaceApi.subirArchivo(casoIdDestino, file);
      actualizarAdjuntosDeCaso(casoIdDestino, (prev) =>
        prev.map((a) => (a.clientId === clientId ? { ...a, estado: "listo", archivo } : a))
      );
    } catch {
      actualizarAdjuntosDeCaso(casoIdDestino, (prev) =>
        prev.map((a) => (a.clientId === clientId ? { ...a, estado: "error" } : a))
      );
    }
  };

  // El archivo se sube apenas se adjunta (por clip o por drag & drop), no
  // recién al enviar el mensaje. Todas las subidas del lote se disparan a
  // la vez (sin await entre ellas) — cada una resuelve su propio chip de
  // forma independiente, así que la espera total es la del archivo más
  // lento, no la suma de todos.
  const subirArchivos = (casoIdDestino: string, filesInput: FileList | File[]) => {
    const filesArray = Array.from(filesInput);
    if (filesArray.length === 0) return;

    const actuales = adjuntosPorCaso[casoIdDestino] ?? [];
    const espacioDisponible = Math.max(LIMITE_ARCHIVOS_POR_MENSAJE - actuales.length, 0);
    const aProcesar = filesArray.slice(0, espacioDisponible);

    setAvisoLimiteAdjuntos(
      filesArray.length > aProcesar.length
        ? `Se cargaron los primeros ${LIMITE_ARCHIVOS_POR_MENSAJE} archivos — el límite por mensaje es ${LIMITE_ARCHIVOS_POR_MENSAJE}.`
        : null
    );

    const nuevos: AdjuntoEnProgreso[] = aProcesar.map((file) => ({
      clientId: crypto.randomUUID(),
      file,
      estado: "subiendo",
    }));
    actualizarAdjuntosDeCaso(casoIdDestino, (prev) => [...prev, ...nuevos]);
    nuevos.forEach((item) => subirUnArchivo(casoIdDestino, item.clientId, item.file));
  };

  const reintentarAdjunto = (clientId: string) => {
    if (!casoId) return;
    const item = adjuntos.find((a) => a.clientId === clientId);
    if (!item) return;
    actualizarAdjuntosDeCaso(casoId, (prev) =>
      prev.map((a) => (a.clientId === clientId ? { ...a, estado: "subiendo" } : a))
    );
    subirUnArchivo(casoId, clientId, item.file);
  };

  const quitarAdjunto = (clientId: string) => {
    if (!casoId) return;
    actualizarAdjuntosDeCaso(casoId, (prev) => prev.filter((a) => a.clientId !== clientId));
  };

  const intentarCambiarCaso = (urlDestino: string) => {
    if (adjuntos.length > 0) {
      setCambioCasoPendiente(urlDestino);
    } else {
      navigate(urlDestino);
    }
  };

  // GET /api/archivos/:id ya no es una URL estática — se trae como blob
  // autenticado y se abre en una pestaña nueva vía object URL.
  const abrirArchivo = async (archivoId: string) => {
    const blob = await workspaceApi.obtenerArchivo(archivoId);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // Quitar un adjunto del caso. Se pide confirmación porque es un borrado
  // real y definitivo de un documento clínico (fila, archivo guardado y
  // copia del proveedor) — el proyecto no tiene baja lógica en ninguna
  // tabla, así que no hay de dónde recuperarlo.
  //
  // El backend es quien decide si se puede (solo quien lo subió, y nunca
  // en un caso cerrado); acá el error que devuelve se muestra tal cual en
  // vez de adivinarlo de este lado.
  const eliminarArchivoDelCaso = async (archivo: ArchivoDeMensaje) => {
    if (!casoId) return;
    const confirmado = window.confirm(
      `¿Eliminar "${archivo.nombre_archivo}" del caso?\n\n` +
        "Se borra del expediente y deja de estar disponible para el agente. No se puede deshacer."
    );
    if (!confirmado) return;

    setErrorAnalisis(null);
    try {
      await workspaceApi.eliminarArchivo(archivo.id);
      // Se saca del hilo en memoria en vez de recargar el caso entero: es
      // el mismo dato, sin un viaje de más ni perder la posición de
      // lectura del médico a mitad de un caso largo.
      setMensajes((prev) =>
        prev.map((m) => ({ ...m, archivos: m.archivos.filter((a) => a.id !== archivo.id) }))
      );
    } catch (err) {
      setErrorAnalisis(
        err instanceof ApiError ? err.message : "No se pudo eliminar el archivo."
      );
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* prompt_code_menu_colapsable — la lista de casos cumple el mismo rol
          de "menú que se come la pantalla" que los NavLink de los otros dos
          paneles, aunque acá el contenido sea otro (búsqueda + casos). */}
      <div className="flex items-center gap-3 border-b border-black/5 p-3 md:hidden">
        <BotonMenuMovil onClick={alternarMenu} />
        <span className="text-sm font-semibold text-primary">Vetline Ai</span>
      </div>

      {menuAbierto && <BackdropMenuMovil onClick={cerrarMenu} />}

      <div
        className={[
          "grid min-h-0 flex-1 bg-background",
          "grid-cols-1",
          // 320px → 240px: la lista solo tiene que mostrar paciente y
          // motivo. Los 80px liberados van enteros a la columna central
          // (el hilo clínico), no repartidos: por eso el centro pasa de
          // 1fr a 1.25fr contra 1fr de la derecha. A 1366px de ancho, que
          // es un portátil típico, el centro pasa de 550px a 625px y el
          // panel de Dashboard queda igual (~500px), no se le saca nada.
          detalle ? "md:grid-cols-[240px_1.25fr_1fr]" : "md:grid-cols-[240px_1fr]",
        ].join(" ")}
      >
        {/* Sidebar: lista de casos */}
        <aside
          className={[
            "fixed inset-y-0 left-0 z-40 flex w-[85vw] max-w-xs min-h-0 flex-col overflow-y-auto border-r border-black/5 bg-surface transition-transform duration-200",
            menuAbierto ? "translate-x-0" : "-translate-x-full",
            "md:static md:z-auto md:w-auto md:max-w-none md:translate-x-0",
          ].join(" ")}
        >
        <div className="flex items-center justify-between border-b border-black/5 px-3 py-2.5">
          <Link to="/workspace" className="text-sm font-semibold text-primary hover:underline">
            ← Vetline Ai
          </Link>
        </div>
        <div className="border-b border-black/5 p-2">
          <Input
            placeholder="Buscar por paciente o N.º de expediente…"
            value={busquedaSidebar}
            onChange={(e) => setBusquedaSidebar(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {casosFiltrados.map((caso) => (
            <Link
              key={caso.id}
              to={`/workspace/agentes/${agenteId}/casos/${caso.id}`}
              onClick={(e) => {
                cerrarMenu();
                if (caso.id === casoId) return;
                if (adjuntos.length > 0) {
                  e.preventDefault();
                  intentarCambiarCaso(`/workspace/agentes/${agenteId}/casos/${caso.id}`);
                }
              }}
              className={[
                "mb-1.5 block rounded-lg border p-2.5",
                caso.id === casoId
                  ? "border-accent bg-accent/5"
                  : "border-black/5 hover:border-black/10",
              ].join(" ")}
            >
              {/* Paciente y motivo son lo que la lista tiene que dejar
                  leer; raza, expediente y estado son referencia y van en
                  una línea chica. El nombre trunca en vez de envolver:
                  a 240px, "Bartolomeo — Labrador Retriever" partía la
                  tarjeta en dos líneas antes de llegar al motivo. */}
              <div className="flex items-baseline justify-between gap-2">
                {/* min-w-0 es lo que habilita el truncate: un hijo de flex
                    trae min-width:auto y sin esto el nombre empuja el
                    badge fuera de la tarjeta en vez de cortarse. */}
                <span className="min-w-0 truncate text-sm font-semibold text-primary">
                  {caso.paciente_nombre}
                </span>
                <Badge variant={ESTADO_BADGE[caso.estado] ?? "neutral"} className="shrink-0">
                  {caso.estado.replace("_", " ")}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-text-muted">
                {caso.raza} · N.º {caso.numero_expediente}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-text-muted">{caso.motivo}</p>
            </Link>
          ))}
          {casos.length === 0 && (
            <p className="p-4 text-center text-sm text-text-muted">
              Todavía no hay casos para este agente.
            </p>
          )}
          {casos.length > 0 && casosFiltrados.length === 0 && (
            <p className="p-4 text-center text-sm text-text-muted">
              Ningún caso coincide con la búsqueda.
            </p>
          )}
        </div>
        <div className="p-3">
          <Button fullWidth onClick={abrirModalNuevoCaso}>
            + Nuevo caso
          </Button>
          <Link
            to="/legal"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block text-center text-xs text-text-muted hover:text-primary"
          >
            Términos y Condiciones · Política de Privacidad
          </Link>
        </div>
      </aside>

      {/* Chat */}
      <main className="flex min-h-0 min-w-0 flex-col">
        {detalle ? (
          <>
            {/* Barra superior: alto reducido para devolverle pantalla al
                hilo clínico, que es lo que el médico lee. El py-4 + los
                botones a py-2.5 (el px-3/py-2 que pasaban por className
                nunca se aplicó, ver Button.tsx) hacían una barra de ~200px
                de alto en un portátil, con los botones en 3 o 4 filas. */}
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 bg-surface px-6 py-2.5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-primary">
                  {detalle.paciente_nombre} — {detalle.especie} ({detalle.sexo}
                  {detalle.edad_anios ? `, ${detalle.edad_anios}a` : ""})
                  {detalle.paciente_estado === "fallecido" && <Badge variant="neutral">Fallecido</Badge>}
                  <Badge variant={ESTADO_BADGE[detalle.estado] ?? "neutral"}>
                    {detalle.estado.replace("_", " ")}
                  </Badge>
                </h2>
                <p className="text-xs text-text-muted">Expediente N.º {detalle.numero_expediente}</p>
                <p className="text-sm text-text-muted">{detalle.motivo}</p>
                {casoCerrado && (
                  <p className="mt-1 text-xs text-text-muted">
                    Cerrado el {formatearFechaCorta(detalle.cerrado_en!, zonaHoraria)}
                    {detalle.cerrado_por_nombre ? ` por ${detalle.cerrado_por_nombre}` : ""} · Desenlace:{" "}
                    {detalle.desenlace}
                  </p>
                )}
                {/* prompt_code_cierre_caso.md, Paso 3 — solo aparece si el
                    caso se reabrió alguna vez; convive con la línea de
                    arriba, que sigue mostrando el ÚLTIMO cierre (ver la
                    nota en workspaceApi.CasoDetalle). */}
                {detalle.reabierto_en && (
                  <p className="mt-1 text-xs text-text-muted">
                    Reabierto el {formatearFechaCorta(detalle.reabierto_en, zonaHoraria)}
                    {detalle.reabierto_por_nombre ? ` por ${detalle.reabierto_por_nombre}` : ""}
                    {detalle.motivo_reapertura ? ` — Motivo: ${detalle.motivo_reapertura}` : ""}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-1.5">
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                {SELECTOR_REPORTES_VISIBLE && (
                  <div className="flex flex-col items-end gap-1">
                    <select
                      value={tipoReporteSeleccionado}
                      onChange={(e) => e.target.value && generarReporte(e.target.value)}
                      disabled={estadoReporte !== "idle"}
                      className="rounded-lg border border-black/10 bg-background px-2.5 py-1 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    >
                      <option value="">Generar Reporte ▾</option>
                      {gruposReporte.map((g) => (
                        <optgroup key={g.grupo} label={g.grupo}>
                          {g.tipos.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {estadoReporte === "generando" && (
                      <span className="text-xs text-text-muted">Generando informe…</span>
                    )}
                    {estadoReporte === "listo" && (
                      <span className="text-xs font-semibold text-success">
                        ✓ Informe generado
                      </span>
                    )}
                  </div>
                )}

                <Button
                  variant="secondary"
                  onClick={actualizarDashboard}
                  disabled={dashboardGcisEstado === "generando" || generacionDetenida}
                  size="sm"
                >
                  {dashboardGcisEstado === "generando" ? "Generando…" : "Actualizar Dashboard"}
                </Button>

                {dashboardGcisEstado === "listo" && dashboardGcis?.meta.estado_generacion === "generado" && (
                  <Button
                    variant="secondary"
                    onClick={exportarDashboard}
                    disabled={exportandoDashboard}
                    size="sm"
                  >
                    {exportandoDashboard ? "Exportando…" : "Exportar como HTML"}
                  </Button>
                )}

                {/* Ajustes del área de trabajo, Prioridad 1 — antes vivía
                    atada a que el Dashboard ya estuviera generado (una
                    condición sin relación con el saldo, previa al trabajo
                    de la Prioridad de saldo). Eso hacía que el botón
                    desapareciera por completo en vez de mostrarse
                    deshabilitado. El endpoint real no depende del
                    Dashboard — solo de mensajes mínimos y saldo — así que
                    ya no hay motivo para acoplar la visibilidad a eso. */}
                <Button
                  variant="secondary"
                  onClick={generarInforme}
                  disabled={generandoInforme || generacionDetenida}
                  size="sm"
                  title="Genera un informe nuevo — los anteriores quedan disponibles en Informes anteriores."
                >
                  {generandoInforme ? "Generando informe…" : "Generar informe nuevo"}
                </Button>

                {/* prompt_code_informes_anteriores, Paso 1 — botón fijo
                    con contador, siempre en el mismo lugar, deshabilitado
                    (no oculto) cuando no hay informes. Reemplaza la
                    sección pasiva que aparecía más abajo solo cuando
                    tenía contenido — la razón explícita del cambio es que
                    esa sección resultaba invisible en la práctica. */}
                <Button
                  variant="secondary"
                  onClick={() => setPanelInformesAbierto(true)}
                  disabled={informesAnteriores.length === 0}
                  size="sm"
                >
                  Informes anteriores ({informesAnteriores.length})
                </Button>

                {/* Módulo de Prescripción Médica — común a cualquier
                    agente, no depende de que haya Dashboard generado. */}
                <Button
                  variant="secondary"
                  onClick={() => setRecetaPanelAbierto(true)}
                  disabled={casoCerrado}
                  size="sm"
                >
                  Nueva receta
                </Button>

                {/* prompt_code_registro_atencion.md — "desde el caso, que
                    es donde el médico ya está trabajando". Nunca gateado
                    por casoCerrado: una atención pertenece a la cita y al
                    paciente, no al episodio. */}
                <Button
                  variant="secondary"
                  onClick={() => setResolverCitaAbierto(true)}
                  size="sm"
                >
                  Registrar atención
                </Button>

                {/* prompt_code_cronologia_seguimiento — vista de solo
                    lectura, no depende de que haya Dashboard/informe
                    generado: alcanza con que el caso exista. */}
                <Button
                  variant="secondary"
                  onClick={() => setCronologiaAbierta(true)}
                  size="sm"
                >
                  Cronología
                </Button>

                {/* El médico decide, en cualquier momento del caso, qué
                    atenciones anteriores del paciente (sin caso al
                    registrarse) son relevantes para este — se suman al
                    contexto que razona el agente (ver contextoCaso.ts). */}
                <Button
                  variant="secondary"
                  onClick={() => setVincularAtencionAbierto(true)}
                  size="sm"
                >
                  Vincular atención anterior
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => setFichaPropietarioAbierta(true)}
                  size="sm"
                >
                  Ficha del propietario
                </Button>

                {/* prompt_code_cierre_caso.md, Paso 2 — no aparece un
                    botón "Reabrir" acá: Paso 3 (Reabrir) no está
                    construido todavía, queda fuera de este alcance. */}
                {!casoCerrado && (
                  <Button
                    variant="secondary"
                    onClick={() => setCerrarCasoAbierto(true)}
                    size="sm"
                  >
                    Cerrar caso
                  </Button>
                )}
                {casoCerrado && (
                  <Button
                    variant="secondary"
                    onClick={() => setReabrirCasoAbierto(true)}
                    size="sm"
                  >
                    Reabrir caso
                  </Button>
                )}
                </div>

                {/* Paso 4 — misma explicación al lado de los dos botones
                    que se deshabilitan juntos por falta de saldo. */}
                {generacionDetenida && (
                  <p className="max-w-xs text-right text-xs font-medium text-error">
                    La generación con IA está detenida — avisale a tu administrador de clínica para recargar.
                  </p>
                )}
                {/* Paso 6 — aviso de suficiencia clínica, no menciona costos. */}
                {!generacionDetenida && (
                  <div className="max-w-xs text-right">
                    <AvisoSuficienciaClinica suficiencia={suficienciaClinica} />
                  </div>
                )}
              </div>
            </header>

            <div className="border-b border-black/5 bg-surface px-6 py-2">
              <ConsumoBanner consumo={consumo} />
            </div>

            <div
              className="relative flex-1 space-y-4 overflow-y-auto px-6 py-4"
              onDragOver={(e) => {
                e.preventDefault();
                setArrastrandoArchivo(true);
              }}
              onDragLeave={() => setArrastrandoArchivo(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastrandoArchivo(false);
                if (casoId && e.dataTransfer.files.length > 0) subirArchivos(casoId, e.dataTransfer.files);
              }}
            >
              <MensajesLista
                mensajes={mensajes}
                avisosSinRespuesta={avisosSinRespuesta}
                onAbrirArchivo={abrirArchivo}
                // En un caso cerrado no se ofrece: es de solo lectura, y
                // el backend lo rechaza igual con 409.
                onEliminarArchivo={casoCerrado ? undefined : eliminarArchivoDelCaso}
              />

              {/* Ajustes del área de trabajo, Prioridad 3 — indicador en el
                  lugar donde va a aparecer la respuesta, no solo en el
                  botón: sin esto, la espera de una llamada real a Claude
                  se percibe como que el sistema se colgó. */}
              {enviando && (
                <div className="flex justify-start">
                  <div className="max-w-lg rounded-2xl border border-black/5 bg-surface px-5 py-3 text-sm">
                    <span
                      className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
                      aria-label="Esperando respuesta"
                    />
                  </div>
                </div>
              )}

              {arrastrandoArchivo && (
                <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/5">
                  <p className="text-sm font-semibold text-accent">
                    ↑ Arrastra archivos aquí para analizarlos de forma instantánea
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-black/5 bg-surface px-6 py-3">
              {adjuntos.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {adjuntos.map((a) => (
                    <span
                      key={a.clientId}
                      className={[
                        "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs",
                        a.estado === "error"
                          ? "border-error/30 bg-error/5 text-error"
                          : "border-black/10 bg-background text-text-primary",
                      ].join(" ")}
                    >
                      {a.estado === "subiendo" && (
                        <span
                          className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
                          aria-label="Subiendo"
                        />
                      )}
                      {a.estado === "listo" && a.archivo && (
                        <span
                          className={[
                            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                            a.archivo.legible_por_agente === false
                              ? "bg-warning/15 text-warning"
                              : "bg-accent/10 text-accent",
                          ].join(" ")}
                        >
                          {a.archivo.tipo}
                        </span>
                      )}
                      {a.estado === "error" && <span aria-hidden>⚠</span>}

                      {a.estado === "listo" && a.archivo ? (
                        <button
                          type="button"
                          onClick={() => abrirArchivo(a.archivo!.id)}
                          className="max-w-[10rem] truncate text-left hover:underline"
                          title="Abrir archivo"
                        >
                          {a.archivo.nombre_archivo}
                        </button>
                      ) : (
                        <span className="max-w-[10rem] truncate">{a.file.name}</span>
                      )}

                      {a.estado === "error" && (
                        <button
                          type="button"
                          onClick={() => reintentarAdjunto(a.clientId)}
                          className="font-semibold text-error hover:underline"
                        >
                          Reintentar
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => quitarAdjunto(a.clientId)}
                        className="text-text-muted hover:text-error"
                        aria-label={`Quitar ${a.archivo?.nombre_archivo ?? a.file.name}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {avisoLimiteAdjuntos && (
                <p className="mb-3 text-xs text-warning">{avisoLimiteAdjuntos}</p>
              )}

              {/* El médico se entera de que un adjunto no entra en el
                  análisis acá, al adjuntarlo — no después, por una
                  respuesta en la que el agente lo ignoró en silencio. */}
              {adjuntosNoLegibles.length > 0 && (
                <p className="mb-3 text-xs text-warning">
                  El agente no va a poder leer{" "}
                  {adjuntosNoLegibles.map((a) => a.archivo!.nombre_archivo).join(", ")} — queda guardado en el
                  caso, pero su contenido no entra en el análisis. Para que lo lea, adjuntalo como PDF o imagen.
                </p>
              )}

              {avisoVoz && <p className="mb-3 text-xs text-warning">{avisoVoz}</p>}

              {errorAnalisis && <p className="mb-3 text-xs text-error">{errorAnalisis}</p>}

              <div className="flex items-end gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (casoId && e.target.files && e.target.files.length > 0) {
                      subirArchivos(casoId, e.target.files);
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={casoCerrado}
                  className="flex items-center justify-center rounded-lg border border-black/10 bg-background px-3 text-text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  title="Adjuntar archivo"
                  aria-label="Adjuntar archivo"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>

                {/* Dictado por voz — solo si el navegador soporta Web
                    Speech API y el agente del caso tiene integración real
                    (detalle.agente_operativo = system_prompt IS NOT NULL
                    — renombrado desde es_gcis, ver prompt_code_informes_
                    anteriores Paso 4: ese nombre hacía pensar en una
                    condición por agente específico que nunca existió).
                    Si no hay soporte, el botón directamente no existe en
                    el DOM, no aparece deshabilitado. */}
                {soportaDictado && detalle.agente_operativo && (
                  <button
                    type="button"
                    onClick={alternarDictado}
                    className={[
                      "flex items-center justify-center rounded-lg border px-3",
                      grabandoVoz
                        ? "animate-pulse border-error/30 bg-error/10 text-error"
                        : "border-black/10 bg-background text-text-muted hover:text-accent",
                    ].join(" ")}
                    title={grabandoVoz ? "Detener dictado" : "Dictar mensaje por voz"}
                    aria-label={grabandoVoz ? "Detener dictado" : "Dictar mensaje por voz"}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </button>
                )}

                <textarea
                  ref={textareaRef}
                  rows={3}
                  className="max-h-48 min-h-[4.5rem] flex-1 resize-none overflow-y-auto rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={casoCerrado ? "El caso está cerrado — es de solo lectura." : "Escribí tu mensaje…"}
                  value={nuevoMensaje}
                  disabled={enviando || agregando || casoCerrado}
                  onChange={(e) => setNuevoMensaje(e.target.value)}
                  onKeyDown={(e) => {
                    // Anotar vs consultar, Capa 1 — Enter ahora salta de
                    // línea (comportamiento default del textarea, no se
                    // intercepta); Ctrl+Enter es el atajo de "Analizar el
                    // caso", igual que el botón.
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      analizarCaso();
                    }
                  }}
                />
              </div>

              {/* Anotar vs consultar, Capa 2 — dos acciones distintas sobre
                  la misma caja. Etiquetas y textos de ayuda tal cual están
                  decididos: la distinción entre lo que guarda y lo que
                  procesa tiene que ser evidente sin probar los botones. */}
              <div className="mt-2 flex flex-wrap items-start justify-end gap-4">
                <div className="text-right">
                  <Button
                    variant="secondary"
                    onClick={agregarInformacion}
                    disabled={
                      enviando || agregando || casoCerrado || !nuevoMensaje.trim() || adjuntosSubiendo
                    }
                  >
                    {agregando && (
                      <span
                        className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                        aria-hidden
                      />
                    )}
                    {agregando ? "Agregando…" : "Agregar información"}
                  </Button>
                  <p className="mt-1 text-xs text-text-muted">se guarda en el caso sin consultar al agente</p>
                </div>
                <div className="text-right">
                  <Button
                    onClick={analizarCaso}
                    disabled={
                      enviando ||
                      agregando ||
                      casoCerrado ||
                      // Con adjuntos listos alcanza: no hace falta escribir
                      // nada para mandarle estudios al agente.
                      (!nuevoMensaje.trim() && pendientesInformacion === 0 && adjuntosListos.length === 0) ||
                      adjuntosSubiendo
                    }
                  >
                    {enviando && (
                      <span
                        className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                        aria-hidden
                      />
                    )}
                    {enviando ? "Analizando…" : "Analizar el caso"}
                  </Button>
                  <p className="mt-1 text-xs text-text-muted">envía lo agregado y actualiza el análisis clínico</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-text-muted">
            Seleccioná un caso de la lista, o creá uno nuevo.
          </div>
        )}
      </main>

      {/* Panel de dashboard */}
      {detalle && (
        <CasoDashboardPanel
          detalle={detalle}
          derivacion={derivacion}
          ultimaActualizacion={ultimaActualizacion}
          zonaHoraria={zonaHoraria}
          informacionPosteriorAlDashboard={hayInformacionPosteriorDashboard}
        >
          {/* Dashboard real de GCIS — se agrega debajo del panel estático
              de arriba (Estado clínico/Confianza/Derivación, sin tocar).
              No aparece en el caso ICIS: ese flujo termina siempre en
              "listo" con dashboardGcis en null, ver actualizarDashboard(). */}
          {dashboardGcisEstado === "generando" && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
              <p className="text-sm font-semibold text-primary">Generando Dashboard clínico…</p>
              <p className="mt-1 text-xs text-text-muted">
                Esto puede tardar hasta un par de minutos — es una llamada real al modelo clínico.
              </p>
            </div>
          )}

          {dashboardGcisEstado === "error" && (
            <div className="rounded-xl border border-error/30 bg-error/5 p-4">
              {dashboardGcisMotivo ? (
                <RechazoGeneracionAviso error={dashboardGcisError ?? ""} motivo={dashboardGcisMotivo} />
              ) : (
                <>
                  <p className="text-sm font-semibold text-error">No pudimos generar el Dashboard.</p>
                  {dashboardGcisError && (
                    <p className="mt-1 text-xs text-text-muted">{dashboardGcisError}</p>
                  )}
                </>
              )}
              <Button
                variant="secondary"
                onClick={actualizarDashboard}
                size="sm"
                className="mt-3"
              >
                Reintentar
              </Button>
            </div>
          )}

          {dashboardGcisEstado === "sin_permiso" && (
            <div className="rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">
              No tenés permisos para generar el Dashboard de este caso.
            </div>
          )}

          {dashboardGcisEstado === "sin_datos" && (
            <div className="rounded-xl border border-black/10 bg-background p-4 text-sm text-text-muted">
              Este caso todavía no tiene información clínica suficiente para generar un Dashboard.
              Completá la apertura del expediente y continuá la consulta.
            </div>
          )}

          {dashboardGcisEstado === "listo" && dashboardGcis && (
            <DashboardGcisPanel
              dashboard={dashboardGcis}
              zonaHoraria={zonaHoraria}
              numeroExpediente={detalle.numero_expediente}
            />
          )}

          {generandoInforme && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
              <p className="text-sm font-semibold text-primary">Generando informe clínico…</p>
              <p className="mt-1 text-xs text-text-muted">
                Esto puede tardar unos minutos — es contenido más extenso que el Dashboard.
              </p>
            </div>
          )}

          {errorInforme && <RechazoGeneracionAviso error={errorInforme} motivo={informeMotivo} />}
        </CasoDashboardPanel>
      )}
      </div>

      {/* prompt_code_informes_anteriores, Paso 2 — panel con el
          historial versionado completo (migración 018): cada informe
          generado se conserva para siempre, nunca se sobreescribe. Se
          abre desde el botón fijo con contador de arriba, no como una
          sección que aparece y desaparece según haya o no contenido. */}
      <Modal
        open={panelInformesAbierto}
        onClose={() => setPanelInformesAbierto(false)}
        title="Informes anteriores"
        description={
          informesAnteriores.length === 0
            ? "Este caso todavía no tiene informes generados."
            : `${informesAnteriores.length} informe${informesAnteriores.length === 1 ? "" : "s"} — del más reciente al más antiguo. La descarga entrega el archivo guardado, sin regenerar.`
        }
      >
        <ul className="space-y-2">
          {informesAnteriores.map((informe) => (
            <li
              key={informe.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-background px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium text-text-primary">
                  {formatearFecha(informe.generado_en, zonaHoraria, {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                <p className="text-text-muted">
                  {informe.medico_nombre}
                  {informe.es_cortesia && (
                    <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                      Cortesía
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => descargarInformeAnterior(informe)}
                disabled={descargandoInformeId === informe.id}
                className="flex-shrink-0 font-semibold text-accent hover:underline disabled:opacity-50"
              >
                {descargandoInformeId === informe.id ? "Descargando…" : "Descargar"}
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      {/* Módulo de Prescripción Médica — común a cualquier agente, no
          gateado por estado del Dashboard. */}
      {recetaPanelAbierto && casoId && detalle && (
        <RecetaPanel
          origen={{ tipo: "caso", casoId }}
          pacienteNombre={detalle.paciente_nombre}
          onClose={() => setRecetaPanelAbierto(false)}
        />
      )}

      {resolverCitaAbierto && detalle && user?.userId && (
        <ResolverCitaModal
          pacienteId={detalle.paciente_id}
          medicoId={user.userId}
          casoId={casoId}
          zonaHoraria={zonaHoraria}
          motivoSugerido={detalle.motivo}
          onClose={() => setResolverCitaAbierto(false)}
          onResuelto={(citaId) => {
            setResolverCitaAbierto(false);
            setRegistroAtencionCitaId(citaId);
          }}
        />
      )}

      {registroAtencionCitaId && detalle && (
        <RegistroAtencionModal
          citaId={registroAtencionCitaId}
          pacienteId={detalle.paciente_id}
          pacienteNombre={detalle.paciente_nombre}
          especie={detalle.especie}
          zonaHoraria={zonaHoraria}
          onClose={() => setRegistroAtencionCitaId(null)}
          onVerPropietario={() => {
            setRegistroAtencionCitaId(null);
            setFichaPropietarioAbierta(true);
          }}
          pacienteEstado={detalle.paciente_estado}
          onMarcadoFallecido={() =>
            setDetalle((prev) => (prev ? { ...prev, paciente_estado: "fallecido" } : prev))
          }
        />
      )}

      {cronologiaAbierta && casoId && (
        <CronologiaModal casoId={casoId} zonaHoraria={zonaHoraria} onClose={() => setCronologiaAbierta(false)} />
      )}

      {vincularAtencionAbierto && casoId && detalle && (
        <VincularAtencionModal
          casoId={casoId}
          pacienteId={detalle.paciente_id}
          zonaHoraria={zonaHoraria}
          onClose={() => setVincularAtencionAbierto(false)}
        />
      )}

      {cerrarCasoAbierto && casoId && detalle && (
        <CerrarCasoModal
          pacienteNombre={detalle.paciente_nombre}
          pacienteEstado={detalle.paciente_estado}
          onClose={() => setCerrarCasoAbierto(false)}
          cerrar={(data) => workspaceApi.cerrarCaso(casoId, data)}
          onCerrado={(caso) => {
            setDetalle((prev) => (prev ? { ...prev, ...caso } : prev));
            setCasos((prev) => prev.map((c) => (c.id === casoId ? { ...c, estado: "completado" as const } : c)));
            setCerrarCasoAbierto(false);
          }}
        />
      )}

      {reabrirCasoAbierto && casoId && (
        <ReabrirCasoModal
          onClose={() => setReabrirCasoAbierto(false)}
          reabrir={(motivo) => workspaceApi.reabrirCaso(casoId, motivo)}
          onReabierto={(caso) => {
            setDetalle((prev) => (prev ? { ...prev, ...caso } : prev));
            setCasos((prev) => prev.map((c) => (c.id === casoId ? { ...c, estado: "en_curso" as const } : c)));
            setReabrirCasoAbierto(false);
          }}
        />
      )}

      {fichaPropietarioAbierta && detalle && (
        <FichaPropietarioModal
          propietarioId={detalle.propietario_id}
          onClose={() => setFichaPropietarioAbierta(false)}
        />
      )}

      {/* Modal: nuevo caso — wizard de 3 pasos, panel propio (no el Modal
          genérico) porque necesita el header con puntos de progreso +
          botón de cierre explícito que pide el diseño de Figma. */}
      {modalAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setModalAbierto(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-surface p-8 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  {[1, 2, 3].map((n) => (
                    <span
                      key={n}
                      className={[
                        "h-2.5 w-2.5 rounded-full",
                        n === paso ? "bg-accent" : "bg-black/15",
                      ].join(" ")}
                    />
                  ))}
                </div>
                <span className="text-sm font-semibold text-text-muted">Paso {paso} de 3</span>
              </div>
              <button
                onClick={() => setModalAbierto(false)}
                aria-label="Cerrar"
                className="rounded-lg px-2 py-1 text-lg text-text-muted hover:bg-black/5"
              >
                ✕
              </button>
            </div>

            {paso === 2 && propietarioSeleccionado && (
              <p className="mt-4 text-sm font-semibold text-accent">
                Propietario: {propietarioSeleccionado.nombre}
              </p>
            )}
            {paso === 3 && propietarioSeleccionado && pacienteSeleccionado && (
              <p className="mt-4 text-sm font-semibold text-accent">
                {pacienteSeleccionado.nombre} · {pacienteSeleccionado.especie}
                {pacienteSeleccionado.raza ? `, ${pacienteSeleccionado.raza}` : ""} — Propietario:{" "}
                {propietarioSeleccionado.nombre}
              </p>
            )}

            {/* Paso 1: propietario */}
            {paso === 1 && (
              <div className="mt-2">
                <h2 className="text-xl font-bold text-primary">¿Quién es el propietario?</h2>

                <input
                  className="mt-4 w-full rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  placeholder="Buscar por nombre, email o teléfono…"
                  value={busquedaPropietario}
                  onChange={(e) => setBusquedaPropietario(e.target.value)}
                />

                <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-black/10">
                  {buscandoPropietarios && (
                    <p className="p-4 text-center text-sm text-text-muted">Buscando…</p>
                  )}
                  {!buscandoPropietarios && resultadosPropietarios.length === 0 && (
                    <p className="p-4 text-center text-sm text-text-muted">
                      No encontramos propietarios con esa búsqueda.
                    </p>
                  )}
                  {!buscandoPropietarios &&
                    resultadosPropietarios.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => seleccionarPropietario(p)}
                        className="block w-full border-b border-black/5 px-4 py-3 text-left last:border-b-0 hover:bg-accent/5"
                      >
                        <p className="font-semibold text-primary">{p.nombre}</p>
                        <p className="text-xs text-text-muted">
                          {[
                            p.email,
                            p.telefono,
                            p.numero_identificacion
                              ? `${p.tipo_identificacion_etiqueta}: ${p.numero_identificacion}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </button>
                    ))}
                </div>

                {!formNuevoPropietarioAbierto ? (
                  <button
                    onClick={() => setFormNuevoPropietarioAbierto(true)}
                    className="mt-3 w-full rounded-lg border border-black/15 py-3 text-sm font-semibold text-text-primary hover:bg-black/5"
                  >
                    + Registrar nuevo propietario
                  </button>
                ) : (
                  <div className="mt-3 flex flex-col gap-3 rounded-lg border border-black/10 p-4">
                    {/* prompt_code_propietarios, Ajuste 1 — la identificación
                        va primero: es la llave de entrada que dispara la
                        búsqueda de un propietario ya existente. */}
                    <div className="grid grid-cols-2 gap-3">
                      <Select
                        label="Tipo de identificación (opcional)"
                        value={nuevoPropietario.tipoIdentificacionId}
                        onChange={(e) =>
                          setNuevoPropietario((prev) => ({
                            ...prev,
                            tipoIdentificacionId: e.target.value,
                            numeroIdentificacion: e.target.value ? prev.numeroIdentificacion : "",
                          }))
                        }
                        options={[
                          { value: "", label: "Sin identificación" },
                          ...tiposIdentificacion.map((t) => ({ value: t.id, label: t.etiqueta })),
                        ]}
                      />
                      <Input
                        label="Número de identificación"
                        value={nuevoPropietario.numeroIdentificacion}
                        onChange={(e) =>
                          setNuevoPropietario((prev) => ({ ...prev, numeroIdentificacion: e.target.value }))
                        }
                        disabled={!nuevoPropietario.tipoIdentificacionId}
                      />
                    </div>

                    {buscandoPorIdentificacion && (
                      <p className="text-xs text-text-muted">Buscando propietario existente…</p>
                    )}

                    {!buscandoPorIdentificacion && propietarioEncontradoPorId && (
                      <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                        <p className="text-xs font-semibold text-accent">
                          Ya existe un propietario con esa identificación
                        </p>
                        <p className="mt-1 font-semibold text-primary">{propietarioEncontradoPorId.nombre}</p>
                        <p className="text-xs text-text-muted">
                          {[
                            propietarioEncontradoPorId.email,
                            propietarioEncontradoPorId.telefono,
                            propietarioEncontradoPorId.direccion,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                        <Button
                          className="mt-2"
                          onClick={() => {
                            seleccionarPropietario(propietarioEncontradoPorId);
                            setFormNuevoPropietarioAbierto(false);
                          }}
                        >
                          Usar este propietario
                        </Button>
                      </div>
                    )}

                    <Input
                      label="Nombre"
                      value={nuevoPropietario.nombre}
                      onChange={(e) =>
                        setNuevoPropietario((prev) => ({ ...prev, nombre: e.target.value }))
                      }
                    />
                    <Input
                      label="Teléfono (opcional)"
                      value={nuevoPropietario.telefono}
                      onChange={(e) =>
                        setNuevoPropietario((prev) => ({ ...prev, telefono: e.target.value }))
                      }
                    />
                    <Input
                      label="Email (opcional)"
                      type="email"
                      value={nuevoPropietario.email}
                      onChange={(e) =>
                        setNuevoPropietario((prev) => ({ ...prev, email: e.target.value }))
                      }
                    />
                    <Input
                      label="Dirección (opcional)"
                      value={nuevoPropietario.direccion}
                      onChange={(e) =>
                        setNuevoPropietario((prev) => ({ ...prev, direccion: e.target.value }))
                      }
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => setFormNuevoPropietarioAbierto(false)}>
                        Cancelar
                      </Button>
                      <Button
                        onClick={crearPropietarioYAvanzar}
                        disabled={creandoPropietario || !nuevoPropietario.nombre.trim()}
                      >
                        {creandoPropietario ? "Guardando…" : "Guardar y continuar"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Paso 2: mascota */}
            {paso === 2 && (
              <div className="mt-2">
                <h2 className="text-xl font-bold text-primary">¿Qué mascota vas a atender?</h2>

                {cargandoPacientes ? (
                  <p className="mt-4 text-sm text-text-muted">Cargando mascotas…</p>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {pacientesDelPropietario.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPacienteSeleccionado(p);
                          setPaso(3);
                        }}
                        className={[
                          "rounded-xl border p-4 text-left hover:border-accent hover:bg-accent/5",
                          pacienteSeleccionado?.id === p.id
                            ? "border-accent bg-accent/5"
                            : "border-black/10",
                        ].join(" ")}
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
                          🐾
                        </div>
                        <p className="mt-2 font-semibold text-primary">{p.nombre}</p>
                        <p className="text-xs text-text-muted">
                          {p.especie}
                          {p.raza ? ` · ${p.raza}` : ""}
                        </p>
                      </button>
                    ))}
                    {pacientesDelPropietario.length === 0 && (
                      <p className="col-span-2 text-center text-sm text-text-muted">
                        Este propietario todavía no tiene mascotas registradas.
                      </p>
                    )}
                  </div>
                )}

                {!formNuevoPacienteAbierto ? (
                  <button
                    onClick={() => setFormNuevoPacienteAbierto(true)}
                    className="mt-3 w-full rounded-lg border border-black/15 py-3 text-sm font-semibold text-text-primary hover:bg-black/5"
                  >
                    + Registrar nueva mascota
                  </button>
                ) : (
                  <div className="mt-3 flex flex-col gap-3 rounded-lg border border-black/10 p-4">
                    <Input
                      label="Nombre"
                      value={nuevoPaciente.nombre}
                      onChange={(e) => setNuevoPaciente((prev) => ({ ...prev, nombre: e.target.value }))}
                    />
                    <Select
                      label="Especie"
                      value={nuevoPaciente.especie}
                      onChange={(e) =>
                        // Cambiar de especie invalida cualquier raza ya elegida
                        // — el catálogo es completamente distinto entre las dos.
                        setNuevoPaciente((prev) => ({
                          ...prev,
                          especie: e.target.value,
                          razaId: null,
                        }))
                      }
                      options={ESPECIE_OPTIONS}
                    />
                    <BreedCombobox
                      label="Raza"
                      especie={ESPECIE_A_RAZA_ESPECIE[nuevoPaciente.especie] ?? "canina"}
                      value={nuevoPaciente.razaId}
                      onChange={(razaId) => setNuevoPaciente((prev) => ({ ...prev, razaId }))}
                    />
                    {/* prompt_code_paciente_nacimiento_estado.md, Parte B1 —
                        opcional a propósito: muchos tutores no la saben,
                        sobre todo con animales adoptados. Sin fecha, la
                        edad sigue siendo la que se cargue después (edad_anios,
                        fuera de este wizard) — nunca se piden las dos juntas. */}
                    <Input
                      type="date"
                      label="Fecha de nacimiento (si se conoce)"
                      value={nuevoPaciente.fechaNacimiento}
                      onChange={(e) => setNuevoPaciente((prev) => ({ ...prev, fechaNacimiento: e.target.value }))}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => setFormNuevoPacienteAbierto(false)}>
                        Cancelar
                      </Button>
                      <Button
                        onClick={crearPacienteYAvanzar}
                        disabled={creandoPaciente || !nuevoPaciente.nombre.trim()}
                      >
                        {creandoPaciente ? "Guardando…" : "Guardar y continuar"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-4 border-t border-black/5 pt-4">
                  <button
                    onClick={() => setPaso(1)}
                    className="text-sm font-semibold text-text-primary hover:underline"
                  >
                    Atrás
                  </button>
                </div>
              </div>
            )}

            {/* Paso 3: motivo */}
            {paso === 3 && (
              <div className="mt-2">
                <h2 className="text-xl font-bold text-primary">¿Cuál es el motivo de la consulta?</h2>

                <textarea
                  className="mt-4 w-full rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  rows={4}
                  value={motivoNuevoCaso}
                  onChange={(e) => setMotivoNuevoCaso(e.target.value)}
                  placeholder="Ej: cojera en pata trasera derecha desde hace 3 días…"
                />

                {/* prompt: vincular caso↔cita — opcional, nunca bloquea
                    "Abrir caso". El vínculo es lo que le da al reporte de
                    atenciones un horario real de inicio/fin; sin esto el
                    caso queda igual de válido, solo sin cita asociada. */}
                <div className="mt-5 rounded-lg border border-black/10 p-4">
                  <p className="text-sm font-semibold text-text-primary">¿Esta consulta corresponde a una cita agendada?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setVinculoCita("sin_cita")}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                        vinculoCita === "sin_cita" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
                      }`}
                    >
                      Sin cita
                    </button>
                    {citasDeHoyDisponibles.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setVinculoCita("elegir")}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                          vinculoCita === "elegir" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
                        }`}
                      >
                        Elegir cita de hoy ({citasDeHoyDisponibles.length})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setVinculoCita("crear")}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                        vinculoCita === "crear" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
                      }`}
                    >
                      Crear cita ahora
                    </button>
                  </div>

                  {vinculoCita === "elegir" && (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {citasDeHoyDisponibles.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setCitaSeleccionadaId(c.id)}
                          className={[
                            "rounded-lg border p-2.5 text-left text-sm",
                            citaSeleccionadaId === c.id ? "border-accent bg-accent/5" : "border-black/10",
                          ].join(" ")}
                        >
                          <p className="font-semibold text-primary">
                            {c.hora_inicio.slice(0, 5)}–{c.hora_fin.slice(0, 5)}
                          </p>
                          <p className="text-xs text-text-muted">{c.estado}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  {vinculoCita === "crear" && (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input
                        type="time"
                        label="Hora de inicio"
                        value={nuevaCitaHoraInicio}
                        onChange={(e) => setNuevaCitaHoraInicio(e.target.value)}
                      />
                      <Input
                        type="number"
                        label="Duración (minutos)"
                        value={String(nuevaCitaDuracion)}
                        onChange={(e) => setNuevaCitaDuracion(Number(e.target.value) || 30)}
                      />
                    </div>
                  )}
                </div>

                {avisoVinculoCita && <p className="mt-3 text-sm text-warning">{avisoVinculoCita}</p>}
                {errorWizard && <p className="mt-3 text-sm text-error">{errorWizard}</p>}

                <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-4">
                  <button
                    onClick={() => setPaso(2)}
                    className="text-sm font-semibold text-text-primary hover:underline"
                  >
                    Atrás
                  </button>
                  <Button onClick={crearCaso} disabled={creandoCaso || !motivoNuevoCaso.trim()}>
                    {creandoCaso ? "Creando…" : "Abrir caso"}
                  </Button>
                </div>
              </div>
            )}

            {errorWizard && paso !== 3 && <p className="mt-3 text-sm text-error">{errorWizard}</p>}
          </div>
        </div>
      )}

      {/* Aviso: archivos subidos pero sin enviar en el caso que se está por
          abandonar. Nunca se pierden — quedan en adjuntosPorCaso hasta que
          el médico vuelva a este caso. */}
      {cambioCasoPendiente && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setCambioCasoPendiente(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-primary">Archivos sin enviar</h2>
            <p className="mt-2 text-sm text-text-muted">
              Tenés {adjuntos.length} archivo{adjuntos.length === 1 ? "" : "s"} sin enviar en este
              caso. ¿Querés continuar de todas formas?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setCambioCasoPendiente(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const destino = cambioCasoPendiente;
                  setCambioCasoPendiente(null);
                  navigate(destino);
                }}
              >
                Continuar sin enviar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
