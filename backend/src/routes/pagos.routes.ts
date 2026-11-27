import { Router } from "express";
import { pool } from "../db";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso } from "../permisos";
import { obtenerTokenSdk, TilopayNoConfiguradoError } from "../pagos/tilopay";
import {
  listarPaquetesActivos,
  obtenerMetodoPagoVigente,
  reemplazarMetodoPago,
  obtenerConfigRecarga,
  actualizarConfigRecarga,
  ejecutarRecarga,
  listarRecargas,
} from "../pagos/recargas";
import { intentarRegularizarPagoTrasNuevaTarjeta } from "../pagos/cicloCobro";
import { cotizarUpgrade, ejecutarUpgrade } from "../upgrade";
import { ejecutarConversionPrueba } from "../pagos/conversionPrueba";

export const pagosRouter = Router();

pagosRouter.use(authenticate);

// Token corto para que el frontend inicialice el SDK de Tilopay
// (Tilopay.Init) — genérico, cualquier pantalla de cobro lo puede pedir.
// Nunca expone apiuser/apipassword al navegador. Las credenciales son por
// país (afiliación) — el llamador tiene que indicar cuál.
pagosRouter.get("/sdk-token", async (req, res) => {
  const paisCodigo = String(req.query.pais ?? "");
  if (!paisCodigo) return res.status(400).json({ error: "Falta el país (?pais=CR)." });
  try {
    const { accessToken, expiresIn } = await obtenerTokenSdk(paisCodigo);
    res.json({ accessToken, expiresIn });
  } catch (err) {
    if (err instanceof TilopayNoConfiguradoError) {
      return res.status(503).json({ error: err.message });
    }
    console.error("GET /pagos/sdk-token", err);
    res.status(502).json({ error: "No se pudo obtener el token del SDK de Tilopay." });
  }
});

// ---------------------------------------------------------------------
// Pantallas de pago (recarga/autorecarga/medio de pago/upgrade) —
// tenant-scoped, solo admin_clinica. No se aplica withTenantClient ni
// esta restricción de rol al router entero para no afectar /sdk-token,
// que es genérico y no depende de un tenant.
// ---------------------------------------------------------------------
// LA SUSCRIPCIÓN Y EL MEDIO DE PAGO los maneja quien configura la
// clínica: es plata de la clínica, no de un cliente. `clinica.configurar`
// lo tiene solo el administrador en la matriz del 04, así que el
// comportamiento es el mismo de antes; la diferencia es que ahora es una
// fila de la base y no un booleano en seis archivos.
const soloAdminClinica = [withTenantClient, exigirPermiso("clinica.configurar")];

pagosRouter.get("/paquetes-recarga", ...soloAdminClinica, async (req, res) => {
  res.json({ paquetes: await listarPaquetesActivos(req.db!) });
});

pagosRouter.get("/metodos", ...soloAdminClinica, async (req, res) => {
  res.json({ metodo: await obtenerMetodoPagoVigente(req.db!, req.auth!.tenantId!) });
});

pagosRouter.post("/metodos", ...soloAdminClinica, async (req, res) => {
  const { numero, nombreTitular, vencimientoMes, vencimientoAnio, cvv } = req.body ?? {};
  if (!numero || !nombreTitular || !vencimientoMes || !vencimientoAnio || !cvv) {
    return res.status(400).json({ error: "Faltan datos de la tarjeta." });
  }
  try {
    const resultado = await reemplazarMetodoPago(req.db!, req.auth!.tenantId!, {
      numero,
      nombreTitular,
      vencimientoMes: Number(vencimientoMes),
      vencimientoAnio: Number(vencimientoAnio),
      cvv,
    });
    if (!resultado.ok) {
      return res.status(400).json({ error: resultado.mensajeError });
    }

    // Vetline_Ai_Suspension_Bloqueo.md sección 4.2 — si la clínica estaba
    // suspendida o en ventana de cierre por impago, reemplazar la tarjeta
    // es la señal de que está tratando de regularizar: se intenta cobrar
    // de inmediato. No bloquea la respuesta de "tarjeta guardada" si el
    // intento falla — el resultado real llega por callback, igual que
    // cualquier otro cobro.
    //
    // intentarRegularizarPagoTrasNuevaTarjeta corre sobre el `pool` crudo
    // (no `req.db!`) porque internamente necesita abrir sus propias
    // sub-transacciones (ver intentarCobroSuscripcion). Pero `req.db!`
    // todavía no confirmó el metodo_pago recién creado — withTenantClient
    // solo hace COMMIT en un handler de res.on("finish"), que corre
    // DESPUÉS de esta línea — así que sin este COMMIT explícito, el
    // `pool` no vería todavía la tarjeta nueva y el intento de cobro no
    // encontraría medio de pago. Reabrir la transacción después es
    // inofensivo: no queda nada más por escribir en este handler, y el
    // COMMIT final de withTenantClient sobre una transacción vacía es un
    // no-op.
    await req.db!.query("COMMIT");
    await req.db!.query("BEGIN");

    intentarRegularizarPagoTrasNuevaTarjeta(pool, req.auth!.tenantId!).catch((err) =>
      console.error("POST /pagos/metodos — intentarRegularizarPagoTrasNuevaTarjeta", err)
    );

    res.json({ metodo: resultado.metodo });
  } catch (err) {
    console.error("POST /pagos/metodos", err);
    res.status(500).json({ error: "No se pudo registrar el medio de pago." });
  }
});

pagosRouter.get("/config-recarga", ...soloAdminClinica, async (req, res) => {
  res.json({ config: await obtenerConfigRecarga(req.db!, req.auth!.tenantId!) });
});

pagosRouter.put("/config-recarga", ...soloAdminClinica, async (req, res) => {
  const { autorecargaActiva, umbralUsd, paqueteId, topeMensualRecargasUsd } = req.body ?? {};
  if (typeof autorecargaActiva !== "boolean" || typeof umbralUsd !== "number" || umbralUsd < 0) {
    return res.status(400).json({ error: "Datos de configuración inválidos." });
  }
  const resultado = await actualizarConfigRecarga(req.db!, req.auth!.tenantId!, {
    autorecargaActiva,
    umbralUsd,
    paqueteId: paqueteId ?? null,
    topeMensualRecargasUsd: topeMensualRecargasUsd ?? null,
  });
  if (!resultado.ok) {
    return res.status(400).json({
      error: "El umbral no puede ser mayor ni igual al monto del paquete elegido — produciría una recarga automática inmediata en cadena.",
    });
  }
  res.json({ config: resultado.config });
});

pagosRouter.get("/recargas", ...soloAdminClinica, async (req, res) => {
  res.json({ recargas: await listarRecargas(req.db!, req.auth!.tenantId!) });
});

pagosRouter.post("/recargas", ...soloAdminClinica, async (req, res) => {
  const { paqueteId } = req.body ?? {};
  if (!paqueteId) return res.status(400).json({ error: "Falta el paquete a recargar." });
  try {
    const resultado = await ejecutarRecarga(req.db!, req.auth!.tenantId!, req.auth!.userId, paqueteId);
    if (!resultado.ok) {
      const mensajes = {
        sin_metodo_pago: "No hay un medio de pago registrado — agregá uno primero.",
        paquete_no_encontrado: "El paquete de recarga no existe o ya no está activo.",
        envio_fallido: resultado.mensajeError ?? "No se pudo enviar el cargo a la pasarela.",
      };
      return res.status(400).json({ error: mensajes[resultado.motivo] });
    }
    // El crédito se acredita con la confirmación del callback, no acá —
    // la recarga queda 'pendiente' hasta entonces.
    res.json({ recarga: resultado.recarga });
  } catch (err) {
    console.error("POST /pagos/recargas", err);
    res.status(500).json({ error: "No se pudo procesar la recarga." });
  }
});

pagosRouter.get("/upgrade/:planId/cotizacion", ...soloAdminClinica, async (req, res) => {
  const resultado = await cotizarUpgrade(req.db!, req.auth!.tenantId!, req.params.planId);
  if (!resultado.ok) {
    const mensajes = {
      suscripcion_no_encontrada: "No se encontró la suscripción de la clínica.",
      plan_no_encontrado: "El plan elegido no existe o no está activo.",
      no_es_superior: "Ese plan no es superior al plan actual.",
    };
    return res.status(400).json({ error: mensajes[resultado.motivo] });
  }
  res.json({ cotizacion: resultado.cotizacion });
});

pagosRouter.post("/upgrade", ...soloAdminClinica, async (req, res) => {
  const { planDestinoId } = req.body ?? {};
  if (!planDestinoId) return res.status(400).json({ error: "Falta el plan destino." });
  try {
    const resultado = await ejecutarUpgrade(req.db!, req.auth!.tenantId!, req.auth!.userId, planDestinoId);
    if (!resultado.ok) {
      const mensajes = {
        suscripcion_no_encontrada: "No se encontró la suscripción de la clínica.",
        plan_no_encontrado: "El plan elegido no existe o no está activo.",
        no_es_superior: "Ese plan no es superior al plan actual.",
        sin_metodo_pago: "No hay un medio de pago registrado — agregá uno primero.",
        envio_fallido: resultado.mensajeError ?? "No se pudo enviar el cargo a la pasarela.",
      };
      return res.status(400).json({ error: mensajes[resultado.motivo] });
    }
    // El cambio de plan se aplica con la confirmación del callback, no
    // acá — la cotización ya recalculada server-side es lo único que se
    // devuelve; el estado real se consulta después vía GET /estado-suscripcion.
    res.json({ cotizacion: resultado.cotizacion });
  } catch (err) {
    console.error("POST /pagos/upgrade", err);
    res.status(500).json({ error: "No se pudo procesar el upgrade." });
  }
});

pagosRouter.post("/conversion-prueba", ...soloAdminClinica, async (req, res) => {
  const { planDestinoId, agentesElegidos } = req.body ?? {};
  if (!planDestinoId || !Array.isArray(agentesElegidos)) {
    return res.status(400).json({ error: "Falta el plan destino o la lista de agentes elegidos." });
  }
  try {
    const resultado = await ejecutarConversionPrueba(req.db!, req.auth!.tenantId!, req.auth!.userId, {
      planDestinoId,
      agentesElegidos,
    });
    if (!resultado.ok) {
      const mensajes = {
        suscripcion_no_encontrada: "No se encontró la suscripción de la clínica.",
        plan_no_encontrado: "El plan elegido no existe o no está activo.",
        sin_metodo_pago: "No hay un medio de pago registrado — agregá uno primero.",
        no_esta_en_prueba: "Esta clínica ya no está en período de prueba.",
        envio_fallido: resultado.mensajeError ?? "No se pudo enviar el cargo a la pasarela.",
      };
      return res.status(400).json({ error: mensajes[resultado.motivo] });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /pagos/conversion-prueba", err);
    res.status(500).json({ error: "No se pudo procesar la conversión." });
  }
});
