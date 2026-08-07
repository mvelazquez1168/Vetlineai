import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Configuración semanal de horarios por médico (horarios_configuracion,
// un row por medico_id+dia_semana). tenant_id directo, sin clinica_id
// (ver nota de diseño en la migración 017).
// ---------------------------------------------------------------------
export const horariosRouter = Router();

horariosRouter.use(authenticate, withTenantClient);

horariosRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

// GET /api/horarios?medicoId=... — sin medicoId, devuelve la
// configuración de todos los médicos del tenant (RLS ya scopea).
horariosRouter.get("/", async (req, res) => {
  try {
    const medicoId = req.query.medicoId as string | undefined;
    const result = await req.db!.query(
      medicoId
        ? `SELECT h.*, p.nombre AS medico_nombre
           FROM horarios_configuracion h
           JOIN personas p ON p.id = h.medico_id
           WHERE h.medico_id = $1
           ORDER BY h.dia_semana ASC`
        : `SELECT h.*, p.nombre AS medico_nombre
           FROM horarios_configuracion h
           JOIN personas p ON p.id = h.medico_id
           ORDER BY p.nombre ASC, h.dia_semana ASC`,
      medicoId ? [medicoId] : []
    );
    res.json({ horarios: result.rows });
  } catch (err) {
    console.error("GET /horarios", err);
    res.status(500).json({ error: "Error al obtener los horarios." });
  }
});

interface DiaConfigInput {
  diaSemana: number;
  bloques: { hora_inicio: string; hora_fin: string; tipo: string; etiqueta?: string | null }[];
  activo?: boolean;
  maxCitasDia?: number | null;
  duracionDefaultMinutos?: number;
  bufferMinutos?: number;
  aceptaEmergencias?: boolean;
}

// PUT /api/horarios — upsert de uno o más días para un médico en una
// sola llamada (la pantalla de Configuración de Horarios guarda toda la
// semana visible de una vez con "Aplicar Configuración").
horariosRouter.put("/", async (req, res) => {
  const { medicoId, dias } = req.body as { medicoId?: string; dias?: DiaConfigInput[] };
  if (!medicoId || !dias || dias.length === 0) {
    return res.status(400).json({ error: "Faltan medicoId o dias." });
  }

  // Un médico solo puede tocar su propio horario — poder VER el
  // calendario general (ver prompt_fix_agenda_permisos_paciente.md) no
  // implica poder editar la configuración de otro médico. admin_clinica
  // sigue sin esta restricción (incluida una persona que es admin_clinica
  // Y médico a la vez: como admin, gestiona el horario de toda la clínica).
  if (!req.auth!.esAdminClinica && medicoId !== req.auth!.userId) {
    return res.status(403).json({ error: "Solo podés editar tu propia configuración de horarios." });
  }

  try {
    const filas = [];
    for (const dia of dias) {
      const result = await req.db!.query(
        `INSERT INTO horarios_configuracion
           (tenant_id, medico_id, dia_semana, bloques, activo, max_citas_dia,
            duracion_default_minutos, buffer_minutos, acepta_emergencias)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (medico_id, dia_semana) DO UPDATE SET
           bloques = EXCLUDED.bloques,
           activo = EXCLUDED.activo,
           max_citas_dia = EXCLUDED.max_citas_dia,
           duracion_default_minutos = EXCLUDED.duracion_default_minutos,
           buffer_minutos = EXCLUDED.buffer_minutos,
           acepta_emergencias = EXCLUDED.acepta_emergencias
         RETURNING *`,
        [
          req.auth!.tenantId,
          medicoId,
          dia.diaSemana,
          JSON.stringify(dia.bloques ?? []),
          dia.activo ?? true,
          dia.maxCitasDia ?? null,
          dia.duracionDefaultMinutos ?? 30,
          dia.bufferMinutos ?? 0,
          dia.aceptaEmergencias ?? true,
        ]
      );
      filas.push(result.rows[0]);
    }
    res.json({ horarios: filas });
  } catch (err) {
    console.error("PUT /horarios", err);
    res.status(500).json({ error: "Error al guardar los horarios." });
  }
});
