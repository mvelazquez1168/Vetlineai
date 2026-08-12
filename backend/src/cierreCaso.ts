import { PoolClient } from "pg";

// prompt_code_cierre_caso.md, Paso 2 — módulo único reusado por el endpoint
// del médico (casosRouter, dueño del caso) y el del administrador de
// clínica (adminRouter, cualquier caso del tenant): ambos verifican
// pertenencia con su propio WHERE y después llaman a esta misma función, en
// vez de duplicar la lógica de cierre en dos routers con gates de rol
// distintos (casosRouter exige esMedico, adminRouter exige esAdminClinica —
// ver el comentario de cabecera de cada endpoint).

export type Desenlace = "resuelto" | "derivado" | "en_control" | "fallecido";
const DESENLACES_VALIDOS: Desenlace[] = ["resuelto", "derivado", "en_control", "fallecido"];

export interface CerrarCasoInput {
  diagnosticoFinal: string;
  tratamientoActivo: boolean;
  tratamientoActivoDetalle: string | null;
  desenlace: Desenlace;
  marcarPacienteFallecido: boolean;
  fechaFallecimiento: string | null;
}

type ValidacionCerrarCaso =
  | { valido: true; input: CerrarCasoInput }
  | { valido: false; error: string };

// La conexión entre desenlace='fallecido' y el paciente es OFRECIDA y
// CONFIRMADA por el médico en el mismo formulario de cierre (checkbox +
// fecha), nunca automática — por eso marcarPacienteFallecido/fechaFallecimiento
// viajan sueltos en el body en vez de derivarse solo de desenlace==='fallecido'.
export function validarCerrarCasoInput(body: unknown): ValidacionCerrarCaso {
  const {
    diagnosticoFinal,
    tratamientoActivo,
    tratamientoActivoDetalle,
    desenlace,
    marcarPacienteFallecido,
    fechaFallecimiento,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof diagnosticoFinal !== "string" || !diagnosticoFinal.trim()) {
    return { valido: false, error: "Falta el diagnóstico final." };
  }
  if (typeof tratamientoActivo !== "boolean") {
    return { valido: false, error: "Falta indicar si el caso queda con tratamiento activo." };
  }
  if (tratamientoActivo && (typeof tratamientoActivoDetalle !== "string" || !tratamientoActivoDetalle.trim())) {
    return { valido: false, error: "Falta el detalle del tratamiento activo." };
  }
  if (typeof desenlace !== "string" || !DESENLACES_VALIDOS.includes(desenlace as Desenlace)) {
    return { valido: false, error: "Desenlace inválido." };
  }
  const marcarFallecido = desenlace === "fallecido" && marcarPacienteFallecido === true;
  if (marcarFallecido && (typeof fechaFallecimiento !== "string" || !fechaFallecimiento)) {
    return { valido: false, error: "Falta la fecha de fallecimiento para marcar al paciente." };
  }

  return {
    valido: true,
    input: {
      diagnosticoFinal: diagnosticoFinal.trim(),
      tratamientoActivo,
      tratamientoActivoDetalle: tratamientoActivo ? (tratamientoActivoDetalle as string).trim() : null,
      desenlace: desenlace as Desenlace,
      marcarPacienteFallecido: marcarFallecido,
      fechaFallecimiento: marcarFallecido ? (fechaFallecimiento as string) : null,
    },
  };
}

// Asume que el llamador ya confirmó que el caso existe, pertenece a quien
// corresponde (médico dueño o admin del tenant), y no está ya 'completado'
// — ese chequeo depende del WHERE de cada router y no se repite acá.
export async function ejecutarCierreCaso(
  db: PoolClient,
  casoId: string,
  pacienteId: string,
  input: CerrarCasoInput,
  cerradoPor: string
): Promise<{
  caso: {
    id: string;
    estado: string;
    diagnostico_final: string;
    tratamiento_activo: boolean;
    tratamiento_activo_detalle: string | null;
    desenlace: Desenlace;
    cerrado_por: string;
    cerrado_en: Date;
  };
  pacienteMarcadoFallecido: boolean;
}> {
  const casoResult = await db.query(
    `UPDATE casos
     SET estado = 'completado',
         diagnostico_final = $1,
         tratamiento_activo = $2,
         tratamiento_activo_detalle = $3,
         desenlace = $4,
         cerrado_por = $5,
         cerrado_en = now(),
         actualizado_en = now(),
         -- Un cierre nuevo reemplaza al anterior como "el" cierre vigente
         -- del caso — la marca de la última reapertura queda desactualizada
         -- en cuanto se vuelve a cerrar, así que se limpia acá para no
         -- mostrar un "reabierto el X" viejo junto a un cierre reciente.
         motivo_reapertura = NULL,
         reabierto_por = NULL,
         reabierto_en = NULL
     WHERE id = $6
     RETURNING id, estado, diagnostico_final, tratamiento_activo, tratamiento_activo_detalle, desenlace, cerrado_por, cerrado_en`,
    [
      input.diagnosticoFinal,
      input.tratamientoActivo,
      input.tratamientoActivoDetalle,
      input.desenlace,
      cerradoPor,
      casoId,
    ]
  );

  // Mismo UPDATE que PATCH /api/pacientes/:id/estado (pacientes.routes.ts)
  // — no se llama a ese endpoint desde acá porque cruzar routers HTTP
  // internamente no aporta nada; el WHERE estado='activo' es el mismo
  // guard (nunca pisa una fecha de fallecimiento ya registrada).
  let pacienteMarcadoFallecido = false;
  if (input.marcarPacienteFallecido && input.fechaFallecimiento) {
    const pacienteResult = await db.query(
      `UPDATE pacientes SET estado = 'fallecido', fecha_fallecimiento = $1
       WHERE id = $2 AND estado = 'activo'`,
      [input.fechaFallecimiento, pacienteId]
    );
    pacienteMarcadoFallecido = (pacienteResult.rowCount ?? 0) > 0;
  }

  return { caso: casoResult.rows[0], pacienteMarcadoFallecido };
}

// ---------------------------------------------------------------------
// prompt_code_cierre_caso.md, Paso 3 — Reabrir. "Con motivo, y registrando
// quién lo hizo y cuándo." Lo capturado en el cierre (diagnóstico final,
// tratamiento activo, desenlace, cerrado_por/cerrado_en) NO se toca acá —
// queda como historia del cierre anterior hasta que el caso se cierre de
// nuevo (momento en el que ejecutarCierreCaso sí lo reemplaza).
//
// estado vuelve siempre a 'en_curso', nunca a 'triage': un caso reabierto
// está, por definición, en trabajo — no "recién creado". No existe forma
// de reconstruir en qué estado exacto estaba antes del cierre (pudo
// cerrarse desde triage sin haber tenido nunca un primer análisis), así
// que 'en_curso' es la única opción consistente con lo que esos tres
// valores significan (ver prompt_code_cierre_caso.md, Paso 2).
// ---------------------------------------------------------------------
export type ValidacionReabrirCaso =
  | { valido: true; motivo: string }
  | { valido: false; error: string };

export function validarReabrirCasoInput(body: unknown): ValidacionReabrirCaso {
  const { motivo } = (body ?? {}) as Record<string, unknown>;
  if (typeof motivo !== "string" || !motivo.trim()) {
    return { valido: false, error: "Falta el motivo de la reapertura." };
  }
  return { valido: true, motivo: motivo.trim() };
}

export async function ejecutarReaperturaCaso(
  db: PoolClient,
  casoId: string,
  motivo: string,
  reabiertoPor: string
): Promise<{
  id: string;
  estado: string;
  motivo_reapertura: string;
  reabierto_por: string;
  reabierto_en: Date;
}> {
  const result = await db.query(
    `UPDATE casos
     SET estado = 'en_curso',
         motivo_reapertura = $1,
         reabierto_por = $2,
         reabierto_en = now(),
         actualizado_en = now()
     WHERE id = $3
     RETURNING id, estado, motivo_reapertura, reabierto_por, reabierto_en`,
    [motivo, reabiertoPor, casoId]
  );
  return result.rows[0];
}
