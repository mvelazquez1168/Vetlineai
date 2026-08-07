import express, { Router } from "express";
import { Webhook } from "svix";
import { config } from "../config";
import { pool } from "../db";
import { registrarEventoFacturacion } from "../facturacion";
import { requerirStripe } from "../stripe";
import { obtenerPeriodoDeSuscripcionStripe } from "../usoIa";
import { procesarNotificacionCallback } from "../pagos/callbackCobros";
import { procesarRebote } from "../verificacionCorreo";

export const webhooksRouter = Router();

interface InvoiceWebhook {
  id: string;
  customer: string;
  amount_paid: number;
  amount_due: number;
  subscription?: string | null;
  lines?: { data?: { description?: string | null }[] };
}

async function idDelTenantPorCustomer(customerId: string): Promise<string | null> {
  const result = await pool.query(`SELECT id FROM tenants WHERE stripe_customer_id = $1`, [customerId]);
  return result.rows[0]?.id ?? null;
}

// IMPORTANTE: este router se monta en index.ts ANTES de `app.use(express.json())`,
// con su propio `express.raw()` — la verificación de firma de Stripe necesita
// el body crudo (bytes exactos), no el objeto ya parseado. Si este router se
// montara después del json() global, la firma nunca validaría.
webhooksRouter.post("/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  if (!config.stripeWebhookSecret) {
    console.error("POST /webhooks/stripe: falta STRIPE_WEBHOOK_SECRET, no se puede verificar la firma.");
    return res.status(503).json({ error: "Webhook de Stripe no configurado todavía." });
  }

  const firma = req.headers["stripe-signature"];
  if (!firma || typeof firma !== "string") {
    return res.status(400).json({ error: "Falta la firma del webhook." });
  }

  let evento;
  try {
    const stripe = requerirStripe();
    // No se procesa NINGÚN evento sin verificar la firma primero.
    evento = stripe.webhooks.constructEvent(req.body, firma, config.stripeWebhookSecret);
  } catch (err) {
    console.error("POST /webhooks/stripe: firma inválida", err);
    return res.status(400).json({ error: "Firma de webhook inválida." });
  }

  try {
    switch (evento.type) {
      case "invoice.payment_failed": {
        const invoice = evento.data.object as InvoiceWebhook;
        await pool.query(
          `UPDATE tenants SET estado_suscripcion = 'suspendida' WHERE stripe_customer_id = $1`,
          [invoice.customer]
        );

        const tenantId = await idDelTenantPorCustomer(invoice.customer);
        if (tenantId) {
          await registrarEventoFacturacion(
            pool,
            tenantId,
            "pago_fallido",
            invoice.amount_due / 100,
            invoice.id,
            invoice.lines?.data?.[0]?.description ?? null
          );
        }

        // TODO: notificar al admin de la clínica (email) cuando exista ese
        // mecanismo de notificaciones — por ahora solo se refleja el estado.
        console.log(`[webhook] invoice.payment_failed — tenant con customer ${invoice.customer} -> suspendida`);
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = evento.data.object as InvoiceWebhook;
        await pool.query(
          `UPDATE tenants SET estado_suscripcion = 'activa'
           WHERE stripe_customer_id = $1 AND estado_suscripcion = 'suspendida'`,
          [invoice.customer]
        );

        const tenantId = await idDelTenantPorCustomer(invoice.customer);
        if (tenantId) {
          await registrarEventoFacturacion(
            pool,
            tenantId,
            "pago_exitoso",
            invoice.amount_paid / 100,
            invoice.id,
            invoice.lines?.data?.[0]?.description ?? null
          );

          // El período real del ciclo vigente cambia con cada pago exitoso
          // (arranca uno nuevo) — se guarda en el propio tenant para que el
          // job diario de excedente pueda encontrar "a quién le toca hoy"
          // con una simple comparación de fecha, sin pegarle a Stripe por
          // cada tenant todos los días.
          if (invoice.subscription) {
            const periodo = await obtenerPeriodoDeSuscripcionStripe(invoice.subscription);
            if (periodo) {
              await pool.query(`UPDATE tenants SET stripe_periodo_actual_fin = $1 WHERE id = $2`, [
                periodo.cicloFin.toISOString(),
                tenantId,
              ]);
            }
          }
        }

        console.log(`[webhook] invoice.payment_succeeded — tenant con customer ${invoice.customer} -> activa`);
        break;
      }
      case "customer.subscription.updated": {
        // Cambios de plan, renovación del ciclo, etc. — cualquiera de estos
        // puede correr current_period_end sin pasar por un invoice todavía
        // (ej. al cambiar de plan a mitad de ciclo, Stripe prorratea y
        // actualiza la suscripción antes de facturar). Mismo mecanismo que
        // invoice.payment_succeeded para mantener stripe_periodo_actual_fin
        // al día.
        const suscripcion = evento.data.object as { id: string; customer: string };
        const periodo = await obtenerPeriodoDeSuscripcionStripe(suscripcion.id);
        if (periodo) {
          await pool.query(
            `UPDATE tenants SET stripe_periodo_actual_fin = $1 WHERE stripe_subscription_id = $2`,
            [periodo.cicloFin.toISOString(), suscripcion.id]
          );
        }
        break;
      }
      default:
        // Cualquier otro evento se reconoce (200) pero no dispara lógica —
        // solo manejamos los mínimos pedidos para esta fase.
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`POST /webhooks/stripe: error al procesar el evento ${evento.type}`, err);
    res.status(500).json({ error: "Error al procesar el webhook." });
  }
});

// ---------------------------------------------------------------------
// Motor de cobros, Paso 5 — callback de la pasarela. Público (sin sesión
// — la pasarela nunca tiene un JWT de este backend), pero valida
// autenticidad con un secreto compartido antes de procesar nada. La
// atribución NO necesita un endpoint por país: order_number ya es único
// en toda la tabla `cobros`, así que uno solo alcanza para cualquier
// afiliación.
//
// El proveedor SIMULADO no pasa por acá — entrega el resultado llamando
// a procesarNotificacionCallback() directo en el proceso (ver
// pagos/proveedorPagos.ts). Este endpoint es el punto de entrada real
// para cuando exista una pasarela de verdad — se deja construido y
// probado con curl, no con el simulador.
//
// REGISTRA SIEMPRE: procesarNotificacionCallback ya persiste la
// notificación entrante antes de cualquier otra cosa, exista o no el
// order_number — acá no hay lógica adicional que pueda saltarse eso.
// ---------------------------------------------------------------------
webhooksRouter.post("/pasarela", express.json(), async (req, res) => {
  if (config.pagosCallbackSecret) {
    const firma = req.headers["x-pasarela-signature"];
    if (firma !== config.pagosCallbackSecret) {
      return res.status(401).json({ error: "Firma inválida." });
    }
  } else {
    console.error(
      "POST /webhooks/pasarela: PAGOS_CALLBACK_SECRET no configurado — aceptando la notificación sin " +
        "validar autenticidad. Configurar antes de conectar una pasarela real."
    );
  }

  const { orderNumber, estado, motivoFalla, referenciaExterna, mensajeError } = req.body ?? {};
  if (!orderNumber || (estado !== "exitoso" && estado !== "fallido")) {
    return res.status(400).json({ error: "orderNumber y estado ('exitoso'|'fallido') son obligatorios." });
  }

  try {
    await procesarNotificacionCallback({
      orderNumber,
      exito: estado === "exitoso",
      motivoFalla,
      referenciaExterna,
      mensajeError,
    });
    res.json({ received: true });
  } catch (err) {
    // Igual se devuelve 200: procesarNotificacionCallback ya registró la
    // notificación (REGISTRA SIEMPRE) antes de que esto pudiera fallar —
    // un 5xx acá solo le pediría a la pasarela real que reintente algo
    // que ya quedó persistido, sin ganar nada.
    console.error(`POST /webhooks/pasarela: error al procesar "${orderNumber}"`, err);
    res.json({ received: true });
  }
});

// ---------------------------------------------------------------------
// Prompt de verificación de correo, Capa 2 — eventos de Resend (Svix).
// Body crudo (mismo motivo que Stripe: la firma se valida contra los
// bytes exactos). Se persiste el evento ANTES de procesarlo — idempotente
// por svix-id (clave primaria de webhooks_resend_eventos) — y se deja
// general a propósito (cualquier tipo de evento, no solo bounce) para
// que sirva a futuro para el resto de los correos transaccionales, no
// solo verificación (ver correos.ts).
// ---------------------------------------------------------------------
webhooksRouter.post("/resend", express.raw({ type: "application/json" }), async (req, res) => {
  const svixId = req.headers["svix-id"];
  const svixTimestamp = req.headers["svix-timestamp"];
  const svixSignature = req.headers["svix-signature"];

  let payload: any;
  if (config.resendWebhookSecret) {
    if (!svixId || !svixTimestamp || !svixSignature) {
      return res.status(400).json({ error: "Faltan las cabeceras de firma de Svix." });
    }
    try {
      const webhook = new Webhook(config.resendWebhookSecret);
      payload = webhook.verify(req.body, {
        "svix-id": svixId as string,
        "svix-timestamp": svixTimestamp as string,
        "svix-signature": svixSignature as string,
      });
    } catch (err) {
      console.error("POST /webhooks/resend: firma inválida", err);
      return res.status(400).json({ error: "Firma de webhook inválida." });
    }
  } else {
    console.error(
      "POST /webhooks/resend: RESEND_WEBHOOK_SECRET no configurado — aceptando el evento sin " +
        "validar autenticidad. Configurar antes de depender de esto en producción."
    );
    payload = JSON.parse(req.body.toString("utf-8"));
  }

  const eventoId = (svixId as string) ?? payload?.data?.email_id ?? `sin-id-${Date.now()}`;

  try {
    // REGISTRA SIEMPRE, antes de cualquier otra cosa — mismo criterio que
    // el callback de pasarela. ON CONFLICT: Resend puede reintentar el
    // mismo evento si no confirmamos rápido.
    const insert = await pool.query(
      `INSERT INTO webhooks_resend_eventos (id, tipo, payload) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [eventoId, payload?.type ?? "desconocido", JSON.stringify(payload)]
    );
    if (insert.rows.length === 0) {
      // Ya procesado (reintento de Resend) — idempotente, no repetir.
      return res.json({ received: true });
    }

    if (payload?.type === "email.bounced") {
      const messageId = payload?.data?.email_id;
      if (messageId) await procesarRebote(pool, messageId);
    }

    await pool.query(`UPDATE webhooks_resend_eventos SET procesado_en = now() WHERE id = $1`, [eventoId]);
    res.json({ received: true });
  } catch (err) {
    console.error(`POST /webhooks/resend: error al procesar el evento ${eventoId}`, err);
    // Igual 200: el evento ya quedó persistido (REGISTRA SIEMPRE) antes de
    // que esto pudiera fallar — un 5xx solo le pediría a Resend que
    // reintente algo que ya tenemos.
    res.json({ received: true });
  }
});
