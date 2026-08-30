import { PoolClient } from "pg";
import { requerirAnthropic } from "./anthropic";
import { HERRAMIENTAS_AGENTE, CACHE_PREFIJO_COMPARTIDO } from "./herramientasAgente";
import { SINTESIS_TOOL, calcularHuellaCaso, estadoSintesis } from "./sintesisClinica";
import { construirMensajesParaModelo } from "./archivosDelCaso";
import { construirBloqueContextoCaso } from "./contextoCaso";
import { construirBloqueRazaDocumento } from "./razaDocumento";
import {
  obtenerDocumentosParaContexto,
  construirBloqueDocumentos,
  obtenerRecetasEmitidasParaContexto,
  construirBloquePrescripciones,
  insertarBloquePrescripciones,
} from "./routes/casos.routes";

// ---------------------------------------------------------------------
// Generación de la síntesis clínica.
//
// Una sola llamada por caso, de la que salen el dashboard y el informe.
// No depende de que alguien haya abierto el dashboard antes: si el médico
// pide el informe y no hay síntesis, se genera acá y sirve para los dos.
//
// El contexto se arma EXACTAMENTE como lo armaban los dos caminos que
// reemplaza —mismo prefijo cacheado, mismos documentos, mismos mensajes y
// adjuntos, mismas prescripciones—. Si se armara distinto, la síntesis
// razonaría sobre otra cosa que el dashboard de hoy y la comparación
// antes/después no significaría nada.
//
// A diferencia del dashboard y del informe, esta llamada SÍ persiste su
// resultado, con la huella del material que lo produjo.
// ---------------------------------------------------------------------

const MODELO = "claude-sonnet-4-6";

const INSTRUCCION =
  "A continuación vas a producir la SÍNTESIS CLÍNICA del caso mediante la tool generar_sintesis. " +
  "Es el único razonamiento que se va a hacer sobre este caso: de esta síntesis salen tanto el " +
  "dashboard que el médico ve en pantalla como el informe que se entrega. Ninguna de las dos vistas " +
  "vuelve a razonar — solo presentan lo que vos pongas acá. Si un dato clínico no entra en la " +
  "síntesis, no existe para ninguna de las dos. " +
  "Seguí estrictamente las reglas de aparición condicional de las especificaciones del agente: nunca " +
  "completes un campo de tendencia si no se cumple el umbral mínimo de datos, ni una sección opcional " +
  "sin datos reales que la sustenten — en esos casos va null. " +
  "En los campos de texto libre, si subdividís el contenido marcá la subdivisión con un encabezado de " +
  "nivel 2 (## Título), nunca con negrita a modo de título.";

export interface ResultadoSintesis {
  sintesis: any;
  huella: string;
  generadaEn: Date;
  /** false = ya existía y estaba vigente, no se llamó al modelo. */
  seGenero: boolean;
  usage?: any;
}

/**
 * Devuelve la síntesis vigente del caso. Si no hay, o si el material del
 * caso cambió desde que se generó, la produce y la guarda.
 *
 * `forzar` regenera aunque esté vigente. Lo usa el pedido explícito de
 * "actualizar" del médico, que es distinto de "mostrame lo que hay".
 */
export async function obtenerOGenerarSintesis(
  db: PoolClient,
  casoId: string,
  tenantId: string,
  opciones: { forzar?: boolean } = {}
): Promise<ResultadoSintesis> {
  const estado = await estadoSintesis(db, casoId);
  if (estado.vigente && !opciones.forzar) {
    const fila = (await db.query(`SELECT sintesis, sintesis_generada_en FROM casos WHERE id = $1`, [casoId])).rows[0];
    return {
      sintesis: fila.sintesis,
      huella: estado.huellaGuardada!,
      generadaEn: fila.sintesis_generada_en,
      seGenero: false,
    };
  }
  return generarSintesis(db, casoId, tenantId);
}

export async function generarSintesis(db: PoolClient, casoId: string, tenantId: string): Promise<ResultadoSintesis> {
  const caso = (
    await db.query(
      `SELECT c.id, c.agente_id, a.system_prompt FROM casos c JOIN agentes a ON a.id = c.agente_id WHERE c.id = $1`,
      [casoId]
    )
  ).rows[0];
  if (!caso) throw new Error(`Caso ${casoId} inexistente.`);
  if (!caso.system_prompt) throw new Error(`El agente del caso ${casoId} no tiene system_prompt.`);

  // Mismo armado de contexto que el dashboard y el informe. Los documentos
  // de generación entran: la síntesis produce lo que las dos vistas
  // muestran, así que necesita las dos mitades del catálogo.
  const documentos = await obtenerDocumentosParaContexto(db, caso.agente_id, tenantId);
  const systemCacheado = `${caso.system_prompt}\n\n---\n\n${construirBloqueDocumentos(documentos.clinicos)}`;
  const bloqueGeneracion =
    documentos.generacion.length > 0 ? construirBloqueDocumentos(documentos.generacion) : null;
  const bloqueContextoCaso = await construirBloqueContextoCaso(db, casoId);
  const bloqueRazaDocumento = await construirBloqueRazaDocumento(db, casoId, tenantId);

  const { mensajes } = await construirMensajesParaModelo(db, casoId);
  const recetas = await obtenerRecetasEmitidasParaContexto(db, casoId);
  const mensajesConPrescripciones = insertarBloquePrescripciones(mensajes, construirBloquePrescripciones(recetas));

  // La huella se calcula ANTES de la llamada. Si se calculara después y
  // el caso cambiara mientras el modelo responde, la síntesis quedaría
  // guardada como vigente para un material que no es el que razonó.
  const huella = await calcularHuellaCaso(db, casoId);

  const anthropic = requerirAnthropic();
  const respuesta = await anthropic.beta.messages.create({
    model: MODELO,
    max_tokens: 16384,
    betas: ["files-api-2025-04-14"],
    system: [
      { type: "text", text: systemCacheado, cache_control: CACHE_PREFIJO_COMPARTIDO },
      ...(bloqueGeneracion
        ? [{ type: "text" as const, text: bloqueGeneracion, cache_control: CACHE_PREFIJO_COMPARTIDO }]
        : []),
      { type: "text", text: bloqueContextoCaso },
      ...(bloqueRazaDocumento ? [{ type: "text" as const, text: bloqueRazaDocumento }] : []),
      { type: "text", text: INSTRUCCION },
    ],
    messages: [
      ...mensajesConPrescripciones,
      { role: "user", content: "Generá la síntesis clínica de este caso, usando la tool generar_sintesis." },
    ],
    tools: [...HERRAMIENTAS_AGENTE, SINTESIS_TOOL],
    tool_choice: { type: "tool", name: "generar_sintesis" },
  } as any);

  const bloque = (respuesta.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "generar_sintesis");
  if (!bloque) throw new Error("La respuesta del modelo no incluyó la síntesis.");
  const sintesis = (bloque as any).input;

  const generadaEn = new Date();
  await db.query(
    `UPDATE casos SET sintesis = $2, sintesis_huella = $3, sintesis_generada_en = $4 WHERE id = $1`,
    [casoId, sintesis, huella, generadaEn]
  );

  return { sintesis, huella, generadaEn, seGenero: true, usage: (respuesta as any).usage };
}
