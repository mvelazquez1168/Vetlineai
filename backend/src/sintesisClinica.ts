import crypto from "crypto";
import { PoolClient } from "pg";
import { DASHBOARD_TOOL, INFORME_TOOL } from "./herramientasAgente";

// ---------------------------------------------------------------------
// SÍNTESIS CLÍNICA — una sola por caso, dos vistas.
//
// Hoy el dashboard y el informe son dos llamadas independientes sobre el
// mismo caso. Se paga dos veces, y —más grave— son dos razonamientos que
// pueden discrepar sobre el mismo paciente sin que nadie lo note hasta
// que alguien compare la pantalla con el documento.
//
// El esquema de la síntesis NO se escribe a mano: se COMPONE desde los dos
// esquemas que ya existen. Retipear 27 campos con sus descripciones es
// exactamente cómo se introduce una variante mientras se cree estar
// unificando — y en este repositorio ya pasó tres veces esta semana. Al
// componer, además, si mañana cambia un campo del dashboard, la síntesis
// lo hereda sin que nadie se acuerde de sincronizar.
//
// PRIORIDAD DEL DASHBOARD. Ante un campo con el mismo concepto en los dos,
// gana la definición del DASHBOARD. No es una preferencia estética: si la
// síntesis se diseñara con la estructura del documento en la cabeza,
// quedaría limitada a lo que un documento puede mostrar y perdería lo que
// solo tiene sentido en pantalla — tendencias, coincidencias de la base de
// conocimiento, alertas activas.
//
// Los cuatro conceptos que hoy tienen dos nombres según el camino se
// unifican acá. No es cosmética: mientras existan los dos nombres, nada
// impide que las dos vistas digan cosas distintas del mismo objeto.
// ---------------------------------------------------------------------

/**
 * Mismo concepto, dos nombres según qué camino lo generaba. La síntesis
 * usa uno solo; cada vista traduce al suyo al mostrar.
 */
export const CONCEPTOS_UNIFICADOS: { sintesis: string; dashboard: string; informe?: string }[] = [
  { sintesis: "estado_clinico", dashboard: "clinical_state", informe: "estado_clinico_actual" },
  { sintesis: "diagnostico_diferencial", dashboard: "differential_diagnosis", informe: "diagnostico_diferencial" },
  // OJO: `razonamiento_diagnostico` del informe NO va acá. Ver NO_UNIFICAR.
  { sintesis: "diario_de_razonamiento", dashboard: "clinical_reasoning_journal" },
  { sintesis: "resumen_ejecutivo", dashboard: "executive_summary", informe: "resumen_ejecutivo" },
];

/**
 * `clinical_confidence` y `matriz_evidencia` NO se unifican aunque el
 * relevamiento los emparejó por posición: el primero es un nivel de
 * calidad de evidencia sobre el caso, el segundo es la tabla de afirmación
 * → sustento → fuente. Son dos cosas distintas y las dos van a la
 * síntesis. Fusionarlas sería repetir el error de `confianza`/
 * `probabilidad`, con otro disfraz.
 */
/**
 * Renombres sin contraparte en la otra vista: el campo existe en una sola,
 * pero su nombre era ambiguo. Van declarados aca y no escondidos en una
 * funcion de ajuste — el verificador los lee de esta lista, y un renombre
 * que no este aca aparece como campo perdido, que es lo que corresponde.
 */
export const RENOMBRES: { sintesis: string; dashboard?: string; informe?: string }[] = [
  { sintesis: "sustento_del_caso", dashboard: "clinical_confidence" },
];

/**
 * `matriz_evidencia` NO se unifica con el sustento del caso aunque el
 * relevamiento los emparejo por posicion: uno es un nivel de calidad de
 * evidencia y el otro es la tabla afirmacion -> sustento -> fuente. Son
 * dos cosas distintas y las dos van a la sintesis.
 */
export const NO_UNIFICAR = ["sustento_del_caso", "matriz_evidencia", "razonamiento_diagnostico"];

/**
 * POR QUE `razonamiento_diagnostico` NO SE UNIFICA CON `diario_de_razonamiento`.
 *
 * Estaban emparejados —el relevamiento los junto por tema— y eso rompia el
 * informe: la sintesis adoptaba la forma del dashboard (un array de
 * {fecha, hipotesis, estado, motivo}) y el informe espera prosa, asi que
 * construirCuerpoInforme hacia texto.split() sobre un array. Ver D-005.
 *
 * Pero el tipo era el sintoma, no la causa. Son dos cosas distintas:
 *
 *   informe.razonamiento_diagnostico (CRS-010)  el ARGUMENTO: explicacion
 *     paso a paso de como se llego al diagnostico, no solo el resultado.
 *     "Siempre presente".
 *
 *   dashboard.clinical_reasoning_journal (Zona 4)  el REGISTRO: que
 *     hipotesis siguen activas y cuales se descartaron, con fecha y motivo.
 *     Null legitimo si el caso es demasiado incipiente.
 *
 * Dos nombres del mismo dato no pueden tener reglas de presencia distintas:
 * si fueran lo mismo, un caso incipiente dejaria al informe sin su seccion
 * mas importante. Y lo cronologico que el array describe ya lo cubren
 * `historia_clinica` y `evolucion_clinica` del propio informe.
 *
 * Es el mismo error que confianza/probabilidad, con otro disfraz — y se
 * resuelve igual: la sintesis carga las DOS, no se mapea una a la otra.
 * Al no estar unificado, su `origen` queda en "informe" y cae solo en el
 * COMPLEMENTO: se genera cuando alguien pide el informe, no antes.
 */

const propsDe = (t: any) => t.input_schema.properties as Record<string, any>;

/**
 * Copia profunda. Sin esto, componer la sintesis MUTA los esquemas de las
 * dos tools: `props[nombre] = v` guarda la misma referencia, y cualquier
 * ajuste posterior sobre la sintesis se aplica tambien al dashboard y al
 * informe. Verificado: importar este modulo cambiaba el esquema que el
 * endpoint del dashboard le manda al modelo, sin que nadie tocara ese
 * endpoint. Un modulo que altera otro por el solo hecho de existir.
 */
const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function componerEsquema() {
  const d = propsDe(DASHBOARD_TOOL);
  const i = propsDe(INFORME_TOOL);
  const props: Record<string, any> = {};
  const requeridos: string[] = [];
  const origen: Record<string, string> = {};

  const renombreDash = new Map([
    ...CONCEPTOS_UNIFICADOS.map((c) => [c.dashboard, c.sintesis] as [string, string]),
    ...RENOMBRES.filter((r) => r.dashboard).map((r) => [r.dashboard!, r.sintesis] as [string, string]),
  ]);
  // `.filter(c => c.informe)` y no un cast: desde que un concepto puede
  // estar unificado SOLO entre síntesis y dashboard, `c.informe` puede
  // faltar. El cast que había antes metía `undefined` como clave del mapa
  // — silencioso, y con el efecto de que un campo del informe se saltara.
  const renombreInf = new Map([
    ...CONCEPTOS_UNIFICADOS.filter((c) => c.informe).map((c) => [c.informe!, c.sintesis] as [string, string]),
    ...RENOMBRES.filter((r) => r.informe).map((r) => [r.informe!, r.sintesis] as [string, string]),
  ]);

  // 1. El dashboard primero y entero: define la forma.
  for (const [k, v] of Object.entries(d)) {
    if (k === "meta") continue; // la síntesis tiene su propio meta
    const nombre = renombreDash.get(k) ?? k;
    props[nombre] = clonar(v);
    origen[nombre] = "dashboard";
    requeridos.push(nombre);
  }

  // 2. Del informe, solo lo que el dashboard no cubre.
  for (const [k, v] of Object.entries(i)) {
    if (k === "meta" || k === "tipo_reporte") continue;
    const nombre = renombreInf.get(k) ?? k;
    if (props[nombre]) continue; // ya lo puso el dashboard, que manda
    props[nombre] = clonar(v);
    origen[nombre] = "informe";
    requeridos.push(nombre);
  }

  return { props, requeridos, origen };
}

/**
 * TRES EJES EN EL DIFERENCIAL.
 *
 * El diferencial del dashboard traia un solo campo `confianza` con
 * valores alta/moderada/baja, y el del informe traia `probabilidad` con
 * los mismos tres valores. Eran dos conceptos distintos bajo vocabularios
 * identicos, que es como se confunden sin que nadie lo note.
 *
 * Se separan en tres ejes ortogonales, y CADA UNO CON SU PROPIO
 * VOCABULARIO. Esa es la parte que hace que funcione: si los tres usaran
 * alta/media/baja, el modelo los llenaria igual y la confusion habria
 * quedado mudada al esquema en vez de eliminada. Con vocabularios
 * distintos, confundirlos se ve a simple vista y lo detecta un validador.
 *
 *   sustento      que tan buena es la evidencia disponible
 *   probabilidad  que tan probable es el diagnostico
 *   confirmacion  si esta confirmado, apoyado, o pendiente
 *
 * Los tres pueden combinarse en cualquier orden: evidencia solida de que
 * algo NO es (sustento solida + probabilidad descartada + confirmacion
 * refutada) es un estado valido y hoy inexpresable.
 *
 * `confianza` desaparece: era el nombre ambiguo.
 */
function ajustarDiferencial(props: Record<string, any>) {
  const dif = props["diagnostico_diferencial"];
  if (!dif?.items?.properties) return;
  const it = dif.items;
  delete it.properties.confianza;
  it.properties.sustento = {
    type: "string",
    enum: ["solida", "parcial", "insuficiente"],
    description:
      "Calidad de la EVIDENCIA disponible para evaluar esta hipotesis. No es la probabilidad de la " +
      "enfermedad: evidencia solida de que algo NO es tambien es sustento solido.",
  };
  it.properties.probabilidad = {
    type: "string",
    enum: ["alta", "moderada", "baja", "descartada"],
    description:
      "Probabilidad de que ESTE diagnostico sea el del paciente, dada la evidencia. Ortogonal al " +
      "sustento: una hipotesis puede ser probable con evidencia pobre, o improbable con evidencia solida.",
  };
  // `confirmacion` es un objeto y no un string suelto: 'confirmada' EXIGE
  // nombrar la prueba que confirmo. Sin ese requisito, "confirmado" es una
  // palabra; con el, es una afirmacion verificable — y la unica de las
  // reglas de razonamiento que se puede validar mecanicamente.
  it.properties.confirmacion = {
    type: "object",
    additionalProperties: false,
    required: ["estado", "criterio", "pendiente"],
    properties: {
      estado: {
        type: "string",
        enum: ["sospechada", "apoyada", "confirmada", "refutada", "no_confirmable"],
        description:
          "'confirmada' solo si la prueba de referencia se hizo y es compatible. Si la evidencia " +
          "apoya pero la confirmacion no se hizo, es 'apoyada' por fuerte que sea la evidencia.",
      },
      criterio: {
        type: ["string", "null"],
        description:
          "Que prueba confirmo o refuto, con su resultado. OBLIGATORIO cuando estado es 'confirmada' " +
          "o 'refutada'; null en los otros estados.",
      },
      pendiente: {
        type: ["string", "null"],
        description:
          "Que prueba falta para confirmar. Se espera cuando estado es 'apoyada' o 'sospechada'; " +
          "null cuando ya se confirmo, se refuto, o no hay prueba de referencia disponible.",
      },
    },
  };
  it.required = ["diagnostico", "evidencia_a_favor", "evidencia_en_contra", "informacion_faltante",
                 "sustento", "probabilidad", "confirmacion"];
}

const { props, requeridos, origen } = componerEsquema();

/**
 * El sustento a nivel CASO. Se llamaba `clinical_confidence` con valores
 * alto/moderado/bajo: nombre ambiguo y vocabulario que colisionaba con el
 * de probabilidad. Es el mismo concepto que el sustento de una hipotesis,
 * con otro alcance, asi que lleva el mismo nombre y el mismo vocabulario.
 */
function ajustarSustentoDelCaso(props: Record<string, any>) {
  const cc = props["sustento_del_caso"];
  if (!cc) return;
  const nivel = cc.properties?.nivel;
  if (nivel) {
    nivel.enum = ["solida", "parcial", "insuficiente"];
    nivel.description =
      "Calidad de la evidencia disponible en el caso como conjunto. Nunca es la probabilidad de " +
      "una enfermedad.";
  }
}

ajustarDiferencial(props);
ajustarSustentoDelCaso(props);

export const ORIGEN_DE_CAMPO = origen;

export const SINTESIS_TOOL = {
  name: "generar_sintesis",
  description:
    "Produce la síntesis clínica del caso: UNA sola vez, y de ella salen tanto el dashboard en pantalla " +
    "como el informe en documento. No es un resumen: es el razonamiento completo del caso en forma " +
    "estructurada. Todo lo que el dashboard muestra y todo lo que el informe necesita tiene que estar acá, " +
    "porque ninguna de las dos vistas vuelve a razonar sobre el caso — solo presentan lo que esta síntesis " +
    "dice. Si un dato clínico no entra acá, no existe para ninguna de las dos.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["meta", ...requeridos],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["estado_generacion"],
        properties: {
          estado_generacion: {
            type: "string",
            enum: ["sin_datos", "generado"],
            description:
              "'sin_datos' si el caso todavía no tiene información clínica suficiente para razonar. " +
              "En ese caso todos los demás campos van en null y ninguna vista inventa nada.",
          },
        },
      },
      ...props,
    },
  },
} as any;

// ---------------------------------------------------------------------
// HUELLA
//
// Una huella del contenido que produjo la síntesis. Si cambió, la síntesis
// está vieja y se regenera. Punto.
//
// A propósito NO clasifica qué cambió. Clasificar la causa solo sirve para
// decidir que un cambio no amerita regenerar, y esa decisión es una
// heurística sobre qué importa clínicamente: equivocarse ahí significa
// razonar sobre un caso desactualizado sin saberlo. Cualquier cambio en el
// material del caso invalida la síntesis, sin excepciones y sin criterio.
// ---------------------------------------------------------------------
export async function calcularHuellaCaso(db: PoolClient, casoId: string): Promise<string> {
  const h = crypto.createHash("sha256");

  const caso = (
    await db.query(
      `SELECT motivo, estado, severidad, desenlace, confianza_diagnostica, paciente_id, agente_id
         FROM casos WHERE id = $1`,
      [casoId]
    )
  ).rows[0];
  if (!caso) throw new Error(`Caso ${casoId} inexistente.`);
  h.update(JSON.stringify(caso));

  // Mensajes: contenido y orden.
  const mensajes = (
    await db.query(
      `SELECT id, remitente, tipo, contenido, incorporada FROM mensajes WHERE caso_id = $1 ORDER BY creado_en, id`,
      [casoId]
    )
  ).rows;
  // `incorporada` entra en la huella: un mensaje que pasa de anotado a
  // incorporado cambia lo que el agente ve, aunque su texto no cambie.
  for (const m of mensajes) h.update(`${m.id}|${m.remitente}|${m.tipo}|${m.incorporada}|${m.contenido ?? ""}`);

  // Archivos del caso: un adjunto nuevo cambia el razonamiento.
  const archivos = (
    await db.query(`SELECT id, nombre_archivo, tipo, file_id_anthropic FROM archivos WHERE caso_id = $1 ORDER BY id`, [casoId])
  ).rows;
  for (const a of archivos) h.update(`${a.id}|${a.nombre_archivo}|${a.tipo}|${a.file_id_anthropic ?? ""}`);

  // Recetas emitidas: cambian el historial terapéutico del informe.
  const recetas = (
    await db.query(`SELECT id, estado, emitido_en FROM recetas WHERE caso_id = $1 ORDER BY id`, [casoId])
  ).rows;
  for (const r of recetas) h.update(`${r.id}|${r.estado}|${r.emitido_en?.toISOString?.() ?? ""}`);

  return h.digest("hex");
}

export interface EstadoSintesis {
  existe: boolean;
  vigente: boolean;
  huellaGuardada: string | null;
  huellaActual: string;
  generadaEn: Date | null;
}

/** ¿Hay síntesis y sigue valiendo para el estado actual del caso? */
export async function estadoSintesis(db: PoolClient, casoId: string): Promise<EstadoSintesis> {
  const f = (
    await db.query(`SELECT sintesis IS NOT NULL AS existe, sintesis_huella, sintesis_generada_en FROM casos WHERE id = $1`, [casoId])
  ).rows[0];
  const huellaActual = await calcularHuellaCaso(db, casoId);
  return {
    existe: !!f?.existe,
    vigente: !!f?.existe && f.sintesis_huella === huellaActual,
    huellaGuardada: f?.sintesis_huella ?? null,
    huellaActual,
    generadaEn: f?.sintesis_generada_en ?? null,
  };
}

// ---------------------------------------------------------------------
// LAS DOS VISTAS
//
// Proyecciones puras: toman la síntesis y devuelven la forma que cada
// vista ya esperaba. No razonan, no completan, no interpretan — si un
// campo no está en la síntesis, no está en la vista.
//
// Esa es toda la garantía de coherencia del Paso 5: con una sola fuente y
// dos proyecciones sin lógica, el dashboard y el informe no pueden
// contradecirse, porque ninguno de los dos decide nada.
// ---------------------------------------------------------------------

const propsDash = Object.keys(DASHBOARD_TOOL.input_schema.properties);
const propsInf = Object.keys(INFORME_TOOL.input_schema.properties);

function proyectar(sintesis: any, campos: string[], mapa: Map<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const destino of campos) {
    if (destino === "meta" || destino === "tipo_reporte") continue;
    const enSintesis = mapa.get(destino) ?? destino;
    // `?? null` y no `undefined`: la vista espera el campo presente aunque
    // esté vacío. Un campo ausente y un campo en null son cosas distintas
    // para quien lo consume, y confundirlas es cómo una sección
    // desaparece de un informe sin que nadie lo note.
    out[destino] = sintesis[enSintesis] ?? null;
  }
  return out;
}

/** La vista de pantalla. Conserva los nombres que el frontend ya usa. */
export function proyectarDashboard(sintesis: any, casoId: string): Record<string, any> {
  const mapa = new Map(CONCEPTOS_UNIFICADOS.map((c) => [c.dashboard, c.sintesis]));
  // El frontend todavia lee los nombres viejos. La proyeccion se los da
  // desde el campo canonico: es el mismo objeto con otro nombre, nunca una
  // traduccion de valores. Cuando el frontend adopte el nombre nuevo, la
  // entrada sale de RENOMBRES y esto sigue funcionando.
  for (const r of RENOMBRES) if (r.dashboard) mapa.set(r.dashboard, r.sintesis);
  return {
    meta: { ...(sintesis.meta ?? {}), caso_id: casoId, generado_en: new Date().toISOString() },
    ...proyectar(sintesis, propsDash, mapa),
  };
}

/** La vista de documento. */
export function proyectarInforme(sintesis: any, casoId: string): Record<string, any> {
  const mapa = new Map(CONCEPTOS_UNIFICADOS.filter((c) => c.informe).map((c) => [c.informe!, c.sintesis]));
  for (const r of RENOMBRES) if (r.informe) mapa.set(r.informe, r.sintesis);
  return {
    meta: { ...(sintesis.meta ?? {}), caso_id: casoId, generado_en: new Date().toISOString() },
    tipo_reporte: "CR-001",
    ...proyectar(sintesis, propsInf, mapa),
  };
}

// ---------------------------------------------------------------------
// DOS FASES, UNA SÍNTESIS
//
// La síntesis completa tarda ~220 s porque produce las dos vistas. Con 70
// dashboards y 0 informes en el uso real, hacer esperar todo eso a quien
// solo va a mirar la pantalla es el peor reparto posible.
//
// Se parte en dos llamadas encadenadas sobre la MISMA síntesis:
//
//   NÚCLEO       lo que el dashboard necesita. Se muestra apenas está.
//   COMPLEMENTO  lo que solo el informe usa. Se completa después.
//
// No son dos razonamientos: el complemento recibe el núcleo ya hecho y
// solo agrega lo que falta. Por eso sigue habiendo una sola fuente y las
// dos vistas siguen sin poder contradecirse — que era lo que importaba
// más que el ahorro.
//
// La partición NO se escribe a mano: sale de ORIGEN_DE_CAMPO, el mismo
// registro que dice de qué esquema vino cada campo. Si mañana se agrega un
// campo al dashboard, cae en el núcleo solo.
// ---------------------------------------------------------------------

const CAMPOS_NUCLEO = Object.keys(props).filter((k) => ORIGEN_DE_CAMPO[k] === "dashboard");
const CAMPOS_COMPLEMENTO = Object.keys(props).filter((k) => ORIGEN_DE_CAMPO[k] === "informe");

const subEsquema = (campos: string[], nombre: string, descripcion: string) => ({
  name: nombre,
  description: descripcion,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: nombre === "generar_sintesis_nucleo" ? ["meta", ...campos] : campos,
    properties: {
      ...(nombre === "generar_sintesis_nucleo"
        ? { meta: (SINTESIS_TOOL.input_schema.properties as any).meta }
        : {}),
      ...Object.fromEntries(campos.map((k) => [k, props[k]])),
    },
  },
});

export const SINTESIS_NUCLEO_TOOL = subEsquema(
  CAMPOS_NUCLEO,
  "generar_sintesis_nucleo",
  "Produce el NÚCLEO de la síntesis clínica: el razonamiento del caso en la forma que el médico ve en " +
    "pantalla. Es la primera de dos partes de una misma síntesis — después se completa con las secciones " +
    "que solo el documento usa, sin volver a razonar. Razoná el caso completo acá: lo que se agregue " +
    "después parte de esto y no puede contradecirlo."
) as any;

export const SINTESIS_COMPLEMENTO_TOOL = subEsquema(
  CAMPOS_COMPLEMENTO,
  "generar_sintesis_complemento",
  "Completa la síntesis clínica con las secciones que solo el documento usa. El núcleo ya está hecho y " +
    "te lo paso: NO vuelvas a razonar el caso ni cambies ninguna conclusión. Tu tarea es desarrollar lo " +
    "que falta —narrativa, cronología, laboratorio, recomendaciones, pronóstico— de forma consistente " +
    "con lo que el núcleo ya dice. Si algo del núcleo te parece incorrecto, no lo corrijas: desarrollá " +
    "sobre lo que hay."
) as any;

export const PARTICION_SINTESIS = { nucleo: CAMPOS_NUCLEO, complemento: CAMPOS_COMPLEMENTO };
