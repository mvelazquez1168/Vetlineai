import { Pool, PoolClient } from "pg";
import path from "path";

type EjecutorSql = Pool | PoolClient;

// ---------------------------------------------------------------------
// Fuente única de verdad sobre qué adjunto puede leer el agente, cómo se
// le entrega, y qué se hace con los que no puede leer.
//
// Antes esta decisión estaba escrita cuatro veces —chat, dashboard,
// informe, receta— como un filtro suelto `tipo === "imagen" || tipo ===
// "pdf"`, y una quinta vez por omisión en la subida, que acepta cualquier
// archivo de menos de 25MB sin consultar a ninguna de las otras cuatro. Un
// archivo que pasaba la subida y no pasaba el filtro desaparecía sin
// error, sin log y sin aviso al médico: el agente respondía como si nunca
// hubiera existido. Eso es lo que este módulo cierra.
//
// Las tres formas de perder un archivo que existían, y cómo se cierran acá:
//
//   1. Adjunto colgado de un mensaje tipo='informacion' ("Agregar
//      información"). El historial que va al modelo filtra
//      tipo IN ('consulta','respuesta'), así que esos adjuntos no entraban
//      nunca — pero sí se ven en el hilo, que es lo que hace que el médico
//      crea que el agente los recibió. Ahora van en el turno de cierre.
//   2. Adjunto sin mensaje (mensaje_id NULL). Pasa con los archivos que se
//      suben y nunca se llegan a asociar. Ahora van en el turno de cierre
//      también — lo que además recupera, en el próximo análisis, los que ya
//      hayan quedado huérfanos en producción.
//   3. Adjunto de un formato que la Messages API no sabe referenciar
//      (.docx, .xlsx, .pages, cualquier extensión desconocida). Se sigue sin
//      poder mandar —eso no depende de nosotros— pero ahora se le NOMBRA al
//      modelo y se le pide que lo diga en voz alta, en vez de dejarlo
//      analizar creyendo que lo tiene todo.
// ---------------------------------------------------------------------

// Un bloque de archivo dentro de un mensaje solo existe en dos formas: la
// Messages API referencia por file_id una imagen (bloque `image`) o un PDF
// / texto plano (bloque `document`). Todo lo demás no tiene forma de
// entrar: no es una restricción nuestra que se pueda aflojar con código.
export type FormaDeEnvio = "image" | "document";

export type BloqueContenido =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "file"; file_id: string } }
  | { type: "document"; source: { type: "file"; file_id: string } };

export interface MensajeParaModelo {
  role: "user" | "assistant";
  content: string | BloqueContenido[];
}

// Cómo se le entrega este archivo al modelo, o null si no hay forma.
//
// Se decide por `tipo` (la clasificación que hace inferirTipo() en la
// subida) y, para el cajón de sastre "documento" —que mezcla .txt con
// .docx/.rtf—, se desempata por extensión: text/plain sí se puede
// referenciar como document, un .docx no.
export function formaDeEnvio(tipo: string | null, nombreArchivo: string): FormaDeEnvio | null {
  if (tipo === "imagen") return "image";
  if (tipo === "pdf") return "document";
  const ext = path.extname(nombreArchivo ?? "").toLowerCase();
  if (ext === ".txt") return "document";
  return null;
}

// Para la subida y para la interfaz: ¿este archivo va a llegarle al agente?
// Mismo criterio exacto que el armado del pedido — ese es el punto de tener
// una sola función.
export function esLegiblePorAgente(tipo: string | null, nombreArchivo: string): boolean {
  return formaDeEnvio(tipo, nombreArchivo) !== null;
}

interface FilaArchivo {
  id: string;
  nombre_archivo: string;
  tipo: string | null;
  file_id_anthropic: string | null;
  mensaje_id: string | null;
  mensaje_tipo: string | null;
  mensaje_remitente: string | null;
}

export interface ResultadoMensajes {
  mensajes: MensajeParaModelo[];
  // Diagnóstico para el log y para el mensaje de error: cuántos archivos
  // del caso viajaron de verdad y cuántos no se pudieron mandar. Nadie
  // debería tener que abrir la base para responder "¿el agente vio el
  // estudio?" nunca más.
  archivosEnviados: number;
  archivosNoLegibles: { nombre: string; tipo: string | null }[];
}

// ---------------------------------------------------------------------
// Arma el array `messages` completo del caso: los turnos de conversación
// con sus adjuntos, más un turno de cierre con todo adjunto del caso que
// no tenga un turno propio donde ir.
//
// Es el único lugar donde se decide qué archivo del caso llega al modelo.
// Los cuatro puntos que llaman a la API (chat, dashboard, informe, receta)
// pasan por acá: la duplicación anterior era deliberada, pero el filtro de
// adjuntos derivando por separado en cuatro copias es exactamente cómo se
// pierde un archivo en una sola de ellas sin que nadie lo note.
// ---------------------------------------------------------------------
export async function construirMensajesParaModelo(
  db: EjecutorSql,
  casoId: string
): Promise<ResultadoMensajes> {
  // tipo IN ('consulta','respuesta') — los bloques tipo='informacion' no
  // son turnos de conversación, van como bloque de system aparte (ver
  // informacionRegistrada.ts). Lo que cambia respecto de antes es que sus
  // ARCHIVOS ya no se van con ellos: bajan al turno de cierre.
  const historialResult = await db.query(
    `SELECT id, remitente, contenido
       FROM mensajes
      WHERE caso_id = $1 AND tipo IN ('consulta', 'respuesta')
      ORDER BY creado_en ASC`,
    [casoId]
  );

  // Todos los archivos del caso, no solo los que tienen mensaje: el
  // vínculo con un mensaje decide DÓNDE va el archivo en el hilo, nunca si
  // se manda o no.
  const archivosResult = await db.query(
    `SELECT a.id, a.nombre_archivo, a.tipo, a.file_id_anthropic, a.mensaje_id,
            m.tipo AS mensaje_tipo, m.remitente AS mensaje_remitente
       FROM archivos a
       LEFT JOIN mensajes m ON m.id = a.mensaje_id
      WHERE a.caso_id = $1
      ORDER BY a.creado_en ASC`,
    [casoId]
  );

  const bloquesPorMensaje = new Map<string, BloqueContenido[]>();
  const sueltos: FilaArchivo[] = [];
  const noLegibles: FilaArchivo[] = [];
  let archivosEnviados = 0;

  for (const archivo of archivosResult.rows as FilaArchivo[]) {
    const forma = formaDeEnvio(archivo.tipo, archivo.nombre_archivo);
    // Sin forma de envío (formato no soportado) o sin file_id (la subida a
    // la Files API falló en su momento) son casos distintos con la misma
    // consecuencia: no viaja. Los dos se le nombran al modelo abajo.
    if (!forma || !archivo.file_id_anthropic) {
      noLegibles.push(archivo);
      continue;
    }

    archivosEnviados++;
    const bloque: BloqueContenido =
      forma === "image"
        ? { type: "image", source: { type: "file", file_id: archivo.file_id_anthropic } }
        : { type: "document", source: { type: "file", file_id: archivo.file_id_anthropic } };

    // Un bloque de archivo solo es válido dentro de un turno de rol "user".
    // Un adjunto colgado de un turno del agente, de un bloque de
    // información (que no es turno) o de ningún mensaje no tiene turno
    // propio donde ir: se acumula para el turno de cierre.
    const tieneTurnoPropio =
      archivo.mensaje_id !== null &&
      archivo.mensaje_tipo === "consulta" &&
      archivo.mensaje_remitente === "medico";

    if (tieneTurnoPropio) {
      const existentes = bloquesPorMensaje.get(archivo.mensaje_id!) ?? [];
      existentes.push(bloque);
      bloquesPorMensaje.set(archivo.mensaje_id!, existentes);
    } else {
      sueltos.push(archivo);
    }
  }

  const mensajes: MensajeParaModelo[] = historialResult.rows.map((fila: any) => {
    const role = (fila.remitente === "medico" ? "user" : "assistant") as "user" | "assistant";
    const bloquesArchivo = bloquesPorMensaje.get(fila.id) ?? [];
    if (bloquesArchivo.length === 0) {
      return { role, content: fila.contenido };
    }
    return {
      role,
      content: [{ type: "text" as const, text: fila.contenido }, ...bloquesArchivo],
    };
  });

  const turnoCierre = construirTurnoDeCierre(sueltos, noLegibles);
  if (turnoCierre) mensajes.push(turnoCierre);

  return {
    mensajes,
    archivosEnviados,
    archivosNoLegibles: noLegibles.map((a) => ({ nombre: a.nombre_archivo, tipo: a.tipo })),
  };
}

// Turno de usuario al final del hilo con todo lo que no encontró lugar en
// un turno propio. Se rearma igual en cada llamada a partir de la base, así
// que un estudio adjuntado una vez le sigue llegando al modelo en todos los
// turnos siguientes — igual que los que sí están dentro de un turno, que
// viajan de nuevo en cada llamada porque el historial completo se reenvía.
function construirTurnoDeCierre(
  sueltos: FilaArchivo[],
  noLegibles: FilaArchivo[]
): MensajeParaModelo | null {
  if (sueltos.length === 0 && noLegibles.length === 0) return null;

  const partes: string[] = [];
  const bloques: BloqueContenido[] = [];

  if (sueltos.length > 0) {
    partes.push(
      "Estudios y documentos que el médico adjuntó a este caso. Van acá, y no dentro de " +
        "un turno de la conversación, porque se registraron fuera del chat (junto con " +
        "información clínica, o antes de que hubiera un mensaje al que asociarlos). " +
        "Son parte del caso igual que el resto:\n" +
        sueltos.map((a) => `- ${a.nombre_archivo}`).join("\n")
    );
    for (const archivo of sueltos) {
      const forma = formaDeEnvio(archivo.tipo, archivo.nombre_archivo)!;
      bloques.push(
        forma === "image"
          ? { type: "image", source: { type: "file", file_id: archivo.file_id_anthropic! } }
          : { type: "document", source: { type: "file", file_id: archivo.file_id_anthropic! } }
      );
    }
  }

  // Lo que NO se pudo mandar se nombra igual, con la instrucción explícita
  // de decirlo. Es la diferencia entre un agente que analiza sin el
  // estudio y avisa, y uno que analiza sin el estudio y no avisa —
  // exactamente el modo de falla que hubo en producción.
  if (noLegibles.length > 0) {
    partes.push(
      "Estos archivos están adjuntos al caso pero NO los podés leer (formato que no se " +
        "puede transmitir, o falló su preparación):\n" +
        noLegibles.map((a) => `- ${a.nombre_archivo}`).join("\n") +
        "\n\nNo tenés su contenido: no supongas nada sobre lo que dicen. Si para el " +
        "análisis hace falta lo que hay adentro, decilo de forma explícita en tu " +
        "respuesta y pedile al médico que lo vuelva a adjuntar como PDF o imagen."
    );
  }

  const texto = partes.join("\n\n");
  // Si no hay ningún bloque real, el turno es solo texto — se manda como
  // string, misma forma que cualquier otro turno sin adjuntos.
  if (bloques.length === 0) return { role: "user", content: texto };
  return { role: "user", content: [{ type: "text", text: texto }, ...bloques] };
}
