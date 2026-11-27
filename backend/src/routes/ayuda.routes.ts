import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso, soloPersonalDeLaClinica } from "../permisos";
import { buscarSecciones, responder, sinRespuesta } from "../ayuda/agenteAyuda";

// ---------------------------------------------------------------------
// LA AYUDA DEL SISTEMA — prompt 16a.
//
// SIN PERMISO PARA PREGUNTAR. Cualquiera que trabaje en la clínica
// puede preguntar cómo se usa el sistema: negarle la ayuda a la
// recepción sería lo contrario de lo que este prompt existe para hacer.
// Lo que sí mira el rol es la **respuesta**: si la acción que pregunta
// necesita un permiso que no tiene, se lo dice.
//
// Lo que no se pudo responder sí lleva permiso: es una lista de gestión.
// ---------------------------------------------------------------------

export const ayudaRouter = Router();
ayudaRouter.use(authenticate, withTenantClient, soloPersonalDeLaClinica());

ayudaRouter.post("/preguntar", async (req, res) => {
  try {
    const pregunta = String(req.body?.pregunta ?? "").trim();
    if (pregunta.length < 3) {
      return res.status(400).json({ error: "Escribí la pregunta." });
    }
    if (pregunta.length > 500) {
      return res.status(400).json({
        error: "La pregunta es muy larga. Preguntá una cosa a la vez: la ayuda contesta mejor.",
      });
    }
    res.json(
      await responder(req.db!, {
        tenantId: req.auth!.tenantId!,
        personaId: req.auth!.userId,
        permisos: req.auth!.permisos ?? new Set<string>(),
        pregunta,
        rutaActual: req.body?.rutaActual ?? null,
      })
    );
  } catch (err) {
    console.error("POST /ayuda/preguntar", err);
    res.status(500).json({ error: "No se pudo responder." });
  }
});

/**
 * La búsqueda sola, sin modelo.
 *
 * Sirve para dos cosas: la pantalla puede mostrar las páginas sugeridas
 * mientras se escribe —sin gastar crédito— y el banco de evaluación
 * verifica la parte determinista del agente.
 */
ayudaRouter.get("/buscar", async (req, res) => {
  try {
    res.json({
      secciones: await buscarSecciones(req.db!, String(req.query.q ?? ""), 5),
    });
  } catch (err) {
    console.error("GET /ayuda/buscar", err);
    res.status(500).json({ error: "No se pudo buscar." });
  }
});

ayudaRouter.get("/sin-respuesta", exigirPermiso("clinica.configurar"), async (req, res) => {
  try {
    res.json({ preguntas: await sinRespuesta(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    console.error("GET /ayuda/sin-respuesta", err);
    res.status(500).json({ error: "No se pudo leer." });
  }
});
