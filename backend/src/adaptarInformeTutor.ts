import { requerirAnthropic } from "./anthropic";
import { INFORME_TOOL } from "./herramientasAgente";

// =====================================================================
// Paso 4 — el informe PARA EL TUTOR.
//
// Para un colega no se llama al modelo: la síntesis ya está en lenguaje
// técnico y el informe se compone proyectándola. Para el tutor hay que
// adaptar el lenguaje — "infiltrado linfoplasmocítico moderado" no le dice
// nada al dueño de una mascota.
//
// REGLA DURA: esta llamada solo puede REFORMULAR lo que la síntesis ya
// dice. No puede agregar contenido clínico, ni matizar un pronóstico, ni
// sumar tranquilidad que el veterinario no expresó. Una versión
// simplificada que suaviza lo que el médico dijo es PEOR que no tenerla:
// el tutor toma decisiones sobre su animal con eso.
//
// La regla se sostiene en dos niveles, y conviene ser claro sobre qué
// garantiza cada uno:
//
//   1. El prompt. Es lo único que puede impedir que un pronóstico reservado
//      se vuelva esperanzador. No es una garantía dura.
//   2. La FORMA, al mezclar. Se acepta texto adaptado únicamente donde el
//      original tenía texto, y se exige la misma estructura: mismas claves,
//      misma cantidad de elementos. Agregar un diagnóstico diferencial,
//      sumar una recomendación o borrar una advertencia cambia la forma, y
//      eso sí se detecta y se descarta.
//
// No hace falta el contexto completo del caso: entra la síntesis ya hecha
// y sale reescrita. Entrada chica, salida chica, sin volver a cargar la
// base de conocimiento y sin volver a razonar.
// =====================================================================

const MODELO = "claude-sonnet-4-6";

const INSTRUCCION =
  "Vas a reescribir un informe clínico veterinario para que lo lea el TUTOR del animal — la persona " +
  "que lo cuida, sin formación veterinaria. Usá la tool generar_informe para devolverlo.\n\n" +
  "TU ÚNICA TAREA ES TRADUCIR EL LENGUAJE. No es resumir, no es interpretar, no es opinar.\n\n" +
  "PROHIBIDO, sin excepciones:\n" +
  "- Agregar cualquier contenido clínico que no esté en el informe original.\n" +
  "- Suavizar, matizar o endulzar un pronóstico, un riesgo o una advertencia. Si el original dice que " +
  "el pronóstico es reservado, la versión para el tutor dice que es reservado — explicado en palabras " +
  "simples, no atenuado.\n" +
  "- Sumar tranquilidad, ánimo o expectativas que el veterinario no expresó.\n" +
  "- Quitar una advertencia porque suene dura, ni agregar o eliminar elementos de una lista.\n\n" +
  "SÍ tenés que:\n" +
  "- Reemplazar el término técnico por su equivalente entendible, y cuando el término importe, " +
  "mantenerlo entre paréntesis para que el tutor pueda buscarlo o repetirlo en otra consulta.\n" +
  "- Conservar EXACTAMENTE la misma estructura: las mismas secciones, las mismas claves, la misma " +
  "cantidad de elementos en cada lista. Si una sección viene en null, devolvela en null.\n" +
  "- Escribir en segunda persona, dirigiéndote al tutor, con frases cortas.\n\n" +
  "Si una parte del original ya es entendible, dejala como está. Copiar es preferible a reformular de más.";

/** Qué se descartó de la respuesta del modelo por no respetar la forma. */
export interface ResultadoAdaptacion {
  informe: Record<string, any>;
  usage: any;
  /** Rutas donde el modelo cambió la estructura y se conservó el original. */
  descartados: string[];
}

/**
 * Mezcla la versión adaptada sobre la original conservando la FORMA.
 *
 * Solo el texto puede cambiar. Cualquier otra diferencia —una clave que
 * aparece, un elemento de más en una lista, un null que se volvió objeto—
 * se descarta y gana el original, porque eso ya no es traducir.
 */
export function mezclarConservandoForma(
  original: any,
  adaptado: any,
  esquema: any,
  ruta: string,
  descartados: string[]
): any {
  // UN VALOR DE VOCABULARIO CERRADO NO ES LENGUAJE, ES UN DATO.
  //
  // `nivel: "reservado"` y `probabilidad: "alta"` son strings, pero salen de
  // un enum del esquema: cambiarlos no es traducir, es cambiar el juicio
  // clínico. Sin esta rama, "reservado" -> "favorable" pasaba como una
  // reformulación cualquiera — lo detectó la prueba de la barrera, no una
  // revisión. Es exactamente el "matizar un pronóstico" que la regla dura
  // prohíbe, y el caso más grave de todos porque el tutor decide con eso.
  if (esquema?.enum) {
    if (adaptado !== original) descartados.push(`${ruta} (valor de vocabulario cerrado)`);
    return original;
  }

  if (typeof original === "string") {
    if (typeof adaptado === "string" && adaptado.trim().length > 0) return adaptado;
    descartados.push(ruta || "(raíz)");
    return original;
  }

  // Un null en el original es "esta sección no aplica". Que la versión del
  // tutor la complete sería inventar contenido clínico, que es justo lo
  // prohibido.
  if (original === null || original === undefined) {
    if (adaptado !== null && adaptado !== undefined) descartados.push(ruta || "(raíz)");
    return original;
  }

  if (Array.isArray(original)) {
    if (!Array.isArray(adaptado) || adaptado.length !== original.length) {
      descartados.push(`${ruta}[] (${Array.isArray(adaptado) ? `${adaptado.length} vs ${original.length} elementos` : "no es lista"})`);
      return original;
    }
    return original.map((v, i) =>
      mezclarConservandoForma(v, adaptado[i], esquema?.items, `${ruta}[${i}]`, descartados)
    );
  }

  if (typeof original === "object") {
    if (typeof adaptado !== "object" || adaptado === null || Array.isArray(adaptado)) {
      descartados.push(ruta || "(raíz)");
      return original;
    }
    const salida: Record<string, any> = {};
    for (const k of Object.keys(original)) {
      salida[k] = mezclarConservandoForma(
        original[k],
        adaptado[k],
        esquema?.properties?.[k],
        ruta ? `${ruta}.${k}` : k,
        descartados
      );
    }
    // Las claves que el modelo agregó no entran: la forma la define el original.
    for (const k of Object.keys(adaptado)) {
      if (!(k in original)) descartados.push(`${ruta ? ruta + "." : ""}${k} (clave agregada)`);
    }
    return salida;
  }

  // Números y booleanos: no son lenguaje, no se traducen.
  if (adaptado !== original) descartados.push(`${ruta} (valor no textual modificado)`);
  return original;
}

export async function adaptarInformeParaTutor(
  informeTecnico: Record<string, any>
): Promise<ResultadoAdaptacion> {
  const anthropic = requerirAnthropic();
  const respuesta = await anthropic.beta.messages.create({
    model: MODELO,
    max_tokens: 16384,
    system: [{ type: "text", text: INSTRUCCION }],
    messages: [
      {
        role: "user",
        content:
          "Este es el informe técnico. Devolvé la versión para el tutor con la MISMA estructura.\n\n" +
          JSON.stringify(informeTecnico, null, 1),
      },
    ],
    tools: [INFORME_TOOL],
    tool_choice: { type: "tool", name: "generar_informe" },
  } as any);

  const bloque = (respuesta.content ?? []).find(
    (b: any) => b.type === "tool_use" && b.name === "generar_informe"
  );
  if (!bloque) throw new Error("La respuesta del modelo no incluyó el informe adaptado.");

  const descartados: string[] = [];
  // El esquema guía la mezcla: es lo que distingue un texto libre de un
  // valor de vocabulario cerrado.
  const informe = mezclarConservandoForma(
    informeTecnico,
    (bloque as any).input,
    INFORME_TOOL.input_schema,
    "",
    descartados
  );
  // `meta` y `tipo_reporte` los pone el backend, nunca el modelo.
  informe.meta = informeTecnico.meta;
  informe.tipo_reporte = informeTecnico.tipo_reporte;

  return { informe, usage: (respuesta as any).usage, descartados };
}
