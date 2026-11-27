import { PoolClient } from "pg";
import { Bloque, sePuedeAgendar } from "../clinica/horarios";

// ---------------------------------------------------------------------
// EL MOTOR DE DISPONIBILIDAD — prompt 05, §1.
//
// UNA SOLA FUNCIÓN contesta «¿se puede citar a este médico, en esta
// sala, con este equipo, de tal hora a tal hora?». La usan la agenda, la
// lista de espera, el control desde la atención, el CRM, el agente y
// —cuando llegue— la app del cliente. Y la misma función contesta
// «¿cuáles son los huecos libres?», porque son la misma pregunta hecha
// al revés: un hueco es un rato donde la respuesta es sí.
//
// EL CAMBIO DE FONDO RESPECTO DEL 04: **impide, no avisa**. Hasta acá
// `buscarConflictos` devolvía los choques y la cita se creaba igual: la
// recepción veía un aviso amarillo y seguía. Ahora se rechaza, y la
// única salida es una SOBRECARGA EXPLÍCITA de quien tenga
// `agenda.sobrecarga`, con motivo, que queda registrada.
//
// Un aviso que no frena nada es un aviso que se aprende a ignorar en
// una semana.
//
// LO QUE COMBINA, en este orden —del motivo más útil al menos útil—:
//
//   1. el horario de la clínica, los feriados y los bloqueos (04), más
//      el horario del médico: lo reusa de `clinica/horarios.ts`, que ya
//      lo resolvía, en vez de volver a escribirlo;
//   2. el turno del médico (11): si ese día tiene turnos declarados, la
//      cita tiene que caer dentro de uno;
//   3. los eventos propios de su calendario externo (05, §4): bloquean
//      igual que un turno, y de ellos solo sabemos la hora;
//   4. las citas que ya existen, con el MARGEN del tipo de cita;
//   5. la sala;
//   6. los equipos, contando cuántos hay de cada uno.
// ---------------------------------------------------------------------

export interface Hueco {
  horaInicio: string;
  horaFin: string;
}

export type NivelQueFreno =
  | "clinica"
  | "excepcion"
  | "medico"
  | "turno"
  | "calendario"
  | "cita"
  | "sala"
  | "equipo";

export interface Veredicto {
  permitido: boolean;
  /** Por qué no, en castellano y listo para mostrar. */
  motivo?: string;
  nivel?: NivelQueFreno;
  /** Lo que sí está disponible ese día, para proponer otra hora. */
  bloquesDelDia?: Bloque[];
  /** Los tres huecos más cercanos, cuando rechaza (§1). */
  huecos?: Hueco[];
  /** Con qué choca, para poder mostrarlo en la agenda. */
  choques?: Array<{
    tipo: "cita" | "sala" | "equipo" | "calendario";
    descripcion: string;
    desde: string;
    hasta: string;
  }>;
}

export interface SolicitudDeCita {
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  medicoId: string;
  salaId?: string | null;
  /** Los equipos que la cita va a ocupar. */
  equipoIds?: string[];
  /** De él sale el margen. */
  tipoCitaId?: string | null;
  /** Al mover una cita, ella misma no cuenta como choque. */
  excluirCitaId?: string | null;
}

export function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * El margen que se respeta entre esta cita y la siguiente, en minutos.
 *
 * SALE DE DOS LUGARES y gana el mayor: el del TIPO de cita (166) y el
 * del MÉDICO (`horarios_configuracion.buffer_minutos`).
 *
 * DEFECTO QUE ESTO CIERRA, encontrado al relevar: `buffer_minutos`
 * existe desde la agenda de Vetline Ai, la pantalla de horarios lo
 * guarda, y **nadie lo leía nunca**. Un médico que configuró diez
 * minutos de margen entre citas los veía ignorados en cada agendada. Es
 * el mismo defecto que el 04 encontró con `horarios_configuracion`
 * entero: un dato que se pide, se guarda y no gobierna nada.
 *
 * Gana el mayor y no se suman: son dos formas de decir lo mismo —cuánto
 * tarda en quedar libre el consultorio—, y sumarlas dejaría media hora
 * muerta entre dos consultas de quince minutos.
 */
async function margenEfectivo(
  db: PoolClient,
  tenantId: string,
  datos: { tipoCitaId?: string | null; medicoId?: string | null; fecha?: string }
): Promise<number> {
  let delTipo = 0;
  if (datos.tipoCitaId) {
    const r = await db.query<{ margen_minutos: number }>(
      `SELECT margen_minutos FROM tipos_cita WHERE id = $1 AND tenant_id = $2`,
      [datos.tipoCitaId, tenantId]
    );
    delTipo = r.rows[0]?.margen_minutos ?? 0;
  }

  let delMedico = 0;
  if (datos.medicoId && datos.fecha) {
    const r = await db.query<{ buffer_minutos: number | null }>(
      `SELECT buffer_minutos FROM horarios_configuracion
        WHERE tenant_id = $1 AND medico_id = $2
          AND dia_semana = EXTRACT(DOW FROM $3::date)::int`,
      [tenantId, datos.medicoId, datos.fecha]
    );
    delMedico = r.rows[0]?.buffer_minutos ?? 0;
  }

  return Math.max(delTipo, delMedico);
}

/**
 * Los ratos del día en que el médico NO está disponible, por cualquier
 * motivo. Es la base del veredicto y de los huecos: calcularlo una vez
 * y usarlo para las dos cosas es lo que garantiza que el hueco que la
 * pantalla ofrece sea un hueco que el motor después acepte.
 */
export async function ocupacionDelDia(
  db: PoolClient,
  tenantId: string,
  datos: {
    fecha: string;
    medicoId: string;
    salaId?: string | null;
    equipoIds?: string[];
    excluirCitaId?: string | null;
  }
): Promise<
  Array<{ desde: number; hasta: number; tipo: NivelQueFreno; descripcion: string }>
> {
  const ocupado: Array<{
    desde: number;
    hasta: number;
    tipo: NivelQueFreno;
    descripcion: string;
  }> = [];

  // --- Las citas del médico y de la sala, con su margen -----------
  const citas = await db.query<{
    hora_inicio: string;
    hora_fin: string;
    margen: number;
    medico_id: string;
    sala_id: string | null;
    paciente: string;
    sala: string | null;
  }>(
    `SELECT c.hora_inicio::text, c.hora_fin::text,
            COALESCE(tc.margen_minutos, 0) AS margen,
            c.medico_id, c.sala_id,
            p.nombre AS paciente, s.nombre AS sala
       FROM citas c
       JOIN pacientes p ON p.id = c.paciente_id
       LEFT JOIN salas s ON s.id = c.sala_id
       LEFT JOIN tipos_cita tc ON tc.id = c.tipo_cita_id
      WHERE c.tenant_id = $1
        AND c.fecha = $2::date
        AND c.estado NOT IN ('cancelada', 'no_show')
        AND (c.medico_id = $3 OR ($4::uuid IS NOT NULL AND c.sala_id = $4::uuid))
        AND ($5::uuid IS NULL OR c.id <> $5::uuid)`,
    [tenantId, datos.fecha, datos.medicoId, datos.salaId ?? null, datos.excluirCitaId ?? null]
  );
  for (const c of citas.rows) {
    const esDelMedico = c.medico_id === datos.medicoId;
    ocupado.push({
      desde: aMinutos(c.hora_inicio),
      // EL MARGEN SE SUMA AL FINAL, no a la duración: la cita sigue
      // durando lo que dura —eso es lo que ve el cliente— y lo que se
      // ocupa es el rato de después.
      hasta: aMinutos(c.hora_fin) + c.margen,
      tipo: esDelMedico ? "cita" : "sala",
      descripcion: esDelMedico
        ? `otra cita de este médico (${c.paciente}) de ${c.hora_inicio.slice(0, 5)} a ${c.hora_fin.slice(0, 5)}`
        : `${c.sala ?? "la sala"} está ocupada de ${c.hora_inicio.slice(0, 5)} a ${c.hora_fin.slice(0, 5)}`,
    });
  }

  // --- Los equipos, contando cuántos hay --------------------------
  //
  // Dos máquinas de anestesia admiten dos cirugías a la vez; una, no.
  // Por eso no alcanza con «está ocupado»: hay que contar.
  if (datos.equipoIds && datos.equipoIds.length > 0) {
    const usos = await db.query<{
      equipo: string;
      cantidad: number;
      hora_inicio: string;
      hora_fin: string;
      usados: number;
    }>(
      `SELECT e.nombre AS equipo, e.cantidad,
              c.hora_inicio::text, c.hora_fin::text,
              count(*)::int AS usados
         FROM cita_equipos ce
         JOIN agenda_equipos e ON e.id = ce.equipo_id
         JOIN citas c ON c.id = ce.cita_id
        WHERE e.tenant_id = $1
          AND ce.equipo_id = ANY($2::uuid[])
          AND c.fecha = $3::date
          AND c.estado NOT IN ('cancelada', 'no_show')
          AND ($4::uuid IS NULL OR c.id <> $4::uuid)
        GROUP BY e.nombre, e.cantidad, c.hora_inicio, c.hora_fin`,
      [tenantId, datos.equipoIds, datos.fecha, datos.excluirCitaId ?? null]
    );
    for (const u of usos.rows) {
      // Solo bloquea si al sumar esta cita se pasaría de la cantidad.
      if (u.usados >= u.cantidad) {
        ocupado.push({
          desde: aMinutos(u.hora_inicio),
          hasta: aMinutos(u.hora_fin),
          tipo: "equipo",
          descripcion: `${u.equipo} está ocupado de ${u.hora_inicio.slice(0, 5)} a ${u.hora_fin.slice(0, 5)} (hay ${u.cantidad})`,
        });
      }
    }
  }

  // --- Los eventos propios de su calendario externo ---------------
  //
  // De ellos solo sabemos la hora, a propósito: el dentista del médico
  // no es asunto de la clínica, pero su hora sí.
  const bloques = await db.query<{ desde: string; hasta: string; todo_el_dia: boolean }>(
    `SELECT b.desde::text, b.hasta::text, b.todo_el_dia
       FROM cal_bloques_ocupados b
      WHERE b.tenant_id = $1 AND b.persona_id = $2
        AND b.desde < ($3::date + interval '1 day')
        AND b.hasta > $3::date`,
    [tenantId, datos.medicoId, datos.fecha]
  );
  for (const b of bloques.rows) {
    if (b.todo_el_dia) {
      ocupado.push({
        desde: 0,
        hasta: 24 * 60,
        tipo: "calendario",
        descripcion: "tiene un evento de todo el día en su calendario",
      });
      continue;
    }
    const inicio = new Date(b.desde);
    const fin = new Date(b.hasta);
    const mismoDia = (d: Date) => d.toISOString().slice(0, 10) === datos.fecha;
    ocupado.push({
      desde: mismoDia(inicio) ? inicio.getUTCHours() * 60 + inicio.getUTCMinutes() : 0,
      hasta: mismoDia(fin) ? fin.getUTCHours() * 60 + fin.getUTCMinutes() : 24 * 60,
      tipo: "calendario",
      descripcion: "tiene un evento en su calendario a esa hora",
    });
  }

  return ocupado;
}

/** Los turnos declarados del médico ese día (11). */
async function turnosDelDia(
  db: PoolClient,
  tenantId: string,
  medicoId: string,
  fecha: string
): Promise<Bloque[]> {
  const r = await db.query<{ hora_desde: string; hora_hasta: string }>(
    `SELECT hora_desde::text, hora_hasta::text
       FROM personal_turnos
      WHERE tenant_id = $1 AND persona_id = $2 AND fecha = $3::date
      ORDER BY hora_desde`,
    [tenantId, medicoId, fecha]
  );
  return r.rows.map((t) => ({ desde: t.hora_desde, hasta: t.hora_hasta }));
}

/**
 * ¿Se puede citar? Y si no, por qué y cuándo sí.
 *
 * Devuelve SIEMPRE los huecos cercanos cuando rechaza: un «no» sin una
 * alternativa obliga a la recepción a adivinar, y adivinar con el
 * cliente al teléfono es cómo se termina sobrecargando la agenda.
 */
export async function sePuedeCitar(
  db: PoolClient,
  tenantId: string,
  s: SolicitudDeCita
): Promise<Veredicto> {
  const margen = await margenEfectivo(db, tenantId, {
    tipoCitaId: s.tipoCitaId,
    medicoId: s.medicoId,
    fecha: s.fecha,
  });
  const inicio = aMinutos(s.horaInicio);
  const fin = inicio + s.duracionMinutos;

  // 1. El marco: clínica, feriados, bloqueos y horario del médico.
  //    Se reusa tal cual; no se reescribe.
  const marco = await sePuedeAgendar(db, tenantId, {
    fecha: s.fecha,
    horaInicio: s.horaInicio,
    duracionMinutos: s.duracionMinutos + margen,
    medicoId: s.medicoId,
  });
  if (!marco.permitido) {
    return {
      permitido: false,
      motivo: marco.motivo,
      nivel: marco.nivel,
      bloquesDelDia: marco.bloquesDelDia,
      huecos: await huecosLibres(db, tenantId, {
        fecha: s.fecha,
        medicoId: s.medicoId,
        duracionMinutos: s.duracionMinutos,
        salaId: s.salaId,
        equipoIds: s.equipoIds,
        tipoCitaId: s.tipoCitaId,
        excluirCitaId: s.excluirCitaId,
        limite: 3,
      }),
    };
  }

  // 2. El turno del médico (11). Si ese día no declaró ninguno, no se
  //    exige: una clínica que no usa turnos no tiene que configurarlos
  //    para poder agendar.
  const turnos = await turnosDelDia(db, tenantId, s.medicoId, s.fecha);
  if (turnos.length > 0) {
    const dentro = turnos.some(
      (t) => inicio >= aMinutos(t.desde) && fin + margen <= aMinutos(t.hasta)
    );
    if (!dentro) {
      return {
        permitido: false,
        motivo: `Ese día el médico tiene turno ${turnos
          .map((t) => `de ${t.desde.slice(0, 5)} a ${t.hasta.slice(0, 5)}`)
          .join(" y ")}.`,
        nivel: "turno",
        bloquesDelDia: turnos,
        huecos: await huecosLibres(db, tenantId, {
          fecha: s.fecha,
          medicoId: s.medicoId,
          duracionMinutos: s.duracionMinutos,
          salaId: s.salaId,
          equipoIds: s.equipoIds,
          tipoCitaId: s.tipoCitaId,
          excluirCitaId: s.excluirCitaId,
          limite: 3,
        }),
      };
    }
  }

  // 3. Lo que ya está ocupado: citas, sala, equipos y calendario.
  const ocupado = await ocupacionDelDia(db, tenantId, {
    fecha: s.fecha,
    medicoId: s.medicoId,
    salaId: s.salaId,
    equipoIds: s.equipoIds,
    excluirCitaId: s.excluirCitaId,
  });
  const choques = ocupado.filter((o) => inicio < o.hasta && fin + margen > o.desde);
  if (choques.length > 0) {
    // El motivo más específico primero: un equipo ocupado explica más
    // que «hay otra cita».
    const orden: NivelQueFreno[] = ["equipo", "sala", "calendario", "cita"];
    const primero = [...choques].sort(
      (a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo)
    )[0];
    return {
      permitido: false,
      motivo: `No se puede: ${primero.descripcion}.`,
      nivel: primero.tipo,
      choques: choques.map((c) => ({
        tipo: c.tipo as "cita" | "sala" | "equipo" | "calendario",
        descripcion: c.descripcion,
        desde: aHora(c.desde),
        hasta: aHora(c.hasta),
      })),
      huecos: await huecosLibres(db, tenantId, {
        fecha: s.fecha,
        medicoId: s.medicoId,
        duracionMinutos: s.duracionMinutos,
        salaId: s.salaId,
        equipoIds: s.equipoIds,
        tipoCitaId: s.tipoCitaId,
        excluirCitaId: s.excluirCitaId,
        limite: 3,
      }),
    };
  }

  return { permitido: true };
}

/**
 * Los huecos libres de un día, del largo que haga falta.
 *
 * SALEN DEL MISMO CÁLCULO QUE EL VEREDICTO: se restan los ratos
 * ocupados de los bloques en que el médico atiende. Si los huecos se
 * calcularan aparte, la pantalla ofrecería huecos que el motor después
 * rechaza —y eso es peor que no ofrecer ninguno—.
 */
export async function huecosLibres(
  db: PoolClient,
  tenantId: string,
  datos: {
    fecha: string;
    medicoId: string;
    duracionMinutos: number;
    salaId?: string | null;
    equipoIds?: string[];
    tipoCitaId?: string | null;
    excluirCitaId?: string | null;
    /** Cuántos devolver. Sin límite, todos. */
    limite?: number;
    /** Cada cuántos minutos se prueba un inicio. */
    paso?: number;
  }
): Promise<Hueco[]> {
  const margen = await margenEfectivo(db, tenantId, {
    tipoCitaId: datos.tipoCitaId,
    medicoId: datos.medicoId,
    fecha: datos.fecha,
  });
  const paso = datos.paso ?? 15;
  const largo = datos.duracionMinutos + margen;

  // Los bloques en que el médico atiende ese día: su turno si lo tiene,
  // su horario si no, y el de la clínica como último marco.
  const turnos = await turnosDelDia(db, tenantId, datos.medicoId, datos.fecha);
  let marco: Bloque[] = turnos;
  if (marco.length === 0) {
    const h = await db.query<{ bloques: Bloque[] }>(
      `SELECT bloques FROM horarios_configuracion
        WHERE tenant_id = $1 AND medico_id = $2
          AND dia_semana = EXTRACT(DOW FROM $3::date)::int AND activo`,
      [tenantId, datos.medicoId, datos.fecha]
    );
    marco = h.rows[0]?.bloques ?? [];
  }
  if (marco.length === 0) {
    const c = await db.query<{ bloques: Bloque[] }>(
      `SELECT bloques FROM clinica_horario
        WHERE tenant_id = $1 AND dia_semana = EXTRACT(DOW FROM $2::date)::int AND abierto`,
      [tenantId, datos.fecha]
    );
    marco = c.rows[0]?.bloques ?? [];
  }
  if (marco.length === 0) return [];

  const ocupado = await ocupacionDelDia(db, tenantId, {
    fecha: datos.fecha,
    medicoId: datos.medicoId,
    salaId: datos.salaId,
    equipoIds: datos.equipoIds,
    excluirCitaId: datos.excluirCitaId,
  });

  // Las excepciones del día (feriados, vacaciones, bloqueos) también
  // tapan: se piden una vez y se suman a lo ocupado.
  const exc = await db.query<{ hora_desde: string | null; hora_hasta: string | null }>(
    `SELECT hora_desde::text, hora_hasta::text
       FROM clinica_excepciones
      WHERE tenant_id = $1 AND bloquea AND estado = 'aprobada'
        AND $2::date BETWEEN desde AND hasta
        AND (medico_id IS NULL OR medico_id = $3::uuid)`,
    [tenantId, datos.fecha, datos.medicoId]
  );
  const tapado = [
    ...ocupado.map((o) => ({ desde: o.desde, hasta: o.hasta })),
    ...exc.rows.map((e) => ({
      desde: e.hora_desde ? aMinutos(e.hora_desde) : 0,
      hasta: e.hora_hasta ? aMinutos(e.hora_hasta) : 24 * 60,
    })),
  ];

  const huecos: Hueco[] = [];
  for (const b of marco) {
    const desde = aMinutos(b.desde);
    const hasta = aMinutos(b.hasta);
    for (let t = Math.ceil(desde / paso) * paso; t + largo <= hasta; t += paso) {
      const libre = !tapado.some((o) => t < o.hasta && t + largo > o.desde);
      if (libre) {
        huecos.push({ horaInicio: aHora(t), horaFin: aHora(t + datos.duracionMinutos) });
        if (datos.limite && huecos.length >= datos.limite) return huecos;
      }
    }
  }
  return huecos;
}
