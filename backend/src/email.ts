import { Resend } from "resend";
import { config } from "./config";

// Instancia única y perezosa — mismo patrón que anthropic.ts/stripe.ts. Si
// RESEND_API_KEY todavía no está configurada, `resendClient` queda null y
// quien llame a enviarEmail() recibe un error claro en vez de tirar abajo
// el arranque del backend.
let resendClient: Resend | null = null;
if (config.resendApiKey) {
  resendClient = new Resend(config.resendApiKey);
}

export function resendConfigurado(): boolean {
  return resendClient !== null;
}

// Devuelve el id que Resend asigna al mensaje — verificación de correo
// (Capa 2, detectar el rebote) lo necesita para correlacionar el webhook
// de rebotes con el envío exacto, en vez de adivinar por destinatario.
export async function enviarEmail(
  destinatario: string,
  asunto: string,
  contenido: string,
  html?: string
): Promise<{ id: string | null }> {
  if (!resendClient) {
    throw new ResendNoConfiguradoError();
  }
  const { data, error } = await resendClient.emails.send({
    from: config.resendFromEmail,
    to: destinatario,
    subject: asunto,
    text: contenido,
    ...(html ? { html } : {}),
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
