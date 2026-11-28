import { Request, Response, Router } from "express";
import { soloPersonalDeLaClinica, tienePermiso } from "../permisos";
import { authenticate, withTenantClient } from "../middleware/auth";
import {
  CitaNoDisponible,
  CitaNoEncontrada,
  CrearCitaInput,
  TransicionInvalida,
  borrarCita,
  cambiarEstadoDeCita,
  crearCita,
  moverCita,
  vincularCasoACita,
} from "../agenda/citas";
import { huecosLibres } from "../agenda/disponibilidad";

// ---------------------------------------------------------------------
// Citas — SOLO HTTP. El dominio vive en `agenda/citas.ts`, que es el
// único punto que escribe en la tabla (prompt 05, §0): hasta este
// prompt, seis archivos escribían en `citas` y solo este tenía la tabla
// de transiciones válidas.
//
// Lo que queda acá es lo que es de HTTP y no del dominio: leer el
// cuerpo, resolver el permiso de sobrecarga, y traducir los errores del
// dominio a códigos de respuesta.
// ---------------------------------------------------------------------
export const citasRouter = Router();

// ESTO SE PERDIÓ EN EL COMMIT 75ca2a9 («05 parcial») AL ADELGAZAR EL
// ARCHIVO, y dejó la agenda entera caída: sin `withTenantClient` no hay
// `req.db`, así que toda llamada a /api/citas moría con
// «Cannot read properties of undefined (reading 'query')» —el
// TypeError del punto 7—, y sin `authenticate` además entraba sin
// sesión. Dos líneas, el módulo completo.
//
// Por eso `app.ts` ahora comprueba al arrancar que todo router con
// rutas privadas tenga su `authenticate` (ver `verificar_rutas_unicas`
// y la guarda de arranque): un olvido de dos líneas no puede volver a
// costar un módulo.
citasRouter.use(authenticate, withTenantClient);

citasRouter.use(soloPersonalDeLaClinica());


/**
 * LA SOBRECARGA EXPLÍCITA (prompt 05, §1).
 *
 * El permiso pasó de llamarse `agenda.fuera_de_horario` a
 * `agenda.sobrecarga` (migración 166) porque ya no cubre solo el
 * horario: también una sala ocupada, un equipo ocupado y un evento del
 * calendario del médico. El cuerpo sigue mandando
 * `forzarFueraDeHorario` para no romper el cliente del 04.
 */
export function autorizarFueraDeHorario(
  req: Request,
  body: CrearCitaInput
): { estado: number; cuerpo: Record<string, unknown> } | null {
  const forzar = (req.body as { forzarFueraDeHorario?: { motivo?: string } })
    .forzarFueraDeHorario;
  if (!forzar) return null;
  if (!tienePermiso(req, "agenda.sobrecarga")) {
    return {
      estado: 403,
      cuerpo: {
        error:
          "No tenés permiso para sobrecargar la agenda (citar fuera de horario, en un bloqueo o con un recurso ocupado). Pedíselo a un administrador.",
        permisoFaltante: "agenda.sobrecarga",
      },
    };
  }
  if (!forzar.motivo?.trim()) {
    return {
      estado: 400,
      cuerpo: { error: "Para sobrecargar la agenda hace falta el motivo: queda registrado." },
    };
  }
  body.fueraDeHorario = {
    autorizadoPor: req.auth!.userId,
    motivo: forzar.motivo.trim(),
  };
  return null;
}

/**
 * EL 409 DE «NO SE PUEDE AGENDAR AHÍ»: no es un error del sistema, es
 * una pregunta.
 *
 * Lleva el motivo, el nivel que lo frenó, con qué choca, **los tres
 * huecos más cercanos** y si quien está mirando puede sobrecargar. Un
 * «no» sin alternativa obliga a la recepción a adivinar con el cliente
 * al teléfono.
 */
export function responderNoDisponible(req: Request, res: Response, err: CitaNoDisponible) {
  return res.status(409).json({
    error: err.message,
    fueraDeHorario: true,
    nivel: err.veredicto.nivel,
    bloquesDelDia: err.veredicto.bloquesDelDia,
    choques: err.veredicto.choques,
    huecos: err.veredicto.huecos,
    puedeForzar: tienePermiso(req, "agenda.sobrecarga"),
  });
}

// ---------------------------------------------------------------------
// GET /api/citas?desde=&hasta=&medico_id=&estado=&paciente_id=
// ---------------------------------------------------------------------
citasRouter.get("/", async (req, res) => {
  try {
    const { desde, hasta, medico_id, estado, paciente_id } = req.query as Record<string, string | undefined>;
    const condiciones: string[] = [];
    const valores: any[] = [];

    if (desde) {
      valores.push(desde);
      condiciones.push(`c.fecha >= $${valores.length}`);
    }
    if (hasta) {
      valores.push(hasta);
      condiciones.push(`c.fecha <= $${valores.length}`);
    }
    if (medico_id) {
      valores.push(medico_id);
      condiciones.push(`c.medico_id = $${valores.length}`);
    }
    if (estado) {
      valores.push(estado);
      condiciones.push(`c.estado = $${valores.length}`);
    }
    // Reporte de atenciones / wizard "Nuevo Caso" — filtro para "citas de
    // hoy de este paciente" al elegir una cita existente para vincular.
    if (paciente_id) {
      valores.push(paciente_id);
      condiciones.push(`c.paciente_id = $${valores.length}`);
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
    const result = await req.db!.query(
      `SELECT c.*, p.nombre AS paciente_nombre, p.especie,
              -- El id del dueño, además del nombre: el detalle de la
              -- cita necesita preguntar por dónde se le puede avisar
              -- (anexo 07-03, B4), y con el nombre no se puede.
              prop.id AS propietario_id, prop.nombre AS propietario_nombre,
              m.nombre AS medico_nombre, s.nombre AS sala_nombre
       FROM citas c
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN propietarios prop ON prop.id = p.propietario_id
       JOIN personas m ON m.id = c.medico_id
       LEFT JOIN salas s ON s.id = c.sala_id
       ${where}
       ORDER BY c.fecha ASC, c.hora_inicio ASC`,
      valores
    );
    res.json({ citas: result.rows });
  } catch (err) {
    console.error("GET /citas", err);
    res.status(500).json({ error: "Error al listar las citas." });
  }
});

// ---------------------------------------------------------------------
// POST /api/citas — nunca bloquea por conflicto, solo informa.
// ---------------------------------------------------------------------
citasRouter.post("/", async (req, res) => {
  const body = req.body as CrearCitaInput;
  if (!body.pacienteId || !body.medicoId || !body.fecha || !body.horaInicio || !body.duracionMinutos) {
    return res.status(400).json({ error: "Faltan pacienteId, medicoId, fecha, horaInicio o duracionMinutos." });
  }

  const rechazo = autorizarFueraDeHorario(req, body);
  if (rechazo) return res.status(rechazo.estado).json(rechazo.cuerpo);

  try {
    const { cita, conflictos } = await crearCita(req.db!, req.auth!.tenantId!, body);
    res.status(201).json({ cita, conflictos });
  } catch (err) {
    if (err instanceof CitaNoDisponible) return responderNoDisponible(req, res, err);
    console.error("POST /citas", err);
    res.status(500).json({ error: "Error al crear la cita." });
  }
});

// ---------------------------------------------------------------------
// PUT /api/citas/:id — reprogramar/editar, misma detección de conflictos.
// ---------------------------------------------------------------------
citasRouter.put("/:id", async (req, res) => {
  const body = req.body as CrearCitaInput;
  if (!body.pacienteId || !body.medicoId || !body.fecha || !body.horaInicio || !body.duracionMinutos) {
    return res.status(400).json({ error: "Faltan pacienteId, medicoId, fecha, horaInicio o duracionMinutos." });
  }

  const rechazo = autorizarFueraDeHorario(req, body);
  if (rechazo) return res.status(rechazo.estado).json(rechazo.cuerpo);

  try {
    const { cita, conflictos } = await moverCita(
      req.db!,
      req.auth!.tenantId!,
      req.params.id,
      body,
      req.auth!.userId
    );
    res.json({ cita, conflictos });
  } catch (err) {
    if (err instanceof CitaNoDisponible) return responderNoDisponible(req, res, err);
    if (err instanceof CitaNoEncontrada) return res.status(404).json({ error: err.message });
    console.error("PUT /citas/:id", err);
    res.status(500).json({ error: "Error al editar la cita." });
  }
});

// ---------------------------------------------------------------------
// PATCH /api/citas/:id/estado
// ---------------------------------------------------------------------
citasRouter.patch("/:id/estado", async (req, res) => {
  const { estado: nuevoEstado, motivoCancelacion, casoId } = req.body as {
    estado?: string;
    motivoCancelacion?: string;
    casoId?: string;
  };
  if (!nuevoEstado) {
    return res.status(400).json({ error: "Falta el nuevo estado." });
  }

  try {
    const { cita } = await cambiarEstadoDeCita(
      req.db!,
      req.auth!.tenantId!,
      req.params.id,
      nuevoEstado,
      { quien: req.auth!.userId, motivoCancelacion, casoId }
    );
    res.json({ cita });
  } catch (err) {
    if (err instanceof CitaNoEncontrada) return res.status(404).json({ error: err.message });
    if (err instanceof TransicionInvalida) return res.status(400).json({ error: err.message });
    console.error("PATCH /citas/:id/estado", err);
    res.status(500).json({ error: "Error al cambiar el estado de la cita." });
  }
});

// ---------------------------------------------------------------------
// PATCH /api/citas/:id/caso — vincula una cita ya agendada a un caso.
//
// Punto de entrada de la rama "elegir cita de hoy" del wizard de "Nuevo
// Caso" (PATCH /:id/estado también puede escribir caso_id vía COALESCE,
// pero exige además una transición de estado válida — acá el único
// propósito es el vínculo). Nunca pisa un vínculo existente: si la cita
// ya tiene caso_id, se rechaza en vez de reemplazarlo en silencio.
// ---------------------------------------------------------------------
citasRouter.patch("/:id/caso", async (req, res) => {
  const { casoId } = req.body as { casoId?: string };
  if (!casoId) {
    return res.status(400).json({ error: "Falta casoId." });
  }

  try {
    const r = await vincularCasoACita(req.db!, req.params.id, casoId);
    if (r.yaTeniaOtro) {
      return res.status(409).json({ error: "Esta cita ya está vinculada a otro caso." });
    }
    res.json({ cita: { id: req.params.id, caso_id: casoId } });
  } catch (err) {
    if (err instanceof CitaNoEncontrada) return res.status(404).json({ error: err.message });
    console.error("PATCH /citas/:id/caso", err);
    res.status(500).json({ error: "Error al vincular la cita al caso." });
  }
});

// ---------------------------------------------------------------------
// DELETE /api/citas/:id — solo citas que todavía no arrancaron.
//
// prompt_code_notificaciones_pendientes.md, C2 — el borrado en duro deja
// al tutor esperando un turno que ya no existe si no se avisa acá
// también. Se manda el mismo aviso de cancelación ANTES de borrar (los
// datos del paciente/propietario todavía tienen que estar disponibles).
//
// notificaciones.cita_id no tiene ON DELETE CASCADE (a propósito: una
// notificación ya enviada es historia, no debería desaparecer porque la
// cita se borró) — pero SÍ bloqueaba el DELETE con una violación de FK
// en cuanto la cita tenía alguna notificación previa (la confirmación de
// C1, como mínimo, existe siempre desde que se agenda). Se desvincula
// (cita_id = NULL) antes de borrar, no se elimina la notificación.
//
// Nota aparte, señalada al usuario y NO resuelta en este prompt: borrar
// en duro una cita destruye el historial de quién la canceló y por qué
// (motivo_cancelacion no se completa acá). Convertir este DELETE en una
// cancelación sería una decisión de diseño aparte.
// ---------------------------------------------------------------------
citasRouter.delete("/:id", async (req, res) => {
  try {
    await borrarCita(req.db!, req.auth!.tenantId!, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof CitaNoEncontrada) return res.status(404).json({ error: err.message });
    if (err instanceof TransicionInvalida) return res.status(400).json({ error: err.message });
    console.error("DELETE /citas/:id", err);
    res.status(500).json({ error: "Error al borrar la cita." });
  }
});

// ---------------------------------------------------------------------
// GET /api/citas/huecos — los huecos libres de un día (prompt 05, §1 y §2)
//
// La misma función que decide si una cita se puede agendar es la que los
// calcula, para que la pantalla no ofrezca un hueco que después se
// rechaza.
// ---------------------------------------------------------------------
citasRouter.get("/huecos", async (req, res) => {
  const { fecha, medicoId, duracionMinutos, salaId, tipoCitaId } = req.query as Record<
    string,
    string | undefined
  >;
  if (!fecha || !medicoId) {
    return res.status(400).json({ error: "Faltan fecha y medicoId." });
  }
  try {
    const huecos = await huecosLibres(req.db!, req.auth!.tenantId!, {
      fecha,
      medicoId,
      duracionMinutos: Number(duracionMinutos ?? 30),
      salaId: salaId ?? null,
      tipoCitaId: tipoCitaId ?? null,
    });
    res.json({ huecos });
  } catch (err) {
    console.error("GET /citas/huecos", err);
    res.status(500).json({ error: "Error al calcular los huecos libres." });
  }
});
