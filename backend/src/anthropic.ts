import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

// Instancia única y perezosa — mismo patrón que stripe.ts. Si
// ANTHROPIC_API_KEY todavía no está configurada, `anthropicClient` queda
// null en vez de tirar abajo el arranque del backend; el agente que la
// necesite (hoy: GCIS, ver workspace.routes.ts) llama a
// `requerirAnthropic()` y devuelve un error claro si falta.
let anthropicClient: Anthropic | null = null;
if (config.anthropicApiKey) {
  // El timeout va explícito porque el implícito del SDK son 10 minutos, y
  // acá eso no es solo una espera larga: las rutas del agente corren bajo
  // withTenantClient, o sea CON UNA TRANSACCIÓN ABIERTA, y esa transacción
  // no se cierra hasta que termina el request. Cada segundo que el modelo
  // tarda es un segundo de `idle in transaction` en la base (medido: ~10 s
  // para un mensaje trivial).
  //
  // 240 s deja holgura sobre la llamada legítima más larga que conocemos
  // —la síntesis clínica, ~110 s por fase, ver migración 080— y baja el
  // peor caso de 10 a 4 minutos por intento.
  //
  // OJO: `maxRetries` (2 por defecto) MULTIPLICA esto. Se deja como está
  // porque bajarlo cambia el comportamiento ante errores transitorios del
  // proveedor, que es una decisión de producto y no de este arreglo.
  anthropicClient = new Anthropic({
    apiKey: config.anthropicApiKey,
    timeout: 240_000,
  });
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
