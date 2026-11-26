import { PoolClient } from "pg";
import { config } from "../config";

// ---------------------------------------------------------------------
// LA TRANSCRIPCIÓN — prompt 07d, fase 2.
//
// Por qué del lado del servidor y no con la Web Speech API de la fase 1:
// la fase 1 funciona en Chrome y Edge, y no en iPhone. El médico que
// dicta la consulta completa desde el teléfono en la sala es el caso de
// uso, no la excepción, así que el audio sube y se transcribe acá.
//
// POR QUÉ UNA INTERFAZ Y NO UNA LLAMADA DIRECTA: el proveedor se va a
// cambiar. La precisión en español de Costa Rica con vocabulario
// veterinario es la razón de elegir uno, y es exactamente el tipo de
// cosa que se mide en producción y se corrige. La interfaz hace que ese
// cambio sea una línea de configuración.
//
// EL VOCABULARIO no es decorativo: «carprofeno», «meloxicam» y
// «Schnauzer» no están en el modelo general de español, y sin
// reforzarlos el dictado devuelve «car profe no». Se arma con el
// catálogo real de la clínica, no con una lista fija nuestra.
// ---------------------------------------------------------------------

export interface AudioParaTranscribir {
  bytes: Buffer;
  /** MIME que declaró el navegador: webm/opus en Chrome, mp4 en Safari. */
  tipo: string;
  /**
   * Duración que midió el navegador, en segundos. Se usa solo si el
   * proveedor no devuelve la suya: el costo se cobra por minuto y el
   * dato del cliente no es confiable para cobrar.
   */
  segundosDeclarados?: number | null;
}

export interface ResultadoTranscripcion {
  texto: string;
  /** Segundos de audio que el proveedor dice haber procesado. */
  segundos: number;
  proveedor: string;
  /**
   * Qué tan seguro está el proveedor, 0..1, o null si no lo informa. No
   * se usa para decidir nada automáticamente: se muestra al médico
   * cuando es baja, para que relea el texto antes de aceptar.
   */
  confianza: number | null;
}

export interface Transcriptor {
  /** El nombre con el que se guarda el consumo y se busca la tarifa. */
  readonly nombre: string;
  /** Si está utilizable ahora mismo (p. ej. si tiene credenciales). */
  disponible(): { listo: boolean; motivo?: string };
  transcribir(audio: AudioParaTranscribir, vocabulario: string[]): Promise<ResultadoTranscripcion>;
}

export class TranscripcionNoDisponibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "TranscripcionNoDisponibleError";
  }
}

// ---------------------------------------------------------------------
// EL PROVEEDOR SIMULADO — el de desarrollo.
//
// No inventa un texto de consulta: devuelve el que le pasan. Eso puede
// sonar a que no hace nada, y es a propósito. Lo que hay que poder
// recorrer sin credenciales es TODO EL RESTO del camino —el
// ordenamiento por IA, el borrador, la revisión campo por campo, el
// descuento del crédito—, y para eso hace falta un texto de entrada
// realista, no uno fijo que siempre ordena igual.
//
// De dónde sale ese texto en el navegador: del dictado de la fase 1, que
// ya corre ahí y ya reconoce español. Así la verificación es de punta a
// punta y con voz real, sin mandar audio a ningún servidor de terceros.
//
// Lo que NO hace, y hay que tenerlo presente al leer las mediciones: no
// mide la precisión del proveedor real. La precisión de la fase 2 con
// Deepgram solo se puede medir con credenciales de Deepgram.
// ---------------------------------------------------------------------
export class TranscriptorSimulado implements Transcriptor {
  readonly nombre = "simulado";

  constructor(private readonly textoDelCliente: string | null) {}

  disponible() {
    return { listo: true };
  }

  async transcribir(audio: AudioParaTranscribir): Promise<ResultadoTranscripcion> {
    const texto = (this.textoDelCliente ?? "").trim();
    if (!texto) {
      throw new TranscripcionNoDisponibleError(
        "El proveedor simulado necesita el texto que reconoció el navegador. " +
          "Dicte con el micrófono del campo de dictado o configure un proveedor real."
      );
    }
    // Sin audio real no hay duración real. Si el navegador no la mandó,
    // se estima por longitud del texto a ~150 palabras por minuto, que
    // es el ritmo de un dictado normal: sirve para que el camino del
    // costo se ejercite con un número plausible, y la tarifa del
    // simulado es cero, así que no cobra nada de todos modos.
    const palabras = texto.split(/\s+/).filter(Boolean).length;
    const segundos = audio.segundosDeclarados ?? Math.max(1, Math.round((palabras / 150) * 60));
    return { texto, segundos, proveedor: this.nombre, confianza: null };
  }
}

// ---------------------------------------------------------------------
// EL PROVEEDOR REAL — Deepgram nova-2.
//
// Por qué éste, y no Whisper de OpenAI ni Google Speech-to-Text (la
// justificación completa está en el informe del 07d):
//
//   * refuerzo de vocabulario de verdad (`keywords`), que es lo que
//     resuelve «carprofeno» y los nombres de razas. Whisper solo acepta
//     una pista de contexto en el prompt, sin peso por término;
//   * cobra por minuto de audio, con precio de lista público — se puede
//     medir el costo por consulta sin estimar tokens;
//   * una sola llamada HTTP con el audio crudo, sin SDK nuevo.
//
// NO ESTÁ PROBADO CONTRA EL SERVICIO REAL: este entorno no tiene
// credenciales de Deepgram. Lo que está probado es que sin credencial el
// camino falla diciendo que falta, y que el proveedor simulado recorre
// todo lo demás. Está anotado así en el informe, no vendido como
// verificado.
// ---------------------------------------------------------------------
export class TranscriptorDeepgram implements Transcriptor {
  readonly nombre = "deepgram-nova-2";

  disponible() {
    if (!config.deepgramApiKey) {
      return { listo: false, motivo: "Falta DEEPGRAM_API_KEY en el entorno del backend." };
    }
    return { listo: true };
  }

  async transcribir(audio: AudioParaTranscribir, vocabulario: string[]): Promise<ResultadoTranscripcion> {
    const estado = this.disponible();
    if (!estado.listo) throw new TranscripcionNoDisponibleError(estado.motivo!);

    const parametros = new URLSearchParams({
      model: "nova-2",
      // es-419 es el español de América Latina. No hay un es-CR propio;
      // es-419 es lo más cercano y lo que el informe mide.
      language: "es-419",
      smart_format: "true",
      punctuate: "true",
    });
    // El refuerzo va con peso: el término pesado gana contra la palabra
    // común parecida («carprofeno» contra «car profe no»).
    for (const termino of vocabulario.slice(0, 500)) {
      parametros.append("keywords", `${termino}:2`);
    }

    const respuesta = await fetch(`https://api.deepgram.com/v1/listen?${parametros.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${config.deepgramApiKey}`,
        "Content-Type": audio.tipo || "audio/webm",
      },
      body: new Uint8Array(audio.bytes),
    });

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => "");
      throw new Error(`Deepgram respondió ${respuesta.status}: ${cuerpo.slice(0, 300)}`);
    }

    const datos = (await respuesta.json()) as {
      metadata?: { duration?: number };
      results?: {
        channels?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }>;
      };
    };
    const alternativa = datos.results?.channels?.[0]?.alternatives?.[0];
    const texto = (alternativa?.transcript ?? "").trim();
    if (!texto) {
      throw new TranscripcionNoDisponibleError(
        "No se entendió nada en el audio. Probá de nuevo más cerca del micrófono."
      );
    }
    return {
      texto,
      // La duración del PROVEEDOR, no la del navegador: es la que se
      // cobra, y la del cliente se puede falsear.
      segundos: datos.metadata?.duration ?? audio.segundosDeclarados ?? 0,
      proveedor: this.nombre,
      confianza: alternativa?.confidence ?? null,
    };
  }
}

/**
 * El transcriptor que corresponde a la configuración del entorno.
 *
 * `textoDelCliente` lo usa SOLO el simulado (ver su comentario). Con un
 * proveedor real se ignora: si no se ignorara, cualquiera podría mandar
 * un texto inventado y ahorrarse el audio.
 */
export function transcriptorDelEntorno(textoDelCliente: string | null): Transcriptor {
  if (config.transcripcionProveedor === "deepgram") return new TranscriptorDeepgram();
  return new TranscriptorSimulado(textoDelCliente);
}

// ---------------------------------------------------------------------
// EL VOCABULARIO DE LA CLÍNICA
//
// Sale del catálogo real: los medicamentos que esta clínica usa y las
// razas de los pacientes que atiende. Una lista fija nuestra envejecería
// y no serviría para la clínica equina ni para la que importa un
// antiparasitario que nosotros no conocemos.
//
// El tope de 500 términos es de Deepgram. Se ordena por lo que más
// aparece, así lo que se corta es la cola larga.
// ---------------------------------------------------------------------
export async function vocabularioDeLaClinica(db: PoolClient, tenantId: string): Promise<string[]> {
  const terminos = new Set<string>();

  const medicamentos = await db.query<{ nombre: string; principio_activo: string | null }>(
    `SELECT DISTINCT nombre, principio_activo FROM medicamentos
      WHERE (tenant_id = $1 OR tenant_id IS NULL) AND activo
      ORDER BY nombre
      LIMIT 300`,
    [tenantId]
  );
  for (const fila of medicamentos.rows) {
    agregarTerminos(terminos, fila.nombre);
    if (fila.principio_activo) agregarTerminos(terminos, fila.principio_activo);
  }

  const productos = await db.query<{ nombre: string; principio_activo: string | null }>(
    `SELECT nombre, principio_activo FROM inv_productos
      WHERE tenant_id = $1 AND activo ORDER BY nombre LIMIT 200`,
    [tenantId]
  );
  for (const fila of productos.rows) {
    agregarTerminos(terminos, fila.nombre);
    if (fila.principio_activo) agregarTerminos(terminos, fila.principio_activo);
  }

  const razas = await db.query<{ raza: string }>(
    `SELECT raza, COUNT(*) AS n FROM pacientes
      WHERE tenant_id = $1 AND raza IS NOT NULL AND raza <> ''
      GROUP BY raza ORDER BY n DESC LIMIT 100`,
    [tenantId]
  );
  for (const fila of razas.rows) agregarTerminos(terminos, fila.raza);

  return [...terminos].slice(0, 500);
}

/**
 * De «Amoxicilina 500 mg» salen «Amoxicilina» y nada más: el refuerzo es
 * de la palabra difícil, y «500» y «mg» son palabras que el modelo ya
 * reconoce. Reforzarlas gasta cupo del tope y no mejora nada.
 */
function agregarTerminos(destino: Set<string>, nombre: string): void {
  for (const palabra of nombre.split(/[\s,/()-]+/)) {
    const limpia = palabra.trim();
    if (limpia.length < 4) continue;
    if (/\d/.test(limpia)) continue;
    destino.add(limpia);
  }
}
