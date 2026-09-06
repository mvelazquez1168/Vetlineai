import { PoolClient } from "pg";
import { conAlcanceTenant } from "./alcanceTenant";
import { requerirAnthropic } from "./anthropic";
import { HERRAMIENTAS_AGENTE, CACHE_PREFIJO_COMPARTIDO } from "./herramientasAgente";
import {
  SINTESIS_NUCLEO_TOOL,
  SINTESIS_COMPLEMENTO_TOOL,
  PARTICION_SINTESIS,
  calcularHuellaCaso,
  estadoSintesis,
} from "./sintesisClinica";
import { construirMensajesParaModelo } from "./archivosDelCaso";
import { construirBloqueContextoCaso } from "./contextoCaso";
import { construirBloqueRazaDocumento } from "./razaDocumento";
import {
  obtenerDocumentosParaContexto,
  construirBloqueDocumentos,
  obtenerRecetasEmitidasParaContexto,
  construirBloquePrescripciones,
  insertarBloquePrescripciones,
} from "./contextoAgente";

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
//
// ---------------------------------------------------------------------
// POR QUÉ ESTAS FUNCIONES RECIBEN `tenantId` Y NO UN CLIENTE DE POSTGRES
//
// Cada una hace tres cosas en orden: lee el material del caso, llama al
// modelo, y persiste el resultado. Si recibieran un cliente ya puesto en
// una transacción —que es lo natural desde una ruta—, esa transacción
// quedaría abierta durante toda la llamada al modelo. Eso es la alerta de
// `idle in transaction` de AWS: la conexión retiene bloqueos y congela el
// horizonte de vacuum mientras espera algo que no es la base.
//
// La propiedad vive ACÁ y no en cada llamador a propósito. La síntesis es
// ahora la llamada larga de las dos vistas, así que si el patrón queda mal
// se rompe en el peor lugar posible; y un llamador nuevo que reciba una
// función "dame un `db`" va a pasarle el de su request sin pensarlo. Que
// la puerta lo garantice es lo que evita que alguien copie el patrón mal.
//
// Cada fase corre en su propia transacción corta (`conAlcanceTenant`) y la
// llamada al modelo queda AFUERA de las dos.
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
  estado: "nucleo" | "completa";
  usage?: any;
  /**
   * TODAS las llamadas al modelo que costaron esta síntesis, en orden.
   *
   * `usage` solo trae la última, y eso alcanzaba mientras cada fase se
   * pedía por separado. Pero `obtenerSintesisParaInforme` puede encadenar
   * dos —núcleo y complemento— y devolver solo la del complemento: quien
   * facture desde `usage` cobraría una y regalaría la otra, sin que nada
   * falle. Lista vacía = no se llamó al modelo y no hay nada que cobrar.
   */
  usosDelModelo: any[];
}

/**
 * Devuelve la síntesis vigente del caso. Si no hay, o si el material del
 * caso cambió desde que se generó, la produce y la guarda.
 *
 * `forzar` regenera aunque esté vigente. Lo usa el pedido explícito de
 * "actualizar" del médico, que es distinto de "mostrame lo que hay".
 */
async function leerVigente(db: PoolClient, casoId: string, huella: string): Promise<ResultadoSintesis> {
  const f = (
    await db.query(`SELECT sintesis, sintesis_generada_en, sintesis_estado FROM casos WHERE id = $1`, [casoId])
  ).rows[0];
  return {
    sintesis: f.sintesis,
    huella,
    generadaEn: f.sintesis_generada_en,
    seGenero: false,
    estado: f.sintesis_estado,
    // No se llamó al modelo: no hay nada que cobrar.
    usosDelModelo: [],
  };
}

/**
 * Lo que el DASHBOARD necesita. Le alcanza con el núcleo: si hay uno
 * vigente —completo o no— se devuelve sin llamar al modelo.
 */
export async function obtenerSintesisParaDashboard(
  tenantId: string,
  casoId: string,
  opciones: { forzar?: boolean } = {}
): Promise<ResultadoSintesis> {
  const vigente = await conAlcanceTenant(tenantId, async (db) => {
    const estado = await estadoSintesis(db, casoId);
    if (estado.vigente && !opciones.forzar) return leerVigente(db, casoId, estado.huellaGuardada!);
    return null;
  });
  if (vigente) return vigente;
  return generarNucleo(tenantId, casoId);
}

/**
 * Lo que el INFORME necesita. Exige la síntesis completa: si solo hay
 * núcleo, se completa; si no hay nada, se hacen las dos fases.
 *
 * Que el informe dispare la generación es el punto del Paso 3: no depende
 * de que alguien haya abierto el dashboard antes.
 */
export async function obtenerSintesisParaInforme(
  tenantId: string,
  casoId: string,
  opciones: { forzar?: boolean } = {}
): Promise<ResultadoSintesis> {
  const decision = await conAlcanceTenant(tenantId, async (db) => {
    const estado = await estadoSintesis(db, casoId);
    const fila = (await db.query(`SELECT sintesis_estado FROM casos WHERE id = $1`, [casoId])).rows[0];
    if (estado.vigente && fila?.sintesis_estado === "completa" && !opciones.forzar) {
      return { vigente: await leerVigente(db, casoId, estado.huellaGuardada!), hacerNucleo: false };
    }
    return { vigente: null, hacerNucleo: !estado.vigente || !!opciones.forzar };
  });

  if (decision.vigente) return decision.vigente;

  // El núcleo se guarda para arrastrar su consumo: son DOS llamadas al
  // modelo y las dos se cobran. Devolver solo la del complemento regalaba
  // la del núcleo sin que nada fallara.
  const nucleo = decision.hacerNucleo ? await generarNucleo(tenantId, casoId) : null;
  const completa = await completarSintesis(tenantId, casoId);
  return {
    ...completa,
    usosDelModelo: [...(nucleo?.usosDelModelo ?? []), ...completa.usosDelModelo],
  };
}

/**
 * Contexto compartido por las dos fases. Se arma una sola vez y se usa
 * igual en las dos, para que el complemento razone sobre exactamente el
 * mismo material que el nucleo.
 */
async function armarContexto(db: PoolClient, casoId: string, tenantId: string) {
  const caso = (
    await db.query(
      `SELECT c.id, c.agente_id, a.system_prompt FROM casos c JOIN agentes a ON a.id = c.agente_id WHERE c.id = $1`,
      [casoId]
    )
  ).rows[0];
  if (!caso) throw new Error(`Caso ${casoId} inexistente.`);
  if (!caso.system_prompt) throw new Error(`El agente del caso ${casoId} no tiene system_prompt.`);

  const documentos = await obtenerDocumentosParaContexto(db, caso.agente_id, tenantId);
  const systemCacheado = `${caso.system_prompt}\n\n---\n\n${construirBloqueDocumentos(documentos.clinicos)}`;
  const bloqueGeneracion =
    documentos.generacion.length > 0 ? construirBloqueDocumentos(documentos.generacion) : null;
  const bloqueContextoCaso = await construirBloqueContextoCaso(db, casoId);
  const bloqueRazaDocumento = await construirBloqueRazaDocumento(db, casoId, tenantId);

  const { mensajes } = await construirMensajesParaModelo(db, casoId);
  const recetas = await obtenerRecetasEmitidasParaContexto(db, casoId);
  const mensajesConPrescripciones = insertarBloquePrescripciones(mensajes, construirBloquePrescripciones(recetas));

  return { systemCacheado, bloqueGeneracion, bloqueContextoCaso, bloqueRazaDocumento, mensajesConPrescripciones };
}

function bloquesSystem(ctx: any, instruccion: string) {
  return [
    { type: "text", text: ctx.systemCacheado, cache_control: CACHE_PREFIJO_COMPARTIDO },
    ...(ctx.bloqueGeneracion
      ? [{ type: "text" as const, text: ctx.bloqueGeneracion, cache_control: CACHE_PREFIJO_COMPARTIDO }]
      : []),
    { type: "text", text: ctx.bloqueContextoCaso },
    ...(ctx.bloqueRazaDocumento ? [{ type: "text" as const, text: ctx.bloqueRazaDocumento }] : []),
    { type: "text", text: instruccion },
  ];
}

/**
 * FASE 1 — el nucleo. Lo que el dashboard necesita, y nada mas.
 *
 * Razona el caso completo: lo que la fase 2 agregue parte de aca y no
 * puede contradecirlo. Por eso el nucleo no es "la mitad barata" sino el
 * razonamiento, y el complemento es desarrollo.
 */
export async function generarNucleo(tenantId: string, casoId: string): Promise<ResultadoSintesis> {
  // FASE A — lectura. Transacción corta, y todo lo que el modelo necesita
  // sale de acá: después de esto no se vuelve a tocar la base hasta tener
  // la respuesta.
  //
  // La huella se calcula ANTES de la llamada: si el caso cambiara mientras
  // el modelo responde, la sintesis quedaria guardada como vigente para un
  // material que no es el que razono.
  const { ctx, huella } = await conAlcanceTenant(tenantId, async (db) => ({
    ctx: await armarContexto(db, casoId, tenantId),
    huella: await calcularHuellaCaso(db, casoId),
  }));

  // FASE B — el modelo, SIN ninguna conexión tomada.
  const anthropic = requerirAnthropic();
  const respuesta = await anthropic.beta.messages.create({
    model: MODELO,
    max_tokens: 8192,
    betas: ["files-api-2025-04-14"],
    system: bloquesSystem(ctx, INSTRUCCION),
    messages: [
      ...ctx.mensajesConPrescripciones,
      { role: "user", content: "Generá el núcleo de la síntesis clínica de este caso, usando la tool generar_sintesis_nucleo." },
    ],
    tools: [...HERRAMIENTAS_AGENTE, SINTESIS_NUCLEO_TOOL],
    tool_choice: { type: "tool", name: "generar_sintesis_nucleo" },
  } as any);

  const bloque = (respuesta.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "generar_sintesis_nucleo");
  if (!bloque) throw new Error("La respuesta del modelo no incluyó el núcleo de la síntesis.");
  const sintesis = (bloque as any).input;

  // FASE C — persistencia. Otra transacción corta.
  const generadaEn = new Date();
  await conAlcanceTenant(tenantId, (db) =>
    db.query(
      `UPDATE casos SET sintesis = $2, sintesis_huella = $3, sintesis_generada_en = $4, sintesis_estado = 'nucleo' WHERE id = $1`,
      [casoId, sintesis, huella, generadaEn]
    )
  );
  const usage = (respuesta as any).usage;
  return { sintesis, huella, generadaEn, seGenero: true, estado: "nucleo", usage, usosDelModelo: [usage] };
}

/**
 * FASE 2 — el complemento. Desarrolla lo que solo el informe usa.
 *
 * Recibe el nucleo ya hecho y tiene prohibido volver a razonar. Esa es la
 * unica razon por la que sigue habiendo una sola fuente: si la fase 2
 * razonara de nuevo, serian otra vez dos razonamientos que pueden
 * discrepar, con un paso intermedio.
 */
export async function completarSintesis(tenantId: string, casoId: string): Promise<ResultadoSintesis> {
  // FASE A — lectura. El núcleo, su huella y el contexto salen de una sola
  // transacción corta: si se leyeran por separado podrían describir
  // momentos distintos del caso.
  const leido = await conAlcanceTenant(tenantId, async (db) => {
    const fila = (
      await db.query(`SELECT sintesis, sintesis_huella, sintesis_estado FROM casos WHERE id = $1`, [casoId])
    ).rows[0];
    if (!fila?.sintesis) throw new Error("No hay núcleo que completar.");
    const huellaAhora = await calcularHuellaCaso(db, casoId);
    // Si el caso cambió, no se arma el contexto: se va a regenerar entero.
    // Unión discriminada por `desactualizado` para que TypeScript sepa que
    // en la otra rama `ctx` está — sin `!` ni casts que apaguen el chequeo.
    if (huellaAhora !== fila.sintesis_huella) return { desactualizado: true as const };
    return { desactualizado: false as const, fila, ctx: await armarContexto(db, casoId, tenantId) };
  });

  // Si el caso cambio entre las dos fases, completar seria construir sobre
  // un nucleo que ya no describe el caso. Se regenera entero.
  if (leido.desactualizado) {
    const nuevo = await generarNucleo(tenantId, casoId);
    // El consumo del núcleo recién hecho se arrastra al resultado, gane la
    // rama que gane: si el complemento sale, se cobran los dos; si falla y
    // se devuelve el núcleo solo, ya trae el suyo.
    return completarSintesis(tenantId, casoId)
      .then((r) => ({ ...r, usosDelModelo: [...nuevo.usosDelModelo, ...r.usosDelModelo] }))
      .catch(() => nuevo);
  }

  // En el camino normal esta llamada no viene precedida de otra.
  const usosPrevios: any[] = [];

  const { fila, ctx } = leido;
  const nucleo = JSON.stringify(fila.sintesis, null, 1);
  const instruccion =
    "Ya existe el núcleo de la síntesis de este caso, hecho por vos en la llamada anterior. Te lo paso " +
    "completo. NO vuelvas a razonar el caso: tu tarea es desarrollar las secciones que faltan, " +
    "consistentes con lo que el núcleo ya dice. Si algo del núcleo te parece incorrecto, no lo " +
    "corrijas — desarrollá sobre lo que hay.\n\n=== NÚCLEO DE LA SÍNTESIS ===\n" + nucleo;

  const anthropic = requerirAnthropic();
  const respuesta = await anthropic.beta.messages.create({
    model: MODELO,
    max_tokens: 12288,
    betas: ["files-api-2025-04-14"],
    system: bloquesSystem(ctx, instruccion),
    messages: [
      ...ctx.mensajesConPrescripciones,
      { role: "user", content: "Completá la síntesis con las secciones que faltan, usando la tool generar_sintesis_complemento." },
    ],
    tools: [...HERRAMIENTAS_AGENTE, SINTESIS_COMPLEMENTO_TOOL],
    tool_choice: { type: "tool", name: "generar_sintesis_complemento" },
  } as any);

  const bloque = (respuesta.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "generar_sintesis_complemento");
  if (!bloque) throw new Error("La respuesta del modelo no incluyó el complemento.");

  // El complemento se AGREGA al nucleo, nunca lo pisa: solo puede escribir
  // los campos de su particion. Si intentara devolver un campo del nucleo,
  // el esquema no se lo permite, y esta linea lo garantiza igual.
  const complemento: Record<string, any> = {};
  for (const k of PARTICION_SINTESIS.complemento) complemento[k] = (bloque as any).input[k] ?? null;
  const sintesis = { ...fila.sintesis, ...complemento };

  // FASE C — persistencia, en su propia transacción corta.
  const generadaEn = new Date();
  await conAlcanceTenant(tenantId, (db) =>
    db.query(
      `UPDATE casos SET sintesis = $2, sintesis_generada_en = $3, sintesis_estado = 'completa' WHERE id = $1`,
      [casoId, sintesis, generadaEn]
    )
  );
  const usage = (respuesta as any).usage;
  return {
    sintesis,
    huella: fila.sintesis_huella,
    generadaEn,
    seGenero: true,
    estado: "completa",
    usage,
    usosDelModelo: [...usosPrevios, usage],
  };
}
