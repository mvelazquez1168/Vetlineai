import Stripe from "stripe";
import { config } from "./config";

// Instancia única y perezosa: si STRIPE_SECRET_KEY todavía no está
// configurada (el usuario la completa después con sus credenciales
// reales de test), `stripeClient` queda null en vez de tirar abajo el
// arranque del backend — cada ruta que la necesita llama a
// `requerirStripe()` y devuelve un 503 claro si falta.
let stripeClient: Stripe | null = null;
if (config.stripeSecretKey) {
  stripeClient = new Stripe(config.stripeSecretKey, { apiVersion: "2024-06-20" });
}

export function requerirStripe(): Stripe {
  if (!stripeClient) {
    throw new StripeNoConfiguradoError();
  }
  return stripeClient;
}

export class StripeNoConfiguradoError extends Error {
  constructor() {
    super(
      "Stripe no está configurado todavía (falta STRIPE_SECRET_KEY). " +
        "Completá las variables de entorno con tus credenciales de test."
    );
    this.name = "StripeNoConfiguradoError";
  }
}
