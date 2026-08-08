import { Pool, PoolClient } from "pg";
import { enviarEmail, resendConfigurado } from "./email";

// ---------------------------------------------------------------------
// Flujos de suscripción, Flujo B — downgrade programado y cancelación.
// Ninguno de los dos cobra (el upgrade sí, y depende de Tilopay — fuera
// de este archivo). Sigue el patrón de módulos planos del proyecto.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export type MotivoRechazoCambio =
  | "no_cabe_en_destino"
  | "cambio_no_encontrado"
  | "ya_no_programado"
  | "pago_pendiente";

export interface ResultadoCambio {
  permitido: boolean;
  motivo?: MotivoRechazoCambio;
  agentesSobran?: number;
  medicosSobran?: number;
  cambioId?: string;
}

interface SuscripcionVigente {
  id: string;
  periodoFin: Date;
  periodicidad: string;
}

async function resolverSuscripcionVigente(db: EjecutorSql, tenantId: string): Promise<SuscripcionVigente | null> {
  const result = await db.query(
    `SELECT s.id, s.periodo_fin, s.periodicidad
     FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE t.id = $1`,
    [tenantId]
  );
  const fila = result.rows[0];
  if (!fila) return null;
  return { id: fila.id, periodoFin: new Date(fila.periodo_fin), periodicidad: fila.periodicidad };
}

async function obtenerEmailAdminClinica(db: EjecutorSql, tenantId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT email FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true LIMIT 1`,
    [tenantId]
  );
  return result.rows[0]?.email ?? null;
}

async function notificarAdmin(db: EjecutorSql, tenantId: string, asunto: string, contenido: string): Promise<void> {
  if (!resendConfigurado()) return;
  try {
    const email = await obtenerEmailAdminClinica(db, tenantId);
    if (!email) return;
    await enviarEmail(email, asunto, contenido);
  } catch (err) {
    console.error(`[cambios] Fallo al notificar al administrador del tenant ${tenantId}`, err);
  }
}

// ---------------------------------------------------------------------
// PASO 1 — Solicitar un downgrade.
//
// DECISIÓN (pedida explícitamente, sin criterio dado): "solo puede existir
// un cambio programado por suscripción" — se eligió REEMPLAZAR el cambio
// programado existente (si lo hay, de cualquier tipo — downgrade o
// cancelación) en vez de rechazar la nueva solicitud. Motivo: es más
// consistente con cómo se espera que funcione un formulario de selección
// en la pantalla de plan y consumo — el admin corrigiendo su elección no
// debería tener que cancelar a mano antes de volver a intentar.
// ---------------------------------------------------------------------
export async function solicitarDowngrade(
  db: EjecutorSql,
  tenantId: string,
  personaId: string,
  params: { planDestinoId: string; periodicidadDestino?: string; agentesConservados: string[]; medicosConservados: string[] }
): Promise<ResultadoCambio> {
  const suscripcion = await resolverSuscripcionVigente(db, tenantId);
  if (!suscripcion) return { permitido: false, motivo: "cambio_no_encontrado" };

  // Rechazar, no cancelar. Un upgrade/conversión en 'espera_pago' tiene un
  // cobro ya enviado a la pasarela — cancelarlo acá dejaría un cargo
  // cobrado (o por confirmar) sin cambio de plan asociado. La ventana dura
  // segundos en el caso normal; pedirle al admin que reintente es más
  // simple que reversar un cobro ya hecho.
  const pagoPendienteResult = await db.query(
    `SELECT id FROM cambios_suscripcion WHERE suscripcion_id = $1 AND estado = 'espera_pago'`,
    [suscripcion.id]
  );
  if (pagoPendienteResult.rows.length > 0) {
    return { permitido: false, motivo: "pago_pendiente" };
  }

  const planResult = await db.query(
    `SELECT agentes_incluidos, medicos_incluidos FROM planes WHERE id = $1`,
    [params.planDestinoId]
  );
  const plan = planResult.rows[0];
  if (!plan) return { permitido: false, motivo: "cambio_no_encontrado" };

  const agentesDestino: number | null = plan.agentes_incluidos != null ? Number(plan.agentes_incluidos) : null;
  const medicosDestino: number = Number(plan.medicos_incluidos);

  const agentesSobran =
    agentesDestino != null ? Math.max(params.agentesConservados.length - agentesDestino, 0) : 0;
  const medicosSobran = Math.max(params.medicosConservados.length - medicosDestino, 0);
  if (agentesSobran > 0 || medicosSobran > 0) {
    return { permitido: false, motivo: "no_cabe_en_destino", agentesSobran, medicosSobran };
  }

  await db.query("BEGIN");
  try {
    // Reemplaza cualquier cambio programado existente para esta
    // suscripción (de cualquier tipo) — pero SOLO 'programado' (downgrade
    // o cancelación agendados a fin de período, nunca cobran). Un upgrade
    // o conversión con el cobro en tránsito vive en 'espera_pago' (ver
    // migración 056) y ya se rechazó más arriba antes de llegar acá — este
    // UPDATE nunca puede tocarlo, ni por casualidad de nombre de estado.
    await db.query(
      `UPDATE cambios_suscripcion SET estado = 'cancelado' WHERE suscripcion_id = $1 AND estado = 'programado'`,
      [suscripcion.id]
    );

    const cambioResult = await db.query(
      `INSERT INTO cambios_suscripcion
         (suscripcion_id, tipo, plan_destino_id, periodicidad_destino, agentes_destino, medicos_destino,
          estado, efectivo_en, solicitado_por)
       VALUES ($1, 'downgrade', $2, $3, $4, $5, 'programado', $6, $7)
       RETURNING id`,
      [
        suscripcion.id,
        params.planDestinoId,
        params.periodicidadDestino ?? null,
        agentesDestino,
        medicosDestino,
        suscripcion.periodoFin.toISOString(),
        personaId,
      ]
    );
    const cambioId = cambioResult.rows[0].id;

    for (const agenteId of params.agentesConservados) {
      await db.query(`INSERT INTO cambio_agentes_conservados (cambio_id, agente_id) VALUES ($1, $2)`, [
        cambioId,
        agenteId,
      ]);
    }
    for (const personaIdConservada of params.medicosConservados) {
      await db.query(`INSERT INTO cambio_medicos_conservados (cambio_id, persona_id) VALUES ($1, $2)`, [
        cambioId,
        personaIdConservada,
      ]);
    }

    await db.query("COMMIT");
    return { permitido: true, cambioId };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

// PASO 2 — Cancelar el cambio programado (downgrade o cancelación),
// antes de efectivo_en. La suscripción sigue exactamente como estaba —
// para el tipo 'cancelacion' eso incluye revertir el estado 'cancelada'
// que se puso al solicitar (ver solicitarCancelacionSuscripcion), a
// activa.
export async function cancelarCambioProgramado(
  db: EjecutorSql,
  tenantId: string,
  cambioId: string
): Promise<ResultadoCambio> {
  const cambioResult = await db.query(
    `SELECT cs.id, cs.tipo, cs.estado, cs.efectivo_en, cs.suscripcion_id
     FROM cambios_suscripcion cs
     JOIN suscripciones s ON s.id = cs.suscripcion_id
     JOIN tenants t ON t.suscripcion_id = s.id
     WHERE cs.id = $1 AND t.id = $2`,
    [cambioId, tenantId]
  );
  const cambio = cambioResult.rows[0];
  if (!cambio) return { permitido: false, motivo: "cambio_no_encontrado" };
  if (cambio.estado !== "programado" || new Date(cambio.efectivo_en) <= new Date()) {
    return { permitido: false, motivo: "ya_no_programado" };
  }

  await db.query(`UPDATE cambios_suscripcion SET estado = 'cancelado' WHERE id = $1`, [cambioId]);

  if (cambio.tipo === "cancelacion") {
    await db.query(`UPDATE suscripciones SET estado = 'activa' WHERE id = $1`, [cambio.suscripcion_id]);
  }

  return { permitido: true };
}

// PASO 4 — Cancelación de la suscripción. El estado pasa a 'cancelada' de
// inmediato (no 'finalizada' — el servicio sigue funcionando con
// normalidad, incluido el saldo comprado, hasta efectivo_en).
export async function solicitarCancelacionSuscripcion(
  db: EjecutorSql,
  tenantId: string,
  personaId: string
): Promise<ResultadoCambio> {
  const suscripcion = await resolverSuscripcionVigente(db, tenantId);
  if (!suscripcion) return { permitido: false, motivo: "cambio_no_encontrado" };

  await db.query("BEGIN");
  try {
    await db.query(
      `UPDATE cambios_suscripcion SET estado = 'cancelado' WHERE suscripcion_id = $1 AND estado = 'programado'`,
      [suscripcion.id]
    );
    const cambioResult = await db.query(
      `INSERT INTO cambios_suscripcion (suscripcion_id, tipo, estado, efectivo_en, solicitado_por)
       VALUES ($1, 'cancelacion', 'programado', $2, $3)
       RETURNING id`,
      [suscripcion.id, suscripcion.periodoFin.toISOString(), personaId]
    );
    await db.query(`UPDATE suscripciones SET estado = 'cancelada' WHERE id = $1`, [suscripcion.id]);
    await db.query("COMMIT");
    return { permitido: true, cambioId: cambioResult.rows[0].id };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

// PASO 5 — Consulta del cambio programado vigente.
export async function obtenerCambioPendiente(db: EjecutorSql, tenantId: string) {
  const result = await db.query(
    `SELECT cs.id, cs.tipo, cs.plan_destino_id, p.nombre AS plan_destino_nombre,
            cs.periodicidad_destino, cs.agentes_destino, cs.medicos_destino, cs.efectivo_en,
            s.plan_id AS plan_actual_id, pa.nombre AS plan_actual_nombre,
            s.credito_pactado_usd AS credito_actual, p.credito_ia_usd AS credito_destino,
            s.precio_pactado_usd AS precio_actual,
            (CASE WHEN cs.periodicidad_destino = 'anual' THEN p.precio_anual_usd ELSE p.precio_mensual_usd END) AS precio_destino
     FROM cambios_suscripcion cs
     JOIN suscripciones s ON s.id = cs.suscripcion_id
     JOIN tenants t ON t.suscripcion_id = s.id
     LEFT JOIN planes p ON p.id = cs.plan_destino_id
     LEFT JOIN planes pa ON pa.id = s.plan_id
     WHERE t.id = $1 AND cs.estado = 'programado'
     ORDER BY cs.solicitado_en DESC LIMIT 1`,
    [tenantId]
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------
// PASO 3 — Ejecución de cambios vencidos (downgrade y cancelación). Se
// llama desde el trabajo programado del ciclo (jobs/ciclo.job.ts) ANTES
// de la renovación normal — un downgrade tiene que actualizar
// credito_pactado_usd antes de que la renovación lo lea, y una
// cancelación efectiva tiene que dejar la suscripción en 'finalizada'
// antes de que la renovación la considere candidata (su query selecciona
// estado IN ('activa','morosa','cancelada'), que sin este orden
// renovaría una suscripción que ya debería estar finalizada).
// ---------------------------------------------------------------------
export async function ejecutarCambiosVencidos(db: Pool): Promise<{ ejecutados: number; requierenAtencion: number }> {
  let ejecutados = 0;
  let requierenAtencion = 0;

  const candidatos = await db.query(
    `SELECT cs.id, cs.suscripcion_id, cs.tipo, cs.plan_destino_id, cs.periodicidad_destino
     FROM cambios_suscripcion cs
     WHERE cs.estado = 'programado' AND cs.efectivo_en <= now()`
  );

  for (const cambio of candidatos.rows) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const suscripcionResult = await client.query(
        `SELECT s.id, s.tenant_id, t.nombre AS tenant_nombre
         FROM suscripciones s JOIN tenants t ON t.id = s.tenant_id
         WHERE s.id = $1 FOR UPDATE`,
        [cambio.suscripcion_id]
      );
      const suscripcion = suscripcionResult.rows[0];
      if (!suscripcion) {
        await client.query("ROLLBACK");
        continue;
      }

      if (cambio.tipo === "cancelacion") {
        await client.query(`UPDATE suscripciones SET estado = 'finalizada' WHERE id = $1`, [suscripcion.id]);
        await client.query(`UPDATE cambios_suscripcion SET estado = 'ejecutado', ejecutado_en = now() WHERE id = $1`, [
          cambio.id,
        ]);
        await client.query("COMMIT");
        ejecutados++;
        console.log(`[cambios] Cancelación efectiva para "${suscripcion.tenant_nombre}" — suscripción finalizada.`);
        continue;
      }

      // tipo === 'downgrade' — REVALIDACIÓN OBLIGATORIA: la selección se
      // capturó al solicitar, y en el medio pudo cambiar todo.
      const agentesConservadosResult = await client.query(
        `SELECT agente_id FROM cambio_agentes_conservados WHERE cambio_id = $1`,
        [cambio.id]
      );
      const medicosConservadosResult = await client.query(
        `SELECT persona_id FROM cambio_medicos_conservados WHERE cambio_id = $1`,
        [cambio.id]
      );
      const agentesConservados: string[] = agentesConservadosResult.rows.map((r) => r.agente_id);
      const medicosConservados: string[] = medicosConservadosResult.rows.map((r) => r.persona_id);

      const agentesVigentesResult = await client.query(
        `SELECT agente_id FROM tenant_agentes WHERE tenant_id = $1 AND estado = 'habilitado' AND agente_id = ANY($2::uuid[])`,
        [suscripcion.tenant_id, agentesConservados]
      );
      const medicosVigentesResult = await client.query(
        `SELECT id FROM personas WHERE tenant_id = $1 AND es_medico = true AND estado = 'activo' AND id = ANY($2::uuid[])`,
        [suscripcion.tenant_id, medicosConservados]
      );

      const planResult = await client.query(
        `SELECT agentes_incluidos, medicos_incluidos FROM planes WHERE id = $1`,
        [cambio.plan_destino_id]
      );
      const planDestino = planResult.rows[0];

      const motivosFalla: string[] = [];
      if (agentesVigentesResult.rows.length !== agentesConservados.length) {
        motivosFalla.push(
          "Uno o más agentes seleccionados ya no están habilitados para la clínica (fueron deshabilitados o eliminados después de solicitar el cambio)."
        );
      }
      if (medicosVigentesResult.rows.length !== medicosConservados.length) {
        motivosFalla.push(
          "Uno o más médicos seleccionados ya no están activos en la clínica (fueron inactivados o eliminados después de solicitar el cambio)."
        );
      }
      if (
        planDestino &&
        planDestino.agentes_incluidos != null &&
        agentesConservados.length > Number(planDestino.agentes_incluidos)
      ) {
        motivosFalla.push("La cantidad de agentes seleccionados ya no cabe en el plan destino.");
      }
      if (planDestino && medicosConservados.length > Number(planDestino.medicos_incluidos)) {
        motivosFalla.push("La cantidad de médicos seleccionados ya no cabe en el plan destino.");
      }

      if (motivosFalla.length > 0) {
        const motivo = motivosFalla.join(" ");
        await client.query(
          `UPDATE cambios_suscripcion SET estado = 'requiere_atencion', motivo_atencion = $1 WHERE id = $2`,
          [motivo, cambio.id]
        );
        await client.query("COMMIT");
        requierenAtencion++;
        console.log(`[cambios] Downgrade de "${suscripcion.tenant_nombre}" requiere atención: ${motivo}`);
        await notificarAdmin(
          db,
          suscripcion.tenant_id,
          "Tu cambio de plan necesita tu atención",
          `El cambio de plan que solicitaste no se pudo ejecutar automáticamente: ${motivo} ` +
            `Tu plan actual se mantiene sin cambios. Ingresá a Plan y Consumo para revisar la selección y volver a intentarlo.`
        );
        continue;
      }

      // Revalidación OK — ejecuta.
      const agentesADeshabilitarResult = await client.query(
        `SELECT agente_id FROM tenant_agentes
         WHERE tenant_id = $1 AND estado = 'habilitado' AND NOT (agente_id = ANY($2::uuid[]))`,
        [suscripcion.tenant_id, agentesConservados]
      );
      for (const fila of agentesADeshabilitarResult.rows) {
        // No se toca periodo_ultimo_cambio: el freno anti-rotación (flujo
        // A) es para cambios ad-hoc de un médico/admin, no para un
        // downgrade de plataforma ya validado y programado.
        await client.query(
          `UPDATE tenant_agentes SET estado = 'deshabilitado', deshabilitado_en = now(), actualizado_en = now()
           WHERE tenant_id = $1 AND agente_id = $2`,
          [suscripcion.tenant_id, fila.agente_id]
        );
      }

      await client.query(
        `UPDATE personas SET estado = 'inactivo'
         WHERE tenant_id = $1 AND es_medico = true AND estado = 'activo' AND NOT (id = ANY($2::uuid[]))`,
        [suscripcion.tenant_id, medicosConservados]
      );

      const planCompletoResult = await client.query(
        `SELECT agentes_incluidos, medicos_incluidos, credito_ia_usd, precio_mensual_usd, precio_anual_usd
         FROM planes WHERE id = $1`,
        [cambio.plan_destino_id]
      );
      const planCompleto = planCompletoResult.rows[0];
      const periodicidadFinal = cambio.periodicidad_destino; // null = no cambia
      const precioNuevo =
        periodicidadFinal === "anual" ? planCompleto.precio_anual_usd : planCompleto.precio_mensual_usd;

      await client.query(
        `UPDATE suscripciones
         SET plan_id = $1,
             precio_pactado_usd = $2,
             credito_pactado_usd = $3,
             agentes_contratados = $4,
             medicos_contratados = $5,
             periodicidad = COALESCE($6, periodicidad)
         WHERE id = $7`,
        [
          cambio.plan_destino_id,
          precioNuevo,
          planCompleto.credito_ia_usd,
          planCompleto.agentes_incluidos,
          planCompleto.medicos_incluidos,
          periodicidadFinal,
          suscripcion.id,
        ]
      );

      await client.query(`UPDATE cambios_suscripcion SET estado = 'ejecutado', ejecutado_en = now() WHERE id = $1`, [
        cambio.id,
      ]);

      await client.query("COMMIT");
      ejecutados++;
      console.log(`[cambios] Downgrade ejecutado para "${suscripcion.tenant_nombre}".`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[cambios] Error al ejecutar el cambio ${cambio.id}`, err);
    } finally {
      client.release();
    }
  }

  return { ejecutados, requierenAtencion };
}

export function mensajeRechazoCambio(resultado: ResultadoCambio): string {
  switch (resultado.motivo) {
    case "no_cabe_en_destino":
      return `La selección no cabe en el plan destino — sobran ${resultado.agentesSobran ?? 0} agente(s) y ${resultado.medicosSobran ?? 0} médico(s).`;
    case "cambio_no_encontrado":
      return "No se encontró el cambio o la suscripción.";
    case "ya_no_programado":
      return "Este cambio ya no está programado (fue ejecutado, cancelado o ya venció).";
    case "pago_pendiente":
      return "Hay un cambio de plan con el cobro en proceso — esperá a que se confirme (unos segundos) antes de solicitar otro.";
    default:
      return "No se pudo completar la operación.";
  }
}
