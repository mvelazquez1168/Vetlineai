import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------
// Prompt agentes/países, Prompt A — punto único de gestión de
// medico_agente (antes disperso dentro de admin.routes.ts). Sigue el
// patrón de módulos planos del proyecto (tarifas.ts, cupos.ts):
// funciones exportadas sueltas, sin clases.
//
// medico_agente es la asignación OPERATIVA (qué agentes puede usar un
// médico puntual), distinta de tenant_agentes (el entitlement de la
// CLÍNICA — qué agentes contrató). El área de trabajo del médico
// (GET /api/workspace/agentes) consulta exclusivamente esta tabla.
//
// Regla de asignación (Paso 4 del prompt): NO es automática, salvo un
// único caso — el registrante que se da de alta como médico en el
// registro de la clínica, porque es el único médico que existe en ese
// momento y sin la asignación entraría a una pantalla vacía. De ahí en
// adelante, la decide el administrador desde "Gestionar accesos".
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export interface AccesoAgente {
  agenteId: string;
  agenteNombre: string;
  habilitado: boolean;
  rol: "general" | "especialista" | null;
}

export async function listarAccesosMedico(
  db: EjecutorSql,
  personaId: string,
  tenantId: string
): Promise<AccesoAgente[]> {
  const result = await db.query(
    `SELECT a.id AS "agenteId", a.nombre AS "agenteNombre",
            COALESCE(ma.habilitado, false) AS habilitado,
            ma.rol AS rol
     FROM tenant_agentes ta
     JOIN agentes a ON a.id = ta.agente_id
     LEFT JOIN medico_agente ma ON ma.agente_id = a.id AND ma.persona_id = $1
     WHERE ta.tenant_id = $2 AND ta.estado = 'habilitado'
     ORDER BY a.nombre`,
    [personaId, tenantId]
  );
  return result.rows;
}

export async function actualizarAccesosMedico(
  db: EjecutorSql,
  personaId: string,
  accesos: { agenteId: string; habilitado: boolean }[]
): Promise<void> {
  for (const { agenteId, habilitado } of accesos) {
    const updateResult = await db.query(
      `UPDATE medico_agente SET habilitado = $1
       WHERE persona_id = $2 AND agente_id = $3
       RETURNING id`,
      [habilitado, personaId, agenteId]
    );

    // Si el médico nunca tuvo asignación a este agente y se está
    // habilitando ahora, se crea la fila con rol 'general' por defecto.
    // Si se está deshabilitando y la fila no existe, no hay nada que
    // hacer: "sin fila" ya significa "sin acceso".
    if (updateResult.rows.length === 0 && habilitado) {
      await db.query(
        `INSERT INTO medico_agente (persona_id, agente_id, rol, habilitado)
         VALUES ($1, $2, 'general', true)`,
        [personaId, agenteId]
      );
    }
  }
}

export async function contarCuposConsumidos(db: EjecutorSql, tenantId: string): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) FROM medico_agente ma
     JOIN personas p ON p.id = ma.persona_id
     WHERE p.tenant_id = $1 AND ma.habilitado = true`,
    [tenantId]
  );
  return Number(result.rows[0].count);
}

// El único caso de asignación automática (ver nota de cabecera) — se usa
// exclusivamente desde registro.routes.ts, en la misma transacción que
// crea la persona del registrante-médico.
export async function asignarAgenteAlRegistrante(
  db: EjecutorSql,
  personaId: string,
  agenteId: string
): Promise<void> {
  await db.query(
    `INSERT INTO medico_agente (persona_id, agente_id, rol, habilitado)
     VALUES ($1, $2, 'general', true)
     ON CONFLICT (persona_id, agente_id) DO NOTHING`,
    [personaId, agenteId]
  );
}

export interface ResultadoReparacion {
  filasCreadas: number;
  clinicasAfectadas: number;
}

// Paso 3 — reparación puntual de los registros rotos (médicos activos con
// cero agentes asignados mientras su clínica sí tiene agentes
// habilitados). No es la regla permanente — eso es
// asignarAgenteAlRegistrante() más el flujo manual del administrador.
// Idempotente: un médico que ya tiene aunque sea un agente asignado no
// se toca, aunque le falten otros — esa curación queda a criterio del
// administrador, no es un dato roto.
export async function repararAsignacionesFaltantes(db: EjecutorSql): Promise<ResultadoReparacion> {
  const medicosSinAgentes = await db.query(
    `SELECT p.id AS persona_id, p.tenant_id
     FROM personas p
     WHERE p.es_medico = true AND p.estado = 'activo'
       AND NOT EXISTS (SELECT 1 FROM medico_agente ma WHERE ma.persona_id = p.id)`
  );

  let filasCreadas = 0;
  const clinicasAfectadas = new Set<string>();

  for (const medico of medicosSinAgentes.rows) {
    const insertResult = await db.query(
      `INSERT INTO medico_agente (persona_id, agente_id, rol, habilitado)
       SELECT $1, ta.agente_id, 'general', true
       FROM tenant_agentes ta
       WHERE ta.tenant_id = $2 AND ta.estado = 'habilitado'
       ON CONFLICT (persona_id, agente_id) DO NOTHING
       RETURNING id`,
      [medico.persona_id, medico.tenant_id]
    );
    if (insertResult.rows.length > 0) {
      filasCreadas += insertResult.rows.length;
      clinicasAfectadas.add(medico.tenant_id);
    }
  }

  return { filasCreadas, clinicasAfectadas: clinicasAfectadas.size };
}
