import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// ¿SE PUEDE CITAR A ESTA HORA? — prompt 04, sección 3.
//
// Una sola función que la agenda consulta antes de agendar. Antes no
// existía: `horarios_configuracion` guardaba el horario de cada médico
// y nadie lo comparaba contra la cita, y el horario de la clínica no
// existía en ninguna parte.
//
// EL ORDEN DE LAS TRES PREGUNTAS, y por qué ese:
//
//   1. **¿la clínica abre ese día y a esa hora?** Es el marco: nadie
//      atiende con la clínica cerrada, ni el médico más dispuesto.
//   2. **¿hay una excepción que bloquee?** Un feriado, las vacaciones
//      del médico, un bloqueo puntual.
//   3. **¿el médico trabaja a esa hora?** Dentro del marco.
//
// Si la 1 falla, las otras dos no importan. Y el motivo que se devuelve
// es el de la primera que falla: decirle «el médico no trabaja los
// domingos» cuando la clínica está cerrada el domingo manda a la
// recepción a mirar el lugar equivocado.
//
// NO BLOQUEA POR SÍ MISMA: devuelve el veredicto. Quien agenda decide
// si pide el permiso de excepción, que es lo que el prompt pide.
// ---------------------------------------------------------------------

export interface Bloque {
  desde: string;
  hasta: string;
}

export interface VeredictoHorario {
  permitido: boolean;
  /** Por qué no, en castellano, listo para mostrar. */
  motivo?: string;
  /** Qué nivel lo frenó: para que la pantalla sepa qué ofrecer arreglar. */
  nivel?: "clinica" | "excepcion" | "medico";
  /** Lo que sí está disponible ese día, para proponer otra hora. */
  bloquesDelDia?: Bloque[];
}

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function dentroDeAlguno(bloques: Bloque[], desde: number, hasta: number): boolean {
  return bloques.some((b) => desde >= aMinutos(b.desde) && hasta <= aMinutos(b.hasta));
}

/**
 * Si se puede agendar en esa fecha y hora.
 *
 * `horaFin` se calcula con la duración: una cita de 30 minutos a las
 * 16:45 con la clínica cerrando a las 17:00 **sí entra**; la misma a
 * las 16:50 no. Comparar solo la hora de inicio dejaría citas que
 * terminan con la clínica cerrada, que es el error que la recepción
 * descubre cuando el cliente ya está en la sala.
 */
export async function sePuedeAgendar(
  db: PoolClient,
  tenantId: string,
  datos: {
    fecha: string;
    horaInicio: string;
    duracionMinutos: number;
    medicoId?: string | null;
  }
): Promise<VeredictoHorario> {
  const inicio = aMinutos(datos.horaInicio);
  const fin = inicio + datos.duracionMinutos;

  // 1. EL HORARIO DE LA CLÍNICA.
  const dia = await db.query<{ dia_semana: number; bloques: Bloque[]; abierto: boolean }>(
    `SELECT dia_semana, bloques, abierto
       FROM clinica_horario
      WHERE tenant_id = $1 AND dia_semana = EXTRACT(DOW FROM $2::date)::int`,
    [tenantId, datos.fecha]
  );
  // SIN HORARIO CONFIGURADO NO SE BLOQUEA NADA. Una clínica que nunca
  // abrió esta pantalla tiene que poder seguir agendando como antes:
  // un control que nace prohibiendo todo es un control que se apaga.
  if (dia.rows.length > 0) {
    const h = dia.rows[0];
    if (!h.abierto) {
      return {
        permitido: false,
        motivo: `La clínica no abre los ${nombreDia(h.dia_semana)}.`,
        nivel: "clinica",
        bloquesDelDia: [],
      };
    }
    if (h.bloques.length > 0 && !dentroDeAlguno(h.bloques, inicio, fin)) {
      return {
        permitido: false,
        motivo: `La clínica atiende ${h.bloques.map((b) => `de ${b.desde} a ${b.hasta}`).join(" y ")}, y la cita de ${datos.horaInicio} termina ${aHora(fin)}.`,
        nivel: "clinica",
        bloquesDelDia: h.bloques,
      };
    }
  }

  // 2. LAS EXCEPCIONES: feriados, vacaciones y bloqueos.
  const exc = await db.query<{
    tipo: string;
    nombre: string;
    hora_desde: string | null;
    hora_hasta: string | null;
    medico_id: string | null;
  }>(
    `SELECT tipo, nombre, hora_desde::text, hora_hasta::text, medico_id
       FROM clinica_excepciones
      WHERE tenant_id = $1
        AND bloquea
        AND $2::date BETWEEN desde AND hasta
        -- Las de la clínica aplican a todos; las de un médico, solo a él.
        AND (medico_id IS NULL OR medico_id = $3::uuid)`,
    [tenantId, datos.fecha, datos.medicoId ?? null]
  );
  for (const e of exc.rows) {
    const todoElDia = e.hora_desde === null;
    const choca =
      todoElDia ||
      !(fin <= aMinutos(e.hora_desde!) || inicio >= aMinutos(e.hora_hasta!));
    if (choca) {
      return {
        permitido: false,
        motivo: todoElDia
          ? `${e.nombre}: ${e.tipo === "feriado" ? "es feriado" : e.tipo === "vacaciones" ? "está de vacaciones" : "hay un bloqueo"} ese día.`
          : `${e.nombre}: hay un bloqueo de ${e.hora_desde!.slice(0, 5)} a ${e.hora_hasta!.slice(0, 5)}.`,
        nivel: "excepcion",
      };
    }
  }

  // 3. EL HORARIO DEL MÉDICO, dentro del marco.
  if (datos.medicoId) {
    const m = await db.query<{ bloques: Bloque[]; activo: boolean }>(
      `SELECT bloques, activo FROM horarios_configuracion
        WHERE tenant_id = $1 AND medico_id = $2
          AND dia_semana = EXTRACT(DOW FROM $3::date)::int`,
      [tenantId, datos.medicoId, datos.fecha]
    );
    if (m.rows.length > 0 && m.rows[0].activo) {
      const bloques = m.rows[0].bloques ?? [];
      if (bloques.length > 0 && !dentroDeAlguno(bloques, inicio, fin)) {
        return {
          permitido: false,
          motivo: `Ese médico atiende ${bloques.map((b) => `de ${b.desde} a ${b.hasta}`).join(" y ")} ese día.`,
          nivel: "medico",
          bloquesDelDia: bloques,
        };
      }
    }
  }

  return { permitido: true };
}

function nombreDia(dow: number): string {
  return ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"][dow];
}

function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// LA CONFIGURACIÓN, para la pantalla.
// ---------------------------------------------------------------------

export async function horarioDeLaClinica(
  db: PoolClient,
  tenantId: string
): Promise<Array<{ dia_semana: number; bloques: Bloque[]; abierto: boolean }>> {
  const r = await db.query<{ dia_semana: number; bloques: Bloque[]; abierto: boolean }>(
    `SELECT dia_semana, bloques, abierto FROM clinica_horario
      WHERE tenant_id = $1 ORDER BY dia_semana`,
    [tenantId]
  );
  return r.rows;
}

export async function guardarHorarioDelDia(
  db: PoolClient,
  tenantId: string,
  datos: { diaSemana: number; bloques: Bloque[]; abierto: boolean }
): Promise<void> {
  for (const b of datos.bloques) {
    if (aMinutos(b.hasta) <= aMinutos(b.desde)) {
      throw new Error(`El bloque de ${b.desde} a ${b.hasta} termina antes de empezar.`);
    }
  }
  await db.query(
    `INSERT INTO clinica_horario (tenant_id, dia_semana, bloques, abierto)
     VALUES ($1,$2,$3::jsonb,$4)
     ON CONFLICT (tenant_id, dia_semana) DO UPDATE
       SET bloques = EXCLUDED.bloques, abierto = EXCLUDED.abierto,
           actualizado_en = now()`,
    [tenantId, datos.diaSemana, JSON.stringify(datos.bloques), datos.abierto]
  );
}

export async function excepcionesDeLaClinica(
  db: PoolClient,
  tenantId: string,
  desde?: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT e.id, e.tipo, e.nombre, e.desde::text, e.hasta::text,
            e.hora_desde::text, e.hora_hasta::text, e.bloquea,
            e.medico_id, p.nombre AS medico_nombre
       FROM clinica_excepciones e
       LEFT JOIN personas p ON p.id = e.medico_id
      WHERE e.tenant_id = $1
        AND e.hasta >= COALESCE($2::date, CURRENT_DATE - 30)
      ORDER BY e.desde`,
    [tenantId, desde ?? null]
  );
  return r.rows;
}

export async function guardarExcepcion(
  db: PoolClient,
  tenantId: string,
  datos: {
    id?: string;
    tipo: string;
    nombre: string;
    desde: string;
    hasta: string;
    horaDesde?: string | null;
    horaHasta?: string | null;
    medicoId?: string | null;
    bloquea?: boolean;
  }
): Promise<{ id: string }> {
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE clinica_excepciones
          SET tipo = $2, nombre = $3, desde = $4, hasta = $5,
              hora_desde = $6, hora_hasta = $7, medico_id = $8,
              bloquea = COALESCE($9, bloquea)
        WHERE id = $1 RETURNING id`,
      [
        datos.id,
        datos.tipo,
        datos.nombre,
        datos.desde,
        datos.hasta,
        datos.horaDesde || null,
        datos.horaHasta || null,
        datos.medicoId || null,
        datos.bloquea ?? null,
      ]
    );
    if (r.rows.length === 0) throw new Error("Esa excepción no existe.");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO clinica_excepciones
       (tenant_id, tipo, nombre, desde, hasta, hora_desde, hora_hasta, medico_id, bloquea)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true))
     RETURNING id`,
    [
      tenantId,
      datos.tipo,
      datos.nombre,
      datos.desde,
      datos.hasta,
      datos.horaDesde || null,
      datos.horaHasta || null,
      datos.medicoId || null,
      datos.bloquea ?? null,
    ]
  );
  return r.rows[0];
}

export async function borrarExcepcion(db: PoolClient, id: string): Promise<void> {
  await db.query(`DELETE FROM clinica_excepciones WHERE id = $1`, [id]);
}
