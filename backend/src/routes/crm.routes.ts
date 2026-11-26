import { Request, Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import {
  agregarNota,
  lineaDeInteracciones,
  tiposDeEvento,
} from "../crm/interacciones";
import {
  Canal,
  consentimientosDe,
  guardarPoliticas,
  guardarPreferencias,
  historialDe,
  politicas,
  preferenciasDe,
  puedeEnviar,
  registrarConsentimiento,
} from "../crm/consentimientos";
import { recibirRespuesta } from "../crm/mensajeria";

// ---------------------------------------------------------------------
// API DEL CRM (prompt 03).
//
// LA LECTURA ES PARA TODO EL PERSONAL: la recepción necesita la línea de
// tiempo de un cliente para atender el teléfono, y los consentimientos
// para saber si puede escribirle. El detalle clínico de un evento se
// tapa según quién mira — eso lo decide `lineaDeInteracciones`, no esta
// ruta.
//
// LA ESCRITURA DE CONSENTIMIENTOS también es de la recepción: es quien
// atiende al cliente cuando dice "no me manden más promociones". Las
// POLÍTICAS de la clínica —el tope, la franja, la ventana— son del
// administrador: son una decisión del negocio.
// ---------------------------------------------------------------------

export const crmRouter = Router();

crmRouter.use(authenticate, withTenantClient);

function fallo(res: Response, err: unknown, donde: string) {
  const mensaje = err instanceof Error ? err.message : "Error inesperado.";
  console.error(donde, err);
  res.status(400).json({ error: mensaje });
}

function soloAdmin(req: Request, res: Response, next: () => void) {
  if (!req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esto lo configura un administrador de la clínica." });
  }
  next();
}

crmRouter.get("/tipos-evento", async (req, res) => {
  try {
    res.json({ tipos: await tiposDeEvento(req.db!) });
  } catch (err) {
    fallo(res, err, "GET /crm/tipos-evento");
  }
});

/**
 * La línea de tiempo de un cliente, con sus filtros.
 *
 * `puedeVerClinico` sale del rol de quien pregunta, nunca de un
 * parámetro: si el filtro viniera del navegador, cualquiera podría pedir
 * el detalle clínico agregando algo a la URL.
 */
crmRouter.get("/clientes/:id/linea", async (req, res) => {
  try {
    res.json({
      eventos: await lineaDeInteracciones(
        req.db!,
        {
          propietarioId: req.params.id,
          tipos: req.query.tipos ? String(req.query.tipos).split(",") : undefined,
          modulo: (req.query.modulo as string) || undefined,
          pacienteId: (req.query.paciente as string) || undefined,
          desde: (req.query.desde as string) || undefined,
          hasta: (req.query.hasta as string) || undefined,
        },
        !!req.auth!.esMedico
      ),
    });
  } catch (err) {
    fallo(res, err, "GET /crm/clientes/:id/linea");
  }
});

crmRouter.get("/pacientes/:id/linea", async (req, res) => {
  try {
    res.json({
      eventos: await lineaDeInteracciones(
        req.db!,
        { pacienteId: req.params.id },
        !!req.auth!.esMedico
      ),
    });
  } catch (err) {
    fallo(res, err, "GET /crm/pacientes/:id/linea");
  }
});

crmRouter.post("/clientes/:id/notas", async (req, res) => {
  try {
    const id = await agregarNota(req.db!, req.auth!.tenantId!, {
      propietarioId: req.params.id,
      pacienteId: req.body.pacienteId,
      texto: String(req.body.texto ?? ""),
      personaId: req.auth!.userId,
    });
    res.status(201).json({ id });
  } catch (err) {
    fallo(res, err, "POST /crm/clientes/:id/notas");
  }
});

crmRouter.get("/clientes/:id/consentimientos", async (req, res) => {
  try {
    res.json({
      consentimientos: await consentimientosDe(req.db!, req.params.id),
      historial: await historialDe(req.db!, req.params.id),
      preferencias: await preferenciasDe(req.db!, req.params.id),
      politicas: await politicas(req.db!, req.auth!.tenantId!),
    });
  } catch (err) {
    fallo(res, err, "GET /crm/clientes/:id/consentimientos");
  }
});

crmRouter.put("/clientes/:id/consentimientos", async (req, res) => {
  try {
    const r = await registrarConsentimiento(req.db!, req.auth!.tenantId!, {
      propietarioId: req.params.id,
      canal: req.body.canal as Canal,
      finalidad: req.body.finalidad,
      otorgado: !!req.body.otorgado,
      // Desde la pantalla, la fuente es siempre la recepción: quien lo
      // marca es alguien de la clínica atendiendo al cliente. Las otras
      // fuentes las pone el código que corresponde (el registro, la
      // respuesta del cliente, la importación).
      fuente: "recepcion",
      personaId: req.auth!.userId,
      nota: req.body.nota,
    });
    res.json(r);
  } catch (err) {
    fallo(res, err, "PUT /crm/clientes/:id/consentimientos");
  }
});

crmRouter.put("/clientes/:id/preferencias", async (req, res) => {
  try {
    await guardarPreferencias(req.db!, req.auth!.tenantId!, req.params.id, {
      canalPreferido: req.body.canalPreferido || null,
      horaDesde: req.body.horaDesde || null,
      horaHasta: req.body.horaHasta || null,
    });
    res.json({ guardado: true });
  } catch (err) {
    fallo(res, err, "PUT /crm/clientes/:id/preferencias");
  }
});

/**
 * ¿Se le puede escribir? Es la misma pregunta que hace el código antes
 * de enviar, expuesta para que la pantalla pueda explicarlo ANTES de que
 * alguien escriba un mensaje que no va a salir.
 */
crmRouter.get("/clientes/:id/puede-enviar", async (req, res) => {
  try {
    res.json(
      await puedeEnviar(req.db!, {
        tenantId: req.auth!.tenantId!,
        propietarioId: req.params.id,
        pacienteId: (req.query.paciente as string) || null,
        canal: (req.query.canal as Canal) || undefined,
        finalidad: (req.query.finalidad as "salud" | "promociones") || "salud",
        tipo: (req.query.tipo as string) || "consulta_manual",
      })
    );
  } catch (err) {
    fallo(res, err, "GET /crm/clientes/:id/puede-enviar");
  }
});

crmRouter.get("/politicas", async (req, res) => {
  try {
    res.json(await politicas(req.db!, req.auth!.tenantId!));
  } catch (err) {
    fallo(res, err, "GET /crm/politicas");
  }
});

crmRouter.put("/politicas", soloAdmin, async (req, res) => {
  try {
    await guardarPoliticas(req.db!, req.auth!.tenantId!, req.body);
    res.json(await politicas(req.db!, req.auth!.tenantId!));
  } catch (err) {
    fallo(res, err, "PUT /crm/politicas");
  }
});

/**
 * La entrada de respuestas del cliente.
 *
 * Hoy la usa el proveedor SIMULADO y la pantalla de prueba. Cuando
 * Converza se conecte, va a entrar por acá con su firma: el contrato
 * está en `docs/crm/contrato-mensajeria.md`, y el CRM no cambia.
 */
crmRouter.post("/respuestas", async (req, res) => {
  try {
    res.status(201).json(
      await recibirRespuesta(req.db!, req.auth!.tenantId!, {
        canal: (req.body.canal as Canal) ?? "whatsapp",
        remitente: String(req.body.remitente ?? ""),
        texto: String(req.body.texto ?? ""),
      })
    );
  } catch (err) {
    fallo(res, err, "POST /crm/respuestas");
  }
});
