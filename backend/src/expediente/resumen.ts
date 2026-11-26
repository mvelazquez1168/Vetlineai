import { PoolClient } from "pg";
import { NOMBRE_DOCUMENTO_PREDISPOSICIONES, seleccionarSeccionRaza } from "../razaDocumento";
import { alergiasDePaciente, problemasDePaciente } from "./clinico";
import { normalizarEspecie } from "./laboratorio";
import { hallazgosPendientes } from "./grooming";

// ---------------------------------------------------------------------
// EL EXPEDIENTE COMO LECTURA: encabezado, franja de alertas, línea de
// tiempo, búsqueda en la historia, evolución y ficha racial.
//
// Secciones 2, 3 y 8 del prompt 07. Todo acá es SOLO LECTURA y nada se
// guarda: el expediente muestra lo que ya existe en citas, atenciones,
// preventivos, recetas, casos, estudios, archivos, grooming,
// consentimientos y comprobantes. No hay una tabla "expediente", y por
// eso no hay nada que pueda quedar desincronizado.
//
// LA LÍNEA DE TIEMPO ES UN UNION, no una tabla de eventos. La tabla de
// eventos del CRM (prompt 03) va a existir para lo que le pasa al
// CLIENTE a través de los módulos; la historia clínica del paciente ya
// está escrita en sus propias tablas, y copiarla a una línea de tiempo
// propia sería mantener dos verdades sobre la misma visita.
// ---------------------------------------------------------------------

export interface AlertaExpediente {
  tipo: "alergia" | "manejo" | "cronico" | "preventivo" | "saldo" | "hallazgo" | "estudio";
  severidad: "alta" | "media" | "baja";
  texto: string;
  detalle?: string;
}

export interface Encabezado {
  paciente: Record<string, unknown>;
  cliente: Record<string, unknown> | null;
  alertas: AlertaExpediente[];
  problemas: Awaited<ReturnType<typeof problemasDePaciente>>;
  alergias: Awaited<ReturnType<typeof alergiasDePaciente>>;
  medicacionActiva: Array<{
    receta_id: string;
    medicamento: string;
    dosis: string | null;
    frecuencia: string | null;
    duracion: string | null;
    emitido_en: string | null;
    fecha_fin: string | null;
    duracionEstructurada: boolean;
  }>;
  completitud: { porcentaje: number; faltan: string[] };
  pesoActual: number | null;
}

/** Días que una duración en texto representa, si se puede leer. */
export function diasDeDuracion(texto: string | null): number | null {
  if (!texto) return null;
  const t = texto.toLowerCase();
  const n = Number((t.match(/(\d+(?:[.,]\d+)?)/) ?? [])[1]?.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (/sem/.test(t)) return Math.round(n * 7);
  if (/mes/.test(t)) return Math.round(n * 30);
  if (/d[ií]a/.test(t)) return Math.round(n);
  // Un número suelto se lee como días: es lo que escribe todo el mundo.
  return Math.round(n);
}

/**
 * El encabezado del expediente: quién es el paciente y qué hay que
 * saber antes de tocarlo.
 *
 * LA FRANJA DE ALERTAS mezcla cosas de distinto origen a propósito —una
 * alergia, un hallazgo del groomer, un preventivo vencido, un resultado
 * de laboratorio sin mirar y el saldo del cliente— porque el médico no
 * tiene que ir a buscarlas a cinco pestañas distintas antes de empezar.
 *
 * EL SALDO va aparte en la respuesta (`alertas` lo incluye solo si
 * `verSaldo`): es un dato del cliente, no del paciente, y no todo el
 * personal tiene permiso de verlo.
 */
export async function encabezadoDeExpediente(
  db: PoolClient,
  pacienteId: string,
  opciones: { verSaldo?: boolean } = {}
): Promise<Encabezado> {
  const p = await db.query(
    `SELECT pa.*, r.nombre AS raza_nombre,
            (SELECT max(a.peso) FILTER (WHERE a.peso IS NOT NULL)
               FROM atenciones a WHERE a.paciente_id = pa.id
                AND a.creado_en = (SELECT max(a2.creado_en) FROM atenciones a2
                                    WHERE a2.paciente_id = pa.id AND a2.peso IS NOT NULL))
              AS peso_actual
       FROM pacientes pa
       LEFT JOIN razas r ON r.id = pa.raza_id
      WHERE pa.id = $1`,
    [pacienteId]
  );
  if (p.rows.length === 0) throw new Error("Ese paciente no existe.");
  const paciente = p.rows[0] as Record<string, unknown>;

  const cliente = paciente.propietario_id
    ? (
        await db.query(
          `SELECT id, nombre, telefono, email, numero_identificacion
             FROM propietarios WHERE id = $1`,
          [paciente.propietario_id]
        )
      ).rows[0] ?? null
    : null;

  // En ORDEN y no con Promise.all: `db` es UN cliente de Postgres, y
  // node-postgres no admite dos consultas a la vez sobre el mismo
  // cliente (avisa por deprecación y en pg@9 falla). Paralelizar acá no
  // ahorraría nada igual: la transacción es una sola.
  const problemas = await problemasDePaciente(db, pacienteId);
  const alergias = await alergiasDePaciente(db, pacienteId);
  const hallazgos = await hallazgosPendientes(db, pacienteId);

  // Preventivos vencidos: la fecha recomendada ya pasó.
  const preventivos = await db.query<{ tipo: string; vacuna: string | null; fecha: string }>(
    `SELECT tipo, vacuna, fecha_proxima_recomendada::text AS fecha
       FROM cuidados_preventivos
      WHERE paciente_id = $1 AND fecha_proxima_recomendada IS NOT NULL
        AND fecha_proxima_recomendada < CURRENT_DATE
      ORDER BY fecha_proxima_recomendada`,
    [pacienteId]
  );

  // Resultados de laboratorio que llegaron y nadie miró.
  const sinVer = await db.query<{ n: string; alterados: string }>(
    `SELECT count(*)::text AS n,
            COALESCE(sum((SELECT count(*) FROM exp_lab_resultados r
                           WHERE r.estudio_id = e.id AND r.bandera IN ('alto','bajo'))), 0)::text
              AS alterados
       FROM exp_estudios_lab e
      WHERE e.paciente_id = $1 AND e.estado = 'resultado_recibido' AND e.visto_en IS NULL`,
    [pacienteId]
  );

  const alertas: AlertaExpediente[] = [];
  for (const a of alergias) {
    alertas.push({
      tipo: "alergia",
      severidad: a.severidad === "grave" ? "alta" : "media",
      texto: `${a.tipo === "alergia" ? "Alergia" : "Reacción adversa"} a ${a.sustancia}`,
      detalle: a.reaccion ?? a.nota ?? undefined,
    });
  }
  // La nota libre de la ficha se muestra TAMBIÉN, etiquetada: existe
  // desde antes y es texto que alguien escribió para que se lea. Lo que
  // no hace es disparar la alerta al recetar — para eso están las
  // alergias estructuradas de arriba.
  if (typeof paciente.alergias === "string" && paciente.alergias.trim() !== "") {
    alertas.push({
      tipo: "alergia",
      severidad: "media",
      texto: "Nota de alergias en la ficha",
      detalle: String(paciente.alergias),
    });
  }
  if (typeof paciente.alerta_manejo === "string" && paciente.alerta_manejo.trim() !== "") {
    alertas.push({
      tipo: "manejo",
      severidad: "alta",
      texto: "Alerta de manejo",
      detalle: String(paciente.alerta_manejo),
    });
  }
  for (const pr of problemas.filter((x) => x.estado === "cronico")) {
    alertas.push({ tipo: "cronico", severidad: "media", texto: `Crónico: ${pr.descripcion}` });
  }
  for (const v of preventivos.rows) {
    alertas.push({
      tipo: "preventivo",
      severidad: "media",
      texto: `${v.tipo === "vacunacion" ? "Vacuna" : "Desparasitación"} vencida${v.vacuna ? ` (${v.vacuna})` : ""}`,
      detalle: `vencía el ${v.fecha}`,
    });
  }
  for (const h of hallazgos) {
    alertas.push({
      tipo: "hallazgo",
      severidad: "alta",
      texto: `Hallazgo del groomer: ${h.tipo}`,
      detalle: String(h.descripcion),
    });
  }
  if (Number(sinVer.rows[0].n) > 0) {
    alertas.push({
      tipo: "estudio",
      severidad: Number(sinVer.rows[0].alterados) > 0 ? "alta" : "media",
      texto: `${sinVer.rows[0].n} resultado(s) de laboratorio sin revisar`,
      detalle:
        Number(sinVer.rows[0].alterados) > 0
          ? `${sinVer.rows[0].alterados} valor(es) fuera de rango`
          : undefined,
    });
  }

  if (opciones.verSaldo && cliente) {
    const saldo = await db.query<{ total: string }>(
      // El pendiente se calcula POR FACTURA y después se suma: restar
      // los abonos del total agregado haría que Postgres se quejara —y
      // con razón— de una subconsulta correlacionada dentro de un
      // agregado.
      `SELECT COALESCE(sum(f.total_comprobante - COALESCE((
                SELECT sum(aa.monto) FROM vta_abono_aplicaciones aa
                 WHERE aa.comprobante_id = f.id), 0)), 0)::text AS total
         FROM fact_comprobantes f
        WHERE f.receptor_propietario_id = $1 AND f.tipo_comprobante = '01'
          AND f.condicion_venta IN ('02','10')
          AND f.estado IN ('aceptado','aceptado_parcial','enviado','en_cola')`,
      [cliente.id]
    );
    const total = Number(saldo.rows[0].total);
    if (total > 0) {
      alertas.push({
        tipo: "saldo",
        severidad: "media",
        // Con formato de moneda: «El cliente tiene 20510 pendiente» se
        // lee como un numero de referencia, no como plata. El resto de
        // la interfaz muestra colones formateados y esta alerta era la
        // unica que no.
        texto: `El cliente tiene ${new Intl.NumberFormat("es-CR", {
          style: "currency",
          currency: "CRC",
          maximumFractionDigits: 0,
        }).format(total)} pendiente`,
      });
    }
  }

  // --- Medicación activa --------------------------------------------
  //
  // Lo recetado cuya duración no terminó. La duración está en TEXTO
  // ("7 días", "una semana") porque así se guardó siempre, así que se
  // interpreta y se dice cuándo no se pudo: una medicación cuya
  // duración no se entiende se muestra igual, marcada, en vez de
  // desaparecer de la lista.
  const items = await db.query<{
    receta_id: string;
    medicamento: string;
    dosis: string | null;
    frecuencia: string | null;
    duracion: string | null;
    emitido_en: string | null;
  }>(
    // `nombre_impreso` y no el JOIN con `medicamentos` (migracion 117):
    // una linea del 07c puede salir del inventario o ser texto libre, y
    // con el COALESCE viejo todas esas decian "Medicamento".
    //
    // La duracion estructurada gana sobre el texto cuando esta: es la
    // misma informacion, pero no hay que adivinarla.
    `SELECT r.id AS receta_id, i.nombre_impreso AS medicamento,
            i.dosis, i.frecuencia,
            CASE WHEN i.duracion_cantidad IS NOT NULL
                 THEN i.duracion_cantidad || ' ' || i.duracion_unidad
                 ELSE i.duracion END AS duracion,
            COALESCE(r.emitido_en, r.creado_en)::text AS emitido_en
       FROM recetas r
       JOIN receta_items i ON i.receta_id = r.id
      WHERE r.paciente_id = $1 AND r.estado <> 'anulada'
      ORDER BY COALESCE(r.emitido_en, r.creado_en) DESC NULLS LAST, i.orden`,
    [pacienteId]
  );

  const ahora = Date.now();
  const medicacionActiva = items.rows
    .map((i) => {
      const dias = diasDeDuracion(i.duracion);
      const desde = i.emitido_en ? new Date(i.emitido_en).getTime() : null;
      const fin = dias !== null && desde !== null ? desde + dias * 86400000 : null;
      return {
        ...i,
        fecha_fin: fin ? new Date(fin).toISOString().slice(0, 10) : null,
        duracionEstructurada: dias !== null,
        activa: fin === null ? true : fin >= ahora,
      };
    })
    .filter((i) => i.activa)
    .map(({ activa: _activa, ...resto }) => resto);

  // --- Completitud ---------------------------------------------------
  const faltan: string[] = [];
  if (!paciente.especie) faltan.push("especie");
  if (!paciente.raza && !paciente.raza_id) faltan.push("raza");
  if (!paciente.sexo) faltan.push("sexo");
  if (!paciente.estado_reproductivo) faltan.push("estado reproductivo");
  if (!paciente.fecha_nacimiento && !paciente.edad_anios) faltan.push("edad o fecha de nacimiento");
  if (!paciente.peso_actual) faltan.push("peso");
  if (!paciente.microchip) faltan.push("microchip");
  if (alergias.length === 0 && !paciente.alergias) faltan.push("alergias");
  if (!cliente) faltan.push("cliente");

  const total = 9;
  const completitud = {
    porcentaje: Math.round(((total - faltan.length) / total) * 100),
    faltan,
  };

  return {
    paciente,
    cliente,
    alertas: alertas.sort(
      (a, b) =>
        ["alta", "media", "baja"].indexOf(a.severidad) -
        ["alta", "media", "baja"].indexOf(b.severidad)
    ),
    problemas,
    alergias,
    medicacionActiva,
    completitud,
    pesoActual: paciente.peso_actual ? Number(paciente.peso_actual) : null,
  };
}

export interface EventoHistoria {
  tipo: string;
  fecha: string;
  titulo: string;
  detalle: string | null;
  medico: string | null;
  referencia_id: string;
}

/**
 * LA LÍNEA DE TIEMPO DEL PACIENTE — ahora LEE DE LA TABLA DEL CRM.
 *
 * Hasta el prompt 03 esto era un `UNION ALL` sobre las tablas de origen.
 * Funcionaba, pero dejaba DOS historias del mismo paciente: esta y la
 * del CRM. Dos historias que pueden divergir son peores que una
 * incompleta, porque nadie sabe cuál mirar.
 *
 * Ahora hay una sola tabla de eventos —`crm_interacciones`— y esta
 * función la filtra por la mascota. El DETALLE no está en el evento (el
 * evento nunca copia el contenido del origen): se resuelve leyendo el
 * registro referenciado, que es exactamente lo que el prompt 03 pide.
 * De ahí los `LEFT JOIN` por tabla de origen.
 *
 * Los nombres de tipo que la pantalla del expediente ya usaba —`visita`,
 * `vacuna`, `documento`…— se mantienen: el CRM los llama de otra forma
 * porque habla de la relación con el cliente, no del expediente. La
 * traducción vive acá, en un solo lugar.
 */
const TIPO_CRM_A_EXPEDIENTE: Record<string, string> = {
  atencion_cerrada: "visita",
  vacuna_aplicada: "vacuna",
  desparasitacion: "desparasitacion",
  receta_emitida: "receta",
  estudio_laboratorio: "laboratorio",
  grooming: "grooming",
  documento_adjunto: "documento",
  consentimiento_firmado: "consentimiento",
  caso_abierto: "caso",
};

const TIPO_EXPEDIENTE_A_CRM: Record<string, string[]> = {
  visita: ["atencion_cerrada"],
  vacuna: ["vacuna_aplicada"],
  desparasitacion: ["desparasitacion"],
  receta: ["receta_emitida"],
  laboratorio: ["estudio_laboratorio"],
  grooming: ["grooming"],
  documento: ["documento_adjunto"],
  consentimiento: ["consentimiento_firmado"],
  caso: ["caso_abierto"],
};

export async function lineaDeTiempo(
  db: PoolClient,
  pacienteId: string,
  filtros: { tipo?: string; desde?: string; hasta?: string; medicoId?: string; limite?: number } = {}
): Promise<EventoHistoria[]> {
  const limite = Math.min(Math.max(filtros.limite ?? 200, 1), 1000);
  const tiposCrm = filtros.tipo ? TIPO_EXPEDIENTE_A_CRM[filtros.tipo] ?? [filtros.tipo] : null;

  const r = await db.query<EventoHistoria & { tipo_crm: string }>(
    `SELECT i.tipo AS tipo_crm,
            i.ocurrido_en AS fecha,
            -- EL TÍTULO: el del origen cuando el origen lo tiene mejor
            -- que el resumen del evento, y la etiqueta del catálogo
            -- cuando no.
            COALESCE(
              CASE i.tipo
                WHEN 'atencion_cerrada' THEN COALESCE(ci.motivo_consulta, 'Consulta')
                WHEN 'vacuna_aplicada' THEN COALESCE(cp.vacuna, 'Vacuna')
                WHEN 'desparasitacion' THEN COALESCE(cp.producto_desparasitacion, 'Desparasitación')
                WHEN 'receta_emitida' THEN 'Prescripción'
                WHEN 'estudio_laboratorio' THEN COALESCE(el.tipo_estudio, 'Laboratorio')
                WHEN 'grooming' THEN 'Grooming'
                WHEN 'documento_adjunto' THEN COALESCE(ar.tipo_documento, 'Documento')
                WHEN 'consentimiento_firmado' THEN COALESCE(cons.titulo, 'Consentimiento')
                WHEN 'caso_abierto' THEN COALESCE(ca.motivo, 'Caso de Vetline Ai')
              END,
              i.resumen, te.etiqueta
            ) AS titulo,
            -- EL DETALLE: se lee del origen. El evento no lo copia, y
            -- por eso una nota corregida se ve corregida también acá.
            CASE i.tipo
              WHEN 'atencion_cerrada' THEN at.nota_medica
              WHEN 'vacuna_aplicada' THEN
                CASE WHEN cp.lote IS NOT NULL THEN 'lote ' || cp.lote ELSE NULL END
              WHEN 'desparasitacion' THEN cp.subtipo_desparasitacion
              WHEN 'receta_emitida' THEN
                (SELECT string_agg(COALESCE(m.nombre, 'ítem'), ', ')
                   FROM receta_items ri LEFT JOIN medicamentos m ON m.id = ri.medicamento_id
                  WHERE ri.receta_id = i.origen_id)
              WHEN 'estudio_laboratorio' THEN
                (SELECT count(*) || ' resultado(s), ' ||
                        count(*) FILTER (WHERE lr.bandera IS NOT NULL AND lr.bandera <> 'normal')
                        || ' fuera de rango'
                   FROM exp_lab_resultados lr WHERE lr.estudio_id = i.origen_id)
              WHEN 'grooming' THEN gr.observaciones
              WHEN 'documento_adjunto' THEN COALESCE(ar.descripcion, ar.nombre_archivo)
              WHEN 'consentimiento_firmado' THEN 'firmado por ' || cons.firmante_nombre
              WHEN 'caso_abierto' THEN ca.diagnostico_final
            END AS detalle,
            per.nombre AS medico,
            COALESCE(i.origen_id, i.id) AS referencia_id
       FROM crm_interacciones i
       JOIN crm_tipos_evento te ON te.codigo = i.tipo
       LEFT JOIN personas per ON per.id = i.persona_id
       LEFT JOIN atenciones at ON i.tipo = 'atencion_cerrada' AND at.id = i.origen_id
       LEFT JOIN citas ci ON ci.id = at.cita_id
       LEFT JOIN cuidados_preventivos cp
              ON i.tipo IN ('vacuna_aplicada', 'desparasitacion') AND cp.id = i.origen_id
       LEFT JOIN exp_estudios_lab el ON i.tipo = 'estudio_laboratorio' AND el.id = i.origen_id
       LEFT JOIN exp_grooming gr ON i.tipo = 'grooming' AND gr.id = i.origen_id
       LEFT JOIN archivos ar ON i.tipo = 'documento_adjunto' AND ar.id = i.origen_id
       LEFT JOIN exp_consentimientos cons
              ON i.tipo = 'consentimiento_firmado' AND cons.id = i.origen_id
       LEFT JOIN casos ca ON i.tipo = 'caso_abierto' AND ca.id = i.origen_id
      WHERE i.paciente_id = $1
        AND i.tipo = ANY($2::varchar[])
        AND ($3::date IS NULL OR i.ocurrido_en >= $3::date)
        AND ($4::date IS NULL OR i.ocurrido_en < $4::date + interval '1 day')
        AND ($5::uuid IS NULL OR i.persona_id = $5::uuid)
      ORDER BY i.ocurrido_en DESC, i.creado_en DESC
      LIMIT ${limite}`,
    [
      pacienteId,
      tiposCrm ?? Object.keys(TIPO_CRM_A_EXPEDIENTE),
      filtros.desde ?? null,
      filtros.hasta ?? null,
      filtros.medicoId ?? null,
    ]
  );

  return r.rows.map((e) => ({
    tipo: TIPO_CRM_A_EXPEDIENTE[e.tipo_crm] ?? e.tipo_crm,
    fecha: e.fecha,
    titulo: e.titulo,
    detalle: e.detalle,
    medico: e.medico,
    referencia_id: e.referencia_id,
  }));
}

/**
 * BÚSQUEDA POR PALABRA dentro de toda la historia del paciente.
 *
 * Busca en las notas de las atenciones, en las adendas, en los nombres
 * de los medicamentos recetados, en los analitos de laboratorio, en las
 * observaciones y hallazgos de grooming y en las descripciones de los
 * documentos. Es `ILIKE` con `unaccent` y no trigramas: acá se busca una
 * palabra que el médico sabe que escribió ("vómito", "carprofeno"), no
 * un nombre mal tipeado.
 */
export async function buscarEnHistoria(
  db: PoolClient,
  pacienteId: string,
  texto: string
): Promise<Array<{ tipo: string; fecha: string; donde: string; fragmento: string; referencia_id: string }>> {
  const q = texto.trim();
  if (q.length < 2) return [];

  const r = await db.query<{
    tipo: string;
    fecha: string;
    donde: string;
    fragmento: string;
    referencia_id: string;
  }>(
    `WITH patron AS (SELECT '%' || inmutable_unaccent(lower($2)) || '%' AS p)
     SELECT 'visita' AS tipo, a.creado_en AS fecha, 'nota de la visita' AS donde,
            a.nota_medica AS fragmento, a.id AS referencia_id
       FROM atenciones a, patron
      WHERE a.paciente_id = $1 AND inmutable_unaccent(lower(a.nota_medica)) LIKE patron.p
     UNION ALL
     SELECT 'adenda', ad.creado_en, 'adenda: ' || ad.motivo, ad.texto, ad.atencion_id
       FROM exp_adendas ad
       JOIN atenciones a ON a.id = ad.atencion_id, patron
      WHERE a.paciente_id = $1 AND inmutable_unaccent(lower(ad.texto)) LIKE patron.p
     UNION ALL
     SELECT 'receta', COALESCE(rec.emitido_en, rec.creado_en), 'prescripción',
            COALESCE(m.nombre, '') || ' ' || COALESCE(i.dosis, ''), rec.id
       FROM recetas rec
       JOIN receta_items i ON i.receta_id = rec.id
       LEFT JOIN medicamentos m ON m.id = i.medicamento_id, patron
      WHERE rec.paciente_id = $1
        AND (inmutable_unaccent(lower(COALESCE(m.nombre, ''))) LIKE patron.p
             OR inmutable_unaccent(lower(COALESCE(i.observaciones, ''))) LIKE patron.p)
     UNION ALL
     SELECT 'laboratorio', COALESCE(e.fecha_resultado, e.fecha_solicitud),
            e.tipo_estudio || ' · ' || res.analito_texto,
            COALESCE(res.valor::text, res.valor_texto, '') || ' ' || COALESCE(res.unidad, ''), e.id
       FROM exp_estudios_lab e
       JOIN exp_lab_resultados res ON res.estudio_id = e.id, patron
      WHERE e.paciente_id = $1 AND inmutable_unaccent(lower(res.analito_texto)) LIKE patron.p
     UNION ALL
     SELECT 'grooming', g.fecha, 'grooming', COALESCE(g.observaciones, ''), g.id
       FROM exp_grooming g, patron
      WHERE g.paciente_id = $1 AND inmutable_unaccent(lower(COALESCE(g.observaciones,''))) LIKE patron.p
     UNION ALL
     SELECT 'hallazgo', h.creado_en, 'hallazgo del groomer: ' || h.tipo, h.descripcion, h.grooming_id
       FROM exp_grooming_hallazgos h, patron
      WHERE h.paciente_id = $1 AND inmutable_unaccent(lower(h.descripcion)) LIKE patron.p
     UNION ALL
     SELECT 'documento', COALESCE(ar.fecha_documento::timestamptz, ar.creado_en),
            COALESCE(ar.tipo_documento, 'documento'),
            COALESCE(ar.descripcion, ar.nombre_archivo), ar.id
       FROM archivos ar, patron
      WHERE ar.paciente_id = $1
        AND (inmutable_unaccent(lower(COALESCE(ar.descripcion,''))) LIKE patron.p
             OR inmutable_unaccent(lower(ar.nombre_archivo)) LIKE patron.p)
     UNION ALL
     SELECT 'problema', p.creado_en, 'lista de problemas', p.descripcion, p.id
       FROM exp_problemas p, patron
      WHERE p.paciente_id = $1 AND inmutable_unaccent(lower(p.descripcion)) LIKE patron.p
      ORDER BY fecha DESC
      LIMIT 100`,
    [pacienteId, q]
  );
  return r.rows;
}

/** Peso y signos vitales en el tiempo, para los gráficos de evolución. */
export async function evolucion(db: PoolClient, pacienteId: string) {
  const r = await db.query(
    `SELECT a.creado_en AS fecha, a.peso, a.temperatura, per.nombre AS medico
       FROM atenciones a
       LEFT JOIN personas per ON per.id = a.medico_id
      WHERE a.paciente_id = $1 AND (a.peso IS NOT NULL OR a.temperatura IS NOT NULL)
      ORDER BY a.creado_en`,
    [pacienteId]
  );
  return r.rows;
}

export interface FichaRacial {
  raza: string | null;
  especie: string;
  /** El texto de la sección del documento, tal como está escrito. */
  texto: string | null;
  coincidio: boolean;
  /** Si la sección agrupa varias razas, se dice. */
  seccionAgrupada: boolean;
  motivo: string | null;
}

/**
 * LA FICHA RACIAL sale del DOCUMENTO de la base de conocimiento, nunca
 * de un texto escrito a mano acá.
 *
 * Reusa `seleccionarSeccionRaza`, el mismo selector que arma el bloque
 * racial de un caso de Vetline Ai, y el mapeo explícito de
 * `razas_alias_documento`. Si la raza no tiene cobertura, se dice; si la
 * sección agrupa varias razas, se dice; y en mestizo o raza desconocida
 * NO se muestra nada — inventar predisposiciones de un mestizo es
 * exactamente el error que este diseño evita.
 */
export async function fichaRacial(db: PoolClient, pacienteId: string): Promise<FichaRacial> {
  const p = await db.query<{ especie: string; raza: string | null; raza_id: string | null }>(
    `SELECT pa.especie, COALESCE(r.nombre, pa.raza) AS raza, pa.raza_id
       FROM pacientes pa LEFT JOIN razas r ON r.id = pa.raza_id
      WHERE pa.id = $1`,
    [pacienteId]
  );
  if (p.rows.length === 0) throw new Error("Ese paciente no existe.");
  const { especie, raza, raza_id } = p.rows[0];

  const esMestizo =
    !raza ||
    /mestiz|criollo|desconocid|mixto|sin raza/i.test(raza) ||
    raza.trim() === "";
  if (esMestizo) {
    return {
      raza,
      especie,
      texto: null,
      coincidio: false,
      seccionAgrupada: false,
      motivo:
        "El paciente es mestizo o no tiene raza registrada. Las predisposiciones raciales no aplican, y mostrar las de alguna raza elegida al azar sería inventar un dato clínico.",
    };
  }

  const doc = await db.query<{ id: string; contenido_texto: string | null }>(
    `SELECT id, contenido_texto FROM documentos_conocimiento
      WHERE nombre = $1 AND estado = 'activo' LIMIT 1`,
    [NOMBRE_DOCUMENTO_PREDISPOSICIONES]
  );
  if (!doc.rows[0]?.contenido_texto) {
    return {
      raza,
      especie,
      texto: null,
      coincidio: false,
      seccionAgrupada: false,
      motivo:
        "El documento de predisposiciones raciales no está cargado en esta instalación, así que no hay de dónde leerlas.",
    };
  }

  // El mapeo explícito: qué sección del documento corresponde a esta
  // raza, cargado en `razas_alias_documento`.
  const alias = raza_id
    ? await db.query<{ titulo_seccion: string; nota: string | null }>(
        `SELECT titulo_seccion, nota FROM razas_alias_documento
          WHERE raza_id = $1 AND documento_id = $2`,
        [raza_id, doc.rows[0].id]
      )
    : null;

  const resultado = seleccionarSeccionRaza(
    doc.rows[0].contenido_texto,
    // El selector del documento mapea 'Canino' → "PERROS" con la clave
    // exacta: un paciente guardado como 'canino' no coincidiría y la
    // ficha diría "sin cobertura" sobre una raza que sí está.
    normalizarEspecie(especie),
    raza,
    alias?.rows[0]?.titulo_seccion ?? null,
    alias?.rows[0]?.nota ?? null
  );

  return {
    raza,
    especie,
    texto: resultado.coincidio ? resultado.texto : null,
    coincidio: resultado.coincidio,
    seccionAgrupada: !!alias?.rows[0]?.nota,
    motivo: resultado.coincidio
      ? alias?.rows[0]?.nota ?? null
      : `El documento de predisposiciones no tiene una sección para ${raza}. No se muestra nada en vez de mostrar la de una raza parecida.`,
  };
}
