import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { obtenerOCrearAtencionParaCita, guardarAtencion } from "../atencion";
import { crearRecetaConItems, ItemRecetaInput } from "./casos.routes";

// prompt_code_registro_atencion.md — módulo de Registro de Atención.
// Gate esMedico (no esAdminClinica): registrar lo que pasó en una
// visita — nota, peso, vacunas, receta — es un acto clínico del
// veterinario, mismo criterio que recetasRouter.
export const atencionesRouter = Router();

atencionesRouter.use(authenticate, withTenantClient);

atencionesRouter.use((req, res, next) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }
  next();
});

// ---------------------------------------------------------------------
// GET /api/atenciones/catalogo-enfermedades?especie=canino|felino
// Catálogo de plataforma, no editable por las clínicas.
// ---------------------------------------------------------------------
atencionesRouter.get("/catalogo-enfermedades", async (req, res) => {
  const especie = req.query.especie as string | undefined;
  if (especie !== "canino" && especie !== "felino") {
    return res.status(400).json({ error: "especie debe ser 'canino' o 'felino'." });
  }
  try {
    const result = await req.db!.query(
      `SELECT id, especie, nombre FROM enfermedades_vacuna WHERE especie = $1 ORDER BY nombre`,
      [especie]
    );
    res.json({ enfermedades: result.rows });
  } catch (err) {
    console.error("GET /atenciones/catalogo-enfermedades", err);
    res.status(500).json({ error: "Error al listar el catálogo de enfermedades." });
  }
});

// ---------------------------------------------------------------------
// POST /api/atenciones — get-or-create sobre una cita. body: { citaId }
// ---------------------------------------------------------------------
atencionesRouter.post("/", async (req, res) => {
  const { citaId } = req.body as { citaId?: string };
  if (!citaId) {
    return res.status(400).json({ error: "Falta citaId." });
  }
  try {
    const citaResult = await req.db!.query(
      `SELECT c.id, c.caso_id, c.medico_id, p.nombre AS paciente_nombre, p.especie
       FROM citas c JOIN pacientes p ON p.id = c.paciente_id
       WHERE c.id = $1`,
      [citaId]
    );
    if (citaResult.rows.length === 0) {
      return res.status(404).json({ error: "Cita no encontrada." });
    }
    const { atencion, error, status } = await obtenerOCrearAtencionParaCita(req.db!, citaId, req.auth!.userId);
    if (error) {
      return res.status(status ?? 500).json({ error });
    }
    res.status(201).json({ atencion, cita: citaResult.rows[0] });
  } catch (err) {
    console.error("POST /atenciones", err);
    res.status(500).json({ error: "Error al abrir el registro de atención." });
  }
});

async function obtenerAtencionDetalle(db: import("pg").PoolClient, atencionId: string, medicoId: string) {
  const atencionResult = await db.query(
    `SELECT a.*, c.caso_id
     FROM atenciones a
     JOIN citas c ON c.id = a.cita_id
     WHERE a.id = $1 AND a.medico_id = $2`,
    [atencionId, medicoId]
  );
  if (atencionResult.rows.length === 0) return null;
  const atencion = atencionResult.rows[0];

  const [recetas, cuidados] = await Promise.all([
    db.query(
      `SELECT r.id, r.estado, r.emitido_en, r.instrucciones_generales, r.instrucciones_propietario
       FROM recetas r WHERE r.atencion_id = $1 ORDER BY r.creado_en DESC`,
      [atencionId]
    ),
    db.query(
      `SELECT cp.id, cp.tipo, cp.fecha_aplicacion, cp.fecha_proxima_recomendada, cp.vacuna, cp.lote,
              cp.subtipo_desparasitacion, cp.producto_desparasitacion
       FROM cuidados_preventivos cp WHERE cp.atencion_id = $1 ORDER BY cp.creado_en DESC`,
      [atencionId]
    ),
  ]);

  return { atencion, recetas: recetas.rows, cuidados: cuidados.rows };
}

// ---------------------------------------------------------------------
// GET /api/atenciones/:id
// ---------------------------------------------------------------------
atencionesRouter.get("/:id", async (req, res) => {
  try {
    const datos = await obtenerAtencionDetalle(req.db!, req.params.id, req.auth!.userId);
    if (!datos) {
      return res.status(404).json({ error: "Atención no encontrada." });
    }
    res.json(datos);
  } catch (err) {
    console.error("GET /atenciones/:id", err);
    res.status(500).json({ error: "Error al obtener la atención." });
  }
});

// ---------------------------------------------------------------------
// PUT /api/atenciones/:id — guarda nota/peso/temperatura. Todo opcional.
// ---------------------------------------------------------------------
atencionesRouter.put("/:id", async (req, res) => {
  const { notaMedica, peso, temperatura } = req.body as {
    notaMedica?: string | null;
    peso?: number | null;
    temperatura?: number | null;
  };
  try {
    const propia = await req.db!.query(`SELECT id FROM atenciones WHERE id = $1 AND medico_id = $2`, [
      req.params.id,
      req.auth!.userId,
    ]);
    if (propia.rows.length === 0) {
      return res.status(404).json({ error: "Atención no encontrada." });
    }
    const resultado = await guardarAtencion(req.db!, req.params.id, { notaMedica, peso, temperatura });
    if ("error" in resultado) {
      return res.status(resultado.status).json({ error: resultado.error });
    }
    res.json({ atencion: resultado.atencion });
  } catch (err) {
    console.error("PUT /atenciones/:id", err);
    res.status(500).json({ error: "Error al guardar la atención." });
  }
});

// ---------------------------------------------------------------------
// POST /api/atenciones/:id/recetas
// caso_id se resuelve de la cita de la atención — si esa cita está
// ligada a un caso, la receta también queda visible en el contexto de IA
// y la cronología de ese caso (ambos filtran por recetas.caso_id, sin
// tocarlos). Si no hay caso, caso_id queda null — receta legítima sin
// caso, ver prompt_code_registro_atencion.md Paso 3.
// ---------------------------------------------------------------------
atencionesRouter.post("/:id/recetas", async (req, res) => {
  const { instruccionesGenerales, instruccionesPropietario, items } = req.body as {
    instruccionesGenerales?: string;
    instruccionesPropietario?: string;
    items?: ItemRecetaInput[];
  };
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "La receta necesita al menos un medicamento." });
  }

  try {
    const atencionResult = await req.db!.query(
      `SELECT a.id, a.paciente_id, c.caso_id
       FROM atenciones a JOIN citas c ON c.id = a.cita_id
       WHERE a.id = $1 AND a.medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (atencionResult.rows.length === 0) {
      return res.status(404).json({ error: "Atención no encontrada." });
    }
    const atencion = atencionResult.rows[0];

    const { receta, items: itemsGuardados } = await crearRecetaConItems(req.db!, {
      tenantId: req.auth!.tenantId!,
      casoId: atencion.caso_id ?? null,
      atencionId: atencion.id,
      pacienteId: atencion.paciente_id,
      medicoId: req.auth!.userId,
      instruccionesGenerales,
      instruccionesPropietario,
      items,
    });

    if (atencion.caso_id) {
      await req.db!.query(`UPDATE casos SET actualizado_en = now() WHERE id = $1`, [atencion.caso_id]);
    }

    res.status(201).json({ receta, items: itemsGuardados });
  } catch (err) {
    console.error("POST /atenciones/:id/recetas", err);
    res.status(500).json({ error: "Error al crear la receta." });
  }
});
