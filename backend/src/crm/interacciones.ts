import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------
// LA LÍNEA DE TIEMPO DE INTERACCIONES — prompt 03, secciones 1 a 3.
//
// `registrarInteraccion` es el punto único. Lo llaman los puntos únicos
// que cada módulo ya tiene —`crearCita`, el cierre de atención, la
// emisión de comprobantes, los cobros, `emitirNotificacion`— y SIEMPRE
// dentro de la misma transacción que el registro de origen. Por eso
// recibe el mismo `db` que el origen y no abre su propia conexión: si la
// cita se va atrás, su evento también. No puede existir un evento sin su
// origen ni un origen sin su evento.
//
// NUNCA COPIA EL CONTENIDO DEL ORIGEN. Guarda el tipo, cuándo pasó y
// dónde está el registro que lo cuenta. `resumen` es cómo se NOMBRA el
// evento en una lista ("Cita del 12 de marzo"), no el contenido: si
// alguien corrige la nota médica, el evento no queda diciendo la versión
// vieja porque nunca la tuvo.
//
// FALLAR ACÁ NO PUEDE TUMBAR EL ORIGEN. Una cita que no se agenda porque
// su evento de CRM falló sería el CRM rompiendo la clínica. Así que el
// registro atrapa su propio error y lo deja en el log; lo único que
// nunca se traga es un error de programación en los argumentos, que se
// ve en desarrollo.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export type TipoInteraccion =
  | "cliente_registrado"
  /* Anexo 07-03, B3: qué cliente lo trajo. */
  | "cliente_referido"
  | "mascota_registrada"
  | "cita_agendada"
  | "cita_confirmada"
  | "cita_reprogramada"
  | "cita_cancelada"
  | "cita_no_presentada"
  | "cita_completada"
  | "llegada"
  | "atencion_cerrada"
  | "vacuna_aplicada"
  | "desparasitacion"
  | "receta_emitida"
  | "estudio_laboratorio"
  | "grooming"
  | "consentimiento_firmado"
  | "caso_abierto"
  | "caso_cerrado"
  | "comprobante_emitido"
  | "comprobante_aceptado"
  | "comprobante_rechazado"
  | "cobro"
  | "anticipo"
  | "abono"
  | "encargo_creado"
  | "encargo_recibido"
  | "encargo_entregado"
  | "mensaje_enviado"
  | "mensaje_respondido"
  | "consentimiento_cambiado"
  | "nota_manual";

export interface SolicitudInteraccion {
  tenantId: string;
  tipo: TipoInteraccion;
  propietarioId?: string | null;
  pacienteId?: string | null;
  /** Cuándo PASÓ. Por defecto, ahora. La reconstrucción manda la real. */
  ocurridoEn?: Date | string;
  origenTabla: string;
  origenId?: string | null;
  personaId?: string | null;
  resumen?: string | null;
  canal?: string | null;
  finalidad?: string | null;
  nota?: string | null;
}

/**
 * Registra un evento en la línea de tiempo.
 *
 * Devuelve el id del evento, o `null` si ya existía (mismo tipo y mismo
 * origen) o si no se pudo registrar. Quien llama no necesita el id para
 * nada: el evento es un efecto, no el resultado de su operación.
 */
export async function registrarInteraccion(
  db: EjecutorSql,
  s: SolicitudInteraccion
): Promise<string | null> {
  // Un evento tiene que ser de alguien. Si el llamador no sabe de quién
  // —un cobro sin cliente, una venta de mostrador anónima—, no hay línea
  // de tiempo donde ponerlo y no se registra nada. No es un error: es
  // una venta sin cliente.
  if (!s.propietarioId && !s.pacienteId) return null;

  // Si vino el paciente y no el cliente, el cliente se deduce: la
  // mascota siempre tiene dueño, y la línea de tiempo del cliente tiene
  // que mostrar lo que le pasó a sus mascotas.
  let propietarioId = s.propietarioId ?? null;
  if (!propietarioId && s.pacienteId) {
    try {
      const p = await db.query<{ propietario_id: string }>(
        `SELECT propietario_id FROM pacientes WHERE id = $1`,
        [s.pacienteId]
      );
      propietarioId = p.rows[0]?.propietario_id ?? null;
    } catch {
      /* sin dueño resuelto, el evento igual sirve para la mascota */
    }
  }

  try {
    const r = await db.query<{ id: string }>(
      `INSERT INTO crm_interacciones
         (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
          persona_id, resumen, canal, finalidad, nota)
       VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, now()),$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tipo, origen_tabla, origen_id) WHERE origen_id IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [
        s.tenantId,
        propietarioId,
        s.pacienteId ?? null,
        s.tipo,
        s.ocurridoEn ?? null,
        s.origenTabla,
        s.origenId ?? null,
        s.personaId ?? null,
        s.resumen ?? null,
        s.canal ?? null,
        s.finalidad ?? null,
        s.nota ?? null,
      ]
    );
    return r.rows[0]?.id ?? null;
  } catch (err) {
    // El CRM no tumba la operación que lo llamó.
    console.error(
      `[crm] no se pudo registrar la interacción ${s.tipo} de ${s.origenTabla}:`,
      (err as Error).message
    );
    return null;
  }
}

// ---------------------------------------------------------------------
// LECTURA
//
// EL DETALLE CLÍNICO SOLO LO VE QUIEN PUEDE. El tipo, la fecha y el
// enlace los ve todo el personal —la recepción necesita saber que hubo
// una visita para atender el teléfono—, pero el resumen y la nota de un
// evento marcado como clínico se reemplazan por una leyenda cuando quien
// mira no es médico. No se oculta el evento: ocultarlo le haría creer a
// la recepción que ese día no pasó nada.
// ---------------------------------------------------------------------

export interface FiltrosLinea {
  propietarioId?: string;
  pacienteId?: string;
  tipos?: string[];
  modulo?: string;
  desde?: string;
  hasta?: string;
  limite?: number;
}

export interface EventoLinea {
  id: string;
  tipo: string;
  etiqueta: string;
  modulo: string;
  clinico: boolean;
  ocurrido_en: string;
  origen_tabla: string;
  origen_id: string | null;
  /** Si el registro de origen todavía existe. */
  origen_existe: boolean;
  resumen: string | null;
  canal: string | null;
  finalidad: string | null;
  nota: string | null;
  persona_nombre: string | null;
  paciente_id: string | null;
  paciente_nombre: string | null;
  propietario_id: string | null;
}

export async function lineaDeInteracciones(
  db: PoolClient,
  filtros: FiltrosLinea,
  puedeVerClinico: boolean
): Promise<EventoLinea[]> {
  const cond: string[] = [];
  const val: unknown[] = [];
  const agregar = (sql: string, v: unknown) => {
    val.push(v);
    cond.push(sql.replace("$?", `$${val.length}`));
  };

  if (filtros.propietarioId) agregar("i.propietario_id = $?", filtros.propietarioId);
  if (filtros.pacienteId) agregar("i.paciente_id = $?", filtros.pacienteId);
  if (filtros.tipos && filtros.tipos.length > 0) agregar("i.tipo = ANY($?)", filtros.tipos);
  if (filtros.modulo) agregar("t.modulo = $?", filtros.modulo);
  if (filtros.desde) agregar("i.ocurrido_en >= $?::date", filtros.desde);
  if (filtros.hasta) agregar("i.ocurrido_en < ($?::date + interval '1 day')", filtros.hasta);

  const limite = Math.min(filtros.limite ?? 200, 500);

  const r = await db.query<EventoLinea>(
    `SELECT i.id, i.tipo, t.etiqueta, t.modulo, t.clinico, i.ocurrido_en,
            i.origen_tabla, i.origen_id,
            i.resumen, i.canal, i.finalidad, i.nota,
            p.nombre AS persona_nombre,
            i.paciente_id, pa.nombre AS paciente_nombre, i.propietario_id
       FROM crm_interacciones i
       JOIN crm_tipos_evento t ON t.codigo = i.tipo
       LEFT JOIN personas p ON p.id = i.persona_id
       LEFT JOIN pacientes pa ON pa.id = i.paciente_id
      ${cond.length > 0 ? `WHERE ${cond.join(" AND ")}` : ""}
      ORDER BY i.ocurrido_en DESC, i.creado_en DESC
      LIMIT ${limite}`,
    val
  );

  // ¿Sigue existiendo el origen? Se pregunta por tabla, en lote: una
  // consulta por evento serían doscientas consultas para una pantalla.
  const porTabla = new Map<string, string[]>();
  for (const e of r.rows) {
    if (!e.origen_id) continue;
    if (!TABLAS_DE_ORIGEN.has(e.origen_tabla)) continue;
    const lista = porTabla.get(e.origen_tabla) ?? [];
    lista.push(e.origen_id);
    porTabla.set(e.origen_tabla, lista);
  }
  const vivos = new Set<string>();
  for (const [tabla, ids] of porTabla) {
    const q = await db.query<{ id: string }>(
      `SELECT id FROM ${tabla} WHERE id = ANY($1)`,
      [ids]
    );
    for (const f of q.rows) vivos.add(`${tabla}:${f.id}`);
  }

  return r.rows.map((e) => ({
    ...e,
    origen_existe: !e.origen_id || vivos.has(`${e.origen_tabla}:${e.origen_id}`),
    resumen:
      e.clinico && !puedeVerClinico
        ? "Detalle clínico: lo ve el personal médico"
        : e.resumen,
    nota: e.clinico && !puedeVerClinico ? null : e.nota,
  }));
}

/**
 * Las tablas que un evento puede referenciar.
 *
 * Es una lista blanca porque `origen_tabla` se interpola en el SQL para
 * preguntar si el registro vive. Sin la lista, un valor raro en esa
 * columna sería una inyección; con la lista, lo peor que pasa es que un
 * origen desconocido se reporte como "no se puede verificar".
 */
const TABLAS_DE_ORIGEN = new Set([
  "propietarios",
  "archivos",
  "exp_atencion_items",
  "pacientes",
  "citas",
  "atenciones",
  "cuidados_preventivos",
  "recetas",
  "casos",
  "exp_estudios_lab",
  "exp_grooming",
  "exp_consentimientos",
  "fact_comprobantes",
  "vta_cobros",
  "vta_anticipos",
  "vta_abonos",
  "vta_encargos",
  "crm_mensajes",
  "crm_respuestas",
  "crm_consentimiento_historial",
]);

/** Una nota que escribe la recepción. Es el único evento que no tiene otro origen. */
export async function agregarNota(
  db: PoolClient,
  tenantId: string,
  datos: {
    propietarioId?: string;
    pacienteId?: string;
    texto: string;
    personaId: string;
  }
): Promise<string> {
  if (!datos.texto?.trim()) {
    throw new Error("Una nota sin texto no dice nada: escribí qué pasó.");
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO crm_interacciones
       (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, persona_id,
        resumen, nota)
     VALUES ($1,$2,$3,'nota_manual',now(),'crm_interacciones',$4,$5,$6)
     RETURNING id`,
    [
      tenantId,
      datos.propietarioId ?? null,
      datos.pacienteId ?? null,
      datos.personaId,
      datos.texto.trim().slice(0, 120),
      datos.texto.trim(),
    ]
  );
  return r.rows[0].id;
}

export async function tiposDeEvento(
  db: PoolClient
): Promise<Array<{ codigo: string; etiqueta: string; modulo: string; clinico: boolean }>> {
  const r = await db.query<{
    codigo: string;
    etiqueta: string;
    modulo: string;
    clinico: boolean;
  }>(`SELECT codigo, etiqueta, modulo, clinico FROM crm_tipos_evento ORDER BY orden, etiqueta`);
  return r.rows;
}
