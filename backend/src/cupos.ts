import { fechaEnZona } from "./fecha";
import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------
// Flujos de suscripción, Flujo A — gestión de cupos de agentes y médicos
// del administrador de clínica. Sigue el patrón de módulos planos del
// proyecto (tarifas.ts, facturacion.ts): funciones exportadas sueltas,
// sin clases.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export type MotivoRechazoCupo =
  | "sin_cupo_agentes"
  | "sin_cupo_medicos"
  | "freno_anti_rotacion"
  | "agente_con_casos"
  | "agente_no_encontrado"
  | "agente_discontinuado"
  | "agente_en_mantenimiento";

export interface ResultadoCupo {
  permitido: boolean;
  motivo?: MotivoRechazoCupo;
  disponibleDesde?: Date; // solo para freno_anti_rotacion
}

export interface ConteoCupos {
  agentesContratados: number | null; // null = plan Full, todos los del catálogo
  agentesEnUso: number;
  agentesDisponibles: number | null; // null si Full (ilimitado)
  agentesExceso: number; // > 0 si agentesEnUso supera agentesContratados
  medicosContratados: number;
  medicosActivos: number;
  medicosDisponibles: number;
  medicosExceso: number;
}

interface SuscripcionCupos {
  suscripcionId: string;
  periodoInicio: Date;
  agentesContratados: number | null;
  medicosContratados: number;
}

async function resolverSuscripcionCupos(db: EjecutorSql, tenantId: string): Promise<SuscripcionCupos | null> {
  const result = await db.query(
    `SELECT s.id, s.periodo_inicio, s.agentes_contratados, s.medicos_contratados
     FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE t.id = $1`,
    [tenantId]
  );
  const fila = result.rows[0];
  if (!fila) return null;
  return {
    suscripcionId: fila.id,
    periodoInicio: new Date(fila.periodo_inicio),
    agentesContratados: fila.agentes_contratados != null ? Number(fila.agentes_contratados) : null,
    medicosContratados: Number(fila.medicos_contratados),
  };
}

// PASO 1 — Contador de cupos.
export async function obtenerConteoCupos(db: EjecutorSql, tenantId: string): Promise<ConteoCupos | null> {
  const suscripcion = await resolverSuscripcionCupos(db, tenantId);
  if (!suscripcion) return null;

  const agentesEnUsoResult = await db.query(
    `SELECT COUNT(*) FROM tenant_agentes WHERE tenant_id = $1 AND estado = 'habilitado'`,
    [tenantId]
  );
  const agentesEnUso = Number(agentesEnUsoResult.rows[0].count);

  // Médicos activos = personas con es_medico true y estado activo. Un
  // administrador que no es médico (es_medico=false) no consume cupo, así
  // que queda afuera de este conteo a propósito.
  const medicosActivosResult = await db.query(
    `SELECT COUNT(*) FROM personas WHERE tenant_id = $1 AND es_medico = true AND estado = 'activo'`,
    [tenantId]
  );
  const medicosActivos = Number(medicosActivosResult.rows[0].count);

  const agentesDisponibles =
    suscripcion.agentesContratados != null ? suscripcion.agentesContratados - agentesEnUso : null;
  const agentesExceso =
    suscripcion.agentesContratados != null ? Math.max(agentesEnUso - suscripcion.agentesContratados, 0) : 0;
  const medicosDisponibles = suscripcion.medicosContratados - medicosActivos;
  const medicosExceso = Math.max(medicosActivos - suscripcion.medicosContratados, 0);

  return {
    agentesContratados: suscripcion.agentesContratados,
    agentesEnUso,
    agentesDisponibles,
    agentesExceso,
    medicosContratados: suscripcion.medicosContratados,
    medicosActivos,
    medicosDisponibles,
    medicosExceso,
  };
}

// PASO 3 — Freno anti-rotación. Un parámetro de plataforma
// (agentes.cambios_por_ciclo, hoy 1) limita cuántos cambios de agente por
// ciclo de facturación puede hacer una clínica.
//
// DECISIÓN (pedida explícitamente en el prompt, con criterio dado):
// habilitar un agente en un cupo vacío NO consume ni verifica el cambio;
// solo DESHABILITAR lo consume, porque es la acción que libera cupo y
// permite rotar — es la acción escasa. Si habilitar también verificara el
// freno, un swap normal (deshabilitar X, habilitar Y en el mismo período)
// se rompería: el habilitar de Y quedaría bloqueado por el
// periodo_ultimo_cambio que el propio deshabilitar de X acaba de fijar.
async function verificarFrenoAntiRotacion(db: EjecutorSql, tenantId: string): Promise<ResultadoCupo> {
  const suscripcion = await resolverSuscripcionCupos(db, tenantId);
  if (!suscripcion) return { permitido: true };

  const parametroResult = await db.query(
    `SELECT valor FROM parametros_plataforma WHERE clave = 'agentes.cambios_por_ciclo'`
  );
  const cambiosPorCiclo = Number(parametroResult.rows[0]?.valor ?? 1);

  const cambiosResult = await db.query(
    `SELECT COUNT(*) FROM tenant_agentes
     WHERE tenant_id = $1 AND periodo_ultimo_cambio >= $2`,
    [tenantId, suscripcion.periodoInicio.toISOString()]
  );
  const cambiosEnPeriodo = Number(cambiosResult.rows[0].count);

  if (cambiosEnPeriodo >= cambiosPorCiclo) {
    // Disponible desde el próximo período — hoy eso es periodo_fin de la
    // suscripción vigente (el trabajo del ciclo, bloque 5, es lo que
    // avanza periodo_inicio a esa fecha).
    const periodoFinResult = await db.query(`SELECT periodo_fin FROM suscripciones WHERE id = $1`, [
      suscripcion.suscripcionId,
    ]);
    return {
      permitido: false,
      motivo: "freno_anti_rotacion",
      disponibleDesde: new Date(periodoFinResult.rows[0].periodo_fin),
    };
  }
  return { permitido: true };
}

// PASO 2 — Deshabilitar un agente.
//
// agentes_paises_v2, Paso 2, último bullet: un agente en mantenimiento NO
// puede ser desactivado por la clínica — si se permitiera, la clínica
// liberaría el cupo y consumiría su cambio del período por un agente que
// va a volver en unos días. Este chequeo tiene que vivir acá (no solo en
// el frontend, que ya oculta la acción) porque es la única frontera real.
export async function deshabilitarAgente(
  db: EjecutorSql,
  tenantId: string,
  agenteId: string
): Promise<ResultadoCupo> {
  const agenteGlobal = await db.query(`SELECT estado FROM agentes WHERE id = $1`, [agenteId]);
  if (agenteGlobal.rows[0]?.estado === "mantenimiento") {
    return { permitido: false, motivo: "agente_en_mantenimiento" };
  }

  const freno = await verificarFrenoAntiRotacion(db, tenantId);
  if (!freno.permitido) return freno;

  const result = await db.query(
    `UPDATE tenant_agentes
     SET estado = 'deshabilitado', deshabilitado_en = now(), periodo_ultimo_cambio = now(), actualizado_en = now()
     WHERE tenant_id = $1 AND agente_id = $2
     RETURNING id`,
    [tenantId, agenteId]
  );
  if (result.rows.length === 0) {
    return { permitido: false, motivo: "agente_no_encontrado" };
  }
  return { permitido: true };
}

// PASO 5 — Habilitar un agente. Sin chequeo de freno (ver comentario de
// verificarFrenoAntiRotacion) — solo verifica cupo disponible.
//
// agentes_paises_v2, Paso 2: un agente DISCONTINUADO no puede ser adoptado
// por una clínica que nunca lo tuvo, pero una clínica que ya lo tuvo
// (fila existente en tenant_agentes, aunque esté deshabilitada) SÍ puede
// volver a activarlo. MANTENIMIENTO no bloquea esta acción — solo
// congela la generación (ver tarifas.ts) mientras dure, la clínica puede
// seguir agregándolo/reactivándolo con normalidad.
export async function habilitarAgente(db: EjecutorSql, tenantId: string, agenteId: string): Promise<ResultadoCupo> {
  const conteo = await obtenerConteoCupos(db, tenantId);
  if (conteo && conteo.agentesDisponibles != null && conteo.agentesDisponibles <= 0) {
    return { permitido: false, motivo: "sin_cupo_agentes" };
  }

  const existente = await db.query(`SELECT id FROM tenant_agentes WHERE tenant_id = $1 AND agente_id = $2`, [
    tenantId,
    agenteId,
  ]);

  if (existente.rows.length === 0) {
    const agenteResult = await db.query(`SELECT estado FROM agentes WHERE id = $1`, [agenteId]);
    if (agenteResult.rows[0]?.estado === "discontinuado") {
      return { permitido: false, motivo: "agente_discontinuado" };
    }
    await db.query(
      `INSERT INTO tenant_agentes (tenant_id, agente_id, estado, habilitado_en)
       VALUES ($1, $2, 'habilitado', now())`,
      [tenantId, agenteId]
    );
    return { permitido: true };
  }

  await db.query(
    `UPDATE tenant_agentes
     SET estado = 'habilitado', habilitado_en = now(), actualizado_en = now()
     WHERE tenant_id = $1 AND agente_id = $2`,
    [tenantId, agenteId]
  );
  return { permitido: true };
}

// PASO 4 — Eliminar un agente. Solo si no tiene casos registrados.
export async function eliminarAgente(db: EjecutorSql, tenantId: string, agenteId: string): Promise<ResultadoCupo> {
  const casosResult = await db.query(`SELECT 1 FROM casos WHERE tenant_id = $1 AND agente_id = $2 LIMIT 1`, [
    tenantId,
    agenteId,
  ]);
  if (casosResult.rows.length > 0) {
    return { permitido: false, motivo: "agente_con_casos" };
  }

  const result = await db.query(`DELETE FROM tenant_agentes WHERE tenant_id = $1 AND agente_id = $2 RETURNING id`, [
    tenantId,
    agenteId,
  ]);
  if (result.rows.length === 0) {
    return { permitido: false, motivo: "agente_no_encontrado" };
  }
  return { permitido: true };
}

// PASO 6 — Alta de médicos contra el cupo del plan. Un usuario
// administrador sin es_medico no consume cupo y puede crearse siempre —
// esta función solo se llama para altas de médico, nunca para admins.
export async function verificarCupoMedico(db: EjecutorSql, tenantId: string): Promise<ResultadoCupo> {
  const conteo = await obtenerConteoCupos(db, tenantId);
  if (conteo && conteo.medicosDisponibles <= 0) {
    return { permitido: false, motivo: "sin_cupo_medicos" };
  }
  return { permitido: true };
}

export function mensajeRechazoCupo(resultado: ResultadoCupo): string {
  switch (resultado.motivo) {
    case "sin_cupo_agentes":
      return "No hay cupo de agentes disponible en tu plan — cambiá de plan para agregar más.";
    case "sin_cupo_medicos":
      return "No hay cupo de médicos disponible en tu plan — cambiá de plan para agregar más.";
    case "freno_anti_rotacion":
      return `Ya hiciste un cambio de agente en este período — vas a poder cambiar de nuevo a partir del ${resultado.disponibleDesde ? fechaEnZona(resultado.disponibleDesde, null) : "la próxima factura"}.`;
    case "agente_con_casos":
      return "Este agente tiene casos registrados — no se puede eliminar, solo deshabilitar.";
    case "agente_no_encontrado":
      return "El agente no está contratado por esta clínica.";
    case "agente_discontinuado":
      return "Este agente fue discontinuado y ya no se ofrece a nuevas clínicas.";
    case "agente_en_mantenimiento":
      return "Este agente está en mantenimiento — no se puede desactivar hasta que vuelva a estar disponible.";
    default:
      return "No se pudo completar la operación.";
  }
}
