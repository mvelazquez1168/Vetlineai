import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

// Instancia única y perezosa — mismo patrón que stripe.ts. Si
// ANTHROPIC_API_KEY todavía no está configurada, `anthropicClient` queda
// null en vez de tirar abajo el arranque del backend; el agente que la
// necesite (hoy: GCIS, ver workspace.routes.ts) llama a
// `requerirAnthropic()` y devuelve un error claro si falta.
let anthropicClient: Anthropic | null = null;
if (config.anthropicApiKey) {
  anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
}

export function requerirAnthropic(): Anthropic {
  if (!anthropicClient) {
    throw new AnthropicNoConfiguradoError();
  }
  return anthropicClient;
}

export class AnthropicNoConfiguradoError extends Error {
  constructor() {
    super("Anthropic no está configurado todavía (falta ANTHROPIC_API_KEY).");
    this.name = "AnthropicNoConfiguradoError";
  }
}
