import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

export const pacientesRouter = Router();

pacientesRouter.use(authenticate, withTenantClient);

// Ampliado a admin_clinica — mismo motivo que propietarios.routes.ts
// (ver prompt_fix_agenda_permisos_paciente.md).
pacientesRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

// pacientes.especie sigue guardando el valor tal como lo manda el
// formulario ("Canino"/"Felino", mismo dato de siempre) — razas.especie
// usa la convención distinta ('canina'/'felina') que pidió el prompt de
// esa migración. Este mapeo es el único lugar donde se cruzan las dos.
const ESPECIE_PACIENTE_A_RAZA: Record<string, string> = {
  Canino: "canina",
  Felino: "felina",
};

// ---------------------------------------------------------------------
// POST /api/pacientes
// Alta de mascota nueva. razaId es opcional (igual que antes lo era
// `raza` en texto libre) pero si viene, se valida que exista y que
// corresponda a la misma especie declarada en el request. Los demás
// campos opcionales del modelo (sexo, edad_anios) quedan NULL — se
// completan después desde otra pantalla, fuera de este alcance.
// ---------------------------------------------------------------------
pacientesRouter.post("/", async (req, res) => {
  const { propietarioId, nombre, especie, razaId } = req.body as {
    propietarioId?: string;
    nombre?: string;
    especie?: string;
    razaId?: string;
  };

  if (!propietarioId || !nombre || !nombre.trim() || !especie || !especie.trim()) {
    return res.status(400).json({ error: "Faltan propietarioId, nombre o especie." });
  }

  try {
    let razaNombre: string | null = null;
    if (razaId) {
      const razaResult = await req.db!.query(`SELECT especie, nombre FROM razas WHERE id = $1`, [
        razaId,
      ]);
      if (razaResult.rows.length === 0) {
        return res.status(400).json({ error: "La raza seleccionada no existe." });
      }
      const especieEsperada = ESPECIE_PACIENTE_A_RAZA[especie.trim()];
      if (razaResult.rows[0].especie !== especieEsperada) {
        return res
          .status(400)
          .json({ error: "La raza seleccionada no corresponde a la especie indicada." });
      }
      razaNombre = razaResult.rows[0].nombre;
    }

    const result = await req.db!.query(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, raza_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, especie, raza_id`,
      [req.auth!.tenantId, propietarioId, nombre.trim(), especie.trim(), razaId || null]
    );

    res.status(201).json({ paciente: { ...result.rows[0], raza: razaNombre } });
  } catch (err) {
    console.error("POST /pacientes", err);
    res.status(500).json({ error: "Error al crear la mascota." });
  }
});

// ---------------------------------------------------------------------
// GET /api/pacientes/:id/historial-farmacologico
//
// Consulta SQL directa, sin IA — mezcla recetas de cualquier agente
// (GCIS, ICIS, u otros) a propósito: el historial es del paciente, no
// de un agente en particular. No filtra por médico emisor: cualquier
// médico del tenant puede ver el historial completo del paciente, igual
// que ya pueden buscar/ver el paciente en el wizard de "Nuevo Caso".
// ---------------------------------------------------------------------
pacientesRouter.get("/:id/historial-farmacologico", async (req, res) => {
  try {
    const filasResult = await req.db!.query(
      `SELECT r.id AS receta_id, r.emitido_en, m.nombre AS medico_nombre,
              (r.validacion_ia IS NOT NULL) AS fue_validada,
              ri.medicamento_id, med.nombre AS medicamento_nombre,
              ri.dosis, ri.frecuencia, ri.duracion, ri.orden
       FROM recetas r
       JOIN personas m ON m.id = r.medico_id
       JOIN receta_items ri ON ri.receta_id = r.id
       JOIN medicamentos med ON med.id = ri.medicamento_id
       WHERE r.paciente_id = $1 AND r.estado = 'emitida'
       ORDER BY r.emitido_en DESC, ri.orden ASC`,
      [req.params.id]
    );

    const recetasPorId = new Map<
      string,
      {
        id: string;
        emitido_en: string;
        medico_nombre: string;
        fue_validada: boolean;
        items: { medicamento_id: string; medicamento_nombre: string; dosis: string; frecuencia: string; duracion: string }[];
      }
    >();
    const conteoMedicamentos = new Map<string, { nombre: string; veces: number }>();

    for (const fila of filasResult.rows) {
      if (!recetasPorId.has(fila.receta_id)) {
        recetasPorId.set(fila.receta_id, {
          id: fila.receta_id,
          emitido_en: fila.emitido_en,
          medico_nombre: fila.medico_nombre,
          fue_validada: fila.fue_validada,
          items: [],
        });
      }
      recetasPorId.get(fila.receta_id)!.items.push({
        medicamento_id: fila.medicamento_id,
        medicamento_nombre: fila.medicamento_nombre,
        dosis: fila.dosis,
        frecuencia: fila.frecuencia,
        duracion: fila.duracion,
      });

      const actual = conteoMedicamentos.get(fila.medicamento_id) ?? { nombre: fila.medicamento_nombre, veces: 0 };
      actual.veces += 1;
      conteoMedicamentos.set(fila.medicamento_id, actual);
    }

    res.json({
      recetas: Array.from(recetasPorId.values()),
      medicamentosRepetidos: Array.from(conteoMedicamentos.entries()).map(([medicamentoId, datos]) => ({
        medicamentoId,
        nombre: datos.nombre,
        veces: datos.veces,
      })),
    });
  } catch (err) {
    console.error("GET /pacientes/:id/historial-farmacologico", err);
    res.status(500).json({ error: "Error al obtener el historial farmacológico." });
  }
});

// ---------------------------------------------------------------------
// POST /api/pacientes/:id/cuidados-preventivos
// GET  /api/pacientes/:id/cuidados-preventivos
//
// prompt_code_notificaciones_pendientes.md, Parte A — segundo tipo
// ('vacunacion'), con vacuna obligatoria y lote opcional (solo lo que la
// vacunación necesita y la desparasitación no; ver migración 055). El
// job diario de notificaciones lee de esta misma tabla, nunca la
// modifica.
// ---------------------------------------------------------------------
pacientesRouter.post("/:id/cuidados-preventivos", async (req, res) => {
  const { tipo, fechaAplicacion, fechaProximaRecomendada, vacuna, lote } = req.body as {
    tipo?: "desparasitacion" | "vacunacion";
    fechaAplicacion?: string;
    fechaProximaRecomendada?: string;
    vacuna?: string;
    lote?: string;
  };

  if (!tipo || !fechaAplicacion || !fechaProximaRecomendada) {
    return res.status(400).json({ error: "Faltan tipo, fechaAplicacion o fechaProximaRecomendada." });
  }
  if (tipo !== "desparasitacion" && tipo !== "vacunacion") {
    return res.status(400).json({ error: "El tipo debe ser 'desparasitacion' o 'vacunacion'." });
  }
  if (tipo === "vacunacion" && !vacuna?.trim()) {
    return res.status(400).json({ error: "Falta indicar qué vacuna se aplicó." });
  }

  try {
    const result = await req.db!.query(
      `INSERT INTO cuidados_preventivos
         (tenant_id, paciente_id, tipo, fecha_aplicacion, fecha_proxima_recomendada, registrado_por, vacuna, lote)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tipo, fecha_aplicacion, fecha_proxima_recomendada, registrado_por, creado_en, vacuna, lote`,
      [
        req.auth!.tenantId,
        req.params.id,
        tipo,
        fechaAplicacion,
        fechaProximaRecomendada,
        req.auth!.userId,
        tipo === "vacunacion" ? vacuna!.trim() : null,
        tipo === "vacunacion" ? lote?.trim() || null : null,
      ]
    );
    res.status(201).json({ cuidadoPreventivo: result.rows[0] });
  } catch (err) {
    console.error("POST /pacientes/:id/cuidados-preventivos", err);
    res.status(500).json({ error: "Error al registrar el cuidado preventivo." });
  }
});

pacientesRouter.get("/:id/cuidados-preventivos", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT cp.id, cp.tipo, cp.fecha_aplicacion, cp.fecha_proxima_recomendada, cp.creado_en,
              cp.vacuna, cp.lote, per.nombre AS registrado_por_nombre
       FROM cuidados_preventivos cp
       JOIN personas per ON per.id = cp.registrado_por
       WHERE cp.paciente_id = $1
       ORDER BY cp.fecha_aplicacion DESC`,
      [req.params.id]
    );
    res.json({ cuidadosPreventivos: result.rows });
  } catch (err) {
    console.error("GET /pacientes/:id/cuidados-preventivos", err);
    res.status(500).json({ error: "Error al obtener los cuidados preventivos." });
  }
});
