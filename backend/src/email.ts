import { Resend } from "resend";
import { config } from "./config";
import { enviosRealesHabilitados, explicacionDeSimulacion } from "./entorno";

// Instancia única y perezosa — mismo patrón que anthropic.ts/stripe.ts. Si
// RESEND_API_KEY todavía no está configurada, `resendClient` queda null y
// quien llame a enviarEmail() recibe un error claro en vez de tirar abajo
// el arranque del backend.
let resendClient: Resend | null = null;
if (config.resendApiKey) {
  resendClient = new Resend(config.resendApiKey);
}

export function resendConfigurado(): boolean {
  // En un ambiente local SIN `ENVIOS_REALES=1` el proveedor simulado
  // está siempre "configurado": el camino de envío tiene que funcionar
  // de punta a punta —con su fila en `correos_enviados` y su estado— sin
  // que nada salga de la máquina. Devolver `false` acá dejaría las
  // notificaciones en 'simulada' y no se podría verificar el flujo.
  if (!enviosRealesHabilitados()) return true;
  return resendClient !== null;
}

/**
 * Qué proveedor va a usar el próximo envío. Es la función que el
 * verificador mira: si alguien rompe la puerta, acá se ve.
 */
export function proveedorDeCorreo(): "resend" | "simulado" | "no_configurado" {
  if (!enviosRealesHabilitados()) return "simulado";
  return resendClient ? "resend" : "no_configurado";
}

let simulados = 0;

/**
 * EL PROVEEDOR SIMULADO DE CORREO.
 *
 * No manda nada: registra en el log qué se habría mandado y devuelve un
 * identificador reconocible (`sim-mail-…`). Es lo que hace que un
 * `proveedor_message_id` en `correos_enviados` diga sin ambigüedad si el
 * correo salió de verdad.
 *
 * Nació de un incidente real: el job diario de notificaciones mandó dos
 * avisos a un cliente de demostración por Resend REAL desde el entorno
 * de desarrollo. El dominio era `.invalid` y no llegó a ninguna persona,
 * pero la salida existió.
 */
function enviarSimulado(
  destino: string,
  asunto: string,
  adjuntos: number
): { id: string } {
  simulados += 1;
  const id = `sim-mail-${simulados}`;
  console.log(
    `[correo:SIMULADO] ${id} -> ${destino} | "${asunto.slice(0, 60)}"` +
      (adjuntos > 0 ? ` | ${adjuntos} adjunto(s)` : "") +
      ` | ${explicacionDeSimulacion()}`
  );
  return { id };
}

// El dominio del remitente NO se toca — es el que está verificado en
// Resend y el que firma DKIM; cambiarlo rompería la autenticación del
// correo. Lo único que se reemplaza es el nombre visible, que no
// participa de ninguna firma. RESEND_FROM_EMAIL viene en cualquiera de
// las dos formas válidas ("Nombre <a@b.com>" o "a@b.com"): de ahí se
// extrae la dirección y se recompone con el nombre pedido.
function direccionDelRemitente(): string {
  const enAngulos = config.resendFromEmail.match(/<([^>]+)>/);
  return (enAngulos ? enAngulos[1] : config.resendFromEmail).trim();
}

// ---------------------------------------------------------------------
// Saneo de cabeceras — TODO lo que sale de acá hacia una cabecera pasa
// por una de estas tres funciones, y el saneo se aplica DENTRO de
// enviarEmail(), no en los llamadores. Esa es la parte importante: los
// valores que llegan a una cabecera los escribe un usuario (el nombre de
// la clínica lo tipea su admin, el nombre del paciente y el correo del
// tutor los carga la clínica) y están repartidos por 27 plantillas y una
// decena de módulos. Sanear en cada origen deja la puerta abierta al
// próximo llamador que se olvide; sanear en el cuello de botella no.
//
// Qué se está evitando concretamente: un CRLF en cualquiera de esos
// valores termina una cabecera y empieza otra. Con eso, un admin de
// clínica podía hacer que un correo salido de nuestro dominio
// autenticado declarara otro remitente, o agregar destinatarios ocultos
// a un aviso que sale a nombre de la clínica.
// ---------------------------------------------------------------------

// Una dirección de correo utilizable como cabecera: sin espacios, sin
// separadores de lista, sin ángulos y sin nada de control. Deliberadamente
// más estricta que la validación de formulario de admin.routes.ts:476 —
// acá no se trata de rechazar una dirección mal tipeada sino de que no
// entre nada que un parser de cabeceras pueda leer como dos cosas.
export function direccionValida(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = valor.trim();
  if (limpio.length > 254) return null;
  if (!/^[^\s<>@,;:"\\()[\]]+@[^\s<>@,;:"\\()[\]]+\.[^\s<>@,;:"\\()[\]]{2,}$/.test(limpio)) return null;
  return limpio;
}

// El nombre visible del remitente. Sin esta limpieza, un salto de línea
// inyecta cabeceras propias y una comilla doble corta el quoted-string y
// convierte el resto del nombre en direcciones adicionales.
//
// Los ángulos se sacan aunque un quoted-string los admita (son qtext
// válidos en RFC 5322): un parser tolerante que vea
// `"Clínica <otro@dominio>" <real@dominio>` puede quedarse con la
// dirección de adentro. Ningún nombre de clínica legítimo los usa, así
// que el costo de sacarlos es cero y cierra la ambigüedad.
function nombreParaCabecera(nombre: string): string {
  return nombre
    .replace(/[\r\n]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/["\\<>]/g, "")
    .trim()
    .slice(0, 78);
}

// El asunto. A diferencia del nombre del remitente, un asunto legítimo
// puede llevar comillas y ángulos, así que solo se saca lo que rompe la
// estructura de la cabecera: saltos de línea y caracteres de control. El
// tope de largo es contra un asunto absurdo, no contra un ataque: los
// nombres de paciente y de clínica que se interpolan acá no tienen
// límite de largo garantizado en la base.
export function asuntoParaCabecera(asunto: string): string {
  return asunto
    .replace(/[\r\n]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 200);
}

export function componerRemitente(nombreVisible?: string | null): string {
  if (!nombreVisible) return config.resendFromEmail;
  const nombre = nombreParaCabecera(nombreVisible);
  if (!nombre) return config.resendFromEmail;
  return `"${nombre}" <${direccionDelRemitente()}>`;
}

// Devuelve el id que Resend asigna al mensaje — verificación de correo
// (Capa 2, detectar el rebote) lo necesita para correlacionar el webhook
// de rebotes con el envío exacto, en vez de adivinar por destinatario.
/**
 * Un archivo adjunto. `contenido` es el archivo entero en memoria.
 *
 * Hay un tope de tamaño y vive acá (ver TOPE_ADJUNTOS_BYTES): Resend
 * acepta hasta 40 MB por mensaje, y un envío que lo pase falla con un
 * error del proveedor que no dice cuál de los adjuntos sobraba.
 */
export interface AdjuntoEmail {
  nombreArchivo: string;
  contenido: Buffer;
}

/** 20 MB, la mitad del tope de Resend. Un comprobante son ~15 KB de XML y ~40 KB de PDF. */
const TOPE_ADJUNTOS_BYTES = 20 * 1024 * 1024;

export async function enviarEmail(
  destinatario: string,
  asunto: string,
  contenido: string,
  html?: string,
  opciones?: {
    nombreRemitente?: string | null;
    replyTo?: string | null;
    adjuntos?: AdjuntoEmail[];
  }
): Promise<{ id: string | null }> {
  // LA PUERTA, antes de cualquier otra cosa: en un ambiente local sin
  // `ENVIOS_REALES=1`, no se toca Resend. Las validaciones de
  // destinatario y adjuntos se siguen aplicando igual —si están mal, el
  // envío simulado también falla, que es lo que hace útil la prueba—.
  const simular = !enviosRealesHabilitados();

  if (!simular && !resendClient) {
    throw new ResendNoConfiguradoError();
  }
  // El destinatario se RECHAZA en vez de limpiarse: una dirección que no
  // pasa esta validación o está mal cargada (y entregarla igual, mutilada,
  // no la arregla) o es un intento de inyección. En los dos casos lo
  // correcto es no mandar y que quede registrado — enviarCorreoTransaccional
  // atrapa esto y lo escribe en correos_enviados como 'fallido' con el
  // motivo, que es justo la evidencia que hace falta después.
  const destino = direccionValida(destinatario);
  if (!destino) {
    throw new DireccionInvalidaError(destinatario);
  }

  const adjuntos = opciones?.adjuntos ?? [];
  const bytesAdjuntos = adjuntos.reduce((a, x) => a + x.contenido.length, 0);
  if (bytesAdjuntos > TOPE_ADJUNTOS_BYTES) {
    // Se corta ACÁ y no en el proveedor: así el mensaje dice cuánto pesa
    // y cuál es el tope, en vez de un error genérico de Resend.
    throw new Error(
      `Los adjuntos pesan ${(bytesAdjuntos / 1024 / 1024).toFixed(1)} MB y el tope es ${TOPE_ADJUNTOS_BYTES / 1024 / 1024} MB.`
    );
  }
  for (const a of adjuntos) {
    // Un nombre de archivo con barras o saltos de línea es lo mismo que
    // una cabecera inyectada: va a un header del adjunto. Se rechaza en
    // vez de limpiarse, igual que el destinatario.
    if (/[\r\n/\\]/.test(a.nombreArchivo) || a.nombreArchivo.trim() === "") {
      throw new Error(`El nombre del adjunto no es utilizable: "${a.nombreArchivo.slice(0, 40)}".`);
    }
  }
  if (simular) {
    return enviarSimulado(destino, asunto, adjuntos.length);
  }

  const { data, error } = await resendClient!.emails.send({
    from: componerRemitente(opciones?.nombreRemitente),
    to: destino,
    subject: asuntoParaCabecera(asunto),
    text: contenido,
    // Defensa en profundidad: marcaCorreo.ts ya valida lo que pone acá,
    // pero enviarEmail() es una función exportada y el próximo llamador
    // puede no hacerlo. Un Reply-To inválido se descarta en silencio (a
    // diferencia del destinatario, no impide que el correo se entregue).
    ...(direccionValida(opciones?.replyTo) ? { replyTo: direccionValida(opciones?.replyTo)! } : {}),
    ...(html ? { html } : {}),
    ...(adjuntos.length > 0
      ? {
          attachments: adjuntos.map((a) => ({
            filename: a.nombreArchivo,
            content: a.contenido,
          })),
        }
      : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
  return { id: data?.id ?? null };
}

export class ResendNoConfiguradoError extends Error {
  constructor() {
    super("Resend no está configurado todavía (falta RESEND_API_KEY).");
    this.name = "ResendNoConfiguradoError";
  }
}

export class DireccionInvalidaError extends Error {
  constructor(valor: string) {
    // El valor entero NO va al mensaje de error: termina en
    // correos_enviados.error y en el log, y si traía un intento de
    // inyección lo estaríamos propagando a otro lado.
    super(`La dirección de destino no es utilizable (${valor.length} caracteres, empieza con "${valor.slice(0, 12).replace(/[\r\n]/g, "·")}").`);
    this.name = "DireccionInvalidaError";
  }
}
