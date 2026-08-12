import crypto from "crypto";
import { Router } from "express";
import multer from "multer";
import path from "path";
import { PoolClient } from "pg";
import { almacenamientoPrivado, almacenamientoPublico, claveLogoDesdeValorGuardado } from "../almacenamiento";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";
import { registrarEventoDetallado, registrarLecturaSensible } from "../middleware/auditoria";
import {
  validarCerrarCasoInput,
  ejecutarCierreCaso,
  validarReabrirCasoInput,
  ejecutarReaperturaCaso,
} from "../cierreCaso";
import { resolverFechaCorte } from "../casosSinActividad";
import { authenticate, withTenantClient } from "../middleware/auth";
import { requerirStripe } from "../stripe";
import { calcularCicloActual, calcularConsumoCiclo } from "../usoIa";
import {
  obtenerConteoCupos,
  habilitarAgente,
  deshabilitarAgente,
  eliminarAgente,
  mensajeRechazoCupo,
} from "../cupos";
import {
  solicitarDowngrade,
  cancelarCambioProgramado,
  solicitarCancelacionSuscripcion,
  obtenerCambioPendiente,
  mensajeRechazoCambio,
} from "../cambios";
import { generarPaqueteExportacion } from "../purga";
import { calcularEdadEfectiva } from "../edadPaciente";
import {
  crearInvitacion,
  listarInvitacionesPendientes,
  reenviarInvitacion,
  cancelarInvitacion,
  obtenerConteoCuposMedicos,
} from "../invitaciones";
import { listarAccesosMedico, actualizarAccesosMedico, contarCuposConsumidos } from "../medicoAgente";
import { cambiarCorreoAdmin, generarYEnviarVerificacion } from "../verificacionCorreo";
import { configurarInicioExpediente } from "../expediente";

export const adminRouter = Router();

adminRouter.use(authenticate, withTenantClient);

adminRouter.use((req, res, next) => {
  if (!req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para administradores de clínica." });
  }
  next();
});

// =====================================================================
// MÉDICOS
// =====================================================================

adminRouter.get("/medicos", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT
         p.id, p.nombre, p.email, p.colegiatura, p.estado,
         COALESCE(
           json_agg(
             json_build_object('agente', a.nombre, 'rol', ma.rol, 'habilitado', ma.habilitado)
             ORDER BY a.nombre
           ) FILTER (WHERE a.id IS NOT NULL),
           '[]'
         ) AS especialidades
       FROM personas p
       LEFT JOIN medico_agente ma ON ma.persona_id = p.id
       LEFT JOIN agentes a ON a.id = ma.agente_id
       WHERE p.es_admin_clinica = false
       GROUP BY p.id
       ORDER BY p.nombre`
    );
    res.json({ medicos: result.rows });
  } catch (err) {
    console.error("GET /admin/medicos", err);
    res.status(500).json({ error: "Error al listar médicos." });
  }
});

// ---------------------------------------------------------------------
// Pantallas faltantes, Prompt A — el alta directa con contraseña de
// desarrollo fija (DevPassword123!) se reemplaza por invitación con
// enlace de un solo uso. La persona ya no se crea acá: se crea recién
// cuando el médico invitado completa su alta (ver invitaciones.ts,
// aceptarInvitacion, y el router público montado en /api/invitaciones).
// ---------------------------------------------------------------------

adminRouter.get("/medicos/cupos", async (req, res) => {
  const conteo = await obtenerConteoCuposMedicos(req.db!, req.auth!.tenantId!);
  if (!conteo) return res.status(404).json({ error: "No se encontró la suscripción de esta clínica." });
  res.json({ cupos: conteo });
});

adminRouter.get("/medicos/invitaciones", async (req, res) => {
  const invitaciones = await listarInvitacionesPendientes(req.db!, req.auth!.tenantId!);
  res.json({ invitaciones });
});

adminRouter.post("/medicos/invitar", async (req, res) => {
  const { email, nombre } = req.body as { email?: string; nombre?: string };
  if (!email) return res.status(400).json({ error: "Falta el correo del médico." });

  try {
    const tenantResult = await req.db!.query(`SELECT nombre FROM tenants WHERE id = $1`, [req.auth!.tenantId]);
    const nombreClinica = tenantResult.rows[0]?.nombre ?? "tu clínica";

    const resultado = await crearInvitacion(req.db!, req.auth!.tenantId!, nombreClinica, req.auth!.userId, email, nombre);
    if (!resultado.ok) {
      return res.status(402).json({
        error: "No hay cupo de médicos disponible en tu plan — cambiá de plan para invitar más.",
        motivo: "sin_cupo_medicos",
      });
    }
    res.status(201).json({ invitacion: resultado.invitacion });
  } catch (err) {
    console.error("POST /admin/medicos/invitar", err);
    res.status(500).json({ error: "No se pudo enviar la invitación." });
  }
});

adminRouter.post("/medicos/invitaciones/:id/reenviar", async (req, res) => {
  const tenantResult = await req.db!.query(`SELECT nombre FROM tenants WHERE id = $1`, [req.auth!.tenantId]);
  const nombreClinica = tenantResult.rows[0]?.nombre ?? "tu clínica";
  const resultado = await reenviarInvitacion(req.db!, req.auth!.tenantId!, req.params.id, nombreClinica);
  if (!resultado.ok) return res.status(404).json({ error: "La invitación no existe o ya no está pendiente." });
  res.json({ invitacion: resultado.invitacion });
});

adminRouter.post("/medicos/invitaciones/:id/cancelar", async (req, res) => {
  const resultado = await cancelarInvitacion(req.db!, req.auth!.tenantId!, req.params.id);
  if (!resultado.ok) return res.status(404).json({ error: "La invitación no existe o ya no está pendiente." });
  res.json({ invitacion: resultado.invitacion });
});

adminRouter.patch("/medicos/:id/estado", async (req, res) => {
  const { estado } = req.body as { estado?: "activo" | "inactivo" };
  if (estado !== "activo" && estado !== "inactivo") {
    return res.status(400).json({ error: "Estado inválido." });
  }

  try {
    const result = await req.db!.query(
      `UPDATE personas SET estado = $1
       WHERE id = $2 AND es_admin_clinica = false
       RETURNING id, nombre, estado`,
      [estado, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Médico no encontrado." });
    }
    res.json({ medico: result.rows[0] });
  } catch (err) {
    console.error("PATCH /admin/medicos/:id/estado", err);
    res.status(500).json({ error: "Error al actualizar el médico." });
  }
});

// =====================================================================
// ACCESO MÉDICO-AGENTE
// Un agente puede estar habilitado para el tenant (tenant_agentes) pero
// deshabilitado puntualmente para un médico (medico_agente.habilitado).
// Estos endpoints gestionan esa segunda capa.
// =====================================================================

adminRouter.get("/medicos/:personaId/accesos", async (req, res) => {
  try {
    const personaResult = await req.db!.query(
      `SELECT id FROM personas WHERE id = $1 AND es_admin_clinica = false`,
      [req.params.personaId]
    );
    if (personaResult.rows.length === 0) {
      return res.status(404).json({ error: "Médico no encontrado." });
    }

    const accesos = await listarAccesosMedico(req.db!, req.params.personaId, req.auth!.tenantId!);
    res.json({ accesos });
  } catch (err) {
    console.error("GET /admin/medicos/:personaId/accesos", err);
    res.status(500).json({ error: "Error al obtener los accesos." });
  }
});

// Se llama cada vez que cambia la cantidad de accesos habilitado=true del
// tenant. Durante el trial (o cualquier tenant sin stripe_cupos_item_id
// todavía, porque su suscripción real recién se crea cuando el trial se
// convierte — ver jobs/suscripciones.job.ts) no hay nada que sincronizar
// con Stripe: medico_agente ya es la fuente de verdad del conteo. Cuando
// sí hay una suscripción activa, dejamos que Stripe calcule el
// prorrateo — nunca lo calculamos nosotros.
async function sincronizarCuposConStripe(db: PoolClient, tenantId: string): Promise<number> {
  const cuposConsumidos = await contarCuposConsumidos(db, tenantId);

  const tenantResult = await db.query(
    `SELECT estado_suscripcion, stripe_cupos_item_id FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantResult.rows[0];

  if (tenant?.estado_suscripcion !== "activa" || !tenant?.stripe_cupos_item_id) {
    return cuposConsumidos;
  }

  try {
    const stripe = requerirStripe();
    await stripe.subscriptionItems.update(tenant.stripe_cupos_item_id, {
      quantity: cuposConsumidos,
    });
  } catch (err) {
    // El acceso del médico ya se actualizó en medico_agente — eso es lo
    // que importa para el uso del producto. Si Stripe falla acá (o no
    // está configurado), no revertimos nada; queda para reconciliar.
    console.error(`No se pudo sincronizar cupos con Stripe para el tenant ${tenantId}`, err);
  }

  return cuposConsumidos;
}

adminRouter.put("/medicos/:personaId/accesos", async (req, res) => {
  const { accesos } = req.body as {
    accesos?: { agenteId: string; habilitado: boolean }[];
  };

  if (!Array.isArray(accesos)) {
    return res.status(400).json({ error: "Falta el array de accesos." });
  }

  try {
    const personaResult = await req.db!.query(
      `SELECT id FROM personas WHERE id = $1 AND es_admin_clinica = false`,
      [req.params.personaId]
    );
    if (personaResult.rows.length === 0) {
      return res.status(404).json({ error: "Médico no encontrado." });
    }

    await actualizarAccesosMedico(req.db!, req.params.personaId, accesos);

    const cuposConsumidos = await sincronizarCuposConStripe(req.db!, req.auth!.tenantId!);

    const accesosActualizados = await listarAccesosMedico(
      req.db!,
      req.params.personaId,
      req.auth!.tenantId!
    );
    res.json({ accesos: accesosActualizados, cuposConsumidos });
  } catch (err) {
    console.error("PUT /admin/medicos/:personaId/accesos", err);
    res.status(500).json({ error: "Error al actualizar los accesos." });
  }
});

// =====================================================================
// AGENTES IA
// =====================================================================

// "ultima_solicitud" (solicitudes_activacion) se quitó de acá —
// implementación de pantallas, prompt 2, paso 6: esa funcionalidad está
// dada de baja (ver POST /agentes/:agenteId/solicitar-activacion más
// abajo, que ya devuelve 410). casos_count/habilitado_en/deshabilitado_en/
// periodo_ultimo_cambio son nuevos, los necesita la pantalla "Mis
// agentes" (tarjetas + sección de desactivados + modal de desactivación).
adminRouter.get("/agentes", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT
         a.id, a.nombre, a.descripcion, a.icono, a.estado_catalogo,
         a.estado, a.motivo_mantenimiento, a.retorno_estimado,
         ta.estado AS estado_tenant, ta.habilitado_en, ta.deshabilitado_en, ta.periodo_ultimo_cambio,
         (SELECT COUNT(*) FROM medico_agente ma
            JOIN personas p ON p.id = ma.persona_id
            WHERE ma.agente_id = a.id AND p.tenant_id = $1) AS medicos_asignados,
         (SELECT COUNT(*) FROM casos c WHERE c.agente_id = a.id AND c.tenant_id = $1) AS casos_count
       FROM agentes a
       LEFT JOIN tenant_agentes ta ON ta.agente_id = a.id AND ta.tenant_id = $1
       ORDER BY a.nombre`,
      [req.auth!.tenantId]
    );
    res.json({ agentes: result.rows });
  } catch (err) {
    console.error("GET /admin/agentes", err);
    res.status(500).json({ error: "Error al listar agentes." });
  }
});

// Pantallas faltantes, Prompt B, Paso 1 — llamada liviana para la barra
// de estado de la ventana de purga, persistente en toda la app (se monta
// en AdminLayout, no en una pantalla puntual). Separada de
// GET /admin/plan-consumo a propósito: esa llamada es más pesada (trae
// cupos, saldo, aviso, cambio pendiente) y no todas las pantallas la
// disparan — la barra sí necesita este dato en cada navegación.
adminRouter.get("/estado-suscripcion", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT s.estado, t.purga_programada_para, t.ventana_purga_origen
       FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
       WHERE t.id = $1`,
      [req.auth!.tenantId]
    );
    const fila = result.rows[0];
    const purgaProgramadaPara = fila?.purga_programada_para ?? null;
    const diasRestantes = purgaProgramadaPara
      ? Math.max(Math.ceil((new Date(purgaProgramadaPara).getTime() - Date.now()) / (1000 * 60 * 60 * 24)), 0)
      : null;
    res.json({
      estado: fila?.estado ?? null,
      purgaProgramadaPara,
      diasRestantes,
      // Vetline_Ai_Suspension_Bloqueo.md — la barra global necesita
      // distinguir "prueba no convertida" de "cierre por impago" para
      // mostrar el texto correcto (null para las demás causas de ventana
      // de cierre, que ya usan la redacción existente por default).
      ventanaPurgaOrigen: fila?.ventana_purga_origen ?? null,
    });
  } catch (err) {
    console.error("GET /admin/estado-suscripcion", err);
    res.status(500).json({ error: "Error al obtener el estado de la suscripción." });
  }
});

// Flujo de suscripción A — contador de cupos (agentes y médicos,
// contratados/en uso/disponibles, exceso si lo hay). Alimenta la
// pantalla de plan y consumo del admin de clínica.
// Flujo de suscripción C — exportación de datos. Disponible siempre, no
// solo en ventana_purga/cancelada/finalizada (ver comentario de cabecera
// en purga.ts).
adminRouter.post("/exportaciones", async (req, res) => {
  try {
    const exportacionId = await generarPaqueteExportacion(req.db!, req.auth!.tenantId!, req.auth!.userId);
    res.status(201).json({ exportacionId });
  } catch (err) {
    console.error("POST /admin/exportaciones", err);
    res.status(500).json({ error: "Error al generar la exportación." });
  }
});

adminRouter.get("/exportaciones", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT id, estado, casos_incluidos, creada_en, lista_en, expira_en
       FROM exportaciones WHERE tenant_id = $1 ORDER BY creada_en DESC`,
      [req.auth!.tenantId]
    );
    res.json({ exportaciones: result.rows });
  } catch (err) {
    console.error("GET /admin/exportaciones", err);
    res.status(500).json({ error: "Error al listar las exportaciones." });
  }
});

adminRouter.get("/exportaciones/:id/descargar", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT archivo_ref, estado FROM exportaciones WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    const exportacion = result.rows[0];
    if (!exportacion || exportacion.estado !== "lista" || !exportacion.archivo_ref) {
      return res.status(404).json({ error: "La exportación no está lista o no existe." });
    }
    let datos: Buffer;
    try {
      datos = await almacenamientoPrivado.leer(exportacion.archivo_ref);
    } catch {
      return res.status(404).json({ error: "No se encontró el archivo de la exportación." });
    }
    await req.db!.query(`UPDATE exportaciones SET descargada_en = now() WHERE id = $1`, [req.params.id]);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="exportacion_${req.params.id}.zip"`);
    res.send(datos);
  } catch (err) {
    console.error("GET /admin/exportaciones/:id/descargar", err);
    res.status(500).json({ error: "Error al descargar la exportación." });
  }
});

adminRouter.get("/cupos", async (req, res) => {
  try {
    const conteo = await obtenerConteoCupos(req.db!, req.auth!.tenantId!);
    if (!conteo) {
      return res.status(404).json({ error: "No se encontró la suscripción de esta clínica." });
    }
    res.json({ cupos: conteo });
  } catch (err) {
    console.error("GET /admin/cupos", err);
    res.status(500).json({ error: "Error al calcular los cupos." });
  }
});

adminRouter.patch("/agentes/:agenteId/habilitar", async (req, res) => {
  try {
    const resultado = await habilitarAgente(req.db!, req.auth!.tenantId!, req.params.agenteId);
    if (!resultado.permitido) {
      return res.status(402).json({ error: mensajeRechazoCupo(resultado), motivo: resultado.motivo });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /admin/agentes/:agenteId/habilitar", err);
    res.status(500).json({ error: "Error al habilitar el agente." });
  }
});

adminRouter.patch("/agentes/:agenteId/deshabilitar", async (req, res) => {
  try {
    const resultado = await deshabilitarAgente(req.db!, req.auth!.tenantId!, req.params.agenteId);
    if (!resultado.permitido) {
      const status = resultado.motivo === "agente_no_encontrado" ? 404 : 409;
      return res.status(status).json({ error: mensajeRechazoCupo(resultado), motivo: resultado.motivo });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /admin/agentes/:agenteId/deshabilitar", err);
    res.status(500).json({ error: "Error al deshabilitar el agente." });
  }
});

adminRouter.delete("/agentes/:agenteId", async (req, res) => {
  try {
    const resultado = await eliminarAgente(req.db!, req.auth!.tenantId!, req.params.agenteId);
    if (!resultado.permitido) {
      const status = resultado.motivo === "agente_no_encontrado" ? 404 : 409;
      return res.status(status).json({ error: mensajeRechazoCupo(resultado), motivo: resultado.motivo });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/agentes/:agenteId", err);
    res.status(500).json({ error: "Error al eliminar el agente." });
  }
});

adminRouter.post("/agentes/:agenteId/solicitar-activacion", async (_req, res) => {
  // Funcionalidad dada de baja: el modelo de facturación 2026 (migraciones
  // 024/025) reemplazó la activación de agentes por solicitud individual
  // con la contratación vía cambio de plan (suscripciones.agentes_contratados).
  // solicitudes_activacion queda pendiente de eliminación (migración de baja).
  res.status(410).json({
    error: "Esta función ya no está disponible. Los agentes se agregan cambiando de plan.",
  });
});

// =====================================================================
// VERIFICACIÓN DE CORREO DEL ADMINISTRADOR
// Capas 2/3 del prompt — estado para el banner persistente + corrección
// del propio correo. req.auth!.userId es siempre el propio token, nunca
// un id recibido por parámetro: no hay forma de que este endpoint toque
// el correo de otra persona.
// =====================================================================

adminRouter.get("/mi-correo", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT email, correo_verificado_en, correo_rebotado_en FROM personas WHERE id = $1`,
      [req.auth!.userId]
    );
    const persona = result.rows[0];
    if (!persona) return res.status(404).json({ error: "No se encontró tu usuario." });
    res.json({
      email: persona.email,
      verificado: !!persona.correo_verificado_en,
      rebotado: !!persona.correo_rebotado_en,
    });
  } catch (err) {
    console.error("GET /admin/mi-correo", err);
    res.status(500).json({ error: "Error al consultar el estado del correo." });
  }
});

adminRouter.put("/mi-correo", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Ingresá un correo con formato válido." });
  }

  try {
    const tenantResult = await req.db!.query(`SELECT nombre FROM tenants WHERE id = $1`, [req.auth!.tenantId]);
    const nombreClinica = tenantResult.rows[0]?.nombre ?? "tu clínica";

    const resultado = await cambiarCorreoAdmin(req.db!, req.auth!.userId, req.auth!.tenantId!, nombreClinica, email);
    if (!resultado.ok) {
      return res.status(409).json({ error: "Ya existe una cuenta con ese correo." });
    }
    // El username de Keycloak cambió — la sesión actual sigue siendo
    // válida hasta que expire, pero cualquier login futuro tiene que ser
    // con el correo nuevo. Se lo decimos explícito al frontend para que
    // avise y cierre la sesión (ver Datos de la Clínica / banner).
    res.json({ ok: true, nuevoEmail: email });
  } catch (err) {
    console.error("PUT /admin/mi-correo", err);
    res.status(500).json({ error: "No se pudo cambiar el correo." });
  }
});

// prompt_code_reenvio_verificacion — hasta acá la ÚNICA forma de pedir un
// enlace nuevo era "Corregir mi correo" (PUT de arriba), que exige cambiar
// la dirección para habilitarse. Con una dirección correcta y un enlace
// que falla, eso dejaba al usuario sin salida — y de paso es la causa real
// del reporte de "el token no coincide": la única vía de recuperación
// disponible reescribía el token silenciosamente ("cualquier reenvío
// invalida el anterior", ver generarYEnviarVerificacion) apenas alguien
// intentaba usarla para reintentar, no para corregir un error real.
// Este endpoint SÍ reenvía sin tocar la dirección.
const LIMITE_REENVIOS_VERIFICACION = 3;
const VENTANA_REENVIOS_MINUTOS = 30;

adminRouter.post("/mi-correo/reenviar-verificacion", async (req, res) => {
  try {
    const personaResult = await req.db!.query(
      `SELECT email, correo_verificado_en FROM personas WHERE id = $1`,
      [req.auth!.userId]
    );
    const persona = personaResult.rows[0];
    if (!persona) return res.status(404).json({ error: "No se encontró tu usuario." });
    if (persona.correo_verificado_en) {
      return res.status(400).json({ error: "Tu correo ya está verificado." });
    }

    // Límite deslizante sobre correos_enviados — ya es el registro real de
    // cada envío (éste incluido), así que sirve de contador sin agregar
    // una tabla ni una columna nueva. "primero" es el más viejo dentro de
    // la ventana: sumarle la ventana da el momento exacto en que vuelve a
    // haber lugar, no un "esperá N minutos" que se recalcula distinto cada
    // vez que alguien reintenta.
    const limiteResult = await req.db!.query(
      `SELECT count(*)::int AS cantidad, min(enviado_en) AS primero
         FROM correos_enviados
        WHERE destinatario = $1 AND tipo = 'verificacion_correo'
          AND enviado_en > now() - ($2 || ' minutes')::interval`,
      [persona.email, VENTANA_REENVIOS_MINUTOS]
    );
    const { cantidad, primero } = limiteResult.rows[0];
    if (cantidad >= LIMITE_REENVIOS_VERIFICACION) {
      const disponibleEn = new Date(new Date(primero).getTime() + VENTANA_REENVIOS_MINUTOS * 60_000);
      return res.status(429).json({
        error: "Ya pediste el máximo de reenvíos por ahora.",
        disponibleEn: disponibleEn.toISOString(),
      });
    }

    const tenantResult = await req.db!.query(`SELECT nombre FROM tenants WHERE id = $1`, [req.auth!.tenantId]);
    const nombreClinica = tenantResult.rows[0]?.nombre ?? "tu clínica";

    await generarYEnviarVerificacion(req.db!, req.auth!.userId, req.auth!.tenantId!, persona.email, nombreClinica);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /admin/mi-correo/reenviar-verificacion", err);
    res.status(500).json({ error: "No se pudo reenviar la verificación." });
  }
});

// =====================================================================
// DATOS DE LA CLÍNICA
// =====================================================================

adminRouter.get("/clinica", async (req, res) => {
  try {
    const tenantResult = await req.db!.query(
      `SELECT id, nombre, pais_codigo, ciudad, idioma, zona_horaria, plan, telefono, email, direccion, logo_url,
              expediente_ultimo_numero + 1 AS expediente_proximo_numero
       FROM tenants WHERE id = $1`,
      [req.auth!.tenantId]
    );

    const agentesHabilitados = await req.db!.query(
      `SELECT COUNT(*) FROM tenant_agentes WHERE tenant_id = $1 AND estado = 'habilitado'`,
      [req.auth!.tenantId]
    );
    const agentesTotal = await req.db!.query(`SELECT COUNT(*) FROM agentes`);

    const medicosActivos = await req.db!.query(
      `SELECT COUNT(*) FROM personas
       WHERE tenant_id = $1 AND es_admin_clinica = false AND estado = 'activo'`,
      [req.auth!.tenantId]
    );
    const medicosTotal = await req.db!.query(
      `SELECT COUNT(*) FROM personas WHERE tenant_id = $1 AND es_admin_clinica = false`,
      [req.auth!.tenantId]
    );

    const tenant = tenantResult.rows[0];
    if (tenant?.logo_url) {
      tenant.logo_url = almacenamientoPublico.url(claveLogoDesdeValorGuardado(tenant.logo_url));
    }

    res.json({
      tenant,
      plan: {
        agentesHabilitados: Number(agentesHabilitados.rows[0].count),
        agentesTotal: Number(agentesTotal.rows[0].count),
        medicosActivos: Number(medicosActivos.rows[0].count),
        medicosTotal: Number(medicosTotal.rows[0].count),
      },
    });
  } catch (err) {
    console.error("GET /admin/clinica", err);
    res.status(500).json({ error: "Error al obtener los datos de la clínica." });
  }
});

// ---------------------------------------------------------------------
// GET/PATCH /api/admin/clinica/configuracion-notificaciones
//
// Interruptor + parámetro por cada una de las 3 notificaciones del
// módulo (prompt_code_notificaciones, PARTE C). El job diario
// (jobs/notificaciones.job.ts) ya lee esta misma tabla — un cambio acá
// se refleja solo en la próxima corrida, sin tocar el job.
// ---------------------------------------------------------------------
// prompt_code_notificaciones_pendientes.md, Parte D — 6 columnas nuevas
// (migración 055). Los 3 avisos disparados por hecho (confirmación,
// cancelación/reprogramación, informe disponible) no tienen parámetro de
// días: son inmediatos, no hay umbral que configurar.
const CONFIG_NOTIFICACIONES_DEFAULT = {
  recordatorioCitaActivo: true,
  horasAvisoRecordatorioCita: 26,
  desparasitacionActivo: true,
  diasAvisoDesparasitacion: 7,
  seguimientoFaltanteActivo: true,
  diasAvisoSeguimientoFaltante: 3,
  vacunacionActivo: true,
  diasAvisoVacunacion: 7,
  seguimientoPosteriorActivo: true,
  diasSeguimientoPosterior: 3,
  agendaDiaSiguienteActivo: true,
  confirmacionCitaActivo: true,
  cancelacionCitaActivo: true,
  informeDisponibleActivo: true,
  // prompt_code_paciente_nacimiento_estado.md, Parte B3 — 10º aviso, el
  // único puramente comercial: la clínica lo apaga sin pensarlo dos veces.
  cumpleanosActivo: true,
};

const HORAS_AVISO_MIN = 1;
const HORAS_AVISO_MAX = 168;
const DIAS_AVISO_MIN = 1;
const DIAS_AVISO_MAX = 90;
const DIAS_SEGUIMIENTO_MIN = 1;
const DIAS_SEGUIMIENTO_MAX = 30;

const COLUMNAS_CONFIG_NOTIFICACIONES = `
  recordatorio_cita_activo, horas_aviso_recordatorio_cita,
  desparasitacion_activo, dias_aviso_desparasitacion,
  seguimiento_faltante_activo, dias_aviso_seguimiento_faltante,
  vacunacion_activo, dias_aviso_vacunacion,
  seguimiento_posterior_activo, dias_seguimiento_posterior,
  agenda_dia_siguiente_activo, confirmacion_cita_activo,
  cancelacion_cita_activo, informe_disponible_activo, cumpleanos_activo`;

function filaAJson(fila: any) {
  return {
    recordatorioCitaActivo: fila.recordatorio_cita_activo,
    horasAvisoRecordatorioCita: fila.horas_aviso_recordatorio_cita,
    desparasitacionActivo: fila.desparasitacion_activo,
    diasAvisoDesparasitacion: fila.dias_aviso_desparasitacion,
    seguimientoFaltanteActivo: fila.seguimiento_faltante_activo,
    diasAvisoSeguimientoFaltante: fila.dias_aviso_seguimiento_faltante,
    vacunacionActivo: fila.vacunacion_activo,
    diasAvisoVacunacion: fila.dias_aviso_vacunacion,
    seguimientoPosteriorActivo: fila.seguimiento_posterior_activo,
    diasSeguimientoPosterior: fila.dias_seguimiento_posterior,
    agendaDiaSiguienteActivo: fila.agenda_dia_siguiente_activo,
    confirmacionCitaActivo: fila.confirmacion_cita_activo,
    cancelacionCitaActivo: fila.cancelacion_cita_activo,
    informeDisponibleActivo: fila.informe_disponible_activo,
    cumpleanosActivo: fila.cumpleanos_activo,
  };
}

adminRouter.get("/clinica/configuracion-notificaciones", async (req, res) => {
  try {
    const existente = await req.db!.query(
      `SELECT ${COLUMNAS_CONFIG_NOTIFICACIONES}
       FROM configuracion_notificaciones WHERE tenant_id = $1`,
      [req.auth!.tenantId]
    );
    if (existente.rows.length > 0) {
      return res.json(filaAJson(existente.rows[0]));
    }

    // Clínicas dadas de alta después de la migración 019 no tienen fila
    // todavía — upsert implícito con los defaults, para que a partir de
    // acá sí exista un registro real que editar.
    const d = CONFIG_NOTIFICACIONES_DEFAULT;
    const creado = await req.db!.query(
      `INSERT INTO configuracion_notificaciones
         (tenant_id, ${COLUMNAS_CONFIG_NOTIFICACIONES})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
       RETURNING ${COLUMNAS_CONFIG_NOTIFICACIONES}`,
      [
        req.auth!.tenantId,
        d.recordatorioCitaActivo,
        d.horasAvisoRecordatorioCita,
        d.desparasitacionActivo,
        d.diasAvisoDesparasitacion,
        d.seguimientoFaltanteActivo,
        d.diasAvisoSeguimientoFaltante,
        d.vacunacionActivo,
        d.diasAvisoVacunacion,
        d.seguimientoPosteriorActivo,
        d.diasSeguimientoPosterior,
        d.agendaDiaSiguienteActivo,
        d.confirmacionCitaActivo,
        d.cancelacionCitaActivo,
        d.informeDisponibleActivo,
        d.cumpleanosActivo,
      ]
    );
    res.json(filaAJson(creado.rows[0]));
  } catch (err) {
    console.error("GET /admin/clinica/configuracion-notificaciones", err);
    res.status(500).json({ error: "Error al obtener la configuración de notificaciones." });
  }
});

adminRouter.patch("/clinica/configuracion-notificaciones", async (req, res) => {
  const {
    recordatorioCitaActivo,
    horasAvisoRecordatorioCita,
    desparasitacionActivo,
    diasAvisoDesparasitacion,
    seguimientoFaltanteActivo,
    diasAvisoSeguimientoFaltante,
    vacunacionActivo,
    diasAvisoVacunacion,
    seguimientoPosteriorActivo,
    diasSeguimientoPosterior,
    agendaDiaSiguienteActivo,
    confirmacionCitaActivo,
    cancelacionCitaActivo,
    informeDisponibleActivo,
    cumpleanosActivo,
  } = req.body as {
    recordatorioCitaActivo?: boolean;
    horasAvisoRecordatorioCita?: number;
    desparasitacionActivo?: boolean;
    diasAvisoDesparasitacion?: number;
    seguimientoFaltanteActivo?: boolean;
    diasAvisoSeguimientoFaltante?: number;
    vacunacionActivo?: boolean;
    diasAvisoVacunacion?: number;
    seguimientoPosteriorActivo?: boolean;
    diasSeguimientoPosterior?: number;
    agendaDiaSiguienteActivo?: boolean;
    confirmacionCitaActivo?: boolean;
    cancelacionCitaActivo?: boolean;
    informeDisponibleActivo?: boolean;
    cumpleanosActivo?: boolean;
  };

  const enteroValido = (n: unknown, min: number, max: number) =>
    typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

  if (
    typeof recordatorioCitaActivo !== "boolean" ||
    !enteroValido(horasAvisoRecordatorioCita, HORAS_AVISO_MIN, HORAS_AVISO_MAX) ||
    typeof desparasitacionActivo !== "boolean" ||
    !enteroValido(diasAvisoDesparasitacion, DIAS_AVISO_MIN, DIAS_AVISO_MAX) ||
    typeof seguimientoFaltanteActivo !== "boolean" ||
    !enteroValido(diasAvisoSeguimientoFaltante, DIAS_SEGUIMIENTO_MIN, DIAS_SEGUIMIENTO_MAX) ||
    typeof vacunacionActivo !== "boolean" ||
    !enteroValido(diasAvisoVacunacion, DIAS_AVISO_MIN, DIAS_AVISO_MAX) ||
    typeof seguimientoPosteriorActivo !== "boolean" ||
    !enteroValido(diasSeguimientoPosterior, DIAS_SEGUIMIENTO_MIN, DIAS_SEGUIMIENTO_MAX) ||
    typeof agendaDiaSiguienteActivo !== "boolean" ||
    typeof confirmacionCitaActivo !== "boolean" ||
    typeof cancelacionCitaActivo !== "boolean" ||
    typeof informeDisponibleActivo !== "boolean" ||
    typeof cumpleanosActivo !== "boolean"
  ) {
    return res.status(400).json({
      error: `Datos inválidos. horasAvisoRecordatorioCita: ${HORAS_AVISO_MIN}-${HORAS_AVISO_MAX}. ` +
        `diasAvisoDesparasitacion / diasAvisoVacunacion: ${DIAS_AVISO_MIN}-${DIAS_AVISO_MAX}. ` +
        `diasAvisoSeguimientoFaltante / diasSeguimientoPosterior: ${DIAS_SEGUIMIENTO_MIN}-${DIAS_SEGUIMIENTO_MAX}.`,
    });
  }

  try {
    const result = await req.db!.query(
      `INSERT INTO configuracion_notificaciones
         (tenant_id, ${COLUMNAS_CONFIG_NOTIFICACIONES})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (tenant_id) DO UPDATE SET
         recordatorio_cita_activo = EXCLUDED.recordatorio_cita_activo,
         horas_aviso_recordatorio_cita = EXCLUDED.horas_aviso_recordatorio_cita,
         desparasitacion_activo = EXCLUDED.desparasitacion_activo,
         dias_aviso_desparasitacion = EXCLUDED.dias_aviso_desparasitacion,
         seguimiento_faltante_activo = EXCLUDED.seguimiento_faltante_activo,
         dias_aviso_seguimiento_faltante = EXCLUDED.dias_aviso_seguimiento_faltante,
         vacunacion_activo = EXCLUDED.vacunacion_activo,
         dias_aviso_vacunacion = EXCLUDED.dias_aviso_vacunacion,
         seguimiento_posterior_activo = EXCLUDED.seguimiento_posterior_activo,
         dias_seguimiento_posterior = EXCLUDED.dias_seguimiento_posterior,
         agenda_dia_siguiente_activo = EXCLUDED.agenda_dia_siguiente_activo,
         confirmacion_cita_activo = EXCLUDED.confirmacion_cita_activo,
         cancelacion_cita_activo = EXCLUDED.cancelacion_cita_activo,
         informe_disponible_activo = EXCLUDED.informe_disponible_activo,
         cumpleanos_activo = EXCLUDED.cumpleanos_activo
       RETURNING ${COLUMNAS_CONFIG_NOTIFICACIONES}`,
      [
        req.auth!.tenantId,
        recordatorioCitaActivo,
        horasAvisoRecordatorioCita,
        desparasitacionActivo,
        diasAvisoDesparasitacion,
        seguimientoFaltanteActivo,
        diasAvisoSeguimientoFaltante,
        vacunacionActivo,
        diasAvisoVacunacion,
        seguimientoPosteriorActivo,
        diasSeguimientoPosterior,
        agendaDiaSiguienteActivo,
        confirmacionCitaActivo,
        cancelacionCitaActivo,
        informeDisponibleActivo,
        cumpleanosActivo,
      ]
    );
    res.json(filaAJson(result.rows[0]));
  } catch (err) {
    console.error("PATCH /admin/clinica/configuracion-notificaciones", err);
    res.status(500).json({ error: "Error al guardar la configuración de notificaciones." });
  }
});

// Catálogo de planes de pago (excluye el de prueba — no tiene sentido
// "cambiarse" a un plan de prueba). Usado por el selector de "Cambiar de
// plan" en Uso y Facturación.
// Implementación de pantallas, prompt 2 — REEMPLAZADO 2026-08-04. Esta
// query leía cupos_agente_medico/presupuesto_usd_incluido/precio_cupo_extra_usd
// — las columnas heredadas del modelo viejo, que la migración 025 dejó en
// cero para los 4 planes reales (Básico/Pro/Max/Full) y que el filtro
// `es_plan_prueba = false` (en vez de `activo = true`) además dejaba
// colar los 3 planes viejos desactivados (Starter/Profesional/Enterprise)
// con precios reales pero obsoletos — el catálogo que devolvía este
// endpoint estaba roto para cualquier consumidor nuevo. Se corrige acá
// porque la pantalla "Cambiar plan" de este mismo prompt lo necesita
// correcto; el equivalente público (`GET /api/planes`, usado por
// /registro) tiene el mismo problema pero queda fuera de este prompt —
// arreglarlo implica tocar Registro.tsx, que es un desarrollo todavía no
// pedido (ver memoria del proyecto).
adminRouter.get("/planes", async (req, res) => {
  try {
    const planesResult = await req.db!.query(
      `SELECT id, nombre, codigo, orden, agentes_incluidos, medicos_incluidos,
              credito_ia_usd, precio_mensual_usd, precio_anual_usd
       FROM planes
       WHERE activo = true AND es_plan_prueba = false
       ORDER BY orden`
    );
    res.json({
      planes: planesResult.rows.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        codigo: p.codigo,
        orden: Number(p.orden),
        agentesIncluidos: p.agentes_incluidos != null ? Number(p.agentes_incluidos) : null,
        medicosIncluidos: Number(p.medicos_incluidos),
        creditoIaUsd: Number(p.credito_ia_usd),
        precioMensualUsd: Number(p.precio_mensual_usd),
        precioAnualUsd: p.precio_anual_usd != null ? Number(p.precio_anual_usd) : null,
      })),
    });
  } catch (err) {
    console.error("GET /admin/planes", err);
    res.status(500).json({ error: "Error al listar planes." });
  }
});

// ---------------------------------------------------------------------
// Implementación de pantallas, prompt 2 — Plan y consumo.
//
// PASO 1 — Contrato de datos: una sola llamada, pocos y gruesos. Reusa
// obtenerConteoCupos (flujo A) y obtenerCambioPendiente (flujo B) en vez
// de duplicar esas consultas.
// ---------------------------------------------------------------------
adminRouter.get("/plan-consumo", async (req, res) => {
  try {
    const tenantId = req.auth!.tenantId!;

    const suscripcionResult = await req.db!.query(
      `SELECT p.id AS plan_id, p.codigo AS plan_codigo, p.orden AS plan_orden, p.nombre AS plan_nombre,
              s.precio_pactado_usd, s.periodicidad, s.periodo_fin, s.credito_pactado_usd
       FROM tenants t
       JOIN suscripciones s ON s.id = t.suscripcion_id
       JOIN planes p ON p.id = s.plan_id
       WHERE t.id = $1`,
      [tenantId]
    );
    const suscripcion = suscripcionResult.rows[0];
    if (!suscripcion) {
      return res.status(404).json({ error: "No se encontró la suscripción de esta clínica." });
    }

    const saldoResult = await req.db!.query(
      `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1`,
      [tenantId]
    );
    const creditoPlan = Number(saldoResult.rows[0]?.credito_plan_usd ?? 0);
    const creditoComprado = Number(saldoResult.rows[0]?.credito_comprado_usd ?? 0);

    const cupos = await obtenerConteoCupos(req.db!, tenantId);

    // Mismo criterio de gravedad que workspace/consumo (bloque 4/flujo A
    // del médico) — un solo aviso, el más severo, no una lista.
    const avisoResult = await req.db!.query(
      `SELECT umbral, mensaje
       FROM notificaciones_uso
       WHERE tenant_id = $1
         AND umbral IN ('colchon_agotado', 'saldo_agotado', 'saldo_bajo', 'trial_agotado', 'trial_80')
         AND leida = false
       ORDER BY CASE umbral
                  WHEN 'colchon_agotado' THEN 1
                  WHEN 'saldo_agotado' THEN 2
                  WHEN 'trial_agotado' THEN 3
                  WHEN 'trial_80' THEN 4
                  WHEN 'saldo_bajo' THEN 5
                END
       LIMIT 1`,
      [tenantId]
    );

    const cambioPendiente = await obtenerCambioPendiente(req.db!, tenantId);

    const consumoResult = await req.db!.query(
      `SELECT tipo_consumo, COUNT(*) AS cantidad, COALESCE(SUM(costo_usd_calculado), 0) AS monto_usd
       FROM uso_api
       WHERE tenant_id = $1 AND "timestamp" >= (SELECT periodo_inicio FROM suscripciones WHERE tenant_id = $1)
       GROUP BY tipo_consumo
       ORDER BY monto_usd DESC`,
      [tenantId]
    );

    res.json({
      plan: {
        id: suscripcion.plan_id,
        codigo: suscripcion.plan_codigo,
        orden: Number(suscripcion.plan_orden),
        nombre: suscripcion.plan_nombre,
        precioUsd: Number(suscripcion.precio_pactado_usd),
        periodicidad: suscripcion.periodicidad,
        renovacion: suscripcion.periodo_fin,
      },
      cupos,
      credito: { pactadoUsd: Number(suscripcion.credito_pactado_usd) },
      saldo: {
        planUsd: creditoPlan,
        compradoUsd: creditoComprado,
        totalUsd: creditoPlan + creditoComprado,
      },
      aviso: avisoResult.rows[0] ?? null,
      cambioPendiente,
      consumoPeriodo: consumoResult.rows.map((r) => ({
        tipo: r.tipo_consumo,
        cantidad: Number(r.cantidad),
        montoUsd: Number(r.monto_usd),
      })),
    });
  } catch (err) {
    console.error("GET /admin/plan-consumo", err);
    res.status(500).json({ error: "Error al obtener el plan y consumo." });
  }
});

// PASO 5 — Facturación en modo lectura. Historial real de cobros
// (Tilopay, tabla `cobros`) con el comprobante asociado si existe
// (`documentos_fiscales`, vía cobro_id) — reemplaza el historial viejo de
// GET /uso-facturacion, que leía facturas de Stripe y siempre viene
// vacío para clínicas dadas de alta con Tilopay.
const CONCEPTO_COBRO_LABEL: Record<string, string> = {
  suscripcion: "Suscripción",
  recarga: "Recarga de saldo",
  prorrateo_upgrade: "Upgrade de plan (prorrateo)",
  ajuste: "Ajuste",
};

adminRouter.get("/cobros", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT c.id, c.creado_en, c.tipo, c.monto, c.moneda, c.estado,
              df.numero_interno AS comprobante_numero, df.estado_externo AS comprobante_estado
       FROM cobros c
       LEFT JOIN documentos_fiscales df ON df.cobro_id = c.id
       WHERE c.tenant_id = $1
       ORDER BY c.creado_en DESC
       LIMIT 100`,
      [req.auth!.tenantId]
    );
    res.json({
      cobros: result.rows.map((c) => ({
        id: c.id,
        fecha: c.creado_en,
        concepto: CONCEPTO_COBRO_LABEL[c.tipo] ?? c.tipo,
        montoUsd: Number(c.monto),
        moneda: c.moneda,
        estado: c.estado,
        comprobante: c.comprobante_numero
          ? { numero: c.comprobante_numero, estado: c.comprobante_estado }
          : null,
      })),
    });
  } catch (err) {
    console.error("GET /admin/cobros", err);
    res.status(500).json({ error: "Error al listar los cobros." });
  }
});

// Bloque de datos de facturación (Paso 5): nombre fiscal, tipo/número de
// identificación y país — existen en `tenants` desde la migración 024
// pero ningún endpoint del admin de clínica los exponía hasta ahora.
adminRouter.get("/clinica/datos-fiscales", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT pais_codigo, tipo_persona, tipo_identificacion_id, numero_identificacion, nombre_fiscal
       FROM tenants WHERE id = $1`,
      [req.auth!.tenantId]
    );
    res.json({ datosFiscales: result.rows[0] ?? null });
  } catch (err) {
    console.error("GET /admin/clinica/datos-fiscales", err);
    res.status(500).json({ error: "Error al obtener los datos de facturación." });
  }
});

// País y tipo de persona quedan fijos desde el registro (Prompt B) — ya
// no se aceptan acá, solo los datos de identificación fiscal en sí.
adminRouter.patch("/clinica/datos-fiscales", async (req, res) => {
  const { tipoIdentificacionId, numeroIdentificacion, nombreFiscal } = req.body as {
    tipoIdentificacionId?: string;
    numeroIdentificacion?: string;
    nombreFiscal?: string;
  };
  try {
    const result = await req.db!.query(
      `UPDATE tenants
       SET tipo_identificacion_id = COALESCE($1, tipo_identificacion_id),
           numero_identificacion = COALESCE($2, numero_identificacion),
           nombre_fiscal = COALESCE($3, nombre_fiscal)
       WHERE id = $4
       RETURNING pais_codigo, tipo_persona, tipo_identificacion_id, numero_identificacion, nombre_fiscal`,
      [tipoIdentificacionId ?? null, numeroIdentificacion ?? null, nombreFiscal ?? null, req.auth!.tenantId]
    );
    res.json({ datosFiscales: result.rows[0] });
  } catch (err) {
    console.error("PATCH /admin/clinica/datos-fiscales", err);
    res.status(500).json({ error: "Error al actualizar los datos de facturación." });
  }
});

adminRouter.get("/tipos-identificacion", async (req, res) => {
  const paisCodigo = String(req.query.paisCodigo ?? "");
  const tipoPersona = req.query.tipoPersona as "fisica" | "juridica" | undefined;
  if (!paisCodigo) {
    return res.status(400).json({ error: "Falta paisCodigo." });
  }
  try {
    const condicionPersona =
      tipoPersona === "fisica" ? "AND aplica_persona_fisica = true" : tipoPersona === "juridica" ? "AND aplica_persona_juridica = true" : "";
    const result = await req.db!.query(
      `SELECT id, codigo, etiqueta FROM tipos_identificacion
       WHERE pais_codigo = $1 AND activo = true ${condicionPersona}
       ORDER BY orden`,
      [paisCodigo]
    );
    res.json({ tipos: result.rows });
  } catch (err) {
    console.error("GET /admin/tipos-identificacion", err);
    res.status(500).json({ error: "Error al listar los tipos de identificación." });
  }
});

// Prompt B (registro y alta con prueba) — el país queda fijo desde el
// registro; cambiarlo es una operación de Platform Admin (afecta moneda,
// impuesto y proveedor de facturación), no algo que el admin de la propia
// clínica pueda tocar. Por eso pais_codigo salió de los campos editables
// acá — ya no se acepta en el body.
adminRouter.patch("/clinica", async (req, res) => {
  const { nombre, ciudad, idioma, telefono, email, direccion, zona_horaria } =
    req.body as {
      nombre?: string;
      ciudad?: string;
      idioma?: string;
      telefono?: string;
      email?: string;
      direccion?: string;
      zona_horaria?: string;
    };

  try {
    const result = await req.db!.query(
      `UPDATE tenants SET
         nombre = COALESCE($1, nombre),
         ciudad = COALESCE($2, ciudad),
         idioma = COALESCE($3, idioma),
         telefono = COALESCE($4, telefono),
         email = COALESCE($5, email),
         direccion = COALESCE($6, direccion),
         zona_horaria = COALESCE($7, zona_horaria)
       WHERE id = $8
       RETURNING id, nombre, pais_codigo, ciudad, idioma, zona_horaria, plan, telefono, email, direccion`,
      [nombre, ciudad, idioma, telefono, email, direccion, zona_horaria, req.auth!.tenantId]
    );
    res.json({ tenant: result.rows[0] });
  } catch (err) {
    console.error("PATCH /admin/clinica", err);
    res.status(500).json({ error: "Error al guardar los cambios." });
  }
});

// ---------------------------------------------------------------------
// PATCH /api/admin/clinica/numeracion-expedientes
// prompt_code_expediente_y_propietario, Parte A3 — configurar el inicio
// de la numeración solo puede avanzar, nunca retroceder (ver
// expediente.ts::configurarInicioExpediente). El evento queda en la
// bitácora de auditoría, no en una columna de estado.
// ---------------------------------------------------------------------
adminRouter.patch("/clinica/numeracion-expedientes", async (req, res) => {
  const { numeroInicio } = req.body as { numeroInicio?: number };

  if (!Number.isInteger(numeroInicio) || numeroInicio! < 1) {
    return res.status(400).json({ error: "El número de inicio debe ser un entero mayor o igual a 1." });
  }

  try {
    const resultado = await configurarInicioExpediente(
      req.db!,
      req.auth!,
      req.auth!.tenantId!,
      numeroInicio!
    );
    if (!resultado.ok) {
      return res.status(409).json({
        error: `El número de inicio tiene que ser mayor al próximo expediente que ya corresponde (${resultado.proximoNumeroActual}) — no se puede retroceder sobre expedientes ya emitidos.`,
        motivo: "retrocede",
        proximoNumeroActual: resultado.proximoNumeroActual,
      });
    }
    res.json({ expedienteProximoNumero: resultado.proximoNumero });
  } catch (err) {
    console.error("PATCH /admin/clinica/numeracion-expedientes", err);
    res.status(500).json({ error: "No se pudo configurar la numeración de expedientes." });
  }
});

// El logo va al ámbito PÚBLICO del almacenamiento de objetos — a
// propósito alcanzable por URL directa, sin pasar por un endpoint
// autenticado (se embebe en correos leídos sin sesión). Un logo no es un
// documento clínico, así que no comparte el control de acceso del resto
// de los archivos (ver almacenamiento/tipos.ts sobre por qué son dos
// ámbitos separados).
const TIPOS_LOGO_VALIDOS = ["image/png", "image/jpeg"];

const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!TIPOS_LOGO_VALIDOS.includes(file.mimetype)) {
      return cb(new Error("TIPO_INVALIDO"));
    }
    cb(null, true);
  },
});

adminRouter.post("/clinica/logo", (req, res) => {
  uploadLogo.single("logo")(req, res, async (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "El archivo supera el máximo de 2MB." });
      }
      if (err.message === "TIPO_INVALIDO") {
        return res.status(400).json({ error: "Solo se aceptan archivos PNG o JPG." });
      }
      console.error("POST /admin/clinica/logo", err);
      return res.status(500).json({ error: "Error al subir el logo." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Falta el archivo del logo." });
    }

    try {
      const clave = `logos/${crypto.randomUUID()}${path.extname(req.file.originalname)}`;
      await almacenamientoPublico.guardar(clave, req.file.buffer, req.file.mimetype);
      const logoUrl = almacenamientoPublico.url(clave);
      await req.db!.query(`UPDATE tenants SET logo_url = $1 WHERE id = $2`, [
        clave,
        req.auth!.tenantId,
      ]);
      res.json({ logoUrl });
    } catch (dbErr) {
      console.error("POST /admin/clinica/logo (db)", dbErr);
      res.status(500).json({ error: "Error al guardar el logo." });
    }
  });
});

// =====================================================================
// USO Y FACTURACIÓN
// Cupos, consumo de IA del ciclo y estado de suscripción son reales
// (medico_agente, uso_api, tenants). El historial de facturas viene en
// vivo de Stripe (stripe.invoices.list) — no se duplica esa data acá.
// =====================================================================

adminRouter.get("/uso-facturacion", async (req, res) => {
  try {
    const tenantResult = await req.db!.query(
      `SELECT t.estado_suscripcion, t.cancelacion_solicitada, t.cancelacion_efectiva_en,
              t.trial_termina_en, t.creado_en, t.stripe_customer_id, t.stripe_subscription_id,
              t.limite_usd_configurado, t.limite_accion,
              p.id AS plan_id, p.nombre AS plan_nombre, p.cupos_agente_medico,
              p.presupuesto_usd_incluido, p.precio_mensual_usd, p.precio_cupo_extra_usd,
              p.es_plan_prueba
       FROM tenants t
       LEFT JOIN planes p ON p.id = t.plan_id
       WHERE t.id = $1`,
      [req.auth!.tenantId]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant.plan_id) {
      return res.status(500).json({
        error: "Esta clínica no tiene un plan asignado — contactá a soporte.",
      });
    }

    const cuposUsados = await contarCuposConsumidos(req.db!, req.auth!.tenantId!);

    // Límites del ciclo actual: para 'trial' es el período de prueba
    // completo; para 'activa' con suscripción real, se toma en vivo de
    // Stripe (current_period_start/end); para el resto (tenants creados
    // manualmente por staff, sin suscripción real de Stripe todavía) cae
    // a un ciclo calendario simple como fallback razonable. Misma lógica
    // que usa la detección de umbrales/bloqueo (ver usoIa.ts).
    const { cicloInicio, cicloFin } = await calcularCicloActual(tenant);
    const montoUsado = await calcularConsumoCiclo(req.db!, req.auth!.tenantId!, {
      cicloInicio,
      cicloFin,
    });

    // Facturas en vivo desde Stripe — si el tenant no tiene customer de
    // Stripe todavía (creado manualmente por staff, no por autoservicio)
    // o Stripe no está configurado, simplemente no hay historial que
    // mostrar, sin que eso rompa el resto de la pantalla.
    let facturas: { fecha: string; concepto: string; monto: number; estado: string }[] = [];
    if (tenant.stripe_customer_id) {
      try {
        const stripe = requerirStripe();
        const invoices = await stripe.invoices.list({
          customer: tenant.stripe_customer_id,
          limit: 12,
        });
        facturas = invoices.data.map((inv) => ({
          fecha: new Date(inv.created * 1000).toISOString(),
          concepto: inv.lines.data[0]?.description ?? `Factura ${inv.number ?? ""}`.trim(),
          monto: inv.total / 100,
          estado: inv.status === "paid" ? "pagada" : "pendiente",
        }));
      } catch (err) {
        console.error("No se pudo obtener el historial de facturas de Stripe", err);
      }
    }

    // Lectura sensible: uso y facturación de la clínica.
    registrarLecturaSensible(
      req.auth!,
      "GET /api/admin/uso-facturacion",
      "uso_facturacion",
      req.auth!.tenantId
    );

    res.json({
      suscripcion: {
        estado: tenant.estado_suscripcion,
        cancelacionSolicitada: tenant.cancelacion_solicitada,
        cancelacionEfectivaEn: tenant.cancelacion_efectiva_en,
        trialTerminaEn: tenant.trial_termina_en,
        plan: {
          id: tenant.plan_id,
          nombre: tenant.plan_nombre,
          cuposAgenteMedico: tenant.cupos_agente_medico,
          presupuestoUsdIncluido: Number(tenant.presupuesto_usd_incluido),
          precioMensualUsd: Number(tenant.precio_mensual_usd),
          precioCupoExtraUsd: Number(tenant.precio_cupo_extra_usd),
          esPlanPrueba: tenant.es_plan_prueba,
        },
      },
      cupos: {
        usados: cuposUsados,
        incluidos: tenant.cupos_agente_medico,
      },
      consumoIA: {
        montoUsado,
        montoIncluido: Number(tenant.presupuesto_usd_incluido),
        cicloInicio: cicloInicio.toISOString(),
        cicloFin: cicloFin.toISOString(),
      },
      facturas,
      limiteUso: {
        limiteUsdConfigurado:
          tenant.limite_usd_configurado != null ? Number(tenant.limite_usd_configurado) : null,
        limiteAccion: tenant.limite_accion,
      },
    });
  } catch (err) {
    console.error("GET /admin/uso-facturacion", err);
    res.status(500).json({ error: "Error al obtener el uso y facturación." });
  }
});

// Cambia de plan — tanto para elegir plan de pago durante el trial, como
// para upgrade/downgrade después. Si ya hay una suscripción real en
// Stripe, se le actualiza el price del ítem base; si todavía no existe
// (sigue en trial), solo se actualiza plan_id acá — el job de conversión
// de trial (ver jobs/) crea la suscripción real usando el plan_id vigente
// en ese momento.
adminRouter.put("/plan", async (req, res) => {
  const { planId } = req.body as { planId?: string };
  if (!planId) {
    return res.status(400).json({ error: "Falta planId." });
  }

  try {
    const planResult = await req.db!.query(
      `SELECT id, nombre, stripe_price_id FROM planes WHERE id = $1`,
      [planId]
    );
    const nuevoPlan = planResult.rows[0];
    if (!nuevoPlan) {
      return res.status(404).json({ error: "Plan no encontrado." });
    }

    const tenantResult = await req.db!.query(
      `SELECT stripe_subscription_id, stripe_cupos_item_id FROM tenants WHERE id = $1`,
      [req.auth!.tenantId]
    );
    const tenant = tenantResult.rows[0];

    if (tenant.stripe_subscription_id) {
      if (!nuevoPlan.stripe_price_id) {
        return res.status(409).json({
          error: `El plan "${nuevoPlan.nombre}" todavía no tiene un stripe_price_id configurado.`,
        });
      }

      const stripe = requerirStripe();
      const suscripcion = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
      // El ítem base es "el que no es el de cupos extra" — es la única
      // forma de distinguirlos sin una columna dedicada para el item id
      // del plan base (solo se persiste stripe_cupos_item_id).
      const itemBase = suscripcion.items.data.find(
        (item) => item.id !== tenant.stripe_cupos_item_id
      );
      if (!itemBase) {
        return res.status(500).json({ error: "No se encontró el ítem base de la suscripción en Stripe." });
      }

      await stripe.subscriptions.update(tenant.stripe_subscription_id, {
        items: [{ id: itemBase.id, price: nuevoPlan.stripe_price_id }],
        // Comportamiento estándar de Stripe para upgrade/downgrade a mitad
        // de ciclo (prorrateo automático) — sin lógica custom adicional.
        proration_behavior: "create_prorations",
      });
    }

    const result = await req.db!.query(
      `UPDATE tenants SET plan_id = $1 WHERE id = $2
       RETURNING id, plan_id`,
      [planId, req.auth!.tenantId]
    );
    res.json({ tenant: result.rows[0] });
  } catch (err) {
    console.error("PUT /admin/plan", err);
    res.status(500).json({ error: "Error al cambiar de plan." });
  }
});

// Flujo de suscripción B — REEMPLAZADO 2026-08-04. Este endpoint (y
// revertir-cancelacion, abajo) escribía exclusivamente en columnas del
// modelo viejo (tenants.estado_suscripcion/cancelacion_solicitada) que el
// motor de crédito nuevo (bloques 1-5, ver tarifas.ts/usoIa.ts/ciclo.job.ts)
// no lee — un administrador que cancelaba acá veía la confirmación en
// pantalla, pero la suscripción real (suscripciones.estado) seguía activa
// sin cambios: la cancelación no tenía ningún efecto real. El frontend ya
// wireado (Facturacion.tsx) sigue llamando a esta misma ruta sin cambios,
// así que se reemplaza el cuerpo, no el path.
adminRouter.put("/cancelar-suscripcion", async (req, res) => {
  try {
    const resultado = await solicitarCancelacionSuscripcion(req.db!, req.auth!.tenantId!, req.auth!.userId);
    if (!resultado.permitido) {
      return res.status(409).json({ error: mensajeRechazoCambio(resultado), motivo: resultado.motivo });
    }
    const cambio = await obtenerCambioPendiente(req.db!, req.auth!.tenantId!);
    res.json({ suscripcion: { estado: "cancelada", efectivo_en: cambio?.efectivo_en ?? null }, cambio });
  } catch (err) {
    console.error("PUT /admin/cancelar-suscripcion", err);
    res.status(500).json({ error: "Error al cancelar la suscripción." });
  }
});

adminRouter.put("/revertir-cancelacion", async (req, res) => {
  try {
    const cambio = await obtenerCambioPendiente(req.db!, req.auth!.tenantId!);
    if (!cambio || cambio.tipo !== "cancelacion") {
      return res.status(409).json({ error: "No hay una cancelación programada para revertir." });
    }
    const resultado = await cancelarCambioProgramado(req.db!, req.auth!.tenantId!, cambio.id);
    if (!resultado.permitido) {
      return res.status(409).json({ error: mensajeRechazoCambio(resultado), motivo: resultado.motivo });
    }
    res.json({ suscripcion: { estado: "activa" } });
  } catch (err) {
    console.error("PUT /admin/revertir-cancelacion", err);
    res.status(500).json({ error: "Error al revertir la cancelación." });
  }
});

// Flujo de suscripción B — downgrade programado + consulta de cambio
// pendiente.
adminRouter.get("/cambio-pendiente", async (req, res) => {
  try {
    const cambio = await obtenerCambioPendiente(req.db!, req.auth!.tenantId!);
    res.json({ cambio });
  } catch (err) {
    console.error("GET /admin/cambio-pendiente", err);
    res.status(500).json({ error: "Error al consultar el cambio pendiente." });
  }
});

adminRouter.post("/downgrade", async (req, res) => {
  const { planDestinoId, periodicidadDestino, agentesConservados, medicosConservados } = req.body as {
    planDestinoId?: string;
    periodicidadDestino?: string;
    agentesConservados?: string[];
    medicosConservados?: string[];
  };
  if (!planDestinoId || !Array.isArray(agentesConservados) || !Array.isArray(medicosConservados)) {
    return res.status(400).json({ error: "Faltan planDestinoId, agentesConservados o medicosConservados." });
  }
  try {
    const resultado = await solicitarDowngrade(req.db!, req.auth!.tenantId!, req.auth!.userId, {
      planDestinoId,
      periodicidadDestino,
      agentesConservados,
      medicosConservados,
    });
    if (!resultado.permitido) {
      return res.status(409).json({ error: mensajeRechazoCambio(resultado), motivo: resultado.motivo, ...resultado });
    }
    res.status(201).json({ cambioId: resultado.cambioId });
  } catch (err) {
    console.error("POST /admin/downgrade", err);
    res.status(500).json({ error: "Error al solicitar el downgrade." });
  }
});

adminRouter.delete("/cambio-pendiente/:cambioId", async (req, res) => {
  try {
    const resultado = await cancelarCambioProgramado(req.db!, req.auth!.tenantId!, req.params.cambioId);
    if (!resultado.permitido) {
      return res.status(409).json({ error: mensajeRechazoCambio(resultado), motivo: resultado.motivo });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/cambio-pendiente/:cambioId", err);
    res.status(500).json({ error: "Error al cancelar el cambio programado." });
  }
});

// =====================================================================
// LÍMITE DE USO DE IA Y NOTIFICACIONES
// =====================================================================

adminRouter.put("/limite-uso", async (req, res) => {
  const { limiteUsdConfigurado, limiteAccion } = req.body as {
    limiteUsdConfigurado?: number | null;
    limiteAccion?: "solo_notificar" | "bloquear";
  };

  if (limiteAccion !== "solo_notificar" && limiteAccion !== "bloquear") {
    return res.status(400).json({ error: "limiteAccion debe ser 'solo_notificar' o 'bloquear'." });
  }
  if (limiteUsdConfigurado != null && (typeof limiteUsdConfigurado !== "number" || limiteUsdConfigurado < 0)) {
    return res.status(400).json({ error: "limiteUsdConfigurado debe ser un número positivo o null." });
  }

  try {
    const result = await req.db!.query(
      `UPDATE tenants
       SET limite_usd_configurado = $1, limite_accion = $2
       WHERE id = $3
       RETURNING limite_usd_configurado, limite_accion`,
      [limiteUsdConfigurado ?? null, limiteAccion, req.auth!.tenantId]
    );
    res.json({
      limiteUsdConfigurado:
        result.rows[0].limite_usd_configurado != null ? Number(result.rows[0].limite_usd_configurado) : null,
      limiteAccion: result.rows[0].limite_accion,
    });
  } catch (err) {
    console.error("PUT /admin/limite-uso", err);
    res.status(500).json({ error: "Error al actualizar el límite de uso." });
  }
});

// Motor de crédito, bloque 4 — avisos vigentes del ciclo actual, para que
// el frontend (campanita del médico y Plan y Consumo del admin) los
// muestre sin tener que traer todo el historial. "Vigente" acá significa
// del ciclo actual (fecha >= periodo_inicio de la suscripción vigente) Y
// no leída — no se re-deriva contra el estado actual del saldo (la otra
// definición que planteaba el prompt de este bloque), porque eso
// obligaría a reconstruir en el endpoint de lectura la misma lógica de
// comparación que ya corrió al escribir la notificación, duplicando la
// fuente de verdad. Una vez marcada leída, deja de aparecer acá aunque
// el umbral siga técnicamente cruzado — coherente con que
// verificarUmbralesYNotificar ya no la va a repetir en este mismo ciclo.
adminRouter.get("/notificaciones/vigentes", async (req, res) => {
  try {
    const suscripcionResult = await req.db!.query(
      `SELECT s.periodo_inicio
       FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
       WHERE t.id = $1`,
      [req.auth!.tenantId]
    );
    const periodoInicio = suscripcionResult.rows[0]?.periodo_inicio;
    if (!periodoInicio) {
      return res.json({ notificaciones: [] });
    }

    const result = await req.db!.query(
      `SELECT id, umbral, mensaje, fecha, leida
       FROM notificaciones_uso
       WHERE tenant_id = $1 AND leida = false AND fecha >= $2
       ORDER BY fecha DESC`,
      [req.auth!.tenantId, periodoInicio]
    );
    res.json({ notificaciones: result.rows });
  } catch (err) {
    console.error("GET /admin/notificaciones/vigentes", err);
    res.status(500).json({ error: "Error al listar los avisos vigentes." });
  }
});

adminRouter.get("/notificaciones", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT id, umbral, mensaje, fecha, leida
       FROM notificaciones_uso
       WHERE tenant_id = $1
       ORDER BY fecha DESC`,
      [req.auth!.tenantId]
    );
    res.json({ notificaciones: result.rows });
  } catch (err) {
    console.error("GET /admin/notificaciones", err);
    res.status(500).json({ error: "Error al listar las notificaciones." });
  }
});

adminRouter.patch("/notificaciones/marcar-todas-leidas", async (req, res) => {
  try {
    await req.db!.query(
      `UPDATE notificaciones_uso SET leida = true WHERE tenant_id = $1 AND leida = false`,
      [req.auth!.tenantId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /admin/notificaciones/marcar-todas-leidas", err);
    res.status(500).json({ error: "Error al marcar las notificaciones como leídas." });
  }
});

adminRouter.patch("/notificaciones/:id/leida", async (req, res) => {
  try {
    const result = await req.db!.query(
      `UPDATE notificaciones_uso SET leida = true
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, umbral, mensaje, fecha, leida`,
      [req.params.id, req.auth!.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notificación no encontrada." });
    }
    res.json({ notificacion: result.rows[0] });
  } catch (err) {
    console.error("PATCH /admin/notificaciones/:id/leida", err);
    res.status(500).json({ error: "Error al marcar la notificación como leída." });
  }
});

// =====================================================================
// CASOS — visibilidad completa para el admin de clínica + reasignación
// entre médicos.
//
// A diferencia de GET /workspace/casos (que filtra por c.medico_id = el
// médico logueado), acá el admin ve TODOS los casos del tenant. Filtramos
// explícitamente por c.tenant_id en cada query — no confiamos en RLS para
// el aislamiento entre clínicas: las tablas tienen ENABLE ROW LEVEL
// SECURITY pero no FORCE, y esta app se conecta como dueña de las tablas,
// así que RLS no se aplica de verdad a esta conexión (ver el leak real ya
// encontrado en GET /admin/medicos en una fase anterior). El filtro
// explícito es lo que realmente aísla los tenants acá.
// =====================================================================

const CASOS_POR_PAGINA = 10;

adminRouter.get("/casos", async (req, res) => {
  const { medicoId, estado, agenteId, buscarPaciente, numeroExpediente } = req.query as {
    medicoId?: string;
    estado?: string;
    agenteId?: string;
    buscarPaciente?: string;
    numeroExpediente?: string;
  };
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);

  const condiciones = [`c.tenant_id = $1`];
  const params: any[] = [req.auth!.tenantId];

  if (medicoId) {
    params.push(medicoId);
    condiciones.push(`c.medico_id = $${params.length}`);
  }
  if (estado) {
    params.push(estado);
    condiciones.push(`c.estado = $${params.length}`);
  }
  if (agenteId) {
    params.push(agenteId);
    condiciones.push(`c.agente_id = $${params.length}`);
  }
  if (buscarPaciente) {
    params.push(`%${buscarPaciente}%`);
    condiciones.push(`p.nombre ILIKE $${params.length}`);
  }
  // Búsqueda exacta por número de expediente ("traeme el 1042") — filtro
  // separado del texto libre de arriba, no un OR: son dos formas de
  // búsqueda con semántica distinta (parcial por nombre vs. exacta por
  // número), mezclarlas en un solo campo generaría falsos positivos si
  // un nombre de mascota contuviera dígitos.
  if (numeroExpediente) {
    const numero = parseInt(numeroExpediente, 10);
    if (!Number.isNaN(numero)) {
      params.push(numero);
      condiciones.push(`c.numero_expediente = $${params.length}`);
    }
  }
  const where = `WHERE ${condiciones.join(" AND ")}`;

  try {
    const totalResult = await req.db!.query(
      `SELECT COUNT(*) FROM casos c JOIN pacientes p ON p.id = c.paciente_id ${where}`,
      params
    );
    const total = Number(totalResult.rows[0].count);

    const result = await req.db!.query(
      `SELECT c.id, c.motivo, c.estado, c.severidad, c.confianza_diagnostica, c.creado_en, c.numero_expediente,
              p.nombre AS paciente_nombre, p.especie, r.nombre AS raza,
              a.id AS agente_id, a.nombre AS agente_nombre,
              per.id AS medico_id, per.nombre AS medico_nombre
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       LEFT JOIN razas r ON r.id = p.raza_id
       JOIN agentes a ON a.id = c.agente_id
       JOIN personas per ON per.id = c.medico_id
       ${where}
       ORDER BY c.actualizado_en DESC
       LIMIT ${CASOS_POR_PAGINA} OFFSET ${(pagina - 1) * CASOS_POR_PAGINA}`,
      params
    );

    res.json({
      casos: result.rows,
      total,
      totalPaginas: Math.max(1, Math.ceil(total / CASOS_POR_PAGINA)),
    });
  } catch (err) {
    console.error("GET /admin/casos", err);
    res.status(500).json({ error: "Error al listar los casos." });
  }
});

// =====================================================================
// REPORTE DE ATENCIONES — respaldo ante el colegio de médicos
// veterinarios (prompt_code_reporte_atenciones).
//
// La fila principal es la CITA completada (es lo único que tiene hora de
// inicio/fin, que el colegio pide). "Atención" = cita en estado
// 'completada' — programada/confirmada/cancelada/no_show no representan
// una atención realizada.
//
// Pero no todo caso nace de una cita (el alta directa desde el área de
// trabajo no crea ninguna) — relevamiento real: de 30 casos del último
// año, 0 tenían cita asociada. Omitirlos haría que el reporte mienta por
// omisión, así que se listan aparte, señalados como tales.
// =====================================================================

function parseRangoFechas(req: import("express").Request): { desde: string; hasta: string } | null {
  const desde = typeof req.query.desde === "string" ? req.query.desde : "";
  const hasta = typeof req.query.hasta === "string" ? req.query.hasta : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return null;
  return { desde, hasta };
}

async function obtenerDatosReporteAtenciones(
  db: import("pg").PoolClient,
  rango: { desde: string; hasta: string },
  medicoId?: string
) {
  const paramsAtenciones: any[] = [rango.desde, rango.hasta];
  let filtroMedicoAtenciones = "";
  if (medicoId) {
    paramsAtenciones.push(medicoId);
    filtroMedicoAtenciones = `AND ci.medico_id = $${paramsAtenciones.length}`;
  }

  // prompt: 5 columnas exactas — fecha de atención, hora de inicio, hora de
  // fin, número de expediente, número de colegiado. paciente_nombre se cayó
  // del SELECT (ya no se renderiza en ningún lado); medico_id/medico_nombre
  // se mantienen solo para el bloque de totales por médico más abajo.
  const atencionesResult = await db.query(
    `SELECT ci.id, ci.fecha, ci.hora_inicio, ci.hora_fin,
            c.numero_expediente,
            per.id AS medico_id, per.nombre AS medico_nombre, per.colegiatura
     FROM citas ci
     JOIN personas per ON per.id = ci.medico_id
     LEFT JOIN casos c ON c.id = ci.caso_id
     WHERE ci.estado = 'completada' AND ci.fecha BETWEEN $1 AND $2 ${filtroMedicoAtenciones}
     ORDER BY ci.fecha, ci.hora_inicio`,
    paramsAtenciones
  );

  const paramsCasosSinCita: any[] = [rango.desde, rango.hasta];
  let filtroMedicoCasos = "";
  if (medicoId) {
    paramsCasosSinCita.push(medicoId);
    filtroMedicoCasos = `AND c.medico_id = $${paramsCasosSinCita.length}`;
  }

  // Ya no es una tabla con columnas propias — solo la lista de expedientes
  // que quedan fuera de la tabla de atenciones, para que el reporte nunca
  // los omita en silencio sin fingir que tienen las 5 columnas de arriba.
  const casosSinCitaResult = await db.query(
    `SELECT c.id, c.numero_expediente
     FROM casos c
     WHERE NOT EXISTS (SELECT 1 FROM citas ci WHERE ci.caso_id = c.id)
       AND c.creado_en::date BETWEEN $1 AND $2 ${filtroMedicoCasos}
     ORDER BY c.creado_en`,
    paramsCasosSinCita
  );

  const totalesPorMedico = new Map<string, { medicoNombre: string; total: number }>();
  for (const fila of atencionesResult.rows) {
    const actual = totalesPorMedico.get(fila.medico_id) ?? { medicoNombre: fila.medico_nombre, total: 0 };
    actual.total += 1;
    totalesPorMedico.set(fila.medico_id, actual);
  }

  return {
    atenciones: atencionesResult.rows,
    casosSinCita: casosSinCitaResult.rows,
    totalAtenciones: atencionesResult.rows.length,
    totalesPorMedico: Array.from(totalesPorMedico.values()),
  };
}

adminRouter.get("/reporte-atenciones", async (req, res) => {
  const rango = parseRangoFechas(req);
  if (!rango) {
    return res.status(400).json({ error: "Faltan desde/hasta (formato YYYY-MM-DD)." });
  }
  const medicoId = typeof req.query.medicoId === "string" && req.query.medicoId ? req.query.medicoId : undefined;

  try {
    const datos = await obtenerDatosReporteAtenciones(req.db!, rango, medicoId);
    res.json(datos);
  } catch (err) {
    console.error("GET /admin/reporte-atenciones", err);
    res.status(500).json({ error: "Error al generar el reporte de atenciones." });
  }
});

adminRouter.get("/reporte-atenciones/pdf", async (req, res) => {
  const rango = parseRangoFechas(req);
  if (!rango) {
    return res.status(400).json({ error: "Faltan desde/hasta (formato YYYY-MM-DD)." });
  }
  const medicoId = typeof req.query.medicoId === "string" && req.query.medicoId ? req.query.medicoId : undefined;

  try {
    const datos = await obtenerDatosReporteAtenciones(req.db!, rango, medicoId);

    const tenantResult = await req.db!.query(
      `SELECT t.nombre, t.nombre_fiscal, t.numero_identificacion, ti.etiqueta AS tipo_identificacion_etiqueta
       FROM tenants t
       LEFT JOIN tipos_identificacion ti ON ti.id = t.tipo_identificacion_id
       WHERE t.id = $1`,
      [req.auth!.tenantId]
    );
    const clinica = tenantResult.rows[0];

    const generadorResult = await req.db!.query(`SELECT nombre FROM personas WHERE id = $1`, [req.auth!.userId]);
    const generadoPor = generadorResult.rows[0]?.nombre ?? "—";

    const { generarPdfReporteAtenciones } = await import("../reporteAtencionesPdf");
    const buffer = await generarPdfReporteAtenciones({
      clinica,
      rango,
      generadoPor,
      generadoEn: new Date(),
      ...datos,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reporte-atenciones_${rango.desde}_${rango.hasta}.pdf"`
    );
    res.send(buffer);
  } catch (err) {
    console.error("GET /admin/reporte-atenciones/pdf", err);
    res.status(500).json({ error: "Error al generar el PDF del reporte." });
  }
});

// ---------------------------------------------------------------------
// GET /api/admin/casos/sin-actividad
// prompt_code_cierre_caso.md, Paso 4 — mismo criterio que el endpoint
// gemelo del médico (casos.routes.ts), tenant-wide en vez de por médico.
// Va ANTES de GET /casos/:id a propósito: Express toma la primera ruta
// que matchea, y "/casos/:id" también matchea "/casos/sin-actividad" con
// id="sin-actividad" si quedara registrada primero.
// ---------------------------------------------------------------------
adminRouter.get("/casos/sin-actividad", async (req, res) => {
  const resolucion = resolverFechaCorte(req.query as Record<string, unknown>);
  if (!resolucion.valido) {
    return res.status(400).json({ error: resolucion.error });
  }

  try {
    const result = await req.db!.query(
      `SELECT c.id, c.numero_expediente, c.motivo, c.agente_id, a.nombre AS agente_nombre,
              p.nombre AS paciente_nombre, per.nombre AS medico_nombre,
              c.creado_en, c.actualizado_en
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN agentes a ON a.id = c.agente_id
       JOIN personas per ON per.id = c.medico_id
       WHERE c.tenant_id = $1 AND c.estado <> 'completado' AND c.actualizado_en <= $2
       ORDER BY c.actualizado_en ASC`,
      [req.auth!.tenantId, resolucion.fechaCorte]
    );
    res.json({ casos: result.rows });
  } catch (err) {
    console.error("GET /admin/casos/sin-actividad", err);
    res.status(500).json({ error: "Error al obtener los casos sin actividad." });
  }
});

adminRouter.get("/casos/:id", async (req, res) => {
  try {
    const casoResult = await req.db!.query(
      `SELECT c.id, c.motivo, c.estado, c.severidad, c.confianza_diagnostica, c.creado_en, c.numero_expediente,
              c.medico_id, c.agente_id,
              c.diagnostico_final, c.tratamiento_activo, c.tratamiento_activo_detalle, c.desenlace,
              c.cerrado_en, cerrador.nombre AS cerrado_por_nombre,
              c.motivo_reapertura, c.reabierto_en, reabridor.nombre AS reabierto_por_nombre,
              p.id AS paciente_id, p.nombre AS paciente_nombre, p.especie, r.nombre AS raza, p.sexo, p.edad_anios, p.fecha_nacimiento,
              p.estado AS paciente_estado,
              per.nombre AS medico_nombre, a.nombre AS agente_nombre
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       LEFT JOIN razas r ON r.id = p.raza_id
       JOIN personas per ON per.id = c.medico_id
       JOIN agentes a ON a.id = c.agente_id
       LEFT JOIN personas cerrador ON cerrador.id = c.cerrado_por
       LEFT JOIN personas reabridor ON reabridor.id = c.reabierto_por
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    const caso = casoResult.rows[0];
    caso.edad_anios = calcularEdadEfectiva(caso.fecha_nacimiento, caso.edad_anios);

    // tipo incluido sin filtrar — la vista de admin muestra el expediente
    // completo, información registrada incluida (con su propio tratamiento
    // visual en MensajesLista), no arma una conversación para el modelo.
    const mensajesResult = await req.db!.query(
      `SELECT id, remitente, contenido, tipo, creado_en
       FROM mensajes WHERE caso_id = $1 ORDER BY creado_en ASC`,
      [req.params.id]
    );

    const archivosResult = await req.db!.query(
      `SELECT id, mensaje_id, nombre_archivo, tipo
       FROM archivos
       WHERE caso_id = $1 AND mensaje_id IS NOT NULL`,
      [req.params.id]
    );
    const archivosPorMensaje = new Map<string, { id: string; nombre_archivo: string; tipo: string }[]>();
    for (const a of archivosResult.rows) {
      const lista = archivosPorMensaje.get(a.mensaje_id) ?? [];
      lista.push({ id: a.id, nombre_archivo: a.nombre_archivo, tipo: a.tipo });
      archivosPorMensaje.set(a.mensaje_id, lista);
    }
    const mensajesConArchivos = mensajesResult.rows.map((m) => ({
      ...m,
      archivos: archivosPorMensaje.get(m.id) ?? [],
    }));

    const derivacionesResult = await req.db!.query(
      `SELECT especialidad_sugerida, prioridad, motivo
       FROM derivaciones WHERE caso_id = $1 ORDER BY creado_en DESC LIMIT 1`,
      [req.params.id]
    );

    // Acceso elevado: el admin está viendo el caso de un médico que no es
    // él mismo — esto es prácticamente siempre cierto acá (un admin de
    // clínica normalmente no es también el médico dueño del caso), pero se
    // compara explícitamente en vez de asumirlo, por si el admin también
    // tiene casos propios como médico.
    if (caso.medico_id !== req.auth!.userId) {
      registrarLecturaSensible(req.auth!, "admin_vio_caso_de_otro_medico", "casos", req.params.id);
    }

    res.json({
      caso,
      mensajes: mensajesConArchivos,
      derivacion: derivacionesResult.rows[0] ?? null,
    });
  } catch (err) {
    console.error("GET /admin/casos/:id", err);
    res.status(500).json({ error: "Error al obtener el caso." });
  }
});

// Médicos habilitados para el MISMO agente que el caso, tenant-scoped,
// excluyendo al médico ya asignado — la lista que alimenta el dropdown
// "Médico destino" del modal de reasignación.
adminRouter.get("/casos/:id/medicos-disponibles", async (req, res) => {
  try {
    const casoResult = await req.db!.query(
      `SELECT id, agente_id, medico_id FROM casos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    const caso = casoResult.rows[0];

    const medicosResult = await req.db!.query(
      `SELECT ma.id AS medico_agente_id, per.id AS persona_id, per.nombre
       FROM medico_agente ma
       JOIN personas per ON per.id = ma.persona_id
       WHERE ma.agente_id = $1 AND ma.habilitado = true
         AND per.tenant_id = $2 AND per.id <> $3
       ORDER BY per.nombre`,
      [caso.agente_id, req.auth!.tenantId, caso.medico_id]
    );

    res.json({ medicos: medicosResult.rows });
  } catch (err) {
    console.error("GET /admin/casos/:id/medicos-disponibles", err);
    res.status(500).json({ error: "Error al listar médicos disponibles." });
  }
});

adminRouter.put("/casos/:id/reasignar", async (req, res) => {
  const { nuevoMedicoAgenteId, motivo } = req.body as {
    nuevoMedicoAgenteId?: string;
    motivo?: string;
  };

  if (!nuevoMedicoAgenteId) {
    return res.status(400).json({ error: "Falta nuevoMedicoAgenteId." });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT c.id, c.agente_id, c.medico_id, per.nombre AS medico_anterior_nombre
       FROM casos c
       JOIN personas per ON per.id = c.medico_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    const caso = casoResult.rows[0];

    // El nuevo medico_agente tiene que ser del mismo tenant, estar
    // habilitado, y ser para el MISMO agente_id que ya tiene el caso — no
    // tiene sentido reasignar un caso de Gastroenterología a alguien sin
    // acceso habilitado a ese agente.
    const nuevoMedicoResult = await req.db!.query(
      `SELECT ma.id AS medico_agente_id, per.id AS persona_id, per.nombre
       FROM medico_agente ma
       JOIN personas per ON per.id = ma.persona_id
       WHERE ma.id = $1 AND ma.agente_id = $2 AND ma.habilitado = true AND per.tenant_id = $3`,
      [nuevoMedicoAgenteId, caso.agente_id, req.auth!.tenantId]
    );
    if (nuevoMedicoResult.rows.length === 0) {
      return res.status(400).json({
        error: "El médico seleccionado no tiene acceso habilitado a este agente en tu clínica.",
      });
    }
    const nuevoMedico = nuevoMedicoResult.rows[0];

    // Actualiza medico_agente_id (contexto de especialidad) Y medico_id —
    // este último es el campo que usan TODAS las rutas del médico
    // (GET/POST /workspace/casos/:id) para decidir si el caso es suyo. Si
    // solo tocáramos medico_agente_id, el médico nuevo seguiría sin poder
    // ver el caso en su workspace y el anterior seguiría teniendo acceso
    // — la reasignación sería cosmética, no funcional.
    await req.db!.query(
      `UPDATE casos SET medico_agente_id = $1, medico_id = $2, actualizado_en = now() WHERE id = $3`,
      [nuevoMedicoAgenteId, nuevoMedico.persona_id, req.params.id]
    );

    registrarEventoDetallado(req.auth!, "admin_reasigno_caso", "casos", req.params.id, {
      medicoAnterior: { id: caso.medico_id, nombre: caso.medico_anterior_nombre },
      medicoNuevo: { id: nuevoMedico.persona_id, nombre: nuevoMedico.nombre },
      motivo: motivo?.trim() || null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /admin/casos/:id/reasignar", err);
    res.status(500).json({ error: "Error al reasignar el caso." });
  }
});

// ---------------------------------------------------------------------
// POST /api/admin/casos/:id/cerrar
// prompt_code_cierre_caso.md, Paso 2 — endpoint gemelo de
// casosRouter.post("/:id/cerrar") (casos.routes.ts) para el administrador
// de clínica: mismo módulo backend/src/cierreCaso.ts, WHERE de pertenencia
// por tenant_id en vez de medico_id porque adminRouter sirve cualquier
// caso de la clínica, no solo los propios.
// ---------------------------------------------------------------------
adminRouter.post("/casos/:id/cerrar", async (req, res) => {
  const validacion = validarCerrarCasoInput(req.body);
  if (!validacion.valido) {
    return res.status(400).json({ error: validacion.error });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT id, estado, paciente_id FROM casos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    if (casoResult.rows[0].estado === "completado") {
      return res.status(409).json({ error: "El caso ya está cerrado." });
    }

    const { caso, pacienteMarcadoFallecido } = await ejecutarCierreCaso(
      req.db!,
      req.params.id,
      casoResult.rows[0].paciente_id,
      validacion.input,
      req.auth!.userId
    );

    res.json({ caso, pacienteMarcadoFallecido });
  } catch (err) {
    console.error("POST /admin/casos/:id/cerrar", err);
    res.status(500).json({ error: "Error al cerrar el caso." });
  }
});

// ---------------------------------------------------------------------
// POST /api/admin/casos/:id/reabrir
// prompt_code_cierre_caso.md, Paso 3 — endpoint gemelo del médico
// (casosRouter.post("/:id/reabrir")). Ver cierreCaso.ts.
// ---------------------------------------------------------------------
adminRouter.post("/casos/:id/reabrir", async (req, res) => {
  const validacion = validarReabrirCasoInput(req.body);
  if (!validacion.valido) {
    return res.status(400).json({ error: validacion.error });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT id, estado FROM casos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    if (casoResult.rows[0].estado !== "completado") {
      return res.status(409).json({ error: "El caso no está cerrado." });
    }

    const caso = await ejecutarReaperturaCaso(req.db!, req.params.id, validacion.motivo, req.auth!.userId);
    res.json({ caso });
  } catch (err) {
    console.error("POST /admin/casos/:id/reabrir", err);
    res.status(500).json({ error: "Error al reabrir el caso." });
  }
});
