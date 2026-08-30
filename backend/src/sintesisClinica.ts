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
export const CONCEPTOS_UNIFICADOS: { sintesis: string; dashboard: string; informe: string }[] = [
  { sintesis: "estado_clinico", dashboard: "clinical_state", informe: "estado_clinico_actual" },
  { sintesis: "diagnostico_diferencial", dashboard: "differential_diagnosis", informe: "diagnostico_diferencial" },
  { sintesis: "diario_de_razonamiento", dashboard: "clinical_reasoning_journal", informe: "razonamiento_diagnostico" },
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
export const NO_UNIFICAR = ["clinical_confidence", "matriz_evidencia"];

const propsDe = (t: any) => t.input_schema.properties as Record<string, any>;

function componerEsquema() {
  const d = propsDe(DASHBOARD_TOOL);
  const i = propsDe(INFORME_TOOL);
  const props: Record<string, any> = {};
  const requeridos: string[] = [];
  const origen: Record<string, string> = {};

  const renombreDash = new Map(CONCEPTOS_UNIFICADOS.map((c) => [c.dashboard, c.sintesis]));
  const renombreInf = new Map(CONCEPTOS_UNIFICADOS.map((c) => [c.informe, c.sintesis]));

  // 1. El dashboard primero y entero: define la forma.
  for (const [k, v] of Object.entries(d)) {
    if (k === "meta") continue; // la síntesis tiene su propio meta
    const nombre = renombreDash.get(k) ?? k;
    props[nombre] = v;
    origen[nombre] = "dashboard";
    requeridos.push(nombre);
  }

  // 2. Del informe, solo lo que el dashboard no cubre.
  for (const [k, v] of Object.entries(i)) {
    if (k === "meta" || k === "tipo_reporte") continue;
    const nombre = renombreInf.get(k) ?? k;
    if (props[nombre]) continue; // ya lo puso el dashboard, que manda
    props[nombre] = v;
    origen[nombre] = "informe";
    requeridos.push(nombre);
  }

  return { props, requeridos, origen };
}

const { props, requeridos, origen } = componerEsquema();

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
